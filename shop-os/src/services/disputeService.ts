import { Dispute, IDispute, DisputeType } from '../models/Dispute.js'
import { Order } from '../models/Order.js'
import { User } from '../models/User.js'
import { updateBuyerTrust, updateSellerTrust, updateRiderTrust } from './trustService.js'
import { refundPayment } from './paymentService.js'
import { notify, resolveOutboundJid } from '../bot/notifier.js'
import { log } from '../utils/logger.js'

function generateDisputeId(): string {
  return 'DSP-' + Date.now().toString(36).toUpperCase()
}

export async function raiseDispute(
  orderId: string,
  raisedBy: string,
  type: DisputeType,
  description: string
): Promise<IDispute | null> {
  const order = await Order.findOne({ orderId })
  if (!order) return null

  // Allow dispute within 24h of order
  const hoursSince = (Date.now() - order.timestamp.getTime()) / 3600000
  if (hoursSince > 24 && order.status === 'delivered') return null

  const user = await User.findOne({ phone: raisedBy })

  const dispute = new Dispute({
    disputeId: generateDisputeId(),
    orderId,
    raisedBy,
    raisedByName: user?.name ?? raisedBy,
    againstId: order.sellerId,
    againstRole: 'seller',
    type,
    description,
    status: 'open',
  })
  await dispute.save()

  // Mark order as disputed
  await Order.findOneAndUpdate({ orderId }, { status: 'disputed', disputeId: dispute.disputeId, updatedAt: new Date() })

  // Update buyer trust
  await updateBuyerTrust(raisedBy, 'dispute_raised')
  await User.findOneAndUpdate({ phone: raisedBy }, { $inc: { disputeCount: 1 } })

  // Notify admin phone if configured
  const adminPhone = process.env['ADMIN_PHONE']
  if (adminPhone) {
    await notify(
      resolveOutboundJid(undefined, adminPhone.split(',')[0] ?? adminPhone),
      `⚠️ *New Dispute — ${dispute.disputeId}*\n\n` +
      `📦 Order: ${orderId}\n` +
      `👤 By: ${user?.name ?? raisedBy} (${raisedBy})\n` +
      `❓ Type: ${type.replace(/_/g, ' ').toUpperCase()}\n` +
      `📝 "${description}"\n\n` +
      `Reply: *ADMIN RESOLVE ${dispute.disputeId} REFUND* or *ADMIN RESOLVE ${dispute.disputeId} CLOSE*`
    )
  }

  log(`[DISPUTE] ${dispute.disputeId} raised by ${raisedBy} for order ${orderId} — ${type}`)
  return dispute
}

export async function resolveDispute(
  disputeId: string,
  resolution: string,
  issueRefund: boolean,
  handledBy: string
): Promise<IDispute | null> {
  const dispute = await Dispute.findOne({ disputeId })
  if (!dispute) return null

  const newStatus = issueRefund ? 'resolved_refund' : 'resolved_no_action'
  dispute.status = newStatus
  dispute.resolution = resolution
  dispute.handledBy = handledBy
  dispute.resolvedAt = new Date()
  dispute.updatedAt = new Date()
  await dispute.save()

  const order = await Order.findOne({ orderId: dispute.orderId })

  if (issueRefund) {
    await refundPayment(dispute.orderId, `Dispute ${disputeId}: ${resolution}`)
    await updateSellerTrust(dispute.againstId, 'dispute_lost')
    await updateBuyerTrust(dispute.raisedBy, 'dispute_won')
    
    // Notify buyer
    if (order?.buyerJid) {
      await notify(order.buyerJid,
        `✅ *Dispute Resolved — ${disputeId}*\n\n` +
        `A refund of Ksh ${order.totalAmount} has been issued.\n` +
        `Resolution: ${resolution}\n\nType *HELP* to place a new order.`
      )
    }
    // Notify seller
    if (order?.sellerPhone) {
      await notify(resolveOutboundJid(order.sellerJid, order.sellerPhone),
        `⚠️ *Dispute Lost — ${disputeId}*\n\n` +
        `The dispute for order *${dispute.orderId}* was resolved in the buyer's favor.\n` +
        `A refund has been issued. Your seller trust score was updated.`
      )
    }
  } else {
    await updateBuyerTrust(dispute.raisedBy, 'dispute_lost')
    await updateSellerTrust(dispute.againstId, 'dispute_won')

    // Notify buyer
    if (order?.buyerJid) {
      await notify(order.buyerJid,
        `❌ *Dispute Closed — ${disputeId}*\n\n` +
        `The dispute for order *${dispute.orderId}* has been closed without further action.\n` +
        `Resolution: ${resolution}`
      )
    }
    // Notify seller
    if (order?.sellerPhone) {
      await notify(resolveOutboundJid(order.sellerJid, order.sellerPhone),
        `✅ *Dispute Won — ${disputeId}*\n\n` +
        `The dispute for order *${dispute.orderId}* has been resolved in your favor. Payout released.`
      )
    }
  }

  log(`[DISPUTE] ${disputeId} resolved: ${newStatus} by ${handledBy}`)
  return dispute
}

export async function getOpenDisputes(): Promise<IDispute[]> {
  return Dispute.find({ status: { $in: ['open', 'investigating'] } }).sort({ createdAt: -1 })
}

export async function getDisputeById(disputeId: string): Promise<IDispute | null> {
  return Dispute.findOne({ disputeId })
}

export async function getAllDisputes(limit = 20): Promise<IDispute[]> {
  return Dispute.find().sort({ createdAt: -1 }).limit(limit)
}
