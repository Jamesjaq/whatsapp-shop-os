import mongoose, { Document, Schema } from 'mongoose'

export interface IPayout extends Document {
  payoutId: string
  orderId: string
  sellerId: string
  amount: number
  status: 'escrow' | 'released' | 'cancelled'
  releaseAt: Date
  createdAt: Date
  updatedAt: Date
}

const PayoutSchema = new Schema<IPayout>({
  payoutId: { type: String, required: true, unique: true, index: true },
  orderId: { type: String, required: true, index: true },
  sellerId: { type: String, required: true, index: true },
  amount: { type: Number, required: true },
  status: { type: String, enum: ['escrow', 'released', 'cancelled'], default: 'escrow' },
  releaseAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

export const Payout = mongoose.model<IPayout>('Payout', PayoutSchema)
