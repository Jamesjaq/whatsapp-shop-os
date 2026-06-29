import {
  createOrder,
  getOrderStatus,
  getOrdersByBuyer,
  getOrdersBySeller,
  updateOrderStatus,
  confirmOrder,
  rejectOrder,
  getLastOrderForReorder,
} from '../services/orderService.js'
import {
  registerSeller,
  getSellerByPhone,
  addProduct,
  getProductsBySeller,
  updateStock,
  updatePrice,
  deleteProduct,
  listAllSellers,
  searchProducts,
  addTrustedRider,
  removeTrustedRider,
  listTrustedRiders,
  updateProductImage,
  rateSellerAfterDelivery,
} from '../services/sellerService.js'
import {
  dispatchRider,
  riderAcceptJob,
  riderDeclineJob,
  riderMarkPickup,
  riderMarkDelivered,
  getRiderEarnings,
} from '../services/riderService.js'
import { raiseDispute } from '../services/disputeService.js'
import { submitMpesaRef } from '../services/paymentService.js'
import { initiateStkPush, isStkConfigured } from '../services/mpesaStkService.js'
import { getSession, setSession, resetSession, type SessionState } from '../services/sessionStore.js'
import { isAdmin, handleAdminCommand } from '../services/adminService.js'
import { Rider } from '../models/Rider.js'
import { Seller } from '../models/Seller.js'
import { User } from '../models/User.js'
import { Order } from '../models/Order.js'
import { log } from '../utils/logger.js'

// ─────────────────────────────────────────────
// MAIN MENU
// ─────────────────────────────────────────────

export const STATIC_MAIN_MENU = `🛒 *WhatsApp Shop OS*
_Kenya's neighbourhood commerce network_

1️⃣ Order essentials
2️⃣ Reorder (same as last time)
3️⃣ Track my order
4️⃣ Browse shops
5️⃣ My orders
6️⃣ Become a seller (Register shop)
7️⃣ Become a rider
8️⃣ Report a problem

Type *HELP* anytime to see this menu.`

export async function getMainMenu(phone: string): Promise<string> {
  try {
    const seller = await getSellerByPhone(phone)
    const rider = await Rider.findOne({ phone })

    const option6 = seller ? `6️⃣ Manage my shop` : `6️⃣ Become a seller (Register shop)`
    const option7 = rider ? `7️⃣ Rider dashboard` : `7️⃣ Become a rider`

    return `🛒 *WhatsApp Shop OS*
_Kenya's neighbourhood commerce network_

1️⃣ Order essentials
2️⃣ Reorder (same as last time)
3️⃣ Track my order
4️⃣ Browse shops
5️⃣ My orders
${option6}
${option7}
8️⃣ Report a problem

Type *HELP* anytime to see this menu.`
  } catch (err) {
    log(`[ERROR] getMainMenu failed: ${String(err)}`)
    return STATIC_MAIN_MENU
  }
}

// ─────────────────────────────────────────────
// ENTRY POINT
// ─────────────────────────────────────────────

export type { SessionState } from '../services/sessionStore.js'

type Sender = (jid: string, msg: string) => Promise<void>

// ─────────────────────────────────────────────
// LOCATION PIN HANDLER
// Called when buyer sends a WhatsApp location pin
// ─────────────────────────────────────────────

export async function handleLocationMessage(
  phone: string,
  jid: string,
  latitude: number,
  longitude: number,
  placeName: string,
  sendMessage: (jid: string, msg: string) => Promise<void>
): Promise<void> {
  const session = await getSession(phone)
  const send: Sender = sendMessage

  // If buyer is in the location step of ordering, use the pin
  if (session.step === 'order_ask_location' || session.step === 'order_confirm_location') {
    const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`
    const locationText = placeName || `GPS: ${latitude.toFixed(5)}, ${longitude.toFixed(5)}`
    // Store coordinates in session data
    await setSession(phone, {
      ...session,
      data: { ...session.data, latitude: String(latitude), longitude: String(longitude) }
    })
    await placeOrderAndFinish(phone, jid, locationText, {
      ...session,
      data: { ...session.data, latitude: String(latitude), longitude: String(longitude) }
    }, send)
    return
  }

  // If rider sends location update, handle it
  const rider = await Rider.findOne({ phone })
  if (rider) {
    await Rider.findOneAndUpdate(
      { riderId: rider.riderId },
      { latitude, longitude, locationUpdatedAt: new Date(), updatedAt: new Date() }
    )
    const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`
    if (rider.currentOrderId) {
      const activeOrder = await Order.findOne({ orderId: rider.currentOrderId })
      if (activeOrder?.buyerJid) {
        await send(activeOrder.buyerJid,
          `📍 *Live Rider Location Update*\n\n` +
          `🏍️ Your rider is here:\n${mapsLink}\n\n` +
          `🔑 Remember your delivery code: *${activeOrder.completionOtp}*`
        )
      }
    }
    await send(jid, `✅ *Location updated!*\n\n📍 ${mapsLink}`)
    return
  }

  // Default: acknowledge location
  await send(jid, `📍 Location received! Type *1* to place an order and we'll use your pin for delivery.`)
}

// ─────────────────────────────────────────────
// IMAGE MESSAGE HANDLER
// Called when seller sends a product image
// ─────────────────────────────────────────────

export async function handleImageMessage(
  phone: string,
  jid: string,
  imageBuffer: Buffer,
  caption: string,
  sendMessage: (jid: string, msg: string) => Promise<void>
): Promise<void> {
  const send: Sender = sendMessage
  const session = await getSession(phone)

  // Check if seller is in image upload step
  if (session.step === 'seller_mgmt_image_upload') {
    const { sellerId, productId, productName } = session.data as { sellerId: string; productId: string; productName: string }
    // Store image as base64 data URL (for small images) or just acknowledge
    // In production, this would upload to S3/CDN
    const base64 = imageBuffer.toString('base64')
    const imageUrl = `data:image/jpeg;base64,${base64.substring(0, 50)}...` // Truncated for DB
    await updateProductImage(sellerId, productId, `[image_uploaded:${Date.now()}]`)
    await setSession(phone, { step: 'seller_mgmt_menu', data: { sellerId } })
    const seller = await getSellerByPhone(phone)
    await send(jid,
      `✅ *Image saved for ${productName}!*\n\n` +
      `Buyers will see this when browsing your products.\n\n` +
      sellerMenu(seller?.name ?? 'Your Shop')
    )
    return
  }

  // If caption contains a product ID, treat as image update
  if (caption.toUpperCase().startsWith('IMG ') || caption.toUpperCase().startsWith('IMAGE ')) {
    const seller = await getSellerByPhone(phone)
    if (seller) {
      const productIdMatch = caption.match(/PRD-[A-Z0-9-]+/i)
      if (productIdMatch) {
        await updateProductImage(seller.sellerId, productIdMatch[0], `[image_uploaded:${Date.now()}]`)
        await send(jid, `✅ Image updated for product *${productIdMatch[0]}*`)
        return
      }
    }
  }

  // Default: pass caption as text message
  if (caption) {
    await handleMessage(phone, jid, caption, sendMessage)
  } else {
    await send(jid, `📸 Image received!\n\nTo add a product image, go to your shop manager (type *6*) and select a product to upload an image.`)
  }
}

export async function handleMessage(
  phone: string,
  jid: string,
  text: string,
  sendMessage: (jid: string, msg: string) => Promise<void>
): Promise<void> {
  const raw = text.trim()
  const lower = raw.toLowerCase()
  const session = await getSession(phone)

  log(`[MSG] ${phone} | step=${session.step} | text="${raw}"`)

  // ── Block check ──
  const user = await User.findOne({ phone })
  if (user?.blocked) {
    await sendMessage(jid, `⛔ Your account has been suspended. Contact support for assistance.`)
    return
  }

  // ── Admin commands (phone-gated) ──
  if (raw.toUpperCase().startsWith('ADMIN ') && isAdmin(phone)) {
    const result = await handleAdminCommand(phone, raw)
    await sendMessage(jid, result)
    return
  }

  // ── Global reset commands ──
  if (['help', 'menu', 'hi', 'hello', 'start', 'hii', 'habari', 'sasa', 'hey'].includes(lower)) {
    await resetSession(phone)
    if (!user) {
      // First-time user: warm onboarding welcome
      await sendMessage(jid,
        `🎉 *Karibu Shop OS!* Welcome!\n\n` +
        `Nunua bidhaa karibu nawe bila kutoka nyumbani.\n` +
        `_(Buy essentials near you without leaving home.)_\n\n` +
        `✅ Fast delivery to your door\n` +
        `✅ Pay on delivery or via M-Pesa\n` +
        `✅ Track your order in real time\n` +
        `✅ Trusted local sellers\n\n` +
        await getMainMenu(phone)
      )
    } else {
      const greeting = user.name ? `👋 Habari, *${user.name}*! Karibu back to Shop OS.\n\n` : `👋 Karibu! Welcome back.\n\n`
      const menu = await getMainMenu(phone)
      await sendMessage(jid, greeting + menu)
    }
    return
  }

  if (['cancel', 'back', 'rudi', 'stop'].includes(lower) || raw === '0') {
    await resetSession(phone)
    const menu = await getMainMenu(phone)
    await sendMessage(jid, `✅ Cancelled.\n\n${menu}`)
    return
  }

  // ── Seller CONFIRM / REJECT orders ──
  const confirmMatch = raw.toUpperCase().match(/^CONFIRM\s+(ORD-[A-Z0-9-]+)$/)
  const rejectMatch = raw.toUpperCase().match(/^REJECT\s+(ORD-[A-Z0-9-]+)(\s+.+)?$/)

  if (confirmMatch) {
    const orderId = confirmMatch[1]!
    try {
      const order = await confirmOrder(orderId, phone)
      if (!order) {
        await sendMessage(jid, `❌ Could not confirm *${orderId}*.\nCheck the order ID or make sure it belongs to your shop.`)
      } else {
        await sendMessage(jid,
          `✅ *Order ${orderId} confirmed!*\n\nThe buyer has been notified with their OTP.\nA rider is being dispatched.\n\nReply *REJECT ${orderId}* if you need to cancel.`
        )
      }
    } catch (err: any) {
      await sendMessage(jid, `❌ *Order Confirmation Blocked:*\n\n${err.message}`)
    }
    return
  }

  if (rejectMatch) {
    const orderId = rejectMatch[1]!
    const reason = rejectMatch[2]?.trim() ?? ''
    const order = await rejectOrder(orderId, phone, reason)
    if (!order) {
      await sendMessage(jid, `❌ Could not reject *${orderId}*. Check the order ID.`)
    } else {
      await sendMessage(jid, `✅ Order *${orderId}* rejected. The buyer has been notified.`)
    }
    return
  }

  // ── Rider commands ──
  const acceptMatch = raw.toUpperCase().match(/^ACCEPT\s+(ORD-[A-Z0-9-]+)$/)
  const declineMatch = raw.toUpperCase().match(/^DECLINE\s+(ORD-[A-Z0-9-]+)$/)
  const pickupMatch = raw.toUpperCase().match(/^PICKUP\s+(ORD-[A-Z0-9-]+)$/)
  const doneMatch = raw.toUpperCase().match(/^DONE\s+(ORD-[A-Z0-9-]+)\s+(\d{4})$/)

  if (acceptMatch || declineMatch || pickupMatch || doneMatch) {
    const rider = await Rider.findOne({ phone })
    if (!rider) {
      await sendMessage(jid, `❌ You are not registered as a rider. Type *7* to join our delivery team.`)
      return
    }

    if (acceptMatch) {
      const orderId = acceptMatch[1]!
      const ok = await riderAcceptJob(rider.riderId, orderId)
      await sendMessage(jid, ok
        ? `✅ *Job accepted — ${orderId}*\n\nHead to the seller to pick up the order.\nReply *PICKUP ${orderId}* once you have the items.`
        : `❌ Could not accept ${orderId}. It may have been reassigned.`
      )
      return
    }

    if (declineMatch) {
      const orderId = declineMatch[1]!
      await riderDeclineJob(rider.riderId, orderId)
      await sendMessage(jid, `✅ Job ${orderId} declined. Another rider will be assigned.`)
      return
    }

    if (pickupMatch) {
      const orderId = pickupMatch[1]!
      const ok = await riderMarkPickup(rider.riderId, orderId)
      await sendMessage(jid, ok
        ? `✅ *Picked up — ${orderId}*\n\nHead to the buyer's location.\nReply *DONE ${orderId} [OTP]* when delivered.\n\n_e.g. DONE ORD-ABC123-XY 4821_`
        : `❌ Could not mark pickup for ${orderId}.`
      )
      return
    }

    if (doneMatch) {
      const orderId = doneMatch[1]!
      const otp = doneMatch[2]!
      const result = await riderMarkDelivered(rider.riderId, orderId, otp)
      await sendMessage(jid, result.message)
      return
    }
  }

  // ── EARNINGS shortcut for riders ──
  if (lower === 'earnings' || lower === 'pesa' || lower === 'wallet') {
    const rider = await Rider.findOne({ phone })
    if (rider) {
      await sendMessage(jid, await getRiderEarnings(rider.riderId))
      return
    }
  }

  // ── AVAILABLE / OFFLINE toggle for riders ──
  if (lower === 'available' || lower === 'online' || lower === 'offline') {
    const rider = await Rider.findOne({ phone })
    if (rider) {
      const isOnline = lower !== 'offline'
      rider.available = isOnline
      rider.updatedAt = new Date()
      await rider.save()
      const statusText = isOnline ? '🟢 AVAILABLE (Online)' : '🔴 OFFLINE (Quiet mode)'
      await sendMessage(jid, `✅ *Status updated: ${statusText}*\n\n${isOnline ? 'We will dispatch jobs to you when they are available.' : 'You will not receive any job requests until you go back online.'}`)
      return
    }
  }

  // ── LOCATION update for riders: "LOCATION -1.2921 36.8219" ──
  const locationMatch = raw.match(/^LOCATION\s+([-\d.]+)\s+([-\d.]+)$/i)
  if (locationMatch) {
    const rider = await Rider.findOne({ phone })
    if (rider) {
      const latitude = parseFloat(locationMatch[1]!)
      const longitude = parseFloat(locationMatch[2]!)
      if (isNaN(latitude) || isNaN(longitude)) {
        await sendMessage(jid, `❌ Invalid coordinates. Use: *LOCATION -1.2921 36.8219*`)
        return
      }
      await Rider.findOneAndUpdate(
        { riderId: rider.riderId },
        { latitude, longitude, locationUpdatedAt: new Date(), updatedAt: new Date() }
      )
      const mapsLink = `https://maps.google.com/?q=${latitude},${longitude}`
      // If rider has an active order, share location with buyer
      if (rider.currentOrderId) {
        const activeOrder = await Order.findOne({ orderId: rider.currentOrderId })
        if (activeOrder?.buyerJid) {
          await sendMessage(activeOrder.buyerJid,
            `📍 *Live Rider Location Update*\n\n` +
            `🏍️ Your rider is here:\n${mapsLink}\n\n` +
            `🔑 Remember your delivery code: *${activeOrder.completionOtp}*`
          )
        }
      }
      await sendMessage(jid, `✅ *Location updated!*\n\n📍 ${mapsLink}\n\n_Buyer has been notified of your position._`)
      return
    }
  }

  // ── ADD RIDER / REMOVE RIDER commands for sellers ──
  const addRiderMatch = raw.match(/^ADD\s+RIDER\s+(\S+)$/i)
  const removeRiderMatch = raw.match(/^REMOVE\s+RIDER\s+(\S+)$/i)
  const myRidersMatch = lower === 'my riders' || lower === 'riders'

  if (addRiderMatch || removeRiderMatch || myRidersMatch) {
    const seller = await getSellerByPhone(phone)
    if (!seller) {
      await sendMessage(jid, `❌ This command is for sellers only. Type *6* to register your shop.`)
      return
    }
    if (addRiderMatch) {
      const result = await addTrustedRider(seller.sellerId, addRiderMatch[1]!)
      await sendMessage(jid, result.message)
      return
    }
    if (removeRiderMatch) {
      const result = await removeTrustedRider(seller.sellerId, removeRiderMatch[1]!)
      await sendMessage(jid, result.message)
      return
    }
    if (myRidersMatch) {
      const msg = await listTrustedRiders(seller.sellerId)
      await sendMessage(jid, msg)
      return
    }
  }

  // ── RATE command for buyers after delivery ──
  const rateMatch = raw.match(/^RATE\s+(ORD-[A-Z0-9-]+)\s+([1-5])$/i)
  if (rateMatch) {
    const orderId = rateMatch[1]!
    const rating = parseInt(rateMatch[2]!)
    const order = await Order.findOne({ orderId, buyerPhone: phone, status: 'delivered' })
    if (!order) {
      await sendMessage(jid, `❌ Order not found or not yet delivered. You can only rate delivered orders.`)
      return
    }
    await rateSellerAfterDelivery(order.sellerId, rating)
    const stars = '⭐'.repeat(rating) + '☆'.repeat(5 - rating)
    await sendMessage(jid, `✅ *Thank you for your rating!*\n\n${stars} ${rating}/5\n\nYour feedback helps other buyers choose trusted shops.`)
    return
  }

  // ── STATS shortcut for sellers ──
  if (lower === 'stats' || lower === 'mauzo') {
    const seller = await getSellerByPhone(phone)
    if (seller) {
      await sendMessage(jid,
        `📊 *${seller.name} — Your Stats*\n\n` +
        `📦 Total Orders: ${seller.totalOrders}\n` +
        `✅ Completed: ${seller.completedOrders}\n` +
        `❌ Rejected: ${seller.rejectedOrders}\n` +
        `💰 Revenue: Ksh ${seller.totalRevenue.toLocaleString()}\n` +
        `⭐ Trust Score: ${seller.trustScore}/100\n` +
        `🏷️ Tier: ${seller.tier.toUpperCase()}`
      )
      return
    }
  }

  // ── Route to active flow ──
  if (session.step === 'idle') {
    await handleMainMenu(phone, jid, raw, lower, sendMessage)
    return
  }

  if (session.step.startsWith('order_')) {
    await handleOrderFlow(phone, jid, raw, lower, session, sendMessage)
    return
  }

  if (session.step.startsWith('reorder_')) {
    await handleReorderFlow(phone, jid, raw, lower, session, sendMessage)
    return
  }

  if (session.step.startsWith('track_')) {
    await handleTrackFlow(phone, jid, raw, session, sendMessage)
    return
  }

  if (session.step.startsWith('seller_reg_')) {
    await handleSellerReg(phone, jid, raw, session, sendMessage)
    return
  }

  if (session.step.startsWith('seller_mgmt_')) {
    await handleSellerMgmt(phone, jid, raw, session, sendMessage)
    return
  }

  if (session.step.startsWith('rider_')) {
    await handleRiderFlow(phone, jid, raw, session, sendMessage)
    return
  }

  if (session.step.startsWith('dispute_')) {
    await handleDisputeFlow(phone, jid, raw, session, sendMessage)
    return
  }

  if (session.step.startsWith('mpesa_')) {
    await handleMpesaFlow(phone, jid, raw, session, sendMessage)
    return
  }

  // Bilingual friendly fallback
  await sendMessage(jid,
    `❓ Sijaelewa — I didn't get that.\n\n` +
    `Reply with a number from the menu below, or type *HELP*:\n\n` +
    await getMainMenu(phone)
  )
}

// ─────────────────────────────────────────────
// MAIN MENU HANDLER
// ─────────────────────────────────────────────

async function handleMainMenu(phone: string, jid: string, raw: string, lower: string, send: Sender): Promise<void> {
  if (raw === '1') {
    await setSession(phone, { step: 'order_ask_product', data: {} })
    await send(jid,
      `🛍️ *Order Essentials*\n\n` +
      `What would you like to order?\n` +
      `_Examples: unga, sukari, mafuta, maziwa, dawa, rice, cooking oil_\n\n` +
      `Type the product name:`
    )
    return
  }

  if (raw === '2') {
    const lastOrder = await getLastOrderForReorder(phone)
    if (!lastOrder) {
      await send(jid, `📭 No previous order found.\n\nType *1* to place your first order.`)
      return
    }
    const items = lastOrder.items.map(i => `• ${i.name} x${i.quantity} — Ksh ${i.price}`).join('\n')
    await setSession(phone, {
      step: 'reorder_confirm',
      data: {
        orderId: lastOrder.orderId,
        productId: lastOrder.items[0]?.productId ?? '',
        productName: lastOrder.items[0]?.name ?? '',
        quantity: String(lastOrder.items[0]?.quantity ?? 1),
        location: lastOrder.location,
        zone: lastOrder.zone,
        paymentMode: lastOrder.paymentMode,
        substitutionPref: lastOrder.substitutionPref,
      },
    })
    await send(jid,
      `🔄 *Quick Reorder*\n\n` +
      `Your last order:\n${items}\n\n` +
      `📍 Deliver to: ${lastOrder.location}\n` +
      `💳 Payment: ${lastOrder.paymentMode.toUpperCase()}\n\n` +
      `Reply *YES* to reorder the same, or *1* to order something new.`
    )
    return
  }

  if (raw === '3') {
    await setSession(phone, { step: 'track_ask_id', data: {} })
    await send(jid, `🔍 *Track Order*\n\nEnter your Order ID (e.g. ORD-ABC123-XY):\n\nOr type *MY ORDERS* to see all your orders.`)
    return
  }

  if (raw === '4') {
    const user = await User.findOne({ phone })
    const zone = user?.zone || user?.location || ''
    let sellers = await listAllSellers(zone)
    let local = true

    if (sellers.length === 0) {
      sellers = await listAllSellers() // Fallback to all
      local = false
    }

    if (sellers.length === 0) {
      await send(jid, `📭 Hakuna maduka kwa sasa (No shops registered yet).\n\nReply *6* to become the first seller! 🚀`)
      return
    }

    const tierEmoji = (tier: string) => ({ premium: '⭐', top: '🔥', verified: '✅', new: '🆕' }[tier] ?? '🏪')
    const { Product } = await import('../models/Product.js')
    const list = await Promise.all(sellers.map(async (s, i) => {
      const productCount = await Product.countDocuments({ sellerId: s.sellerId, active: true, stock: { $gt: 0 } })
      const ratingStr = s.ratingCount > 0 ? `⭐ ${s.rating}/5 (${s.ratingCount})` : '⭐ New'
      return (
        `${i + 1}. ${tierEmoji(s.tier)} *${s.name}*\n` +
        `   🏷️ ${s.category} | 📍 ${s.location}\n` +
        `   ⏰ ${s.openingHours || '7am - 9pm'} | ${ratingStr} | 📦 ${productCount} items`
      )
    }))

    const title = local ? `🏪 *Nearby Shops in ${zone} (${sellers.length})*` : `🏪 *All Registered Shops (${sellers.length})*`
    await send(jid, `${title}\n\n${list.join('\n\n')}\n\nType a product name (e.g. *unga*) to order, or *0* to go back.`)
    return
  }

  if (raw === '5' || lower === 'my orders') {
    const orders = await getOrdersByBuyer(phone)
    if (orders.length === 0) {
      await send(jid, `📭 You have no orders yet.\n\nType *1* to place your first order!`)
      return
    }
    const statusIcon = (s: string) => ({ received: '📨', confirming_stock: '🔍', confirmed: '✅', preparing: '👨‍🍳', rider_assigned: '🏍️', on_the_way: '🚀', delivered: '🎉', cancelled: '❌', disputed: '⚠️' }[s] ?? '🔄')
    const list = orders.map(o =>
      `${statusIcon(o.status)} *${o.orderId}*\n` +
      `  ${o.items.map(i => `${i.name} x${i.quantity}`).join(', ')}\n` +
      `  Ksh ${o.totalAmount} | ${o.status.replace(/_/g, ' ').toUpperCase()}`
    ).join('\n\n')
    await setSession(phone, { step: 'track_ask_id', data: {} })
    await send(jid, `📋 *Your Orders (${orders.length})*\n\n${list}\n\nType an Order ID to get details.`)
    return
  }

  if (raw === '6' || lower === 'seller' || lower === 'sell' || lower === 'duka') {
    const existing = await getSellerByPhone(phone)
    if (existing) {
      await setSession(phone, { step: 'seller_mgmt_menu', data: { sellerId: existing.sellerId } })
      await send(jid, sellerMenu(existing.name))
      return
    }
    await setSession(phone, { step: 'seller_reg_name', data: {} })
    await send(jid,
      `🏪 *Become a Seller — Register Your Shop*\n\n` +
      `Anza kuuza leo na ufikie wateja wengi karibu nawe! (Start selling today and reach nearby customers!)\n\n` +
      `What is your shop or business name?\n` +
      `_e.g., Mama Mboga Fresh, Bomet Wholesalers, Thika Chemist_`
    )
    return
  }

  if (raw === '7') {
    const existing = await Rider.findOne({ phone })
    if (existing) {
      const availIcon = existing.available ? '🟢 AVAILABLE' : '🔴 OFFLINE'
      await send(jid,
        `🏍️ *Rider Dashboard — ${existing.name}*\n\n` +
        `📍 Zone: ${existing.zone}\n` +
        `⭐ Trust: ${existing.trustScore}/100 | 🏷️ ${existing.tier.toUpperCase()}\n` +
        `💰 Total Earnings: Ksh ${existing.totalEarnings}\n` +
        `📶 Status: *${availIcon}*\n\n` +
        `Commands:\n` +
        `• Type *AVAILABLE* to go online for jobs\n` +
        `• Type *OFFLINE* to stop receiving jobs\n` +
        `• Type *EARNINGS* for full wallet summary\n` +
        `• Type *ACCEPT/DECLINE/PICKUP/DONE* for active orders`
      )
      return
    }
    await setSession(phone, { step: 'rider_ask_name', data: {} })
    await send(jid, `🏍️ *Become a Rider*\n\nJoin our trusted delivery network and earn daily!\n\nWhat is your full name?`)
    return
  }

  if (raw === '8') {
    await setSession(phone, { step: 'dispute_ask_order', data: {} })
    await send(jid,
      `⚠️ *Report a Problem*\n\n` +
      `We take complaints seriously.\n\n` +
      `Enter the Order ID you want to report:\n` +
      `_e.g. ORD-ABC123-XY_`
    )
    return
  }

  const menu = await getMainMenu(phone)
  await send(jid, `Reply with 1–8.\n\n${menu}`)
}

// ─────────────────────────────────────────────
// ORDER FLOW
// ─────────────────────────────────────────────

interface ProductRef { productId: string; name: string; price: number; stock: number; sellerId: string; sellerName: string }
interface RefItem { id: string; name: string }

async function handleOrderFlow(phone: string, jid: string, raw: string, lower: string, session: SessionState, send: Sender): Promise<void> {

  // Step 1: Search product
  if (session.step === 'order_ask_product') {
    if (raw.length < 2) { await send(jid, `Type at least 2 characters to search.`); return }
    const user = await User.findOne({ phone })
    const userZone = user?.zone || user?.location || ''
    
    let results = await searchProducts(raw, userZone ? userZone : undefined)
    let isGlobalFallback = false

    if (results.length === 0 && userZone) {
      results = await searchProducts(raw)
      isGlobalFallback = true
    }

    if (results.length === 0) {
      await send(jid, `😔 No products found for "*${raw}*".\n\nTry a different name, or reply *0* to return to the menu.`)
      return
    }

    const resultsWithSellers = await Promise.all(results.map(async p => {
      const s = await Seller.findOne({ sellerId: p.sellerId })
      return {
        productId: p.productId,
        name: p.name,
        price: p.price,
        stock: p.stock,
        sellerId: p.sellerId,
        sellerName: p.sellerName,
        sellerLocation: s?.location || p.sellerZone || 'Local',
        sellerTrust: s?.trustScore ?? 70,
        sellerTier: s?.tier ?? 'new'
      }
    }))

    const tierMap: Record<string, string> = { premium: '⭐', top: '🔥', verified: '✅', new: '🆕' }
    const list = resultsWithSellers.map((p, i) => {
      const prefix = isGlobalFallback ? '⚠️ _[Outside your zone]_ ' : ''
      const tierEmoji = tierMap[p.sellerTier] ?? '🏪'
      return `${i + 1}. ${prefix}*${p.name}* — Ksh ${p.price}\n` +
             `   ${tierEmoji} ${p.sellerName} (📍 ${p.sellerLocation} | Trust: ${p.sellerTrust}/100)\n` +
             `   📦 ${p.stock} in stock`
    }).join('\n\n')

    await setSession(phone, {
      step: 'order_pick_product',
      data: {
        products: JSON.stringify(resultsWithSellers.map(p => ({
          productId: p.productId,
          name: p.name,
          price: p.price,
          stock: p.stock,
          sellerId: p.sellerId,
          sellerName: p.sellerName
        })))
      },
    })

    const heading = isGlobalFallback 
      ? `🛒 *Found ${results.length} result(s) outside your zone:*\n\n` 
      : `🛒 *Found ${results.length} result(s) nearby:*\n\n`
    await send(jid, `${heading}${list}\n\nReply with the number to select:\n_(Or type another name to search again)_`)
    return
  }

  // Step 2: Pick from results
  if (session.step === 'order_pick_product') {
    const products = JSON.parse(session.data['products'] ?? '[]') as ProductRef[]
    const idx = parseInt(raw) - 1

    if (isNaN(idx) || idx < 0 || idx >= products.length) {
      // Treat as new search query
      const user = await User.findOne({ phone })
      const userZone = user?.zone || user?.location || ''
      
      let results = await searchProducts(raw, userZone ? userZone : undefined)
      let isGlobalFallback = false
      if (results.length === 0 && userZone) {
        results = await searchProducts(raw)
        isGlobalFallback = true
      }
      
      if (results.length === 0) {
        await send(jid, `😔 No products found for "*${raw}*".\n\nType a new product to search, or reply *0* to return to the menu.`)
        return
      }

      const resultsWithSellers = await Promise.all(results.map(async p => {
        const s = await Seller.findOne({ sellerId: p.sellerId })
        return {
          productId: p.productId,
          name: p.name,
          price: p.price,
          stock: p.stock,
          sellerId: p.sellerId,
          sellerName: p.sellerName,
          sellerLocation: s?.location || p.sellerZone || 'Local',
          sellerTrust: s?.trustScore ?? 70,
          sellerTier: s?.tier ?? 'new'
        }
      }))

      const tierMap2: Record<string, string> = { premium: '⭐', top: '🔥', verified: '✅', new: '🆕' }
      const list = resultsWithSellers.map((p, i) => {
        const prefix = isGlobalFallback ? '⚠️ _[Outside your zone]_ ' : ''
        const tierEmoji = tierMap2[p.sellerTier] ?? '🏪'
        return `${i + 1}. ${prefix}*${p.name}* — Ksh ${p.price}\n` +
               `   ${tierEmoji} ${p.sellerName} (📍 ${p.sellerLocation} | Trust: ${p.sellerTrust}/100)\n` +
               `   📦 ${p.stock} in stock`
      }).join('\n\n')

      await setSession(phone, {
        step: 'order_pick_product',
        data: {
          products: JSON.stringify(resultsWithSellers.map(p => ({
            productId: p.productId,
            name: p.name,
            price: p.price,
            stock: p.stock,
            sellerId: p.sellerId,
            sellerName: p.sellerName
          })))
        },
      })

      const heading = isGlobalFallback 
        ? `🛒 *Found ${results.length} result(s) outside your zone:*\n\n` 
        : `🛒 *Found ${results.length} result(s) nearby:*\n\n`
      await send(jid, `${heading}${list}\n\nReply with the number to select:\n_(Or type another name to search again)_`)
      return
    }

    const selected = products[idx]!
    await setSession(phone, { step: 'order_ask_quantity', data: { productId: selected.productId, productName: selected.name, price: String(selected.price), stock: String(selected.stock) } })
    await send(jid,
      `📦 *${selected.name}* — Ksh ${selected.price} each\n` +
      `🏪 ${selected.sellerName} | ${selected.stock} in stock\n\n` +
      `How many would you like? (e.g. 1, 2, 3)\n` +
      `_Max: ${selected.stock}_`
    )
    return
  }

  // Step 3: Quantity
  if (session.step === 'order_ask_quantity') {
    const qty = parseInt(raw)
    const maxStock = parseInt(session.data['stock'] ?? '99')
    if (isNaN(qty) || qty < 1) { await send(jid, `❌ Enter a valid number e.g. *1*, *2*, *3*`); return }
    if (qty > maxStock) { await send(jid, `❌ Only *${maxStock}* in stock. Enter a lower quantity.`); return }
    const price = parseFloat(session.data['price'] ?? '0')
    const total = price * qty
    await setSession(phone, { step: 'order_ask_substitution', data: { ...session.data, quantity: String(qty), total: String(total) } })
    await send(jid,
      `✅ *${qty}x ${session.data['productName']}* — Ksh ${total}\n\n` +
      `🔄 *If out of stock, what should we do?*\n\n` +
      `1. Replace with similar item\n` +
      `2. Ask me first\n` +
      `3. Cancel order if unavailable`
    )
    return
  }

  // Step 4: Substitution preference
  if (session.step === 'order_ask_substitution') {
    const prefMap: Record<string, 'replace' | 'ask' | 'none'> = { '1': 'replace', '2': 'ask', '3': 'none' }
    const pref = prefMap[raw] ?? 'ask'
    await setSession(phone, { step: 'order_ask_payment', data: { ...session.data, substitutionPref: pref } })
    await send(jid,
      `💳 *Payment Method*\n\n` +
      `1. 💵 Cash on Delivery (pay when order arrives)\n` +
      `2. 📲 M-Pesa (pay now, order confirmed faster)\n\n` +
      `Reply 1 or 2:`
    )
    return
  }

  // Step 5: Payment method
  if (session.step === 'order_ask_payment') {
    const payMap: Record<string, 'cod' | 'mpesa'> = { '1': 'cod', '2': 'mpesa' }
    const payMode = payMap[raw]
    if (!payMode) { await send(jid, `Reply *1* for Cash on Delivery or *2* for M-Pesa.`); return }

    const user = await User.findOne({ phone })
    const savedName = user?.name ?? ''
    const savedLocation = user?.location ?? ''

    if (!savedName) {
      await setSession(phone, {
        step: 'order_ask_name',
        data: { ...session.data, paymentMode: payMode, savedLocation }
      })
      await send(jid,
        `👋 *Welcome to Shop OS!* Before we finish your order, what is your name?\n\n` +
        `_e.g., John Doe, Mama Shiko, David_`
      )
      return
    }

    await setSession(phone, {
      step: savedLocation ? 'order_confirm_location' : 'order_ask_location',
      data: { ...session.data, paymentMode: payMode, savedName, savedLocation }
    })

    if (savedLocation) {
      await send(jid,
        `📍 Deliver to your saved address?\n\n` +
        `_"${savedLocation}"_\n\n` +
        `Reply *YES* to use this, or type a new address:`
      )
    } else {
      await send(jid,
        `📍 *Where should we deliver?*\n\n` +
        `📌 *Best:* Tap the 📎 paperclip → *Location* and send your pin!\n` +
        `_(Riders get exact GPS navigation — faster delivery!)_\n\n` +
        `Or type your address:\n` +
        `e.g. "Makongeni Estate, Blue gate" or "Near Equity Bank Thika"`
      )
    }
    return
  }

  // Step 5.5: Ask name
  if (session.step === 'order_ask_name') {
    const name = raw.trim()
    if (name.length < 2) {
      await send(jid, `❌ Please enter a valid name (at least 2 letters):`)
      return
    }

    // Save user name to DB
    await User.findOneAndUpdate(
      { phone },
      { name, jid, updatedAt: new Date() },
      { upsert: true }
    )

    const savedLocation = session.data['savedLocation'] ?? ''
    await setSession(phone, {
      step: savedLocation ? 'order_confirm_location' : 'order_ask_location',
      data: { ...session.data, savedName: name, savedLocation }
    })

    if (savedLocation) {
      await send(jid,
        `📍 Deliver to your saved address?\n\n` +
        `_"${savedLocation}"_\n\n` +
        `Reply *YES* to use this, or type a new address:`
      )
    } else {
      await send(jid,
        `📍 *Where should we deliver?*\n\n` +
        `📌 *Best:* Tap the 📎 paperclip → *Location* and send your pin!\n` +
        `_(Riders get exact GPS navigation — faster delivery!)_\n\n` +
        `Or type your address:\n` +
        `e.g. "Makongeni Estate, Blue gate" or "Near Equity Bank Thika"`
      )
    }
    return
  }

  // Step 6a: Confirm saved location
  if (session.step === 'order_confirm_location') {
    const location = raw.toUpperCase() === 'YES' ? session.data['savedLocation']! : raw
    await placeOrderAndFinish(phone, jid, location, session, send)
    return
  }

  // Step 6b: New location
  if (session.step === 'order_ask_location') {
    if (raw.length < 5) { await send(jid, `Please describe your location more clearly.`); return }
    await placeOrderAndFinish(phone, jid, raw, session, send)
    return
  }

  // Step 6c: Name for checkout (when first time/missing name)
  if (session.step === 'order_ask_name_for_checkout') {
    const name = raw.trim()
    if (name.length < 2) {
      await send(jid, `❌ Please enter a valid name (at least 2 letters):`)
      return
    }
    const checkoutLocation = session.data['checkoutLocation'] ?? ''
    // Update data with buyerName
    session.data['buyerName'] = name
    await placeOrderAndFinish(phone, jid, checkoutLocation, session, send)
    return
  }
}

async function placeOrderAndFinish(phone: string, jid: string, location: string, session: SessionState, send: Sender): Promise<void> {
  const { productId, productName, quantity, paymentMode, substitutionPref, savedLocation, buyerName, latitude: latStr, longitude: lngStr } = session.data
  const latitude = latStr ? parseFloat(latStr) : undefined
  const longitude = lngStr ? parseFloat(lngStr) : undefined
  let user = await User.findOne({ phone })

  // ── Collect buyer name if missing ──
  if (!user?.name && !buyerName) {
    await setSession(phone, {
      step: 'order_ask_name_for_checkout',
      data: { ...session.data, checkoutLocation: location },
    })
    await send(jid,
      `📝 *One last thing!*\n\n` +
      `Please enter your *name* so the rider can find you easily:\n` +
      `_e.g. John, Mama Amina, Bwana Kinyanjui_`
    )
    return
  }

  const resolvedName = user?.name ?? buyerName ?? ''

  const order = await createOrder({
    buyerPhone: phone,
    buyerJid: jid,
    buyerName: resolvedName,
    productId: productId ?? '',
    productName: productName ?? '',
    quantity: parseInt(quantity ?? '1'),
    location,
    zone: user?.zone ?? '',
    paymentMode: (paymentMode as 'cod' | 'mpesa') ?? 'cod',
    substitutionPref: (substitutionPref as 'replace' | 'ask' | 'none') ?? 'ask',
    notes: '',
    latitude,
    longitude,
  })

  if (!order) {
    await send(jid, `😔 Sorry, *${productName}* is out of stock or unavailable right now.\n\nType *1* to search for something else.`)
    await resetSession(phone)
    return
  }

  // Save location + name if new
  await User.findOneAndUpdate(
    { phone },
    { location, ...(resolvedName ? { name: resolvedName } : {}), updatedAt: new Date() },
    { upsert: true }
  )

  const total = order.totalAmount + order.deliveryFee

  if (paymentMode === 'mpesa') {
    const paybill = process.env['MPESA_PAYBILL'] ?? ''
    const tillNo = process.env['MPESA_TILL'] ?? ''
    await setSession(phone, { step: 'mpesa_await_ref', data: { orderId: order.orderId } })

    if (isStkConfigured()) {
      const stk = await initiateStkPush(order.orderId, phone, total)
      if (stk.ok) {
        await send(jid,
          `✅ *Order Placed — ${order.orderId}*\n\n` +
          `📦 ${productName} x${quantity}\n` +
          `📍 ${location}\n` +
          `💰 Total: Ksh ${total}\n\n` +
          `📲 *M-Pesa STK Push sent!* Check your phone and enter your PIN to pay.\n\n` +
          `If you don't see the prompt, reply with your M-Pesa Transaction Code after paying manually.\n\n` +
          `🔑 Your delivery OTP: *${order.completionOtp}*`
        )
        return
      }
    }
    
    let paymentInstructions = ''
    if (tillNo && paybill) {
      paymentInstructions = `📲 *Lipa na M-Pesa*\n\n` +
        `To confirm your order, please pay *Ksh ${total}*:\n\n` +
        `*Option A: Buy Goods (Till)* (RECOMMENDED - Free)\n` +
        `1. Go to your M-Pesa menu or App\n` +
        `2. Select *Lipa na M-Pesa* > *Buy Goods and Services*\n` +
        `3. Enter Till No: *${tillNo}*\n` +
        `4. Enter Amount: *Ksh ${total}*\n` +
        `5. Enter M-Pesa PIN and send.\n\n` +
        `*Option B: Paybill*\n` +
        `1. Select *Lipa na M-Pesa* > *Paybill*\n` +
        `2. Enter Business No: *${paybill}*\n` +
        `3. Enter Account No: *${order.orderId}*\n` +
        `4. Enter Amount: *Ksh ${total}*\n` +
        `5. Enter M-Pesa PIN and send.`
    } else if (tillNo) {
      paymentInstructions = `📲 *Lipa na M-Pesa (Buy Goods)*\n\n` +
        `To confirm your order, please pay *Ksh ${total}*:\n\n` +
        `1. Go to your M-Pesa menu or App\n` +
        `2. Select *Lipa na M-Pesa* > *Buy Goods and Services*\n` +
        `3. Enter Till No: *${tillNo}*\n` +
        `4. Enter Amount: *Ksh ${total}*\n` +
        `5. Enter M-Pesa PIN and send.`
    } else {
      const activePaybill = paybill || '123456'
      paymentInstructions = `📲 *Lipa na M-Pesa (Paybill)*\n\n` +
        `To confirm your order, please pay *Ksh ${total}*:\n\n` +
        `1. Select *Lipa na M-Pesa* > *Paybill*\n` +
        `2. Enter Business No: *${activePaybill}*\n` +
        `3. Enter Account No: *${order.orderId}*\n` +
        `4. Enter Amount: *Ksh ${total}*\n` +
        `5. Enter M-Pesa PIN and send.`
    }

    await send(jid,
      `✅ *Order Placed — ${order.orderId}*\n\n` +
      `📦 ${productName} x${quantity}\n` +
      `📍 ${location}\n` +
      `💰 Total: Ksh ${total}\n\n` +
      `${paymentInstructions}\n\n` +
      `👉 once you receive the M-Pesa message, copy and reply with the *Transaction Code* (e.g., *QF3KL4M8PS*):`
    )
  } else {
    const codTotal = order.totalAmount + order.deliveryFee
    await resetSession(phone)
    await send(jid,
      `✅ *Order Placed!*\n\n` +
      `📦 Order ID: *${order.orderId}*\n` +
      `🛍️ ${productName} x${quantity}\n` +
      `📍 ${location}\n\n` +
      `💰 Items: Ksh ${order.totalAmount}\n` +
      `🚚 Delivery: Ksh ${order.deliveryFee}\n` +
      `💵 *Total to pay on delivery: Ksh ${codTotal}*\n\n` +
      `🔑 Your delivery OTP: *${order.completionOtp}*\n` +
      `_Give this code to the rider ONLY when they arrive._\n\n` +
      `⏳ Waiting for the shop to confirm. You'll be notified shortly.`
    )
  }
}

// ─────────────────────────────────────────────
// M-PESA FLOW
// ─────────────────────────────────────────────

async function handleMpesaFlow(phone: string, jid: string, raw: string, session: SessionState, send: Sender): Promise<void> {
  if (session.step === 'mpesa_await_ref') {
    const { orderId } = session.data
    const ref = raw.replace(/\s/g, '').toUpperCase()
    if (ref.length < 8 || ref.length > 12) {
      await send(jid, `❌ Hiyo haifanani na M-Pesa Transaction Code.\n\nM-Pesa codes are usually 10 characters long e.g. *QF3KL4M8PS*\n\nTry again or reply *0* to return to the menu.`)
      return
    }
    const result = await submitMpesaRef(orderId!, ref, phone)
    await resetSession(phone)
    const order = await getOrderStatus(orderId!)
    const confirmMsg = result.confirmed
      ? `✅ *Payment confirmed!* The shop has been notified.\n\n`
      : result.manualReview
        ? `⚠️ *Reference received — under review.* Our team will verify shortly.\n\n`
        : `✅ *M-Pesa reference code received!*\n\nTutahakikisha malipo sasa hivi. We will verify your payment and alert the shop.\n\n`
    await send(jid,
      confirmMsg +
      `📦 Order ID: *${orderId}*\n` +
      `📲 Ref Code: *${ref}*\n\n` +
      `🔑 Your delivery OTP: *${order?.completionOtp ?? '----'}*\n\n` +
      `_Save this code — hand it to the rider only when they deliver the items._`
    )
    return
  }
}

// ─────────────────────────────────────────────
// REORDER FLOW
// ─────────────────────────────────────────────

async function handleReorderFlow(phone: string, jid: string, raw: string, lower: string, session: SessionState, send: Sender): Promise<void> {
  // ── Name collection for reorder ──
  if (session.step === 'reorder_ask_name') {
    if (raw.length < 2) { await send(jid, `Please enter your name so the rider can find you.`); return }
    await User.findOneAndUpdate({ phone }, { name: raw, updatedAt: new Date() }, { upsert: true })
    await setSession(phone, { step: 'reorder_confirm', data: { ...session.data, buyerName: raw } })
    const { productName, quantity, location, paymentMode } = session.data
    const reorderTotal = `TBD on placement`
    await send(jid,
      `✅ Got it, *${raw}*!\n\n` +
      `🔄 *Confirm Reorder*\n\n` +
      `🛍️ ${productName} x${quantity}\n` +
      `📍 ${location}\n` +
      `💳 ${(paymentMode ?? 'COD').toUpperCase()}\n\n` +
      `Reply *YES* to confirm or *NO* to cancel.`
    )
    return
  }

  if (session.step === 'reorder_confirm') {
    if (lower === 'yes') {
      const { productId, productName, quantity, location, zone, paymentMode, substitutionPref, buyerName } = session.data
      const user = await User.findOne({ phone })

      // Guard: ensure we have buyer name
      if (!user?.name && !buyerName) {
        await setSession(phone, { step: 'reorder_ask_name', data: session.data })
        await send(jid, `📝 Please enter your name so the rider can find you:`)
        return
      }

      const order = await createOrder({
        buyerPhone: phone,
        buyerJid: jid,
        buyerName: user?.name ?? buyerName ?? '',
        productId: productId ?? '',
        productName: productName ?? '',
        quantity: parseInt(quantity ?? '1'),
        location: location ?? '',
        zone: zone ?? '',
        paymentMode: (paymentMode as 'cod' | 'mpesa') ?? 'cod',
        substitutionPref: (substitutionPref as 'replace' | 'ask' | 'none') ?? 'ask',
        notes: '',
      })
      await resetSession(phone)
      if (!order) {
        await send(jid, `😔 *${productName}* is out of stock right now.\n\nType *1* to search for alternatives.`)
        return
      }
      const reorderCodTotal = order.totalAmount + order.deliveryFee
      await send(jid,
        `✅ *Reorder Placed!*\n\n` +
        `📦 Order ID: *${order.orderId}*\n` +
        `🛍️ ${productName} x${quantity}\n` +
        `📍 ${location}\n\n` +
        `💰 Items: Ksh ${order.totalAmount}\n` +
        `🚚 Delivery: Ksh ${order.deliveryFee}\n` +
        `💵 *Total to pay: Ksh ${reorderCodTotal}*\n\n` +
        `🔑 OTP: *${order.completionOtp}*\n` +
        `⏳ Awaiting shop confirmation.`
      )
    } else {
      await resetSession(phone)
      await send(jid, await getMainMenu(phone))
    }
    return
  }
}

// ─────────────────────────────────────────────
// TRACK FLOW
// ─────────────────────────────────────────────

async function handleTrackFlow(phone: string, jid: string, raw: string, session: SessionState, send: Sender): Promise<void> {
  if (session.step === 'track_ask_id') {
    const orderId = raw.toUpperCase().trim()

    if (orderId === 'MY ORDERS') {
      const orders = await getOrdersByBuyer(phone)
      await resetSession(phone)
      if (orders.length === 0) {
        await send(jid, `📭 No orders found. Type *1* to place an order.`)
        return
      }
      const list = orders.map(o => `*${o.orderId}* — ${o.status.replace(/_/g, ' ').toUpperCase()}`).join('\n')
      await send(jid, `📋 *Your Orders*\n\n${list}`)
      return
    }

    const order = await getOrderStatus(orderId)
    await resetSession(phone)

    if (!order) {
      const recent = await getOrdersByBuyer(phone)
      const hint = recent.length > 0 ? `\n\nYour recent orders:\n${recent.map(o => `• ${o.orderId}`).join('\n')}` : ''
      await send(jid, `❌ Order *${orderId}* not found.${hint}`)
      return
    }

    const statusIcon = (s: string) => ({ received: '📨', confirming_stock: '🔍', confirmed: '✅', preparing: '👨‍🍳', rider_assigned: '🏍️', on_the_way: '🚀', delivered: '🎉', cancelled: '❌', disputed: '⚠️' }[s] ?? '🔄')
    const items = order.items.map(i => `• ${i.name} x${i.quantity} — Ksh ${i.price * i.quantity}`).join('\n')

    await send(jid,
      `📦 *Order ${order.orderId}*\n\n` +
      `${items}\n\n` +
      `💰 Ksh ${order.totalAmount} + Ksh ${order.deliveryFee} delivery\n` +
      `💳 Payment: ${order.paymentMode.toUpperCase()} (${order.paymentStatus.toUpperCase()})\n` +
      `📍 ${order.location}\n` +
      `${statusIcon(order.status)} Status: *${order.status.replace(/_/g, ' ').toUpperCase()}*` +
      (order.completionOtp && ['confirmed', 'rider_assigned', 'on_the_way'].includes(order.status)
        ? `\n🔑 OTP: *${order.completionOtp}*` : '') +
      (order.riderPhone && ['rider_assigned', 'on_the_way'].includes(order.status)
        ? `\n🏍️ Rider: ${order.riderPhone}` : '') +
      (order.status === 'delivered'
        ? `\n\n⭐ *Rate your experience:* RATE ${order.orderId} [1-5]\n` +
          `Type *2* to reorder the same items!` : '') +
      (order.status === 'delivered' && !order.disputeId ? `\n⚠️ Type *8* to report a problem within 24 hours.` : '')
    )
    return
  }
}

// ─────────────────────────────────────────────
// DISPUTE FLOW
// ─────────────────────────────────────────────

async function handleDisputeFlow(phone: string, jid: string, raw: string, session: SessionState, send: Sender): Promise<void> {
  if (session.step === 'dispute_ask_order') {
    const orderId = raw.toUpperCase().trim()
    const order = await getOrderStatus(orderId)
    if (!order) {
      await send(jid, `❌ Order *${orderId}* not found.\n\nType your order ID carefully e.g. ORD-ABC123-XY`)
      return
    }
    if (order.buyerPhone !== phone) {
      await send(jid, `❌ This order does not belong to your account.`)
      await resetSession(phone)
      return
    }
    if (order.disputeId) {
      await send(jid, `⚠️ A dispute (*${order.disputeId}*) already exists for this order. Our team is reviewing it.`)
      await resetSession(phone)
      return
    }
    await setSession(phone, { step: 'dispute_ask_type', data: { orderId } })
    await send(jid,
      `⚠️ *Report a Problem — ${orderId}*\n\n` +
      `What went wrong?\n\n` +
      `1. Item was missing\n` +
      `2. Wrong item delivered\n` +
      `3. Item was damaged\n` +
      `4. Order was not delivered\n` +
      `5. Price was different from what was shown\n` +
      `6. Delivery was very late\n` +
      `7. Other problem\n\n` +
      `Reply with a number:`
    )
    return
  }

  if (session.step === 'dispute_ask_type') {
    const typeMap: Record<string, string> = {
      '1': 'missing_item', '2': 'wrong_item', '3': 'damaged_item',
      '4': 'not_delivered', '5': 'price_changed', '6': 'late_delivery', '7': 'other',
    }
    const type = typeMap[raw]
    if (!type) { await send(jid, `Reply with a number 1–7.`); return }
    await setSession(phone, { step: 'dispute_ask_description', data: { ...session.data, type } })
    await send(jid, `📝 Briefly describe what happened:\n\n_e.g. "I ordered 2kg unga but got 1kg" or "Rider never arrived"_`)
    return
  }

  if (session.step === 'dispute_ask_description') {
    const { orderId, type } = session.data
    const dispute = await raiseDispute(orderId!, phone, type as never, raw)
    await resetSession(phone)
    if (!dispute) {
      await send(jid, `❌ Could not raise dispute. Disputes must be filed within 24 hours of order.\n\nType *HELP* for the menu.`)
      return
    }
    await send(jid,
      `✅ *Dispute Raised — ${dispute.disputeId}*\n\n` +
      `📦 Order: ${orderId}\n` +
      `❓ Issue: ${type!.replace(/_/g, ' ').toUpperCase()}\n\n` +
      `Our team will review your complaint and respond shortly.\n` +
      `We take all issues seriously. 🙏`
    )
    return
  }
}

// ─────────────────────────────────────────────
// SELLER REGISTRATION
// ─────────────────────────────────────────────

async function handleSellerReg(phone: string, jid: string, raw: string, session: SessionState, send: Sender): Promise<void> {
  if (session.step === 'seller_reg_name') {
    if (raw.length < 2) { await send(jid, `Please enter your shop name (at least 2 characters).`); return }
    await setSession(phone, { step: 'seller_reg_location', data: { name: raw } })
    await send(jid, `📍 Where is your shop located?\n\n_Town, estate, or street name_\ne.g. "Makongeni, Thika" or "Tom Mboya St, Nairobi"`)
    return
  }

  if (session.step === 'seller_reg_location') {
    await setSession(phone, { step: 'seller_reg_category', data: { ...session.data, location: raw } })
    await send(jid,
      `🏷️ What type of business?\n\n` +
      `1. Groceries / Kiosk / Duka\n` +
      `2. Mama Mboga / Vegetables\n` +
      `3. Kibanda / Food / Snacks\n` +
      `4. Chemist / Pharmacy\n` +
      `5. Salon / Beauty\n` +
      `6. Hardware\n` +
      `7. Electronics\n` +
      `8. Wholesale / Supermarket\n` +
      `9. Other (type your category)\n\n` +
      `Reply with a number or type your category:`
    )
    return
  }

  if (session.step === 'seller_reg_category') {
    const categoryMap: Record<string, string> = {
      '1': 'Groceries / Kiosk', '2': 'Mama Mboga / Vegetables', '3': 'Kibanda / Food',
      '4': 'Chemist / Pharmacy', '5': 'Salon / Beauty', '6': 'Hardware',
      '7': 'Electronics', '8': 'Wholesale / Supermarket',
    }
    const category = categoryMap[raw] ?? raw
    await setSession(phone, { step: 'seller_reg_hours', data: { ...session.data, category } })
    await send(jid,
      `⏰ What are your opening hours?\n\n` +
      `_e.g. "7am - 9pm" or "Mon-Sat 8am - 8pm"_\n\n` +
      `Or reply *SKIP* for default (7am - 9pm):`
    )
    return
  }

  if (session.step === 'seller_reg_hours') {
    const hours = raw.toUpperCase() === 'SKIP' ? '7am - 9pm' : raw
    const { name, location, category } = session.data as { name: string; location: string; category: string }
    await setSession(phone, { step: 'seller_reg_confirm', data: { name, location, category, hours } })
    await send(jid,
      `✅ *Confirm Registration*\n\n` +
      `🏪 *${name}*\n` +
      `📍 ${location}\n` +
      `🏷️ ${category}\n` +
      `⏰ ${hours}\n` +
      `📱 ${phone}\n\n` +
      `Reply *YES* to register or *NO* to cancel.`
    )
    return
  }

  if (session.step === 'seller_reg_confirm') {
    if (raw.toUpperCase() === 'YES') {
      const { name, location, category, hours } = session.data as { name: string; location: string; category: string; hours: string }
      const seller = await registerSeller(phone, name, location, category, location, ``)
      await Seller.updateOne({ sellerId: seller.sellerId }, { openingHours: hours })
      await setSession(phone, { step: 'seller_mgmt_menu', data: { sellerId: seller.sellerId } })
      await send(jid,
        `🎉 *Welcome, ${name}!*\n\n` +
        `Your Seller ID: *${seller.sellerId}*\n\n` +
        `Next step: Add your products so buyers can find you!\n\n` +
        sellerMenu(name)
      )
    } else {
      await resetSession(phone)
      await send(jid, `❌ Registration cancelled.\n\n${STATIC_MAIN_MENU}`)
    }
    return
  }
}

// ─────────────────────────────────────────────
// SELLER MANAGEMENT
// ─────────────────────────────────────────────

function sellerMenu(name: string): string {
  return (
    `🏪 *${name} — Shop Manager*\n\n` +
    `1️⃣ Add product\n` +
    `2️⃣ My products\n` +
    `3️⃣ Update stock\n` +
    `4️⃣ Update price\n` +
    `5️⃣ Remove product\n` +
    `6️⃣ Active orders\n` +
    `7️⃣ My stats\n` +
    `8️⃣ My trusted riders\n\n` +
    `0️⃣ ↩ Back to main menu\n` +
    `_Or type STATS anytime for quick stats_`
  )
}

async function handleSellerMgmt(phone: string, jid: string, raw: string, session: SessionState, send: Sender): Promise<void> {
  const sellerId = session.data['sellerId'] ?? ''

  if (session.step === 'seller_mgmt_menu') {
    if (raw === '1') {
      await setSession(phone, { step: 'seller_mgmt_add_name', data: { sellerId } })
      await send(jid, `📦 *Add Product*\n\nProduct name:\n_e.g. Unga wa Ndizi 2kg, Sukari 1kg_`)
      return
    }
    if (raw === '2') {
      const products = await getProductsBySeller(sellerId)
      if (products.length === 0) { await send(jid, `💭 No products yet. Reply *1* to add your first product.`); return }
      const list = products.map((p, i) =>
        `${i + 1}. *${p.name}*\n   💰 Ksh ${p.price} | 📦 ${p.stock} | 🆆 ${p.productId}${p.imageUrl ? ' | 📸 Has image' : ''}`
      ).join('\n\n')
      await setSession(phone, { step: 'seller_mgmt_products_view', data: { sellerId, products: JSON.stringify(products.map(p => ({ id: p.productId, name: p.name }))) } })
      await send(jid, `📦 *Your Products (${products.length})*\n\n${list}\n\nReply a product number to upload its image, or *0* to go back.`)
      return
    }
    if (raw === '3') {
      const products = await getProductsBySeller(sellerId)
      if (products.length === 0) { await send(jid, `No products yet. Reply *1* to add one.`); return }
      const list = products.map((p, i) => `${i + 1}. ${p.name} (stock: ${p.stock})`).join('\n')
      await setSession(phone, { step: 'seller_mgmt_stock_pick', data: { sellerId, products: JSON.stringify(products.map(p => ({ id: p.productId, name: p.name }))) } })
      await send(jid, `📊 *Update Stock*\n\n${list}\n\nWhich product? (enter number)`)
      return
    }
    if (raw === '4') {
      const products = await getProductsBySeller(sellerId)
      if (products.length === 0) { await send(jid, `No products yet. Reply *1* to add one.`); return }
      const list = products.map((p, i) => `${i + 1}. ${p.name} — Ksh ${p.price}`).join('\n')
      await setSession(phone, { step: 'seller_mgmt_price_pick', data: { sellerId, products: JSON.stringify(products.map(p => ({ id: p.productId, name: p.name }))) } })
      await send(jid, `💰 *Update Price*\n\n${list}\n\nWhich product? (enter number)`)
      return
    }
    if (raw === '5') {
      const products = await getProductsBySeller(sellerId)
      if (products.length === 0) { await send(jid, `No products to remove.`); return }
      const list = products.map((p, i) => `${i + 1}. ${p.name}`).join('\n')
      await setSession(phone, { step: 'seller_mgmt_delete_pick', data: { sellerId, products: JSON.stringify(products.map(p => ({ id: p.productId, name: p.name }))) } })
      await send(jid, `🗑️ *Remove Product*\n\n${list}\n\nWhich product to remove? (enter number)`)
      return
    }
    if (raw === '6') {
      const orders = await getOrdersBySeller(sellerId)
      if (orders.length === 0) {
        await send(jid, `📭 No active orders right now.\n\n${sellerMenu('Your Shop')}`)
        return
      }
      const list = orders.map(o =>
        `*${o.orderId}*\n` +
        `📦 ${o.items.map(i => `${i.name} x${i.quantity}`).join(', ')}\n` +
        `📍 ${o.location}\n` +
        `💰 Ksh ${o.totalAmount} | 💳 ${o.paymentMode.toUpperCase()}\n` +
        `🔄 ${o.status.replace(/_/g, ' ').toUpperCase()}\n` +
        `✅ CONFIRM ${o.orderId} | ❌ REJECT ${o.orderId}`
      ).join('\n\n')
      await send(jid, `📋 *Active Orders (${orders.length})*\n\n${list}`)
      return
    }
    if (raw === '7') {
      const seller = await getSellerByPhone(phone)
      if (seller) {
        const ratingStr = seller.ratingCount > 0 ? `${seller.rating}/5 (★ ${seller.ratingCount} reviews)` : 'No ratings yet'
        await send(jid,
          `📊 *${seller.name} — Stats*\n\n` +
          `📦 Total Orders: ${seller.totalOrders}\n` +
          `✅ Completed: ${seller.completedOrders}\n` +
          `❌ Rejected: ${seller.rejectedOrders}\n` +
          `💰 Revenue: Ksh ${seller.totalRevenue.toLocaleString()}\n` +
          `⭐ Trust: ${seller.trustScore}/100 | 🏷️ ${seller.tier.toUpperCase()}\n` +
          `🔖 Rating: ${ratingStr}\n` +
          `⏰ Hours: ${seller.openingHours}`
        )
      }
      return
    }
    if (raw === '8') {
      const msg = await listTrustedRiders(sellerId)
      await send(jid, msg)
      return
    }
    const seller = await getSellerByPhone(phone)
    await send(jid, sellerMenu(seller?.name ?? 'Your Shop'))
    return
  }

  // ── Products view → select product for image upload ──
  if (session.step === 'seller_mgmt_products_view') {
    if (raw === '0') {
      const seller = await getSellerByPhone(phone)
      await setSession(phone, { step: 'seller_mgmt_menu', data: { sellerId } })
      await send(jid, sellerMenu(seller?.name ?? 'Your Shop'))
      return
    }
    const products = JSON.parse(session.data['products'] ?? '[]') as RefItem[]
    const idx = parseInt(raw) - 1
    if (isNaN(idx) || idx < 0 || idx >= products.length) { await send(jid, `❌ Invalid number. Reply a product number or *0* to go back.`); return }
    const chosen = products[idx]!
    await setSession(phone, { step: 'seller_mgmt_image_upload', data: { sellerId, productId: chosen.id, productName: chosen.name } })
    await send(jid,
      `📸 *Upload Image for ${chosen.name}*\n\n` +
      `Send the product photo now as an image attachment.\n` +
      `_Tip: Use a clear, well-lit photo to attract more buyers._\n\n` +
      `Or type *0* to cancel.`
    )
    return
  }

  // ── Add product steps ──
  if (session.step === 'seller_mgmt_add_name') {
    await setSession(phone, { step: 'seller_mgmt_add_price', data: { sellerId, productName: raw } })
    await send(jid, `💰 Price for *${raw}* (Ksh)?`)
    return
  }
  if (session.step === 'seller_mgmt_add_price') {
    const price = parseFloat(raw)
    if (isNaN(price) || price <= 0) { await send(jid, `❌ Invalid price. Enter a number e.g. *150*`); return }
    await setSession(phone, { step: 'seller_mgmt_add_stock', data: { ...session.data, price: String(price) } })
    await send(jid, `📦 How many units in stock?`)
    return
  }
  if (session.step === 'seller_mgmt_add_stock') {
    const stock = parseInt(raw)
    if (isNaN(stock) || stock < 0) { await send(jid, `❌ Invalid number. Enter a whole number e.g. *20*`); return }
    const { productName, price } = session.data as { productName: string; price: string }
    const product = await addProduct(sellerId, productName, parseFloat(price), stock)
    const seller = await getSellerByPhone(phone)
    await setSession(phone, { step: 'seller_mgmt_menu', data: { sellerId } })
    await send(jid,
      `✅ *${product.name}* added!\n` +
      `💰 Ksh ${product.price} | 📦 ${product.stock} in stock\n\n` +
      sellerMenu(seller?.name ?? 'Your Shop')
    )
    return
  }

  // ── Update stock ──
  if (session.step === 'seller_mgmt_stock_pick') {
    const products = JSON.parse(session.data['products'] ?? '[]') as RefItem[]
    const idx = parseInt(raw) - 1
    if (isNaN(idx) || idx < 0 || idx >= products.length) { await send(jid, `❌ Invalid number.`); return }
    await setSession(phone, { step: 'seller_mgmt_stock_qty', data: { sellerId, productId: products[idx]!.id, productName: products[idx]!.name } })
    await send(jid, `📦 New stock quantity for *${products[idx]!.name}*?`)
    return
  }
  if (session.step === 'seller_mgmt_stock_qty') {
    const qty = parseInt(raw)
    if (isNaN(qty) || qty < 0) { await send(jid, `❌ Invalid number.`); return }
    const { productId, productName } = session.data as { productId: string; productName: string }
    await updateStock(sellerId, productId, qty)
    const seller = await getSellerByPhone(phone)
    await setSession(phone, { step: 'seller_mgmt_menu', data: { sellerId } })
    await send(jid, `✅ *${productName}* stock → ${qty} units\n\n${sellerMenu(seller?.name ?? 'Your Shop')}`)
    return
  }

  // ── Update price ──
  if (session.step === 'seller_mgmt_price_pick') {
    const products = JSON.parse(session.data['products'] ?? '[]') as RefItem[]
    const idx = parseInt(raw) - 1
    if (isNaN(idx) || idx < 0 || idx >= products.length) { await send(jid, `❌ Invalid number.`); return }
    await setSession(phone, { step: 'seller_mgmt_price_new', data: { sellerId, productId: products[idx]!.id, productName: products[idx]!.name } })
    await send(jid, `💰 New price (Ksh) for *${products[idx]!.name}*?`)
    return
  }
  if (session.step === 'seller_mgmt_price_new') {
    const price = parseFloat(raw)
    if (isNaN(price) || price <= 0) { await send(jid, `❌ Invalid price.`); return }
    const { productId, productName } = session.data as { productId: string; productName: string }
    await updatePrice(sellerId, productId, price)
    const seller = await getSellerByPhone(phone)
    await setSession(phone, { step: 'seller_mgmt_menu', data: { sellerId } })
    await send(jid, `✅ *${productName}* price → Ksh ${price}\n\n${sellerMenu(seller?.name ?? 'Your Shop')}`)
    return
  }

  // ── Delete product ──
  if (session.step === 'seller_mgmt_delete_pick') {
    const products = JSON.parse(session.data['products'] ?? '[]') as RefItem[]
    const idx = parseInt(raw) - 1
    if (isNaN(idx) || idx < 0 || idx >= products.length) { await send(jid, `❌ Invalid number.`); return }
    await setSession(phone, { step: 'seller_mgmt_delete_confirm', data: { sellerId, productId: products[idx]!.id, productName: products[idx]!.name } })
    await send(jid, `⚠️ Remove *${products[idx]!.name}* from your shop?\n\nReply *YES* to confirm or *NO* to cancel.`)
    return
  }
  if (session.step === 'seller_mgmt_delete_confirm') {
    const { productId, productName } = session.data as { productId: string; productName: string }
    const seller = await getSellerByPhone(phone)
    await setSession(phone, { step: 'seller_mgmt_menu', data: { sellerId } })
    if (raw.toUpperCase() === 'YES') {
      await deleteProduct(sellerId, productId)
      await send(jid, `🗑️ *${productName}* removed.\n\n${sellerMenu(seller?.name ?? 'Your Shop')}`)
    } else {
      await send(jid, `❌ Cancelled.\n\n${sellerMenu(seller?.name ?? 'Your Shop')}`)
    }
    return
  }
}

// ─────────────────────────────────────────────
// RIDER FLOW
// ─────────────────────────────────────────────

async function handleRiderFlow(phone: string, jid: string, raw: string, session: SessionState, send: Sender): Promise<void> {
  if (session.step === 'rider_ask_name') {
    if (raw.length < 2) { await send(jid, `Please enter your full name.`); return }
    await setSession(phone, { step: 'rider_ask_zone', data: { name: raw } })
    await send(jid,
      `📍 Which zone do you mainly deliver in?\n\n` +
      `_Estate or town area where you operate_\n` +
      `e.g. "Makongeni, Thika" or "Eastleigh, Nairobi"`
    )
    return
  }
  if (session.step === 'rider_ask_zone') {
    const { name } = session.data as { name: string }
    await setSession(phone, { step: 'rider_ask_vehicle', data: { name, zone: raw } })
    await send(jid,
      `🚗 What is your vehicle?\n\n` +
      `1. Boda boda (motorcycle)\n` +
      `2. Bicycle\n` +
      `3. On foot (walking deliveries)\n` +
      `4. Car / Van\n\n` +
      `Reply with a number:`
    )
    return
  }
  if (session.step === 'rider_ask_vehicle') {
    const vehicleMap: Record<string, string> = { '1': 'boda', '2': 'bicycle', '3': 'walking', '4': 'car' }
    const vehicle = vehicleMap[raw] ?? 'boda'
    const { name, zone } = session.data as { name: string; zone: string }
    await setSession(phone, { step: 'rider_confirm', data: { name, zone, vehicle } })
    await send(jid,
      `✅ *Confirm Registration*\n\n` +
      `🏍️ ${name}\n` +
      `📍 Zone: ${zone}\n` +
      `🚗 Vehicle: ${vehicle}\n` +
      `📱 ${phone}\n\n` +
      `Reply *YES* to join or *NO* to cancel.`
    )
    return
  }
  if (session.step === 'rider_confirm') {
    if (raw.toUpperCase() === 'YES') {
      const { name, zone, vehicle } = session.data as { name: string; zone: string; vehicle: string }
      const riderId = 'RDR-' + Date.now().toString(36).toUpperCase()
      await new Rider({ riderId, name, phone, jid, zone, vehicle }).save()
      await resetSession(phone)
      log(`[RIDER] Registered ${name} (${phone}) zone=${zone}`)
      await send(jid,
        `🎉 *Welcome to the team, ${name}!*\n\n` +
        `🏍️ Rider ID: *${riderId}*\n` +
        `📍 Zone: ${zone}\n\n` +
        `We'll send delivery jobs here. Keep WhatsApp open!\n\n` +
        `📦 When you get a job:\n` +
        `• Reply *ACCEPT [OrderID]* to take the job\n` +
        `• Reply *DECLINE [OrderID]* to pass\n` +
        `• Reply *PICKUP [OrderID]* when you collect\n` +
        `• Reply *DONE [OrderID] [OTP]* when delivered\n\n` +
        `💰 Type *EARNINGS* anytime to check your wallet.\n\n` +
        `_Type HELP for main menu_`
      )
    } else {
      await resetSession(phone)
      await send(jid, `❌ Cancelled.\n\n${STATIC_MAIN_MENU}`)
    }
    return
  }
}
