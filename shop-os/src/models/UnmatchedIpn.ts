import mongoose, { Document, Schema } from 'mongoose'

export interface IUnmatchedIpn extends Document {
	mpesaRef: string
	amount: number
	phone: string
	transactionDate: string
	rawPayload: string
	status: 'open' | 'matched' | 'dismissed'
	matchedOrderId: string
	createdAt: Date
	updatedAt: Date
}

const UnmatchedIpnSchema = new Schema<IUnmatchedIpn>({
	mpesaRef: { type: String, required: true, index: true },
	amount: { type: Number, required: true },
	phone: { type: String, default: '' },
	transactionDate: { type: String, default: '' },
	rawPayload: { type: String, default: '' },
	status: { type: String, enum: ['open', 'matched', 'dismissed'], default: 'open', index: true },
	matchedOrderId: { type: String, default: '' },
	createdAt: { type: Date, default: Date.now },
	updatedAt: { type: Date, default: Date.now },
})

UnmatchedIpnSchema.index({ mpesaRef: 1 }, { unique: true })

export const UnmatchedIpn = mongoose.model<IUnmatchedIpn>('UnmatchedIpn', UnmatchedIpnSchema)
