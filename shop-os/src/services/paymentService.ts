import { Payment } from '../models/Payment.js'
import { UnmatchedIpn } from '../models/UnmatchedIpn.js'
import { Order } from '../models/Order.js'
import { PaymentAudit } from '../models/PaymentAudit.js'
import { log } from '../utils/logger.js'
import { confirmPayment as ipnConfirmPayment } from './paymentService.js'
import type { IPayment, PaymentStatus } from '../models/Payment.js'

function generatePaymentId(): string {
	return 'PAY-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 4).toUpperCase()
}

export async function recordPaymentAudit(
	orderId: string,
	fromStatus: string,
	toStatus: string,
	actor: string,
	detail = '',
	paymentId = ''
): Promise<void> {
	await PaymentAudit.create({
		orderId,
		paymentId,
		fromStatus,
		toStatus,
		actor,
		detail,
	})
}

export async function createPaymentRecord(
	orderId: string,
	buyerPhone: string,
	amount: number,
	deliveryFee: number,
	method: 'mpesa' | 'cod' | 'prepaid'
): Promise<IPayment> {
	const existing = await Payment.findOne({ orderId })
	if (existing) return existing

	const payment = new Payment({
		paymentId: generatePaymentId(),
		orderId,
		buyerPhone,
		amount,
		deliveryFee,
		totalAmount: amount + deliveryFee,
		method,
		status: 'pending',
	})
	await payment.save()
	await recordPaymentAudit(orderId, 'none', 'pending', 'system', `method=${method}`, payment.paymentId)
	log(`[PAYMENT] Created ${payment.paymentId} for order ${orderId} method=${method}`)
	return payment
}

export async function recordMpesaRef(orderId: string, mpesaRef: string, mpesaPhone: string): Promise<{ payment: IPayment | null; confirmed: boolean; manualReview: boolean }> {
	return submitMpesaRef(orderId, mpesaRef, mpesaPhone)
}

export async function submitMpesaRef(
	orderId: string,
	mpesaRef: string,
	mpesaPhone: string
): Promise<{ payment: IPayment | null; confirmed: boolean; manualReview: boolean }> {
	const payment = await Payment.findOne({ orderId })
	if (!payment) return { payment: null, confirmed: false, manualReview: false }

	const duplicateRef = await Payment.findOne({
		mpesaRef,
		orderId: { $ne: orderId },
		status: { $in: ['ref_submitted', 'confirmed', 'manual_review'] },
	})
	if (duplicateRef) {
		const fromStatus = payment.status
		payment.status = 'manual_review'
		payment.mpesaRef = mpesaRef
		payment.mpesaPhone = mpesaPhone
		payment.updatedAt = new Date()
		await payment.save()
		await recordPaymentAudit(
			orderId,
			fromStatus,
			'manual_review',
			'buyer_ref',
			`Duplicate ref used on ${duplicateRef.orderId}`,
			payment.paymentId
		)
		log(`[PAYMENT] Ref ${mpesaRef} flagged manual_review — duplicate on ${duplicateRef.orderId}`)
		return { payment, confirmed: false, manualReview: true }
	}

	const fromStatus = payment.status
	payment.mpesaRef = mpesaRef
	payment.mpesaPhone = mpesaPhone
	payment.status = 'ref_submitted'
	payment.updatedAt = new Date()
	await payment.save()
	await recordPaymentAudit(orderId, fromStatus, 'ref_submitted', 'buyer', mpesaRef, payment.paymentId)

	const unmatched = await UnmatchedIpn.findOne({ mpesaRef, status: 'open' })
	if (unmatched && unmatched.amount === payment.totalAmount) {
		await confirmPayment(orderId, 'buyer_ref_ipn_match')
		await UnmatchedIpn.findOneAndUpdate(
			{ mpesaRef },
			{ status: 'matched', matchedOrderId: orderId, updatedAt: new Date() }
		)
		log(`[PAYMENT] Matched open IPN for ref ${mpesaRef} on order ${orderId}`)
		return { payment, confirmed: true, manualReview: false }
	}

	const alreadyConfirmed = await Payment.findOne({ mpesaRef, status: 'confirmed' })
	if (alreadyConfirmed && alreadyConfirmed.orderId === orderId) {
		return { payment, confirmed: true, manualReview: false }
	}

	log(`[PAYMENT] M-Pesa ref ${mpesaRef} submitted for order ${orderId} — awaiting verification`)
	return { payment, confirmed: false, manualReview: false }
}

export async function confirmPayment(orderId: string, confirmedBy: string): Promise<IPayment | null> {
	const existing = await Payment.findOne({ orderId })
	if (!existing) return null
	if (existing.status === 'confirmed') return existing

	const fromStatus = existing.status
	const payment = await Payment.findOneAndUpdate(
		{ orderId, status: { $ne: 'confirmed' } },
		{ status: 'confirmed', confirmedBy, confirmedAt: new Date(), updatedAt: new Date() },
		{ new: true }
	)
	if (payment) {
		await Order.findOneAndUpdate({ orderId }, { paymentStatus: 'paid', paymentRef: payment.mpesaRef })
		await recordPaymentAudit(orderId, fromStatus, 'confirmed', confirmedBy, '', payment.paymentId)
		log(`[PAYMENT] Confirmed for order ${orderId} by ${confirmedBy}`)
	}
	return payment
}

export async function markAwaitingStk(orderId: string, checkoutRequestId: string): Promise<IPayment | null> {
	const payment = await Payment.findOne({ orderId })
	if (!payment) return null
	const fromStatus = payment.status
	payment.status = 'awaiting_stk'
	payment.checkoutRequestId = checkoutRequestId
	payment.updatedAt = new Date()
	await payment.save()
	await recordPaymentAudit(orderId, fromStatus, 'awaiting_stk', 'stk_push', checkoutRequestId, payment.paymentId)
	return payment
}

export async function markCodCollected(orderId: string): Promise<IPayment | null> {
	const payment = await Payment.findOneAndUpdate(
		{ orderId },
		{ status: 'confirmed', confirmedAt: new Date(), confirmedBy: 'rider_cod', updatedAt: new Date() },
		{ new: true }
	)
	if (payment) {
		await Order.findOneAndUpdate({ orderId }, { paymentStatus: 'paid' })
		log(`[PAYMENT] COD collected for order ${orderId}`)
	}
	return payment
}

export async function refundPayment(orderId: string, reason: string): Promise<IPayment | null> {
	const payment = await Payment.findOneAndUpdate(
		{ orderId },
		{ status: 'refunded', refundReason: reason, updatedAt: new Date() },
		{ new: true }
	)
	if (payment) {
		await Order.findOneAndUpdate({ orderId }, { paymentStatus: 'refunded' })
		log(`[PAYMENT] Refund issued for order ${orderId}: ${reason}`)
	}
	return payment
}

export async function getPaymentByOrder(orderId: string): Promise<IPayment | null> {
	return Payment.findOne({ orderId })
}

export function isPaymentReadyForSellerConfirm(paymentStatus: PaymentStatus | undefined, orderPaymentStatus: string): boolean {
	if (orderPaymentStatus === 'paid') return true
	return paymentStatus === 'ref_submitted' || paymentStatus === 'confirmed'
}
