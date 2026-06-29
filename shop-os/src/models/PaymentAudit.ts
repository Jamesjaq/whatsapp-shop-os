import mongoose, { Document, Schema } from 'mongoose'

export interface IPaymentAudit extends Document {
	orderId: string
	paymentId: string
	fromStatus: string
	toStatus: string
	actor: string
	detail: string
	createdAt: Date
}

const PaymentAuditSchema = new Schema<IPaymentAudit>({
	orderId: { type: String, required: true, index: true },
	paymentId: { type: String, required: true, index: true },
	fromStatus: { type: String, required: true },
	toStatus: { type: String, required: true },
	actor: { type: String, required: true },
	detail: { type: String, default: '' },
	createdAt: { type: Date, default: Date.now, index: true },
})

export const PaymentAudit = mongoose.model<IPaymentAudit>('PaymentAudit', PaymentAuditSchema)
