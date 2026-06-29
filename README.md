# 🛒 WhatsApp Shop OS

**Kenya's neighbourhood commerce network — built on WhatsApp.**

WhatsApp Shop OS is an open-source, production-grade conversational commerce platform that turns WhatsApp into a full delivery marketplace. Buyers order essentials, sellers manage their shop, and riders handle delivery — all through natural WhatsApp messages. No app download required.

---

## Why WhatsApp Shop OS?

> "Lock-in through daily utility" — the same principle that made M-Pesa indispensable.

| M-Pesa Lock-in | WhatsApp Shop OS Lock-in |
|---|---|
| Every transaction builds history | Every order builds trust score |
| Agents are everywhere | Sellers are in every neighbourhood |
| Works on any phone | Works on any WhatsApp |
| Fast, reliable, familiar | Fast, reliable, familiar |
| Wallet balance keeps you coming back | Reorder in 1 tap keeps you coming back |

---

## Features

### Buyer Flow
- **Natural language ordering** — type "unga" or "sukari" to find products
- **Browse nearby shops** — see ratings, product count, opening hours, and tier badge
- **WhatsApp location pin** — share your GPS pin for precise delivery navigation
- **Real-time tracking** — live status updates from confirmed → rider assigned → on the way → delivered
- **One-tap reorder** — `2` reorders your last delivery instantly
- **OTP delivery confirmation** — 4-digit code prevents fraud
- **Rate your experience** — `RATE ORD-XXX 5` after delivery
- **M-Pesa or Cash on Delivery** — buyer chooses payment method
- **Dispute system** — 7 dispute categories, 24-hour window

### Seller Flow
- **Self-registration** — register shop via WhatsApp in under 3 minutes
- **Product management** — add, update stock, update price, remove products
- **Product images** — upload product photos directly in WhatsApp
- **Trusted rider fleet** — sellers add their own riders (`ADD RIDER 0712345678`)
- **GPS maps link** — buyer's location pin sent directly to seller on new order
- **Tier system** — New → Verified → Top → Premium (auto-promoted by trust score)
- **Live stats** — orders, revenue, rating, trust score via `STATS`
- **5-minute confirm window** — `CONFIRM ORD-XXX` or `REJECT ORD-XXX`

### Rider Flow
- **Self-registration** — join as rider via WhatsApp
- **Trusted rider priority** — seller's trusted riders get first dispatch
- **Job accept/decline** — `ACCEPT ORD-XXX` / `DECLINE ORD-XXX`
- **Pickup confirmation** — `PICKUP ORD-XXX`
- **OTP delivery** — `DONE ORD-XXX 4821`
- **Live location sharing** — share WhatsApp location pin to update buyer in real time
- **Earnings dashboard** — `EARNINGS` shows total, pending payout, delivery count
- **3-minute auto-decline** — unresponsive riders are auto-reassigned
- **Weekly payouts** — escrow-held funds released on Friday

### Trust & Safety
- **Trust score system** — buyers, sellers, and riders each have a 0–100 trust score
- **Rating-to-trust pipeline** — 5-star ratings boost seller trust score; 1-star penalises
- **Tier auto-promotion** — trust score + order count determines tier
- **Dispute resolution** — admin resolves with REFUND or CLOSE
- **User blocking** — `ADMIN BAN [phone]`
- **Duplicate M-Pesa ref detection** — flags suspicious payment references
- **24-hour payout escrow** — seller funds held until delivery confirmed

### Admin Commands
```
ADMIN STATS
ADMIN ORDERS
ADMIN DISPUTES
ADMIN SELLERS
ADMIN RIDERS
ADMIN RESOLVE [disputeId] REFUND|CLOSE [note]
ADMIN ASSIGN [orderId] [riderPhone]
ADMIN APPROVE SELLER [phone]
ADMIN TIER [sellerPhone] new|verified|top|premium
ADMIN BAN [phone]
ADMIN UNBAN [phone]
ADMIN BROADCAST BUYERS|SELLERS|RIDERS|ALL [message]
```

---

## 🚀 Quick Start (5 Minutes)

### Prerequisites
- Node.js 18+ and pnpm
- MySQL/TiDB database
- Cloudinary account (for product images)
- M-Pesa Daraja credentials (for payments)
- WhatsApp Business API access

### Option 1: Automated Setup (Recommended)

```bash
git clone https://github.com/Jamesjaq/whatsapp-shop-os.git
cd whatsapp-shop-os
chmod +x QUICK_START.sh
./QUICK_START.sh
```

This will:
- ✓ Check prerequisites (Node.js, pnpm)
- ✓ Install all dependencies
- ✓ Create `.env` files (you fill in credentials)
- ✓ Show next steps

### Option 2: Manual Setup

```bash
# Clone repository
git clone https://github.com/Jamesjaq/whatsapp-shop-os.git
cd whatsapp-shop-os

# Install dependencies for both admin and shop-os
cd admin && pnpm install && cd ..
cd shop-os && pnpm install && cd ..

# Create databases
mysql -u root -p << EOF
CREATE DATABASE shop_os_admin;
CREATE DATABASE shop_os;
EOF

# Run migrations (admin dashboard)
cd admin
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
cd ..
```

### Configure Environment Variables

**admin/.env**
```env
DATABASE_URL=mysql://root:password@localhost:3306/shop_os_admin
JWT_SECRET=your-secret-key-here
VITE_APP_ID=your-manus-oauth-app-id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://manus.im/login
CLOUDINARY_CLOUD_NAME=dlbhwdsa0
CLOUDINARY_API_KEY=182788449552121
CLOUDINARY_API_SECRET=-JOQXxj5Dp5fUrm9pxQFt0Q6cm4
```

**shop-os/.env**
```env
DATABASE_URL=mysql://root:password@localhost:3306/shop_os
WHATSAPP_API_URL=https://graph.instagram.com/v18.0
WHATSAPP_BUSINESS_ACCOUNT_ID=your-waba-id
WHATSAPP_ACCESS_TOKEN=your-access-token
MPESA_CONSUMER_KEY=your-mpesa-key
MPESA_CONSUMER_SECRET=your-mpesa-secret
MPESA_SHORTCODE=your-shortcode
MPESA_PASSKEY=your-passkey
MPESA_IPN_URL=https://yourdomain.com/api/mpesa/ipn
```

### Start All Services

**Terminal 1 - Admin Dashboard**
```bash
cd admin
pnpm dev
# → http://localhost:3000
```

**Terminal 2 - API Server**
```bash
cd shop-os
pnpm run api-server
# → http://localhost:3001
```

**Terminal 3 - WhatsApp Bot Worker**
```bash
cd shop-os
pnpm run bot-worker
# → Processes WhatsApp messages
```

**Terminal 4 - Background Jobs**
```bash
cd shop-os
pnpm run job-worker
# → M-Pesa confirmations, GPS tracking, notifications
```

### Access Admin Dashboard

**URL:** http://localhost:3000

**Features:**
- Dashboard: Revenue analytics, GMV, commission tracking
- Sellers: Manage seller profiles and subscription tiers
- Products: Product catalog with Cloudinary image hosting, bulk CSV import
- Settings: Configure platform economics (commission %, delivery fees, loyalty rates)

---

## 📁 Project Structure

```
whatsapp-shop-os/
├── admin/                      # Admin web dashboard (React + Express + tRPC)
│   ├── client/                # React frontend
│   ├── server/                # Express API + tRPC routers
│   ├── drizzle/               # Database schema & migrations
│   └── package.json
├── shop-os/                   # WhatsApp bot + backend services
│   ├── src/
│   │   ├── models/            # Database models
│   │   ├── services/          # Business logic
│   │   ├── handlers/          # WhatsApp message handlers
│   │   └── utils/             # Helpers
│   ├── server.ts              # Main API server
│   ├── bot-worker.ts          # WhatsApp bot message processor
│   ├── job-worker.ts          # Background jobs
│   └── package.json
├── SETUP.md                   # Detailed setup guide
├── QUICK_START.sh             # Automated setup script
├── README_MONOREPO.md         # Complete platform overview
└── README.md                  # This file
```

---

## User Commands Reference

### Buyer
| Command | Action |
|---|---|
| `HELP` / `1-8` | Main menu |
| `1` | Order essentials |
| `2` | Quick reorder (last order) |
| `3` | Track order |
| `4` | Browse shops |
| `5` | My orders |
| `RATE ORD-XXX 5` | Rate a delivered order (1–5) |
| `8` | Report a problem |
| Send location pin | Auto-captured for delivery |

### Seller
| Command | Action |
|---|---|
| `6` | Open shop manager |
| `CONFIRM ORD-XXX` | Confirm an order |
| `REJECT ORD-XXX [reason]` | Reject an order |
| `ADD RIDER 0712345678` | Add trusted rider |
| `REMOVE RIDER 0712345678` | Remove trusted rider |
| `MY RIDERS` | List trusted riders |
| `STATS` | Quick stats |

### Rider
| Command | Action |
|---|---|
| `7` | Register as rider |
| `ACCEPT ORD-XXX` | Accept delivery job |
| `DECLINE ORD-XXX` | Decline delivery job |
| `PICKUP ORD-XXX` | Mark order picked up |
| `DONE ORD-XXX 4821` | Mark delivered (with OTP) |
| `AVAILABLE` / `OFFLINE` | Toggle availability |
| `EARNINGS` | View earnings |
| Send location pin | Share live location with buyer |

---

## Architecture

```
WhatsApp (Baileys2)
    │
    ├── messageHandler.ts   ← routes text / location pin / image messages
    │
    ├── flows.ts            ← all conversational flows (buyer / seller / rider)
    │
    └── notifier.ts         ← outbound message queue
    
Services
    ├── orderService.ts     ← order lifecycle, GPS maps link to seller/rider
    ├── sellerService.ts    ← shop registration, products, trusted riders, ratings
    ├── riderService.ts     ← dispatch (trusted-first), accept/decline, OTP delivery
    ├── trustService.ts     ← trust score engine + rating boost
    ├── paymentService.ts   ← M-Pesa STK push, IPN, COD, escrow
    ├── disputeService.ts   ← dispute raise, admin resolve
    ├── adminService.ts     ← stats, approve, tier, ban, broadcast
    └── payoutService.ts    ← weekly payout processing

Models (MongoDB)
    ├── Order               ← GPS coordinates, OTP, status, items
    ├── Seller              ← trustedRiders[], rating, tier, trustScore, geo
    ├── Rider               ← tier, trustScore, earnings, currentOrderId
    ├── Product             ← imageUrl, stock, soldCount
    ├── User                ← buyer profile, trustScore, lastOrderId
    ├── Payment             ← M-Pesa ref, status, audit trail
    └── Dispute             ← type, description, resolution
```

---

## 📊 Roadmap

### ✅ Completed (Phase 1-3)
- [x] Admin web dashboard (React)
- [x] Seller management with subscription tiers
- [x] Product catalog with Cloudinary integration
- [x] Bulk product import via CSV
- [x] Revenue analytics and configuration
- [x] Database schema and migrations

### 🔄 In Progress (Phase 4-9)
- [ ] WhatsApp bot UX overhaul (numeric selection, multi-item cart)
- [ ] Seller shop page (shareable WhatsApp link)
- [ ] Buyer loyalty points system
- [ ] M-Pesa STK push auto-confirmation
- [ ] Rider GPS live tracking on web dashboard
- [ ] Android companion app (Expo)

### 📋 Future
- [ ] AI-powered product recommendations
- [ ] Seller analytics dashboard
- [ ] Advanced fraud detection
- [ ] Multi-language support
- [ ] SMS fallback for low-bandwidth areas

---

## 🛠️ Technology Stack

**Admin Dashboard:**
- React 19, Tailwind CSS 4, shadcn/ui
- Express 4, tRPC 11, Node.js
- MySQL/TiDB with Drizzle ORM
- Manus OAuth, Cloudinary CDN

**WhatsApp Bot & Backend:**
- WhatsApp Business API
- Node.js workers
- MySQL/TiDB
- M-Pesa Daraja API
- Google Maps API

**Mobile App (In Progress):**
- Expo (React Native)
- Android platform

---

## 💰 Revenue Model

Platform earns from:
- **Per-Order Commission** - 5-10% of order value (configurable)
- **Delivery Fee Split** - Platform takes % of delivery fee
- **Seller Subscriptions** - Premium tiers unlock features
- **Loyalty Sponsorship** - Brands sponsor loyalty points

---

## 🐛 Troubleshooting

### Admin Dashboard Won't Start
```bash
cd admin
pnpm check             # Check TypeScript
pnpm dev               # Start dev server
```

### Database Connection Error
```bash
# Verify DATABASE_URL in .env
# Check MySQL is running
mysql -u root -p -e "SHOW DATABASES;"
```

### WhatsApp Messages Not Processing
1. Check `WHATSAPP_ACCESS_TOKEN` is valid
2. Verify webhook URL is publicly accessible
3. Check logs in `shop-os/logs/`

### M-Pesa Payments Not Confirming
1. Verify `MPESA_IPN_URL` is publicly accessible
2. Check M-Pesa credentials in `.env`
3. Test with M-Pesa sandbox first

---

## 📚 Documentation

- **SETUP.md** - Complete setup and configuration instructions
- **README_MONOREPO.md** - Full platform overview with all workflows
- **QUICK_START.sh** - Automated setup script
- **ARCHITECTURE_PLAN.md** - System design and data models
- **PREMORTEM.md** - Known risks and mitigation strategies

---

## 📞 Support

- **Issues:** GitHub Issues
- **Discussions:** GitHub Discussions
- **Documentation:** See SETUP.md and README_MONOREPO.md

## Contributing

Pull requests welcome. Please open an issue first to discuss what you would like to change.

---

## License

MIT — free to use, modify, and deploy.

---

**Status:** Production-ready (Phases 1-3 complete, Phases 4-9 in active development)

**Last Updated:** June 29, 2026

_Built with ❤️ for Kenya's neighbourhood economy._
