import { Rider, IRider } from '../models/Rider.js'
import { Order } from '../models/Order.js'
import { Seller } from '../models/Seller.js'
import { notify, resolveOutboundJid } from '../bot/notifier.js'
import { updateRiderTrust } from './trustService.js'
import { markCodCollected } from './paymentService.js'
import { createPayoutEscrow } from './payoutService.js'
import { log } from '../utils/logger.js'

export async function findBestRider(zone: string): Promise<IRider | null> {
  // Priority: same zone → available → highest trust score
  const rider = await Rider.findOne({
    zone: { $regex: zone, $options: 'i' },
    available: true,
    active: true,
    currentOrderId: '',
  }).sort({ trustScore: -1, completedDeliveries: -1 })

  if (rider) return rider

  // Fallback: any available rider
  return Rider.findOne({ available: true, active: true, currentOrderId: '' })
    .sort({ trustScore: -1 })
}

export async function dispatchRider(orderId: string): Promise<boolean> {
  const order = await Order.findOne({ orderId })
  if (!order) return false

  // ── Priority 1: Seller's trusted riders ──
  let rider: IRider | null = null
  const seller = await Seller.findOne({ sellerId: order.sellerId })
  if (seller && seller.trustedRiders.length > 0) {
    rider = await Rider.findOne({
      phone: { $in: seller.trustedRiders },
      available: true,
      active: true,
      currentOrderId: '',
    }).sort({ trustScore: -1 })
    if (rider) log(`[RIDER] Using seller-trusted rider ${rider.name} for order ${orderId}`)
  }

  // ── Priority 2: Zone-matched global rider ──
  if (!rider) {
    rider = await findBestRider(order.zone || order.location)
  }

  if (!rider) {
    log(`[RIDER] No available rider for order ${orderId}`)
    return false
  }

  const riderJid = resolveOutboundJid(rider.jid, rider.phone)

  // Mark rider busy
  await Rider.findOneAndUpdate(
    { riderId: rider.riderId },
    { available: false, currentOrderId: orderId, updatedAt: new Date() }
  )

  // Update order with rider info
  await Order.findOneAndUpdate(
    { orderId },
    {
      riderId: rider.riderId,
      riderPhone: rider.phone,
      riderJid,
      status: 'rider_assigned',
      dispatchedAt: new Date(),
      updatedAt: new Date(),
      $inc: { dispatchAttempts: 1 },
    }
  )

  const itemsList = order.items.map(i => `  • ${i.name} x${i.quantity}`).join('\n')
  const payNote = order.paymentMode === 'cod'
    ? `💰 *Collect Ksh ${order.totalAmount + order.deliveryFee} (COD)*`
    : `✅ Payment: Pre-paid`

  // Build navigation link: use GPS pin if available, fallback to text search
  const hasGps = order.latitude && order.longitude
  const mapsLink = hasGps
    ? `https://maps.google.com/?q=${order.latitude},${order.longitude}`
    : `https://maps.google.com/?q=${encodeURIComponent(order.location)}`

  const sellerInfo = seller
    ? `${seller.name} — ${seller.location}`
    : `Seller ${order.sellerId}`

  await notify(riderJid,
    `🏍️ *New Delivery Job — ${orderId}*\n\n` +
    `📦 Items:\n${itemsList}\n\n` +
    `🏪 *Pick up from:* ${sellerInfo}\n` +
    `🏠 *Deliver to:* ${order.location}\n` +
    `📍 *Navigation:* ${mapsLink}\n` +
    `${payNote}\n` +
    `🔑 Buyer OTP: *${order.completionOtp}*\n\n` +
    `Reply:\n✅ *ACCEPT ${orderId}*\n❌ *DECLINE ${orderId}*`
  )

  // Notify buyer
  if (order.buyerJid) {
    await notify(order.buyerJid,
      `🏍️ *Rider Assigned!*\n\n` +
      `📦 Order: *${orderId}*\n` +
      `🧑 Rider: ${rider.name}\n` +
      `📞 ${rider.phone}\n\n` +
      `⏳ They will pick up your order shortly.\n` +
      `🔑 Your delivery code: *${order.completionOtp}*\n` +
      `_Give this code only when your order arrives._`
    )
  }

  // Auto-decline rider if they ignore request for 3 minutes
  const RIDER_RESPONSE_TIMEOUT = 3 * 60 * 1000 // 3 minutes
  setTimeout(async () => {
    try {
      const currentOrder = await Order.findOne({ orderId })
      if (currentOrder && currentOrder.status === 'rider_assigned' && currentOrder.riderId === rider.riderId) {
        log(`[RIDER] Auto-declining job ${orderId} for rider ${rider.name} due to inactivity (timeout)`)
        await riderDeclineJob(rider.riderId, orderId)
        await notify(riderJid, `⚠️ *Job Request Timed Out*\n\nYou did not accept delivery job *${orderId}* within 3 minutes. It has been reassigned to another rider. Please toggle OFFLINE if you are busy.`)
      }
    } catch (err) {
      log(`[RIDER ERROR] Error handling rider dispatch timeout for order ${orderId}: ${err}`)
    }
  }, RIDER_RESPONSE_TIMEOUT)

  log(`[RIDER] Dispatched ${rider.name} (${rider.riderId}) for order ${orderId}`)
  return true
}

export async function riderAcceptJob(riderId: string, orderId: string): Promise<boolean> {
  const rider = await Rider.findOne({ riderId })
  if (!rider || rider.currentOrderId !== orderId) return false

  const order = await Order.findOne({ orderId })
  if (!order) return false

  // Notify seller
  if (order.sellerJid) {
    await notify(order.sellerJid,
      `🏍️ *Rider on the way to you!*\n\n` +
      `📦 Order: ${orderId}\n` +
      `🧑 Rider: ${rider.name} — ${rider.phone}\n\n` +
      `Please have the order ready for pickup.`
    )
  }

  log(`[RIDER] ${rider.name} accepted job ${orderId}`)
  return true
}

export async function riderDeclineJob(riderId: string, orderId: string): Promise<boolean> {
  const rider = await Rider.findOne({ riderId })
  if (!rider) return false

  // Free rider
  await Rider.findOneAndUpdate(
    { riderId },
    { available: true, currentOrderId: '', updatedAt: new Date() }
  )

  await updateRiderTrust(riderId, 'late_delivery')
  log(`[RIDER] ${rider.name} declined job ${orderId} — re-dispatching`)

  // Try next rider
  const order = await Order.findOne({ orderId })
  if (order && order.dispatchAttempts < 3) {
    return dispatchRider(orderId)
  }

  // After 3 attempts, notify admin
  const adminPhone = process.env['ADMIN_PHONE']
  if (adminPhone) {
    await notify(resolveOutboundJid(undefined, adminPhone),
      `⚠️ *No rider for order ${orderId}* after 3 attempts.\n` +
      `Buyer: ${order?.buyerPhone}\n` +
      `Location: ${order?.location}\n\n` +
      `Use: *ADMIN ASSIGN ${orderId} [riderPhone]*`
    )
  }

  return false
}

export async function riderMarkPickup(riderId: string, orderId: string): Promise<boolean> {
  const rider = await Rider.findOne({ riderId })
  if (!rider || rider.currentOrderId !== orderId) return false

  await Order.findOneAndUpdate(
    { orderId },
    { status: 'on_the_way', updatedAt: new Date() }
  )

  const order = await Order.findOne({ orderId })
  if (order?.buyerJid) {
    await notify(order.buyerJid,
      `🚀 *Your order is on the way!*\n\n` +
      `📦 Order: *${orderId}*\n` +
      `🏍️ Rider: ${rider.name}\n\n` +
      `🔑 Remember your delivery code: *${order.completionOtp}*\n` +
      `_Be available to receive your order._`
    )
  }

  log(`[RIDER] ${rider.name} picked up order ${orderId}`)
  return true
}

export async function riderMarkDelivered(riderId: string, orderId: string, otp: string): Promise<{ success: boolean; message: string }> {
  const rider = await Rider.findOne({ riderId })
  if (!rider) return { success: false, message: 'Rider not found' }
  if (rider.currentOrderId !== orderId) return { success: false, message: 'Not your current order' }

  const order = await Order.findOne({ orderId })
  if (!order) return { success: false, message: 'Order not found' }

  if (order.completionOtp !== otp.trim()) {
    return { success: false, message: '❌ Wrong OTP. Ask buyer for the correct 4-digit code.' }
  }

  const deliveryFee = order.deliveryFee
  const now = new Date()

  // Complete order
  await Order.findOneAndUpdate(
    { orderId },
    { status: 'delivered', deliveredAt: now, updatedAt: now, paymentStatus: order.paymentMode === 'cod' ? 'paid' : order.paymentStatus }
  )

  // Update rider metrics
  await Rider.findOneAndUpdate(
    { riderId },
    {
      available: true,
      currentOrderId: '',
      $inc: { completedDeliveries: 1, totalDeliveries: 1, totalEarnings: deliveryFee, pendingEarnings: deliveryFee },
      updatedAt: now,
    }
  )

  if (order.paymentMode === 'cod') await markCodCollected(orderId)

  // Hold completed order amount in escrow for 24h
  await createPayoutEscrow(orderId, order.sellerId, order.totalAmount)

  await updateRiderTrust(riderId, 'delivered')

  // Notify buyer with rating prompt
  if (order.buyerJid) {
    await notify(order.buyerJid,
      `🎉 *Order Delivered!*\n\n` +
      `📦 Order: *${orderId}*\n` +
      `✅ ${order.items.map(i => `${i.name} x${i.quantity}`).join(', ')}\n\n` +
      `Thank you for ordering! 🙏\n\n` +
      `⭐ *Rate your experience:*\n` +
      `Reply: *RATE ${orderId} 5* (or 1–5)\n` +
      `_Your rating helps other buyers find great shops._\n\n` +
      `Type *2* to reorder the same anytime!`
    )
  }

  // Notify seller of completed delivery
  if (order.sellerJid) {
    await notify(order.sellerJid,
      `✅ *Order Delivered — ${orderId}*\n\n` +
      `📦 ${order.items.map(i => `${i.name} x${i.quantity}`).join(', ')}\n` +
      `💰 Ksh ${order.totalAmount} — payout in 24h after confirmation.`
    )
  }

  log(`[RIDER] ${rider.name} delivered order ${orderId}`)
  return { success: true, message: `✅ *Order ${orderId} delivered!* Ksh ${deliveryFee} earned. Keep it up! 🏍️` }
}

export async function getRiderEarnings(riderId: string): Promise<string> {
  const rider = await Rider.findOne({ riderId })
  if (!rider) return '❌ Rider not found.'

  return (
    `💼 *Your Earnings — ${rider.name}*\n\n` +
    `💰 Total earned: Ksh ${rider.totalEarnings}\n` +
    `⏳ Pending payout: Ksh ${rider.pendingEarnings}\n\n` +
    `📦 Deliveries: ${rider.completedDeliveries} completed\n` +
    `⭐ Trust score: ${rider.trustScore}/100\n` +
    `🏷️ Tier: ${rider.tier.toUpperCase()}\n\n` +
    `_Payouts processed every Friday. Contact admin for issues._`
  )
}

export async function forceAssignRider(orderId: string, riderPhone: string): Promise<boolean> {
  const rider = await Rider.findOne({ phone: riderPhone })
  if (!rider) return false

  // Free any current order
  await Rider.findOneAndUpdate({ phone: riderPhone }, { available: false, currentOrderId: orderId })

  // Reset dispatch count to allow fresh dispatch
  await Order.findOneAndUpdate({ orderId }, { dispatchAttempts: 0 })

  return dispatchRider(orderId)
}
