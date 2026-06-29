# WhatsApp Shop OS - Complete Setup Guide

This is a **monorepo** containing the entire WhatsApp Shop OS platform. Clone once, run everything.

## 📁 Project Structure

```
whatsapp-shop-os/
├── admin/                    # Admin web dashboard (React + Express + tRPC)
│   ├── client/              # React frontend
│   ├── server/              # Express API + tRPC routers
│   ├── drizzle/             # Database schema & migrations
│   └── package.json
├── shop-os/                 # WhatsApp bot + backend services
│   ├── src/
│   │   ├── models/          # Database models (Product, Order, User, etc.)
│   │   ├── services/        # Business logic (payments, orders, notifications)
│   │   ├── handlers/        # WhatsApp message handlers
│   │   └── utils/           # Helpers
│   ├── server.ts            # Main API server
│   ├── bot-worker.ts        # WhatsApp bot message processor
│   ├── job-worker.ts        # Background jobs (M-Pesa confirmation, GPS tracking)
│   └── package.json
├── ARCHITECTURE_PLAN.md     # System design & data flow
├── PREMORTEM.md            # Known risks & mitigation
└── SETUP.md                # This file
```

## 🚀 Quick Start (5 minutes)

### Prerequisites
- Node.js 18+ and pnpm
- MySQL/TiDB database
- Cloudinary account (for product images)
- M-Pesa Daraja credentials (for payments)
- WhatsApp Business API access

### 1. Clone & Install

```bash
# Clone the repository
git clone https://github.com/Jamesjaq/whatsapp-shop-os.git
cd whatsapp-shop-os

# Install dependencies for both admin and shop-os
cd admin && pnpm install
cd ../shop-os && pnpm install
cd ..
```

### 2. Set Up Environment Variables

Create `.env` files in both `admin/` and `shop-os/` directories:

**admin/.env**
```
DATABASE_URL=mysql://user:password@localhost:3306/shop_os_admin
JWT_SECRET=your-secret-key-here
VITE_APP_ID=your-manus-oauth-app-id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://manus.im/login
CLOUDINARY_CLOUD_NAME=dlbhwdsa0
CLOUDINARY_API_KEY=182788449552121
CLOUDINARY_API_SECRET=-JOQXxj5Dp5fUrm9pxQFt0Q6cm4
```

**shop-os/.env**
```
DATABASE_URL=mysql://user:password@localhost:3306/shop_os
WHATSAPP_API_URL=https://graph.instagram.com/v18.0
WHATSAPP_BUSINESS_ACCOUNT_ID=your-waba-id
WHATSAPP_ACCESS_TOKEN=your-access-token
MPESA_CONSUMER_KEY=your-mpesa-key
MPESA_CONSUMER_SECRET=your-mpesa-secret
MPESA_SHORTCODE=your-shortcode
MPESA_PASSKEY=your-passkey
MPESA_IPN_URL=https://yourdomain.com/api/mpesa/ipn
```

### 3. Set Up Database

```bash
# Create databases
mysql -u root -p -e "CREATE DATABASE shop_os_admin;"
mysql -u root -p -e "CREATE DATABASE shop_os;"

# Run migrations for admin dashboard
cd admin
pnpm drizzle-kit generate
pnpm drizzle-kit migrate
cd ..

# Run migrations for shop-os (if applicable)
cd shop-os
# Follow existing migration setup in shop-os/src/models
cd ..
```

### 4. Start Services

**Terminal 1 - Admin Dashboard**
```bash
cd admin
pnpm dev
# Runs on http://localhost:3000
```

**Terminal 2 - API Server**
```bash
cd shop-os
pnpm run api-server
# Runs on http://localhost:3001
```

**Terminal 3 - WhatsApp Bot Worker**
```bash
cd shop-os
pnpm run bot-worker
# Processes incoming WhatsApp messages
```

**Terminal 4 - Background Jobs**
```bash
cd shop-os
pnpm run job-worker
# Handles M-Pesa confirmations, GPS tracking, notifications
```

## 📊 Admin Dashboard

**Access:** http://localhost:3000

**Login:** Use Manus OAuth (configured in VITE_APP_ID)

**Features:**
- Dashboard: Revenue analytics, GMV, commission tracking
- Sellers: Manage seller profiles and subscription tiers
- Products: Product catalog with Cloudinary image hosting, bulk CSV import
- Settings: Configure platform economics (commission %, delivery fees, loyalty rates)

### Admin Dashboard Workflow

1. **Login** → OAuth redirect
2. **Dashboard** → View real-time metrics
3. **Sellers** → Create/manage sellers, assign subscription tiers
4. **Products** → Upload products with images or bulk import via CSV
5. **Settings** → Configure platform commission, delivery fees, loyalty mechanics

## 🤖 WhatsApp Bot Workflow

Buyers interact entirely through WhatsApp messages:

### Buyer Flow
1. **Browse** → Send "1" to see products (numeric selection)
2. **Add to Cart** → Send "2" to add quantity, "3" to add another product
3. **Checkout** → Send "order" to review cart and proceed
4. **Payment** → M-Pesa STK push auto-triggers, buyer confirms
5. **Confirmation** → Order confirmed, seller notified, rider assigned
6. **Tracking** → Send "track" to see live rider location
7. **Loyalty** → Earn points per order, redeem for discounts

### Seller Flow
1. **Onboard** → Admin creates seller profile in dashboard
2. **Upload Products** → Via WhatsApp, admin dashboard, or bulk CSV
3. **Manage Orders** → Receive WhatsApp notifications, confirm fulfillment
4. **Withdraw** → Request payout (M-Pesa auto-transfer)

### Rider Flow
1. **Assign** → System assigns orders based on zone and availability
2. **Accept** → Rider confirms via WhatsApp
3. **Track** → Share live GPS location with buyer
4. **Deliver** → Mark complete, collect payment (if COD)
5. **Earnings** → View daily/weekly earnings in dashboard

## 💳 Payment Flow (M-Pesa)

1. **Checkout** → Buyer sends "order"
2. **STK Push** → M-Pesa prompt appears on buyer's phone
3. **Auto-Confirm** → IPN webhook confirms payment (no manual intervention)
4. **Escrow** → Platform holds commission, releases to seller
5. **Notifications** → Buyer, seller, rider all notified instantly

## 📍 Rider GPS Tracking

1. **Live Map** → Admin dashboard shows all active riders in real-time
2. **Buyer View** → Buyer can see rider location via WhatsApp link
3. **Geofencing** → Automatic notifications when rider is near delivery address
4. **Route Optimization** → System suggests optimal delivery order

## 💰 Revenue Model

Platform earns from:
- **Per-Order Commission** → Configurable % (default 5-10%)
- **Delivery Fee Split** → Platform takes % of delivery fee
- **Subscription Tiers** → Sellers pay for premium features (analytics, bulk upload, etc.)
- **Loyalty Sponsorship** → Brands can sponsor loyalty points

All configurable in **Settings** → **Platform Configuration**

## 🔄 Data Flow

```
WhatsApp Message
    ↓
bot-worker (processes message)
    ↓
Order Service (creates/updates order)
    ↓
Payment Service (triggers M-Pesa STK)
    ↓
IPN Webhook (confirms payment)
    ↓
Notification Service (alerts buyer/seller/rider)
    ↓
Admin Dashboard (updates analytics in real-time)
```

## 🛠️ Development

### Add a New Feature

1. **Update Database Schema** → `admin/drizzle/schema.ts` or `shop-os/src/models/`
2. **Create API Route** → `shop-os/src/handlers/` or `admin/server/routers.ts`
3. **Add WhatsApp Handler** → `shop-os/src/handlers/whatsapp.ts`
4. **Update Admin UI** → `admin/client/src/pages/`
5. **Test** → Run tests with `pnpm test`
6. **Deploy** → Push to main branch

### Testing

```bash
# Admin dashboard tests
cd admin && pnpm test

# Shop-os tests
cd shop-os && pnpm test
```

## 📦 Deployment

### Admin Dashboard
```bash
cd admin
pnpm build
# Deploy to Manus, Vercel, or your preferred platform
```

### Shop-OS Services
```bash
cd shop-os
pnpm build
# Deploy API server, bot worker, and job worker as separate services
```

### Environment Variables
Set all `.env` variables in your deployment platform (e.g., GitHub Secrets, Vercel, Railway).

## 🐛 Troubleshooting

### Admin Dashboard Won't Start
```bash
cd admin
pnpm check  # Check TypeScript
pnpm dev    # Start dev server
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
3. Check logs: `tail -f shop-os/logs/bot.log`

### M-Pesa Payments Not Confirming
1. Verify `MPESA_IPN_URL` is publicly accessible
2. Check M-Pesa credentials in `.env`
3. Test with test mode first

## 📚 Documentation

- **ARCHITECTURE_PLAN.md** - System design, data models, API contracts
- **PREMORTEM.md** - Known risks and mitigation strategies
- **admin/README.md** - Admin dashboard specific docs
- **shop-os/README.md** - Bot and backend specific docs

## 🚀 Next Steps

1. Set up database and environment variables
2. Start admin dashboard and verify login works
3. Create test seller and products
4. Test WhatsApp bot with test account
5. Configure M-Pesa and test payment flow
6. Deploy to production

## 📞 Support

For issues or questions:
1. Check existing GitHub issues
2. Review ARCHITECTURE_PLAN.md and PREMORTEM.md
3. Open a new GitHub issue with details

---

**Built with:** React, Express, tRPC, Drizzle ORM, Cloudinary, M-Pesa, WhatsApp API

**License:** MIT

**Status:** Production-ready (Phase 1-3 complete, Phases 4-9 in progress)
