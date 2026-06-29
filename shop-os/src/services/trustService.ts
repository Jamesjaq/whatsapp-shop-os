import { User } from '../models/User.js'
import { Seller } from '../models/Seller.js'
import { Rider } from '../models/Rider.js'
import { log } from '../utils/logger.js'

type TrustEvent =
  | 'order_complete'
  | 'order_cancel'
  | 'dispute_raised'
  | 'dispute_lost'
  | 'dispute_won'
  | 'confirm_fast'
  | 'confirm_slow'
  | 'reject'
  | 'delivered'
  | 'failed_delivery'
  | 'late_delivery'

const TRUST_DELTA: Record<TrustEvent, number> = {
  order_complete: +2,
  order_cancel: -3,
  dispute_raised: -5,
  dispute_lost: -8,
  dispute_won: +3,
  confirm_fast: +1,
  confirm_slow: -1,
  reject: -4,
  delivered: +2,
  failed_delivery: -6,
  late_delivery: -2,
}

function clamp(n: number): number {
  return Math.min(100, Math.max(0, n))
}

export async function updateBuyerTrust(phone: string, event: TrustEvent): Promise<void> {
  const delta = TRUST_DELTA[event] ?? 0
  const user = await User.findOneAndUpdate(
    { phone },
    { $inc: { trustScore: delta }, updatedAt: new Date() },
    { new: true }
  )
  if (user) {
    user.trustScore = clamp(user.trustScore)
    await user.save()
    log(`[TRUST] Buyer ${phone} ${event} → score ${user.trustScore}`)
  }
}

export async function updateSellerTrust(sellerId: string, event: TrustEvent): Promise<void> {
  const delta = TRUST_DELTA[event] ?? 0
  const seller = await Seller.findOneAndUpdate(
    { sellerId },
    { $inc: { trustScore: delta }, updatedAt: new Date() },
    { new: true }
  )
  if (seller) {
    seller.trustScore = clamp(seller.trustScore)
    // Auto-promote/demote tier
    if (seller.trustScore >= 90 && seller.completedOrders >= 50) seller.tier = 'premium'
    else if (seller.trustScore >= 80 && seller.completedOrders >= 20) seller.tier = 'top'
    else if (seller.trustScore >= 70 && seller.completedOrders >= 5) seller.tier = 'verified'
    else seller.tier = 'new'
    await seller.save()
    log(`[TRUST] Seller ${sellerId} ${event} → score ${seller.trustScore} tier=${seller.tier}`)
  }
}

// Boost seller trust score when they receive a high rating (4 or 5 stars)
export async function applyRatingTrustBoost(sellerId: string, rating: number): Promise<void> {
  if (rating < 1 || rating > 5) return
  // 5 stars = +3, 4 stars = +1, 3 stars = 0, 2 stars = -1, 1 star = -3
  const delta = rating === 5 ? 3 : rating === 4 ? 1 : rating === 3 ? 0 : rating === 2 ? -1 : -3
  if (delta === 0) return
  const seller = await Seller.findOneAndUpdate(
    { sellerId },
    { $inc: { trustScore: delta }, updatedAt: new Date() },
    { new: true }
  )
  if (seller) {
    seller.trustScore = clamp(seller.trustScore)
    if (seller.trustScore >= 90 && seller.completedOrders >= 50) seller.tier = 'premium'
    else if (seller.trustScore >= 80 && seller.completedOrders >= 20) seller.tier = 'top'
    else if (seller.trustScore >= 70 && seller.completedOrders >= 5) seller.tier = 'verified'
    else seller.tier = 'new'
    await seller.save()
    log(`[TRUST] Seller ${sellerId} rated ${rating}/5 → score ${seller.trustScore} tier=${seller.tier}`)
  }
}

export async function updateRiderTrust(riderId: string, event: TrustEvent): Promise<void> {
  const delta = TRUST_DELTA[event] ?? 0
  const rider = await Rider.findOneAndUpdate(
    { riderId },
    { $inc: { trustScore: delta }, updatedAt: new Date() },
    { new: true }
  )
  if (rider) {
    rider.trustScore = clamp(rider.trustScore)
    if (rider.trustScore >= 90 && rider.completedDeliveries >= 100) rider.tier = 'priority'
    else if (rider.trustScore >= 80 && rider.completedDeliveries >= 30) rider.tier = 'trusted'
    else if (rider.trustScore >= 70 && rider.completedDeliveries >= 5) rider.tier = 'verified'
    else rider.tier = 'new'
    await rider.save()
    log(`[TRUST] Rider ${riderId} ${event} → score ${rider.trustScore} tier=${rider.tier}`)
  }
}
