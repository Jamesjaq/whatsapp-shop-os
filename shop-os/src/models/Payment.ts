import mongoose, { Document, Schema } from 'mongoose'

export type PaymentMethod = 'mpesa' | 'cod' | 'prepaid'
export type PaymentStatus =
	| 'pending'
	| 'awaiting_stk'
	| 'ref_submitted'
	| 'manual_review'
	| 'confirmed'
	| 'failed'
	| 'refunded'

export interface IPayment extends Document {
	paymentId: string
	orderId: string
	buyerPhone: string
	amount: number
	deliveryFee: number
	totalAmount: number
	method: PaymentMethod
	status: PaymentStatus
	mpesaRef: string
	mpesaPhone: string
	checkoutRequestId: string
	confirmedBy: string
	refundReason: string
	createdAt: Date
	updatedAt: Date
	confirmedAt: Date
}

const PaymentSchema = new Schema<IPayment>({
	paymentId: { type: String, required: true, unique: true, index: true },
	orderId: { type: String, required: true, unique: true, index: true },
	buyerPhone: { type: String, required: true, index: true },
	amount: { type: Number, required: true },
	deliveryFee: { type: Number, default: 50 },
	totalAmount: { type: Number, required: true, index: true },
	method: { type: String, enum: ['mpesa', 'cod', 'prepaid'], required: true },
	status: {
		type: String,
		enum: ['pending', 'awaiting_stk', 'ref_submitted', 'manual_review', 'confirmed', 'failed', 'refunded'],
		default: 'pending',
		index: true,
	},
	mpesaRef: { type: String, default: '', sparse: true, unique: true },
	mpesaPhone: { type: String, default: '' },
	checkoutRequestId: { type: String, default: '' },
	confirmedBy: { type: String, default: '' },
	refundReason: { type: String, default: '' },
	createdAt: { type: Date, default: Date.now, index: true },
	updatedAt: { type: Date, default: Date.now },
	confirmedAt: { type: Date },
})

PaymentSchema.index({ status: 1, totalAmount: 1, createdAt: -1 })

export const Payment = mongoose.model<IPayment>('Payment', PaymentSchema)
