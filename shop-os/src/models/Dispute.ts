import mongoose, { Document, Schema } from 'mongoose'

export type DisputeType =
  | 'missing_item'
  | 'wrong_item'
  | 'damaged_item'
  | 'not_delivered'
  | 'price_changed'
  | 'buyer_unavailable'
  | 'fake_stock'
  | 'late_delivery'
  | 'other'

export type DisputeStatus =
  | 'open'
  | 'investigating'
  | 'resolved_refund'
  | 'resolved_no_action'
  | 'closed'

export type DisputeAgainstRole = 'seller' | 'rider' | 'buyer'

export interface IDispute extends Document {
  disputeId: string
  orderId: string
  raisedBy: string
  raisedByName: string
  againstId: string
  againstRole: DisputeAgainstRole
  type: DisputeType
  status: DisputeStatus
  description: string
  resolution: string
  refundAmount: number
  handledBy: string
  createdAt: Date
  updatedAt: Date
  resolvedAt: Date
}

const DisputeSchema = new Schema<IDispute>({
  disputeId: { type: String, required: true, unique: true, index: true },
  orderId: { type: String, required: true, index: true },
  raisedBy: { type: String, required: true },
  raisedByName: { type: String, default: '' },
  againstId: { type: String, default: '' },
  againstRole: { type: String, enum: ['seller', 'rider', 'buyer'], default: 'seller' },
  type: {
    type: String,
    enum: ['missing_item', 'wrong_item', 'damaged_item', 'not_delivered', 'price_changed', 'buyer_unavailable', 'fake_stock', 'late_delivery', 'other'],
    required: true,
  },
  status: {
    type: String,
    enum: ['open', 'investigating', 'resolved_refund', 'resolved_no_action', 'closed'],
    default: 'open',
    index: true,
  },
  description: { type: String, default: '' },
  resolution: { type: String, default: '' },
  refundAmount: { type: Number, default: 0 },
  handledBy: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date },
})

export const Dispute = mongoose.model<IDispute>('Dispute', DisputeSchema)
