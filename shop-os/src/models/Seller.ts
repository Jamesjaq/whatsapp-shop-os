import mongoose, { Document, Schema } from 'mongoose'

export type SellerTier = 'new' | 'verified' | 'top' | 'premium'

export interface ISeller extends Document {
  sellerId: string
  name: string
  phone: string
  jid: string
  location: string
  zone: string
  category: string
  active: boolean
  approved: boolean
  tier: SellerTier
  trustScore: number
  rating: number
  ratingCount: number
  fulfillmentRate: number
  acceptanceRate: number
  totalOrders: number
  completedOrders: number
  rejectedOrders: number
  totalRevenue: number
  openingHours: string
  description: string
  // Seller-managed trusted rider fleet (phone numbers)
  trustedRiders: string[]
  // Geo coordinates for proximity-based matching
  latitude: number
  longitude: number
  createdAt: Date
  updatedAt: Date
}

const SellerSchema = new Schema<ISeller>({
  sellerId: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true, index: true },
  jid: { type: String, default: '' },
  location: { type: String, required: true },
  zone: { type: String, default: '' },
  category: { type: String, required: true },
  active: { type: Boolean, default: true },
  approved: { type: Boolean, default: true },
  tier: { type: String, enum: ['new', 'verified', 'top', 'premium'], default: 'new' },
  trustScore: { type: Number, default: 70, min: 0, max: 100 },
  rating: { type: Number, default: 0, min: 0, max: 5 },
  ratingCount: { type: Number, default: 0 },
  fulfillmentRate: { type: Number, default: 100, min: 0, max: 100 },
  acceptanceRate: { type: Number, default: 100, min: 0, max: 100 },
  totalOrders: { type: Number, default: 0 },
  completedOrders: { type: Number, default: 0 },
  rejectedOrders: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  openingHours: { type: String, default: '7am - 9pm' },
  description: { type: String, default: '' },
  // Trusted rider phone numbers added by the seller
  trustedRiders: { type: [String], default: [] },
  // Geo coordinates for proximity matching
  latitude: { type: Number, default: 0 },
  longitude: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

export const Seller = mongoose.model<ISeller>('Seller', SellerSchema)
