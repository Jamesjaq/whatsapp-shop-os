import type { Request } from 'express'
import { Payment, type IPayment } from '../models/Payment.js'
import { UnmatchedIpn } from '../models/UnmatchedIpn.js'
import { Order } from '../models/Order.js'
import { confirmPayment, recordPaymentAudit } from './paymentService.js'
import { notify } from '../bot/notifier.js'
import { phonesMatch, normalizePhoneDigits } from '../utils/phone.js'
import { log } from '../utils/logger.js'

const MATCHABLE_STATUSES = ['pending', 'awaiting_stk', 'ref_submitted', 'manual_review'] as const
const ONE_HOUR_MS = 60 * 60 * 1000
const TWENTY_FOUR_HOURS_MS = 24 * ONE_HOUR_MS

export function verifyMpesaCallback(req: Request): boolean {
	const secret = process.env['MPESA_IPN_SECRET']
	if (!secret) return true
	const header = req.headers['x-mpesa-secret']
	const query = (req.query as Record<string, string>)['secret']
	return header === secret || query === secret
}

export interface StkCallbackPayload {
	Body?: {
		stkCallback?: {
			MerchantRequestID: string
			CheckoutRequestID: string
			ResultCode: number
			ResultDesc: string
			CallbackMetadata?: {
				Item: Array<{ Name: string; Value?: string | number }>
			}
		}
	}
}

export async function findPaymentForIpn(
	mpesaRef: string,
	amount: number,
	phone: string
): Promise<IPayment | null> {
	if (mpesaRef) {
		const byRef = await Payment.findOne({
			mpesaRef,
			status: { $in: MATCHABLE_STATUSES },
			method: 'mpesa',
		})
		if (byRef) return byRef

		const bySubmittedRef = await Payment.findOne({
			mpesaRef,
			status: 'ref_submitted',
			method: 'mpesa',
		})
		if (bySubmittedRef) return bySubmittedRef
	}

	const since24h = new Date(Date.now() - TWENTY_FOUR_HOURS_MS)
	const phoneCandidates = await Payment.find({
		status: { $in: MATCHABLE_STATUSES },
		method: 'mpesa',
		totalAmount: amount,
		createdAt: { $gte: since24h },
	}).sort({ createdAt: -1 })

	for (const p of phoneCandidates) {
		if (phonesMatch(p.buyerPhone, phone) || phonesMatch(p.mpesaPhone, phone)) {
			return p
		}
	}

	const since1h = new Date(Date.now() - ONE_HOUR_MS)
	const amountOnly = await Payment.find({
		status: { $in: MATCHABLE_STATUSES },
		method: 'mpesa',
		totalAmount: amount,
		createdAt: { $gte: since1h },
	}).sort({ createdAt: -1 })

	if (amountOnly.length === 1) {
		log(`[MPESA IPN] Amount-only fallback matched order ${amountOnly[0]!.orderId}`)
		return amountOnly[0]!
	}

	return null
}

export async function recordUnmatchedIpn(
	mpesaRef: string,
	amount: number,
	phone: string,
	transactionDate: string,
	rawPayload: string
): Promise<void> {
	try {
		await UnmatchedIpn.findOneAndUpdate(
			{ mpesaRef },
			{
				amount,
				phone,
				transactionDate,
				rawPayload,
				status: 'open',
				updatedAt: new Date(),
			},
			{ upsert: true, new: true }
		)
		log(`[MPESA IPN] Recorded unmatched ref=${mpesaRef} amount=${amount}`)
	} catch (err) {
		log(`[MPESA IPN] Failed to record unmatched IPN: ${String(err)}`)
	}
}

export async function handleStkCallback(body: StkCallbackPayload): Promise<{ matched: boolean; orderId?: string }> {
	const callback = body?.Body?.stkCallback
	if (!callback) {
		throw new Error('Invalid callback format')
	}

	const { ResultCode, ResultDesc, CallbackMetadata, CheckoutRequestID } = callback

	if (ResultCode !== 0) {
		log(`[MPESA IPN] Payment failed — ResultCode=${ResultCode} Desc="${ResultDesc}"`)
		if (CheckoutRequestID) {
			const failed = await Payment.findOne({ checkoutRequestId: CheckoutRequestID })
			if (failed && failed.status !== 'confirmed') {
				await Payment.findOneAndUpdate(
					{ _id: failed._id },
					{ status: 'failed', updatedAt: new Date() }
				)
				await recordPaymentAudit(failed.orderId, failed.status, 'failed', 'mpesa_ipn', ResultDesc, failed.paymentId)
			}
		}
		return { matched: true }
	}

	const items = CallbackMetadata?.Item ?? []
	const get = (name: string): string => {
		const item = items.find(i => i.Name === name)
		return item?.Value != null ? String(item.Value) : ''
	}

	const mpesaRef = get('MpesaReceiptNumber')
	const amount = parseFloat(get('Amount') || '0')
	const phone = get('PhoneNumber')
	const timestamp = get('TransactionDate')

	if (!mpesaRef || amount <= 0) {
		log('[MPESA IPN] Missing receipt or amount — skipping')
		return { matched: false }
	}

	const existingConfirmed = await Payment.findOne({ mpesaRef, status: 'confirmed' })
	if (existingConfirmed) {
		log(`[MPESA IPN] Idempotent skip — ref ${mpesaRef} already confirmed for ${existingConfirmed.orderId}`)
		return { matched: true, orderId: existingConfirmed.orderId }
	}

	log(`[MPESA IPN] Received ref=${mpesaRef} amount=${amount} phone=${phone} ts=${timestamp}`)

	let payment = await findPaymentForIpn(mpesaRef, amount, phone)

	if (!payment && CheckoutRequestID) {
		payment = await Payment.findOne({
			checkoutRequestId: CheckoutRequestID,
			status: { $in: MATCHABLE_STATUSES },
			method: 'mpesa',
		})
	}

	if (!payment) {
		await recordUnmatchedIpn(mpesaRef, amount, phone, timestamp, JSON.stringify(body))
		return { matched: false }
	}

	await Payment.findOneAndUpdate(
		{ _id: payment._id },
		{ mpesaRef, mpesaPhone: phone || payment.mpesaPhone, updatedAt: new Date() }
	)

	await confirmPayment(payment.orderId, 'mpesa_ipn')

	await UnmatchedIpn.findOneAndUpdate(
		{ mpesaRef },
		{ status: 'matched', matchedOrderId: payment.orderId, updatedAt: new Date() }
	)

	const order = await Order.findOne({ orderId: payment.orderId })
	if (order?.buyerJid) {
		const normalizedPhone = phone.startsWith('254') ? '0' + phone.slice(3) : phone
		await notify(
			order.buyerJid,
			`✅ *M-Pesa Payment Received!*\n\n` +
				`📦 Order: *${payment.orderId}*\n` +
				`💰 Amount: Ksh *${amount}*\n` +
				`🔖 M-Pesa Ref: *${mpesaRef}*\n` +
				`📱 From: ${normalizedPhone || normalizePhoneDigits(phone)}\n\n` +
				`Your payment has been confirmed automatically. The seller will now prepare your order. 🛒`
		)
	}

	log(`[MPESA IPN] Auto-confirmed order ${payment.orderId} via ref ${mpesaRef}`)
	return { matched: true, orderId: payment.orderId }
}

export async function getOpenUnmatchedIpns(limit = 50) {
	return UnmatchedIpn.find({ status: 'open' }).sort({ createdAt: -1 }).limit(limit)
}
