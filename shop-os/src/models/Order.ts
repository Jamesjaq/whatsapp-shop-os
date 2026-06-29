import mongoose, { Document, Schema } from 'mongoose'

export type OrderStatus =
  | 'received'
  | 'confirming_stock'
  | 'confirmed'
  | 'preparing'
  | 'rider_assigned'
  | 'on_the_way'
  | 'delivered'
  | 'cancelled'
  | 'disputed'

export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded'

export type SubstitutionPref = 'replace' | 'ask' | 'none'

export type CancelledBy = 'buyer' | 'seller' | 'rider' | 'system'

export interface IOrderItem {
  productId: string
  name: string
  quantity: number
  price: number
  substituted: boolean
  substituteName: string
}

export interface IOrder extends Document {
  orderId: string
  buyerPhone: string
  buyerJid: string
  buyerName: string
  sellerId: string
  sellerPhone: string
  sellerJid: string
  riderId: string
  riderPhone: string
  riderJid: string
  items: IOrderItem[]
  location: string
  zone: string
  status: OrderStatus
  paymentMode: 'cod' | 'mpesa' | 'prepaid'
  paymentStatus: PaymentStatus
  paymentRef: string
  totalAmount: number
  deliveryFee: number
  notes: string
  substitutionPref: SubstitutionPref
  completionOtp: string
  disputeId: string
  cancelledBy: CancelledBy
  cancelReason: string
  dispatchAttempts: number
  // Buyer location coordinates (from WhatsApp location pin)
  latitude: number
  longitude: number
  timestamp: Date
  updatedAt: Date
  confirmedAt: Date
  dispatchedAt: Date
  deliveredAt: Date
}

const OrderItemSchema = new Schema<IOrderItem>({
  productId: { type: String, required: true },
  name: { type: String, required: true },
  quantity: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true },
  substituted: { type: Boolean, default: false },
  substituteName: { type: String, default: '' },
})

const OrderSchema = new Schema<IOrder>({
  orderId: { type: String, required: true, unique: true, index: true },
  buyerPhone: { type: String, required: true, index: true },
  buyerJid: { type: String, default: '' },
  buyerName: { type: String, default: '' },
  sellerId: { type: String, required: true, index: true },
  sellerPhone: { type: String, default: '' },
  sellerJid: { type: String, default: '' },
  riderId: { type: String, default: '' },
  riderPhone: { type: String, default: '' },
  riderJid: { type: String, default: '' },
  items: { type: [OrderItemSchema], default: [] },
  location: { type: String, default: '' },
  zone: { type: String, default: '' },
  status: {
    type: String,
    enum: ['received', 'confirming_stock', 'confirmed', 'preparing', 'rider_assigned', 'on_the_way', 'delivered', 'cancelled', 'disputed'],
    default: 'received',
    index: true,
  },
  paymentMode: { type: String, enum: ['cod', 'mpesa', 'prepaid'], default: 'cod' },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  paymentRef: { type: String, default: '' },
  totalAmount: { type: Number, default: 0 },
  deliveryFee: { type: Number, default: 50 },
  notes: { type: String, default: '' },
  substitutionPref: { type: String, enum: ['replace', 'ask', 'none'], default: 'ask' },
  completionOtp: { type: String, default: '' },
  disputeId: { type: String, default: '' },
  cancelledBy: { type: String, enum: ['buyer', 'seller', 'rider', 'system'], default: 'system' },
  cancelReason: { type: String, default: '' },
  dispatchAttempts: { type: Number, default: 0 },
  latitude: { type: Number, default: 0 },
  longitude: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now, index: true },
  updatedAt: { type: Date, default: Date.now },
  confirmedAt: { type: Date },
  dispatchedAt: { type: Date },
  deliveredAt: { type: Date },
})

export const Order = mongoose.model<IOrder>('Order', OrderSchema)
