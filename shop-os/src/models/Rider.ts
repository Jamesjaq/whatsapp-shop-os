import mongoose, { Document, Schema } from 'mongoose'

export type RiderTier = 'new' | 'verified' | 'trusted' | 'priority'

export interface IRider extends Document {
  riderId: string
  name: string
  phone: string
  jid: string
  zone: string
  active: boolean
  available: boolean
  tier: RiderTier
  trustScore: number
  rating: number
  ratingCount: number
  acceptanceRate: number
  completionRate: number
  totalDeliveries: number
  completedDeliveries: number
  failedDeliveries: number
  totalEarnings: number
  pendingEarnings: number
  currentOrderId: string
  vehicle: string
  latitude: number
  longitude: number
  locationUpdatedAt: Date
  createdAt: Date
  updatedAt: Date
}

const RiderSchema = new Schema<IRider>({
  riderId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true, index: true },
  jid: { type: String, default: '' },
  zone: { type: String, required: true, index: true },
  active: { type: Boolean, default: true },
  available: { type: Boolean, default: true },
  tier: { type: String, enum: ['new', 'verified', 'trusted', 'priority'], default: 'new' },
  trustScore: { type: Number, default: 70, min: 0, max: 100 },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  ratingCount: { type: Number, default: 0 },
  acceptanceRate: { type: Number, default: 100, min: 0, max: 100 },
  completionRate: { type: Number, default: 100, min: 0, max: 100 },
  totalDeliveries: { type: Number, default: 0 },
  completedDeliveries: { type: Number, default: 0 },
  failedDeliveries: { type: Number, default: 0 },
  totalEarnings: { type: Number, default: 0 },
  pendingEarnings: { type: Number, default: 0 },
  currentOrderId: { type: String, default: '' },
  vehicle: { type: String, default: 'boda' },
  latitude: { type: Number, default: 0 },
  longitude: { type: Number, default: 0 },
  locationUpdatedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

export const Rider = mongoose.model<IRider>('Rider', RiderSchema)
