import { Order, IOrder, OrderStatus } from '../models/Order.js'
import { Product } from '../models/Product.js'
import { Seller } from '../models/Seller.js'
import { User } from '../models/User.js'
import { log } from '../utils/logger.js'
import { notify } from '../bot/notifier.js'
import { resolveOutboundJid } from '../utils/jid.js'
import { createPaymentRecord, getPaymentByOrder, isPaymentReadyForSellerConfirm } from './paymentService.js'
import { dispatchRider } from './riderService.js'
import { updateBuyerTrust, updateSellerTrust } from './trustService.js'

function generateOrderId(): string {
  const ts = Date.now().toString(36).toUpperCase()
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase()
  return `ORD-${ts}-${rand}`
}

function generateOtp(): string {
  return String(Math.floor(1000 + Math.random() * 9000))
}

export interface CreateOrderInput {
  buyerPhone: string
  buyerJid: string
  buyerName: string
  productId: string
  productName: string
  quantity: number
  location: string
  zone: string
  paymentMode: 'cod' | 'mpesa'
  substitutionPref: 'replace' | 'ask' | 'none'
  notes: string
  // Optional GPS coordinates from WhatsApp location pin
  latitude?: number
  longitude?: number
}

export async function createOrder(input: CreateOrderInput): Promise<IOrder | null> {
  const { buyerPhone, buyerJid, buyerName, productId, productName, quantity, location, zone, paymentMode, substitutionPref, notes, latitude, longitude } = input

  // Find product by ID first, fallback to name search
  let product = productId ? await Product.findOne({ productId, active: true, stock: { $gt: 0 } }) : null
  if (!product) {
    product = await Product.findOne({ name: { $regex: productName, $options: 'i' }, active: true, stock: { $gt: 0 } })
  }
  if (!product) return null

  const seller = await Seller.findOne({ sellerId: product.sellerId, active: true })
  if (!seller) return null

  const qty = Math.min(quantity, product.stock)
  const totalAmount = product.price * qty
  const deliveryFee = parseInt(process.env['DELIVERY_FEE'] ?? '50')
  const otp = generateOtp()
  const orderId = generateOrderId()

  const order = new Order({
    orderId,
    buyerPhone,
    buyerJid,
    buyerName,
    sellerId: product.sellerId,
    sellerPhone: seller.phone,
    sellerJid: resolveOutboundJid(seller.jid, seller.phone),
    items: [{ productId: product.productId, name: product.name, quantity: qty, price: product.price, substituted: false, substituteName: '' }],
    location,
    zone: zone || seller.zone || '',
    latitude: latitude ?? 0,
    longitude: longitude ?? 0,
    status: 'received',
    paymentMode,
    paymentStatus: 'pending',
    totalAmount,
    deliveryFee,
    notes,
    substitutionPref,
    completionOtp: otp,
  })

  await order.save()

  // Reduce stock
  await Product.findOneAndUpdate({ productId: product.productId }, { $inc: { stock: -qty, soldCount: qty }, updatedAt: new Date() })

  // Create payment record
  await createPaymentRecord(orderId, buyerPhone, totalAmount, deliveryFee, paymentMode)

  // Update buyer stats
  await User.findOneAndUpdate(
    { phone: buyerPhone },
    { jid: buyerJid, name: buyerName || undefined, location, zone: zone || undefined, lastOrderId: orderId, $inc: { totalOrders: 1 }, updatedAt: new Date() },
    { upsert: true }
  )

  // Update seller stats
  await Seller.findOneAndUpdate({ sellerId: seller.sellerId }, { $inc: { totalOrders: 1 }, updatedAt: new Date() })

  // Notify seller
  const sellerJid = resolveOutboundJid(seller.jid, seller.phone)
  const itemsList = `• ${product.name} x${qty} — Ksh ${product.price * qty}`
  const payLabel = paymentMode === 'mpesa' ? '📲 M-Pesa (buyer pays on order)' : '💵 Cash on Delivery'

  // Build delivery navigation link for seller notification
  const hasGps = (latitude ?? 0) !== 0 && (longitude ?? 0) !== 0
  const deliveryMapsLink = hasGps
    ? `\n📌 *Buyer GPS Pin:* https://maps.google.com/?q=${latitude},${longitude}`
    : ''

  await notify(sellerJid,
    `🛒 *New Order — ${orderId}*\n\n` +
    `${itemsList}\n` +
    `📍 Deliver to: ${location}${deliveryMapsLink}\n` +
    `👤 Buyer: ${buyerName || buyerPhone}\n` +
    `💰 Total: Ksh ${totalAmount} + Ksh ${deliveryFee} delivery\n` +
    `💳 Payment: ${payLabel}\n\n` +
    `⏰ Please confirm within 5 minutes:\n` +
    `✅ *CONFIRM ${orderId}*\n` +
    `❌ *REJECT ${orderId}*`
  )

  log(`[ORDER] Created ${orderId} for ${buyerPhone} — ${product.name} x${qty} from ${seller.name}`)
  return order
}

export async function getOrderStatus(orderId: string): Promise<IOrder | null> {
  return Order.findOne({ orderId })
}

export async function getOrdersByBuyer(buyerPhone: string): Promise<IOrder[]> {
  return Order.find({ buyerPhone }).sort({ timestamp: -1 }).limit(10)
}

export async function getOrdersBySeller(sellerId: string): Promise<IOrder[]> {
  return Order.find({ sellerId, status: { $nin: ['delivered', 'cancelled'] } }).sort({ timestamp: -1 })
}

export async function updateOrderStatus(orderId: string, status: OrderStatus, notifyParties = false): Promise<IOrder | null> {
  const order = await Order.findOneAndUpdate(
    { orderId },
    { status, updatedAt: new Date() },
    { new: true }
  )
  if (!order) return null
  log(`[ORDER] ${orderId} status → ${status}`)

  if (notifyParties && order.buyerJid) {
    const statusLabels: Record<string, string> = {
      confirmed: '✅ *Order Confirmed!*\nYour shop is preparing it.',
      preparing: '👨‍🍳 *Preparing your order...*',
      rider_assigned: '🏍️ *Rider assigned!* Your order is coming.',
      on_the_way: '🚀 *On the way!* Stay available.',
      delivered: `🎉 *Delivered!* Thank you for ordering with us!\n\nType *HELP* to order again or *2* for a quick reorder.`,
      cancelled: '❌ *Order Cancelled.* Type *HELP* to place a new order.',
      disputed: '⚠️ *Your dispute has been received.* Our team will review shortly.',
    }
    const msg = statusLabels[status]
    if (msg) await notify(order.buyerJid, `${msg}\n\n📦 Order: *${orderId}*`)
  }

  return order
}

export async function confirmOrder(orderId: string, sellerPhone: string): Promise<IOrder | null> {
  const order = await Order.findOne({ orderId })
  if (!order) return null

  const seller = await Seller.findOne({ sellerId: order.sellerId, phone: sellerPhone })
  if (!seller) return null

  if (order.paymentMode === 'mpesa' && order.paymentStatus !== 'paid') {
    const payment = await getPaymentByOrder(orderId)
    if (!isPaymentReadyForSellerConfirm(payment?.status, order.paymentStatus)) {
      throw new Error(`M-Pesa payment for order *${orderId}* has not been confirmed yet. Please wait for the system to verify the payment before confirming.`)
    }
  }

  const updated = await Order.findOneAndUpdate(
    { orderId },
    { status: 'confirmed', confirmedAt: new Date(), updatedAt: new Date() },
    { new: true }
  )

  // Update seller stats + trust
  await Seller.findOneAndUpdate({ sellerId: seller.sellerId }, { $inc: { completedOrders: 1 } })
  await updateSellerTrust(seller.sellerId, 'confirm_fast')

  // Notify buyer
  if (order.buyerJid) {
    await notify(order.buyerJid,
      `✅ *Order Confirmed!*\n\n` +
      `📦 Order: *${orderId}*\n` +
      `🏪 ${seller.name} has accepted your order.\n\n` +
      `🔑 Your delivery OTP: *${order.completionOtp}*\n` +
      `_Give this code to the rider when they arrive._\n\n` +
      `⏳ A rider will be assigned shortly.`
    )
  }

  // Auto-dispatch rider after short delay
  const DISPATCH_DELAY = parseInt(process.env['RIDER_DISPATCH_TIMEOUT_MS'] ?? '5000')
  setTimeout(async () => {
    const dispatched = await dispatchRider(orderId)
    if (!dispatched) {
      log(`[ORDER] No rider available for ${orderId} — admin notified`)
    }
  }, DISPATCH_DELAY)

  log(`[ORDER] ${orderId} confirmed by ${seller.name} — dispatching rider in ${DISPATCH_DELAY}ms`)
  return updated
}

export async function rejectOrder(orderId: string, sellerPhone: string, reason?: string): Promise<IOrder | null> {
  const order = await Order.findOne({ orderId })
  if (!order) return null

  const seller = await Seller.findOne({ sellerId: order.sellerId, phone: sellerPhone })
  if (!seller) return null

  // Restore stock
  for (const item of order.items) {
    await Product.findOneAndUpdate({ productId: item.productId }, { $inc: { stock: item.quantity } })
  }

  const updated = await Order.findOneAndUpdate(
    { orderId },
    { status: 'cancelled', cancelledBy: 'seller', cancelReason: reason || 'Seller rejected', updatedAt: new Date() },
    { new: true }
  )

  await Seller.findOneAndUpdate({ sellerId: seller.sellerId }, { $inc: { rejectedOrders: 1 } })
  await updateSellerTrust(seller.sellerId, 'reject')

  if (order.buyerJid) {
    await notify(order.buyerJid,
      `❌ *Order Rejected*\n\n` +
      `📦 Order: *${orderId}*\n` +
      `🏪 ${seller.name} could not fulfil your order.\n` +
      (reason ? `Reason: ${reason}\n` : '') +
      `\nType *1* to search for the same item from another shop.`
    )
  }

  log(`[ORDER] ${orderId} rejected by ${seller.name}`)
  return updated
}

export async function getLastOrderForReorder(buyerPhone: string): Promise<IOrder | null> {
  return Order.findOne({
    buyerPhone,
    status: { $in: ['delivered', 'confirmed', 'on_the_way'] },
  }).sort({ timestamp: -1 })
}

export async function getOrderStats(): Promise<{
  total: number
  today: number
  thisWeek: number
  delivered: number
  gmvTotal: number
  gmvToday: number
}> {
  const now = new Date()
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const startOfWeek = new Date(startOfDay.getTime() - 7 * 86400000)

  const [total, today, thisWeek, delivered, gmvResult, gmvTodayResult] = await Promise.all([
    Order.countDocuments(),
    Order.countDocuments({ timestamp: { $gte: startOfDay } }),
    Order.countDocuments({ timestamp: { $gte: startOfWeek } }),
    Order.countDocuments({ status: 'delivered' }),
    Order.aggregate([{ $match: { status: 'delivered' } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
    Order.aggregate([{ $match: { status: 'delivered', timestamp: { $gte: startOfDay } } }, { $group: { _id: null, total: { $sum: '$totalAmount' } } }]),
  ])

  return {
    total,
    today,
    thisWeek,
    delivered,
    gmvTotal: gmvResult[0]?.total ?? 0,
    gmvToday: gmvTodayResult[0]?.total ?? 0,
  }
}
