import mongoose, { Document, Schema } from 'mongoose'

export interface IProduct extends Document {
  productId: string
  sellerId: string
  sellerName: string
  sellerZone: string
  name: string
  description: string
  category: string
  unit: string
  price: number
  stock: number
  lowStockThreshold: number
  imageUrl: string
  active: boolean
  featured: boolean
  soldCount: number
  createdAt: Date
  updatedAt: Date
}

const ProductSchema = new Schema<IProduct>({
  productId: { type: String, required: true, unique: true, index: true },
  sellerId: { type: String, required: true, index: true },
  sellerName: { type: String, default: '' },
  sellerZone: { type: String, default: '', index: true },
  name: { type: String, required: true },
  description: { type: String, default: '' },
  category: { type: String, default: '' },
  unit: { type: String, default: 'piece' },
  price: { type: Number, required: true },
  stock: { type: Number, default: 0 },
  lowStockThreshold: { type: Number, default: 5 },
  imageUrl: { type: String, default: '' },
  active: { type: Boolean, default: true },
  featured: { type: Boolean, default: false },
  soldCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
})

export const Product = mongoose.model<IProduct>('Product', ProductSchema)
