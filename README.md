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

## Quick Start

### Prerequisites
- Node.js 18+
- MongoDB (local or Atlas)
- Redis (for session store)
- A WhatsApp number (personal or business)

### Setup

```bash
git clone https://github.com/YOUR_USERNAME/whatsapp-shop-os.git
cd whatsapp-shop-os/Baileys2

# Install dependencies
npm install --ignore-scripts

# Configure environment
cp shop-os/.env.example shop-os/.env
# Edit .env with your MongoDB URI, Redis URL, admin phone, etc.

# Start the bot
npm run shop-os
```

Scan the QR code with WhatsApp to connect.

### Environment Variables

```env
MONGODB_URI=mongodb://localhost:27017/shopos
REDIS_URL=redis://localhost:6379
ADMIN_PHONE=254712345678
DELIVERY_FEE=50
RIDER_DISPATCH_TIMEOUT_MS=5000
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
MPESA_SHORTCODE=...
MPESA_PASSKEY=...
MPESA_CALLBACK_URL=https://yourdomain.com/api/mpesa/ipn
MPESA_CALLBACK_SECRET=...
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

## Roadmap

- [ ] S3/Cloudinary integration for product image hosting
- [ ] Multi-item cart (order multiple products at once)
- [ ] Seller shop page (shareable WhatsApp link)
- [ ] Buyer loyalty points system
- [ ] Rider GPS live tracking on web dashboard
- [ ] Admin web dashboard (React)
- [ ] Android companion app (Expo)
- [ ] M-Pesa STK push auto-confirmation
- [ ] Bulk product import via CSV
- [ ] WhatsApp Business API (Meta) migration path

---

## Contributing

Pull requests welcome. Please open an issue first to discuss what you would like to change.

---

## License

MIT — free to use, modify, and deploy.

---

_Built with ❤️ for Kenya's neighbourhood economy._
