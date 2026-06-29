import { Order } from '../models/Order.js'
import { Seller } from '../models/Seller.js'
import { Rider } from '../models/Rider.js'
import { User } from '../models/User.js'
import { Product } from '../models/Product.js'
import { getOpenDisputes, resolveDispute } from './disputeService.js'
import { getOrderStats } from './orderService.js'
import { forceAssignRider } from './riderService.js'
import { notify, jidFromPhone } from '../bot/notifier.js'
import { log } from '../utils/logger.js'

const ADMIN_PHONES = (process.env['ADMIN_PHONE'] ?? '').split(',').map(p => p.trim()).filter(Boolean)

export function isAdmin(phone: string): boolean {
  return ADMIN_PHONES.includes(phone)
}

export async function getAdminStats(): Promise<string> {
  const stats = await getOrderStats()
  const [sellers, riders, users, products] = await Promise.all([
    Seller.countDocuments({ active: true }),
    Rider.countDocuments({ active: true }),
    User.countDocuments(),
    Product.countDocuments({ active: true }),
  ])
  const openDisputes = await getOpenDisputes()

  return (
    `📊 *Shop OS — Live Stats*\n\n` +
    `📦 *Orders*\n` +
    `  Today: ${stats.today} | This week: ${stats.thisWeek}\n` +
    `  Total: ${stats.total} | Delivered: ${stats.delivered}\n\n` +
    `💰 *Revenue (GMV)*\n` +
    `  Today: Ksh ${stats.gmvToday.toLocaleString()}\n` +
    `  All-time: Ksh ${stats.gmvTotal.toLocaleString()}\n\n` +
    `🏪 Sellers: ${sellers} | 🏍️ Riders: ${riders}\n` +
    `👤 Buyers: ${users} | 📦 Products: ${products}\n` +
    `⚠️ Open Disputes: ${openDisputes.length}\n\n` +
    `_Updated: ${new Date().toLocaleTimeString('en-KE')}_`
  )
}

export async function getAdminOrdersSummary(): Promise<string> {
  const orders = await Order.find().sort({ timestamp: -1 }).limit(10)
  if (orders.length === 0) return '📭 No orders yet.'

  const lines = orders.map(o =>
    `*${o.orderId}* — ${o.status.toUpperCase()}\n` +
    `  ${o.items.map(i => `${i.name} x${i.quantity}`).join(', ')}\n` +
    `  👤 ${o.buyerPhone} | Ksh ${o.totalAmount}`
  )
  return `📋 *Recent Orders (${orders.length})*\n\n${lines.join('\n\n')}`
}

export async function getAdminDisputesSummary(): Promise<string> {
  const disputes = await getOpenDisputes()
  if (disputes.length === 0) return '✅ No open disputes.'

  const lines = disputes.map(d =>
    `*${d.disputeId}*\n` +
    `  📦 Order: ${d.orderId}\n` +
    `  ❓ ${d.type.replace(/_/g, ' ').toUpperCase()}\n` +
    `  👤 ${d.raisedByName || d.raisedBy}\n` +
    `  📝 "${d.description.substring(0, 60)}..."\n\n` +
    `  ADMIN RESOLVE ${d.disputeId} REFUND\n` +
    `  ADMIN RESOLVE ${d.disputeId} CLOSE`
  )
  return `⚠️ *Open Disputes (${disputes.length})*\n\n${lines.join('\n\n')}`
}

export async function handleAdminCommand(phone: string, command: string): Promise<string> {
  const parts = command.trim().split(/\s+/)
  const sub = parts[1]?.toUpperCase() ?? ''

  if (sub === 'STATS') return getAdminStats()
  if (sub === 'ORDERS') return getAdminOrdersSummary()
  if (sub === 'DISPUTES') return getAdminDisputesSummary()

  if (sub === 'RESOLVE' && parts[2] && parts[3]) {
    const disputeId = parts[2]!.toUpperCase()
    const action = parts[3]!.toUpperCase()
    const issueRefund = action === 'REFUND'
    const resolution = parts.slice(4).join(' ') || (issueRefund ? 'Refund issued by admin' : 'Closed by admin')
    const result = await resolveDispute(disputeId, resolution, issueRefund, phone)
    if (!result) return `❌ Dispute *${disputeId}* not found.`
    return `✅ Dispute *${disputeId}* resolved.\nAction: ${action}\nResolution: ${resolution}`
  }

  if (sub === 'ASSIGN' && parts[2] && parts[3]) {
    const orderId = parts[2]!.toUpperCase()
    const riderPhone = parts[3]!
    const ok = await forceAssignRider(orderId, riderPhone)
    return ok ? `✅ Rider assigned to *${orderId}*.` : `❌ Could not assign. Check order ID and rider phone.`
  }

  if (sub === 'BAN' && parts[2]) {
    const target = parts[2]!
    await User.findOneAndUpdate({ phone: target }, { blocked: true, blockReason: `Banned by admin ${phone}`, updatedAt: new Date() })
    log(`[ADMIN] ${phone} banned ${target}`)
    return `✅ User *${target}* has been blocked.`
  }

  if (sub === 'UNBAN' && parts[2]) {
    const target = parts[2]!
    await User.findOneAndUpdate({ phone: target }, { blocked: false, blockReason: '', updatedAt: new Date() })
    log(`[ADMIN] ${phone} unbanned ${target}`)
    return `✅ User *${target}* has been unblocked.`
  }

  if (sub === 'APPROVE' && parts[2] === 'SELLER' && parts[3]) {
    const sellerPhone = parts[3]!
    const seller = await Seller.findOneAndUpdate(
      { phone: sellerPhone },
      { approved: true, active: true, updatedAt: new Date() },
      { new: true }
    )
    if (!seller) return `❌ Seller *${sellerPhone}* not found.`
    if (seller.jid) {
      await notify(seller.jid,
        `✅ *Your shop has been approved!*\n\n` +
        `🏪 *${seller.name}* is now live on Shop OS.\n\n` +
        `Buyers in your area can now find and order from you.\n` +
        `Type *6* to manage your shop and add products.`
      )
    }
    log(`[ADMIN] ${phone} approved seller ${sellerPhone}`)
    return `✅ Seller *${seller.name}* (${sellerPhone}) approved and notified.`
  }

  if (sub === 'TIER' && parts[2] && parts[3]) {
    const target = parts[2]!
    const tier = parts[3]!.toLowerCase() as 'new' | 'verified' | 'top' | 'premium'
    if (!['new', 'verified', 'top', 'premium'].includes(tier)) {
      return `❌ Invalid tier. Use: new | verified | top | premium`
    }
    const seller = await Seller.findOneAndUpdate(
      { phone: target },
      { tier, updatedAt: new Date() },
      { new: true }
    )
    if (!seller) return `❌ Seller *${target}* not found.`
    log(`[ADMIN] ${phone} set ${target} tier to ${tier}`)
    return `✅ *${seller.name}* tier set to *${tier.toUpperCase()}*.`
  }

  if (sub === 'RIDERS') {
    const riders = await Rider.find({ active: true }).sort({ trustScore: -1 }).limit(15)
    if (riders.length === 0) return '💭 No riders registered yet.'
    const lines = riders.map(r =>
      `🏍️ *${r.name}* (${r.phone})\n` +
      `  Zone: ${r.zone} | Trust: ${r.trustScore}/100 | ${r.available ? '🟢 Online' : '🔴 Offline'}\n` +
      `  Deliveries: ${r.completedDeliveries} | Earnings: Ksh ${r.totalEarnings}`
    )
    return `🏍️ *Active Riders (${riders.length})*\n\n${lines.join('\n\n')}`
  }

  if (sub === 'SELLERS') {
    const sellers = await Seller.find({ active: true }).sort({ trustScore: -1 }).limit(15)
    if (sellers.length === 0) return '💭 No sellers registered yet.'
    const lines = sellers.map(s =>
      `🏪 *${s.name}* (${s.phone})\n` +
      `  Zone: ${s.zone} | Tier: ${s.tier.toUpperCase()} | Trust: ${s.trustScore}/100\n` +
      `  Orders: ${s.totalOrders} | Revenue: Ksh ${s.totalRevenue.toLocaleString()}`
    )
    return `🏪 *Active Sellers (${sellers.length})*\n\n${lines.join('\n\n')}`
  }

  if (sub === 'BROADCAST' && parts[2] && parts.length > 3) {
    const audience = parts[2]!.toUpperCase()
    const message = parts.slice(3).join(' ')
    let count = 0

    if (audience === 'BUYERS' || audience === 'ALL') {
      const users = await User.find({ blocked: false, jid: { $ne: '' } }).limit(200)
      for (const u of users) {
        await notify(u.jid, `📢 *Shop OS Update*\n\n${message}`)
        count++
      }
    }
    if (audience === 'SELLERS' || audience === 'ALL') {
      const sellers = await Seller.find({ active: true }).limit(100)
      for (const s of sellers) {
        if (s.jid) { await notify(s.jid, `📢 *Shop OS — Seller Update*\n\n${message}`); count++ }
      }
    }
    if (audience === 'RIDERS' || audience === 'ALL') {
      const riders = await Rider.find({ active: true }).limit(100)
      for (const r of riders) {
        if (r.jid) { await notify(r.jid, `📢 *Shop OS — Rider Update*\n\n${message}`); count++ }
      }
    }

    log(`[ADMIN] ${phone} broadcast to ${audience} — ${count} messages`)
    return `✅ Broadcast sent to ${count} recipients.`
  }

  return (
    `🔧 *Admin Commands*\n\n` +
    `ADMIN STATS\n` +
    `ADMIN ORDERS\n` +
    `ADMIN DISPUTES\n` +
    `ADMIN SELLERS\n` +
    `ADMIN RIDERS\n` +
    `ADMIN RESOLVE [disputeId] REFUND|CLOSE [note]\n` +
    `ADMIN ASSIGN [orderId] [riderPhone]\n` +
    `ADMIN APPROVE SELLER [phone]\n` +
    `ADMIN TIER [sellerPhone] new|verified|top|premium\n` +
    `ADMIN BAN [phone]\n` +
    `ADMIN UNBAN [phone]\n` +
    `ADMIN BROADCAST BUYERS|SELLERS|RIDERS|ALL [message]`
  )
}
