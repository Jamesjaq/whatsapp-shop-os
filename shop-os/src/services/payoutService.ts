import { Payout, IPayout } from '../models/Payout.js'
import { Seller } from '../models/Seller.js'
import { Order } from '../models/Order.js'
import { updateSellerRevenue } from './sellerService.js'
import { notify, resolveOutboundJid } from '../bot/notifier.js'
import { log } from '../utils/logger.js'

function generatePayoutId(): string {
  return 'POT-' + Date.now().toString(36).toUpperCase()
}

export async function createPayoutEscrow(orderId: string, sellerId: string, amount: number): Promise<IPayout> {
  const existing = await Payout.findOne({ orderId })
  if (existing) return existing

  const releaseAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours from now

  const payout = new Payout({
    payoutId: generatePayoutId(),
    orderId,
    sellerId,
    amount,
    status: 'escrow',
    releaseAt,
  })

  await payout.save()
  log(`[PAYOUT] Created escrow payout ${payout.payoutId} for order ${orderId} amount=${amount} releaseAt=${releaseAt}`)
  return payout
}

export async function cancelPayout(orderId: string): Promise<boolean> {
  const payout = await Payout.findOneAndUpdate(
    { orderId, status: 'escrow' },
    { status: 'cancelled', updatedAt: new Date() },
    { new: true }
  )
  if (payout) {
    log(`[PAYOUT] Escrow payout ${payout.payoutId} cancelled for order ${orderId}`)
    return true
  }
  return false
}

export async function releasePayoutImmediately(orderId: string): Promise<boolean> {
  const payout = await Payout.findOne({ orderId, status: 'escrow' })
  if (!payout) return false

  payout.status = 'released'
  payout.updatedAt = new Date()
  await payout.save()

  await updateSellerRevenue(payout.sellerId, payout.amount)

  const seller = await Seller.findOne({ sellerId: payout.sellerId })
  if (seller) {
    await notify(resolveOutboundJid(seller.jid, seller.phone),
      `💰 *Escrow Payout Released Immediately!*\n\n` +
      `Ksh *${payout.amount}* for order *${orderId}* has been sent to your M-Pesa number (${seller.phone}).\n` +
      `Thank you for resolving the dispute amicably!`
    )
  }
  log(`[PAYOUT] Immediate payout release for ${payout.payoutId} (Order ${orderId})`)
  return true
}

export async function processDuePayouts(): Promise<number> {
  const now = new Date()
  const duePayouts = await Payout.find({ status: 'escrow', releaseAt: { $lte: now } })

  let count = 0
  for (const payout of duePayouts) {
    payout.status = 'released'
    payout.updatedAt = now
    await payout.save()

    await updateSellerRevenue(payout.sellerId, payout.amount)

    const seller = await Seller.findOne({ sellerId: payout.sellerId })
    if (seller) {
      await notify(resolveOutboundJid(seller.jid, seller.phone),
        `💰 *Escrow Payout Released!*\n\n` +
        `Ksh *${payout.amount}* for order *${payout.orderId}* has been successfully released and sent to your M-Pesa number.\n` +
        `Status: Payout processed.`
      )
    }

    log(`[PAYOUT] Escrow payout ${payout.payoutId} released automatically`)
    count++
  }
  return count
}
