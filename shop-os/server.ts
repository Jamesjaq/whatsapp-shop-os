import 'dotenv/config'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { connectDB } from './src/database/db.js'
import { startBot } from './src/bot/index.js'
import { log } from './src/utils/logger.js'
import { Order } from './src/models/Order.js'
import { Seller } from './src/models/Seller.js'
import { Product } from './src/models/Product.js'
import { Rider } from './src/models/Rider.js'
import { User } from './src/models/User.js'
import { Dispute } from './src/models/Dispute.js'
import { Payment } from './src/models/Payment.js'
import { updateOrderStatus, getOrderStats } from './src/services/orderService.js'
import { resolveDispute, getOpenDisputes, getAllDisputes } from './src/services/disputeService.js'
import { confirmPayment } from './src/services/paymentService.js'
import { verifyMpesaCallback, handleStkCallback, getOpenUnmatchedIpns } from './src/services/mpesaIpnService.js'
import { isValidAdminSession, verifyAdminPassword, createAdminSessionCookie } from './src/utils/adminAuth.js'
import { connectRedis } from './src/utils/redis.js'
import { getDeadLetterQueue } from './src/services/outboundQueue.js'
import { forceAssignRider } from './src/services/riderService.js'
import { isAdmin } from './src/services/adminService.js'
import { processDuePayouts } from './src/services/payoutService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = parseInt(process.env['PORT'] ?? '3001')
const app = express()

app.use(express.json())

// ── ADMIN SECURITY MIDDLEWARE ──
function requireAdminAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isValidAdminSession(req)) {
    next()
  } else {
    res.status(401).json({ error: 'Unauthorized' })
  }
}

// ─────────────────────────────────────────────
// M-PESA IPN — PUBLIC (no auth, Safaricom calls this)
// Verify with MPESA_IPN_SECRET env var for extra safety
// ─────────────────────────────────────────────

app.post('/api/payments/mpesa-callback', async (req, res) => {
  try {
    if (!verifyMpesaCallback(req)) {
      log('[MPESA IPN] Rejected — invalid secret')
      res.status(401).json({ error: 'Unauthorized' })
      return
    }
    await handleStkCallback(req.body)
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  } catch (err) {
    log(`[MPESA IPN ERROR] ${err}`)
    res.json({ ResultCode: 0, ResultDesc: 'Accepted' })
  }
})

// Protect all operations endpoints
app.use('/api', requireAdminAuth)

// ─────────────────────────────────────────────
// HEALTH
// ─────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'WhatsApp Shop OS', time: new Date().toISOString() })
})

// ─────────────────────────────────────────────
// STATS
// ─────────────────────────────────────────────

app.get('/api/stats', async (_req, res) => {
  try {
    const stats = await getOrderStats()
    const [sellers, riders, users, products, openDisputes] = await Promise.all([
      Seller.countDocuments({ active: true }),
      Rider.countDocuments({ active: true }),
      User.countDocuments(),
      Product.countDocuments({ active: true }),
      getOpenDisputes(),
    ])
    res.json({ ...stats, sellers, riders, users, products, openDisputes: openDisputes.length })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ─────────────────────────────────────────────
// ORDERS
// ─────────────────────────────────────────────

app.get('/api/orders', async (req, res) => {
  try {
    const { status, buyer, seller, limit = '50', page = '1' } = req.query as Record<string, string>
    const filter: Record<string, unknown> = {}
    if (status) filter['status'] = status
    if (buyer) filter['buyerPhone'] = buyer
    if (seller) filter['sellerId'] = seller
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ timestamp: -1 }).skip(skip).limit(parseInt(limit)),
      Order.countDocuments(filter),
    ])
    res.json({ orders, total, page: parseInt(page), limit: parseInt(limit) })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.get('/api/orders/:orderId', async (req, res) => {
  const order = await Order.findOne({ orderId: req.params['orderId'] })
  if (!order) { res.status(404).json({ error: 'Not found' }); return }
  res.json(order)
})

app.patch('/api/orders/:orderId/status', async (req, res) => {
  try {
    const { status, notify = true } = req.body as { status: string; notify?: boolean }
    const order = await updateOrderStatus(req.params['orderId']!, status as never, notify)
    if (!order) { res.status(404).json({ error: 'Not found' }); return }
    res.json(order)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ─────────────────────────────────────────────
// SELLERS
// ─────────────────────────────────────────────

app.get('/api/sellers', async (req, res) => {
  try {
    const { zone, category, tier } = req.query as Record<string, string>
    const filter: Record<string, unknown> = {}
    if (zone) filter['zone'] = { $regex: zone, $options: 'i' }
    if (category) filter['category'] = { $regex: category, $options: 'i' }
    if (tier) filter['tier'] = tier
    const sellers = await Seller.find(filter).sort({ trustScore: -1 })
    res.json(sellers)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.patch('/api/sellers/:sellerId/tier', async (req, res) => {
  const { tier } = req.body as { tier: string }
  const seller = await Seller.findOneAndUpdate(
    { sellerId: req.params['sellerId'] },
    { tier, updatedAt: new Date() },
    { new: true }
  )
  if (!seller) { res.status(404).json({ error: 'Not found' }); return }
  res.json(seller)
})

app.patch('/api/sellers/:sellerId/approve', async (req, res) => {
  const seller = await Seller.findOneAndUpdate(
    { sellerId: req.params['sellerId'] },
    { approved: true, updatedAt: new Date() },
    { new: true }
  )
  if (!seller) { res.status(404).json({ error: 'Not found' }); return }
  res.json(seller)
})

// ─────────────────────────────────────────────
// PRODUCTS
// ─────────────────────────────────────────────

app.get('/api/products', async (req, res) => {
  try {
    const { seller, search } = req.query as Record<string, string>
    const filter: Record<string, unknown> = { active: true }
    if (seller) filter['sellerId'] = seller
    if (search) filter['name'] = { $regex: search, $options: 'i' }
    const products = await Product.find(filter).sort({ soldCount: -1 })
    res.json(products)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ─────────────────────────────────────────────
// RIDERS
// ─────────────────────────────────────────────

app.get('/api/riders', async (req, res) => {
  try {
    const { zone, available } = req.query as Record<string, string>
    const filter: Record<string, unknown> = { active: true }
    if (zone) filter['zone'] = { $regex: zone, $options: 'i' }
    if (available !== undefined) filter['available'] = available === 'true'
    const riders = await Rider.find(filter).sort({ trustScore: -1 })
    res.json(riders)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.post('/api/riders/:riderId/assign', async (req, res) => {
  const { orderId } = req.body as { orderId: string }
  const rider = await Rider.findOne({ riderId: req.params['riderId'] })
  if (!rider) { res.status(404).json({ error: 'Rider not found' }); return }
  const ok = await forceAssignRider(orderId, rider.phone)
  res.json({ success: ok })
})

// Push live location from rider's phone (called by mobile app or WhatsApp bot)
app.post('/api/riders/:riderId/location', async (req, res) => {
  try {
    const { latitude, longitude } = req.body as { latitude: number; longitude: number }
    if (typeof latitude !== 'number' || typeof longitude !== 'number') {
      res.status(400).json({ error: 'latitude and longitude are required numbers' })
      return
    }
    const rider = await Rider.findOneAndUpdate(
      { riderId: req.params['riderId'], active: true },
      { latitude, longitude, locationUpdatedAt: new Date(), updatedAt: new Date() },
      { new: true }
    )
    if (!rider) { res.status(404).json({ error: 'Rider not found' }); return }
    log(`[LOCATION] Rider ${rider.name} → lat=${latitude} lng=${longitude}`)
    res.json({ success: true, latitude, longitude, updatedAt: rider.locationUpdatedAt })
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// Get rider location (admin dashboard live map)
app.get('/api/riders/:riderId/location', async (req, res) => {
  const rider = await Rider.findOne({ riderId: req.params['riderId'] }, 'riderId name latitude longitude locationUpdatedAt currentOrderId')
  if (!rider) { res.status(404).json({ error: 'Rider not found' }); return }
  res.json({
    riderId: rider.riderId,
    name: rider.name,
    latitude: rider.latitude,
    longitude: rider.longitude,
    locationUpdatedAt: rider.locationUpdatedAt,
    currentOrderId: rider.currentOrderId,
    mapsUrl: (rider.latitude && rider.longitude)
      ? `https://maps.google.com/?q=${rider.latitude},${rider.longitude}`
      : null,
  })
})

// ─────────────────────────────────────────────
// DISPUTES
// ─────────────────────────────────────────────

app.get('/api/disputes', async (req, res) => {
  try {
    const { status } = req.query as Record<string, string>
    const disputes = status
      ? await Dispute.find({ status: status as any }).sort({ createdAt: -1 }).limit(50)
      : await getAllDisputes(50)
    res.json(disputes)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

app.patch('/api/disputes/:disputeId/resolve', async (req, res) => {
  try {
    const { resolution, refund, handledBy = 'admin' } = req.body as { resolution: string; refund: boolean; handledBy?: string }
    const result = await resolveDispute(req.params['disputeId']!, resolution, refund, handledBy)
    if (!result) { res.status(404).json({ error: 'Dispute not found' }); return }
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ─────────────────────────────────────────────
// PAYMENTS
// ─────────────────────────────────────────────

app.get('/api/payments', async (_req, res) => {
  const payments = await Payment.find().sort({ createdAt: -1 }).limit(50)
  res.json(payments)
})

app.get('/api/payments/unmatched', async (_req, res) => {
  const unmatched = await getOpenUnmatchedIpns()
  res.json(unmatched)
})

app.get('/api/notify/dead-letter', async (_req, res) => {
  res.json(getDeadLetterQueue())
})

app.post('/api/payments/:orderId/confirm', async (req, res) => {
  const { confirmedBy = 'admin' } = req.body as { confirmedBy?: string }
  const payment = await confirmPayment(req.params['orderId']!, confirmedBy)
  if (!payment) { res.status(404).json({ error: 'Payment not found' }); return }
  res.json(payment)
})

// ─────────────────────────────────────────────
// USERS
// ─────────────────────────────────────────────

app.get('/api/users', async (_req, res) => {
  const users = await User.find().sort({ createdAt: -1 }).limit(100)
  res.json(users)
})

app.patch('/api/users/:phone/block', async (req, res) => {
  const { blocked, reason = '' } = req.body as { blocked: boolean; reason?: string }
  const user = await User.findOneAndUpdate(
    { phone: req.params['phone'] },
    { blocked, blockReason: reason, updatedAt: new Date() },
    { new: true, upsert: true }
  )
  res.json(user)
})

// ─────────────────────────────────────────────
// ANALYTICS
// ─────────────────────────────────────────────

app.get('/api/analytics/daily', async (_req, res) => {
  try {
    const daily = await Order.aggregate([
      { $match: { status: 'delivered' } },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
          orders: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 30 },
    ])
    res.json(daily)
  } catch (err) {
    res.status(500).json({ error: String(err) })
  }
})

// ─────────────────────────────────────────────
// SERVE ADMIN DASHBOARD (HIDDEN)
// ─────────────────────────────────────────────

const LOGIN_PAGE_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shop OS — Secure Login</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background: radial-gradient(circle at center, #1e1b4b 0%, #090d16 100%);
      color: #f1f5f9;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      position: relative;
    }
    
    body::before {
      content: '';
      position: absolute;
      width: 300px;
      height: 300px;
      background: rgba(6, 182, 212, 0.15);
      border-radius: 50%;
      top: 10%;
      left: 15%;
      filter: blur(80px);
      animation: float 8s ease-in-out infinite alternate;
    }
    body::after {
      content: '';
      position: absolute;
      width: 400px;
      height: 400px;
      background: rgba(99, 102, 241, 0.15);
      border-radius: 50%;
      bottom: 10%;
      right: 15%;
      filter: blur(100px);
      animation: float 10s ease-in-out infinite alternate-reverse;
    }
    
    @keyframes float {
      0% { transform: translateY(0px) scale(1); }
      100% { transform: translateY(20px) scale(1.1); }
    }

    .login-container {
      background: rgba(17, 24, 39, 0.7);
      backdrop-filter: blur(16px);
      -webkit-backdrop-filter: blur(16px);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 24px;
      padding: 3rem 2.5rem;
      width: 100%;
      max-width: 420px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
      z-index: 10;
      text-align: center;
    }

    .logo-container {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 64px;
      height: 64px;
      background: linear-gradient(135deg, #22d3ee, #6366f1);
      border-radius: 18px;
      font-size: 2rem;
      margin-bottom: 1.5rem;
      box-shadow: 0 8px 20px rgba(34, 211, 238, 0.3);
    }

    h1 {
      font-size: 1.75rem;
      font-weight: 800;
      margin-bottom: 0.5rem;
      background: linear-gradient(135deg, #ffffff, #94a3b8);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    p {
      color: #94a3b8;
      font-size: 0.875rem;
      margin-bottom: 2rem;
    }

    .form-group {
      text-align: left;
      margin-bottom: 1.5rem;
    }

    label {
      display: block;
      font-size: 0.75rem;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 0.5rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    input {
      width: 100%;
      background: rgba(31, 41, 55, 0.5);
      border: 1px solid rgba(255, 255, 255, 0.1);
      color: #f8fafc;
      padding: 12px 16px;
      border-radius: 12px;
      font-size: 1rem;
      outline: none;
      transition: all 0.2s ease;
      font-family: inherit;
    }

    input:focus {
      border-color: #22d3ee;
      background: rgba(31, 41, 55, 0.8);
      box-shadow: 0 0 0 4px rgba(34, 211, 238, 0.15);
    }

    .btn-submit {
      width: 100%;
      background: linear-gradient(135deg, #6366f1, #22d3ee);
      color: white;
      border: none;
      padding: 12px;
      border-radius: 12px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
    }

    .btn-submit:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 18px rgba(99, 102, 241, 0.4);
    }

    .error-msg {
      display: none;
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.25);
      color: #ef4444;
      padding: 10px;
      border-radius: 10px;
      font-size: 0.85rem;
      margin-bottom: 1rem;
      font-weight: 500;
    }
  </style>
</head>
<body>
  <div class="login-container">
    <div class="logo-container">🔑</div>
    <h1>Secure Admin Portal</h1>
    <p>Authentication required to access operations dashboard</p>
    
    <div class="error-msg" id="error">Incorrect password. Please try again.</div>
    
    <form onsubmit="handleLogin(event)">
      <div class="form-group">
        <label for="password">Password</label>
        <input type="password" id="password" required placeholder="••••••••" autofocus />
      </div>
      <button type="submit" class="btn-submit">Authenticate</button>
    </form>
  </div>

  <script>
    async function handleLogin(e) {
      e.preventDefault();
      const password = document.getElementById('password').value;
      const errorDiv = document.getElementById('error');
      
      errorDiv.style.display = 'none';
      
      try {
        const res = await fetch('/spnxr/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password })
        });
        
        const data = await res.json();
        if (data.success) {
          window.location.reload();
        } else {
          errorDiv.style.display = 'block';
          document.getElementById('password').value = '';
        }
      } catch (err) {
        errorDiv.textContent = 'Network error. Please try again.';
        errorDiv.style.display = 'block';
      }
    }
  </script>
</body>
</html>
`

app.get('/spnxr', (req, res) => {
  if (isValidAdminSession(req)) {
    res.sendFile(path.join(__dirname, '../public', 'index.html'))
  } else {
    res.send(LOGIN_PAGE_HTML)
  }
})

app.post('/spnxr/login', (req, res) => {
  const { password } = req.body
  if (verifyAdminPassword(password)) {
    res.setHeader('Set-Cookie', createAdminSessionCookie())
    res.json({ success: true })
  } else {
    res.status(401).json({ success: false, error: 'Incorrect password' })
  }
})

app.get('/', (_req, res) => {
  res.send('Shop OS Web Service is active.')
})

// ─────────────────────────────────────────────
// START
// ─────────────────────────────────────────────

export const shopOsApp = app

export async function startPayoutCron(): Promise<void> {
  const PAYOUT_CRON_INTERVAL = 60 * 60 * 1000
  setInterval(async () => {
    try {
      const released = await processDuePayouts()
      if (released > 0) log(`[PAYOUT CRON] Released ${released} escrow payout(s)`)
    } catch (err) {
      log(`[PAYOUT CRON ERROR] ${err}`)
    }
  }, PAYOUT_CRON_INTERVAL)

  try {
    const released = await processDuePayouts()
    if (released > 0) log(`[PAYOUT CRON] Startup — released ${released} overdue escrow payout(s)`)
  } catch (err) {
    log(`[PAYOUT CRON ERROR] Startup run failed: ${err}`)
  }
  log('[SERVER] Payout escrow cron running every 1h')
}

async function main(): Promise<void> {
  await connectDB()
  await connectRedis()
  log('[SERVER] Database connected')

  app.listen(PORT, '0.0.0.0', () => {
    log(`[SERVER] Admin API running on http://localhost:${PORT}`)
    console.log(`\n🌐 Admin Dashboard: http://localhost:${PORT}`)
    console.log(`📊 Stats:     http://localhost:${PORT}/api/stats`)
    console.log(`📋 Orders:    http://localhost:${PORT}/api/orders`)
    console.log(`🏪 Sellers:   http://localhost:${PORT}/api/sellers`)
    console.log(`🏍️  Riders:    http://localhost:${PORT}/api/riders`)
    console.log(`⚠️  Disputes:  http://localhost:${PORT}/api/disputes`)
    console.log(`💳 M-Pesa IPN: POST http://localhost:${PORT}/api/payments/mpesa-callback\n`)
  })

  await startBot()
  await startPayoutCron()
}

const entryPath = process.argv[1] ?? ''
if (entryPath.includes('server.ts')) {
  main().catch(err => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
}
