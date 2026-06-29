import mongoose, { Document, Schema } from 'mongoose'

export interface ISavedBasket {
  name: string
  items: Array<{ productId: string; name: string; quantity: number }>
}

export interface IUser extends Document {
  phone: string
  jid: string
  name: string
  location: string
  zone: string
  role: 'buyer' | 'seller' | 'rider' | 'admin'
  trustScore: number
  totalOrders: number
  completedOrders: number
  cancelledOrders: number
  disputeCount: number
  lastOrderId: string
  savedBaskets: ISavedBasket[]
  blocked: boolean
  blockReason: string
  createdAt: Date
  updatedAt: Date
}

const SavedBasketSchema = new Schema<ISavedBasket>({
  name: { type: String, required: true },
  items: [
    {
      productId: { type: String },
      name: { type: String },
      quantity: { type: Number, default: 1 },
    },
  ],
})

const UserSchema = new Schema<IUser>({
  phone: { type: String, required: true, unique: true, index: true },
  jid: { type: String, default: '' },
  name: { type: String, default: '' },
  location: { type: String, default: '' },
  zone: { type: String, default: '' },
  role: { type: String, enum: ['buyer', 'seller', 'rider', 'admin'], default: 'buyer' },
  trustScore: { type: Number, default: 80, min: 0, max: 100 },
  totalOrders: { type: Number, default: 0 },
  completedOrders: { type: Number, default: 0 },
  cancelledOrders: { type: Number, default: 0 },
  disputeCount: { type: Number, default: 0 },
  lastOrderId: { type: String, default: '' },
  savedBaskets: { type: [SavedBasketSchema], default: [] },
  blocked: { type: Boolean, default: false },
  blockReason: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

export const User = mongoose.model<IUser>('User', UserSchema)
