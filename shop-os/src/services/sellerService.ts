import { Seller, ISeller } from '../models/Seller.js'
import { Product, IProduct } from '../models/Product.js'
import { resolveOutboundJid } from '../bot/notifier.js'
import { applyRatingTrustBoost } from './trustService.js'
import { log } from '../utils/logger.js'

function generateSellerId(): string {
  return 'SEL-' + Date.now().toString(36).toUpperCase()
}

function generateProductId(): string {
  return 'PRD-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 5).toUpperCase()
}

export async function registerSeller(
  phone: string,
  name: string,
  location: string,
  category: string,
  zone?: string,
  description?: string
): Promise<ISeller> {
  const existing = await Seller.findOne({ phone })
  if (existing) return existing

  const jid = resolveOutboundJid(undefined, phone)
  const seller = new Seller({
    sellerId: generateSellerId(),
    name,
    phone,
    jid,
    location,
    zone: zone || location,
    category,
    description: description || '',
  })
  await seller.save()
  log(`[SELLER] Registered ${name} (${phone}) in ${location}`)
  return seller
}

export async function getSellerByPhone(phone: string): Promise<ISeller | null> {
  return Seller.findOne({ phone })
}

export async function addProduct(
  sellerId: string,
  name: string,
  price: number,
  stock: number,
  unit?: string,
  category?: string
): Promise<IProduct> {
  const seller = await Seller.findOne({ sellerId })
  const sellerName = seller?.name ?? ''
  const sellerZone = seller?.zone ?? ''

  const existing = await Product.findOne({ sellerId, name: { $regex: `^${name}$`, $options: 'i' } })
  if (existing) {
    existing.price = price
    existing.stock = stock
    existing.active = true
    if (unit) existing.unit = unit
    if (category) existing.category = category
    existing.sellerName = sellerName
    existing.sellerZone = sellerZone
    existing.updatedAt = new Date()
    await existing.save()
    log(`[PRODUCT] Updated "${name}" Ksh ${price} (stock: ${stock}) for ${sellerId}`)
    return existing
  }

  const product = new Product({
    productId: generateProductId(),
    sellerId,
    sellerName,
    sellerZone,
    name,
    price,
    stock,
    unit: unit || 'piece',
    category: category || seller?.category || '',
  })
  await product.save()
  log(`[PRODUCT] Added "${name}" Ksh ${price} (stock: ${stock}) for ${sellerId}`)
  return product
}

export async function getProductsBySeller(sellerId: string): Promise<IProduct[]> {
  return Product.find({ sellerId, active: true }).sort({ name: 1 })
}

export async function updateStock(sellerId: string, productId: string, stock: number): Promise<IProduct | null> {
  const product = await Product.findOneAndUpdate(
    { sellerId, productId },
    { stock, updatedAt: new Date() },
    { new: true }
  )
  if (product) log(`[PRODUCT] Stock: "${product.name}" → ${stock}`)
  return product
}

export async function updatePrice(sellerId: string, productId: string, price: number): Promise<IProduct | null> {
  const product = await Product.findOneAndUpdate(
    { sellerId, productId },
    { price, updatedAt: new Date() },
    { new: true }
  )
  if (product) log(`[PRODUCT] Price: "${product.name}" → Ksh ${price}`)
  return product
}

export async function deleteProduct(sellerId: string, productId: string): Promise<boolean> {
  const result = await Product.findOneAndUpdate(
    { sellerId, productId },
    { active: false, updatedAt: new Date() },
    { new: true }
  )
  if (result) log(`[PRODUCT] Removed "${result.name}" for ${sellerId}`)
  return !!result
}

export async function listAllSellers(zone?: string): Promise<ISeller[]> {
  const query: Record<string, unknown> = { active: true }
  if (zone) query['zone'] = { $regex: zone, $options: 'i' }
  return Seller.find(query).sort({ trustScore: -1, tier: -1 }).limit(15)
}

export async function searchProducts(query: string, zone?: string): Promise<IProduct[]> {
  const filter: Record<string, unknown> = {
    name: { $regex: query, $options: 'i' },
    active: true,
    stock: { $gt: 0 },
  }
  if (zone) filter['sellerZone'] = { $regex: zone, $options: 'i' }
  return Product.find(filter).sort({ soldCount: -1 }).limit(8)
}

export async function updateSellerRevenue(sellerId: string, amount: number): Promise<void> {
  await Seller.findOneAndUpdate(
    { sellerId },
    { $inc: { totalRevenue: amount, completedOrders: 1 }, updatedAt: new Date() }
  )
}

export async function getTopSellers(limit = 5): Promise<ISeller[]> {
  return Seller.find({ active: true }).sort({ trustScore: -1, totalOrders: -1 }).limit(limit)
}

// ─────────────────────────────────────────────
// TRUSTED RIDER MANAGEMENT
// Sellers can whitelist their own trusted riders (e.g. local nduthi guys)
// These riders get first priority on dispatch for that seller's orders
// ─────────────────────────────────────────────

export async function addTrustedRider(sellerId: string, riderPhone: string): Promise<{ success: boolean; message: string }> {
  const seller = await Seller.findOne({ sellerId })
  if (!seller) return { success: false, message: 'Seller not found' }

  // Normalize phone
  const normalized = riderPhone.replace(/\D/g, '')
  const phone = normalized.startsWith('0') ? '254' + normalized.slice(1) : normalized

  if (seller.trustedRiders.includes(phone)) {
    return { success: false, message: `📞 ${phone} is already in your trusted riders list.` }
  }

  await Seller.findOneAndUpdate(
    { sellerId },
    { $addToSet: { trustedRiders: phone }, updatedAt: new Date() }
  )
  log(`[SELLER] ${seller.name} added trusted rider ${phone}`)
  return { success: true, message: `✅ Rider *${phone}* added to your trusted fleet!\n\nThey will get first priority on your orders.` }
}

export async function removeTrustedRider(sellerId: string, riderPhone: string): Promise<{ success: boolean; message: string }> {
  const seller = await Seller.findOne({ sellerId })
  if (!seller) return { success: false, message: 'Seller not found' }

  const normalized = riderPhone.replace(/\D/g, '')
  const phone = normalized.startsWith('0') ? '254' + normalized.slice(1) : normalized

  await Seller.findOneAndUpdate(
    { sellerId },
    { $pull: { trustedRiders: phone }, updatedAt: new Date() }
  )
  log(`[SELLER] ${seller.name} removed trusted rider ${phone}`)
  return { success: true, message: `✅ Rider *${phone}* removed from your trusted fleet.` }
}

export async function listTrustedRiders(sellerId: string): Promise<string> {
  const seller = await Seller.findOne({ sellerId })
  if (!seller) return '❌ Seller not found'

  if (seller.trustedRiders.length === 0) {
    return (
      `🏍️ *Your Trusted Riders*\n\n` +
      `You have no trusted riders yet.\n\n` +
      `Add a trusted rider with:\n` +
      `*ADD RIDER [phone]*\n` +
      `e.g. ADD RIDER 0712345678\n\n` +
      `_Trusted riders get first priority on your orders._`
    )
  }

  const list = seller.trustedRiders.map((r, i) => `${i + 1}. 📞 ${r}`).join('\n')
  return (
    `🏍️ *Your Trusted Riders (${seller.trustedRiders.length})*\n\n` +
    `${list}\n\n` +
    `To remove: *REMOVE RIDER [phone]*`
  )
}

// ─────────────────────────────────────────────
// PRODUCT IMAGE MANAGEMENT
// ─────────────────────────────────────────────

export async function updateProductImage(sellerId: string, productId: string, imageUrl: string): Promise<boolean> {
  const result = await Product.findOneAndUpdate(
    { sellerId, productId },
    { imageUrl, updatedAt: new Date() },
    { new: true }
  )
  if (result) log(`[PRODUCT] Image updated for "${result.name}" (${productId})`)
  return !!result
}

// ─────────────────────────────────────────────
// SELLER RATING
// ─────────────────────────────────────────────

export async function rateSellerAfterDelivery(sellerId: string, rating: number): Promise<void> {
  const seller = await Seller.findOne({ sellerId })
  if (!seller) return
  const newCount = seller.ratingCount + 1
  const newRating = ((seller.rating * seller.ratingCount) + rating) / newCount
  await Seller.findOneAndUpdate(
    { sellerId },
    { rating: Math.round(newRating * 10) / 10, ratingCount: newCount, updatedAt: new Date() }
  )
  // Also apply trust score boost/penalty based on rating
  await applyRatingTrustBoost(sellerId, rating)
  log(`[SELLER] ${seller.name} rated ${rating}/5 — new avg: ${newRating.toFixed(1)}`)
}
