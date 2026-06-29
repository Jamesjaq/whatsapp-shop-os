#!/bin/bash

# WhatsApp Shop OS - Quick Start Script
# Run this to set up and start all services

set -e

echo "🚀 WhatsApp Shop OS - Quick Start"
echo "=================================="

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+"
    exit 1
fi

if ! command -v pnpm &> /dev/null; then
    echo "❌ pnpm is not installed. Installing..."
    npm install -g pnpm
fi

if ! command -v mysql &> /dev/null; then
    echo "⚠️  MySQL client not found. Make sure MySQL server is running."
fi

echo -e "${GREEN}✓ Prerequisites OK${NC}"

# Install dependencies
echo -e "${BLUE}Installing dependencies...${NC}"

echo "  → Installing admin dashboard dependencies..."
cd admin
pnpm install --frozen-lockfile
cd ..

echo "  → Installing shop-os dependencies..."
cd shop-os
pnpm install --frozen-lockfile
cd ..

echo -e "${GREEN}✓ Dependencies installed${NC}"

# Create .env files if they don't exist
echo -e "${BLUE}Setting up environment variables...${NC}"

if [ ! -f admin/.env ]; then
    echo "  → Creating admin/.env (you'll need to fill in your credentials)"
    cat > admin/.env << 'EOF'
DATABASE_URL=mysql://root:password@localhost:3306/shop_os_admin
JWT_SECRET=your-secret-key-here-change-in-production
VITE_APP_ID=your-manus-oauth-app-id
OAUTH_SERVER_URL=https://api.manus.im
VITE_OAUTH_PORTAL_URL=https://manus.im/login
CLOUDINARY_CLOUD_NAME=dlbhwdsa0
CLOUDINARY_API_KEY=182788449552121
CLOUDINARY_API_SECRET=-JOQXxj5Dp5fUrm9pxQFt0Q6cm4
EOF
fi

if [ ! -f shop-os/.env ]; then
    echo "  → Creating shop-os/.env (you'll need to fill in your credentials)"
    cat > shop-os/.env << 'EOF'
DATABASE_URL=mysql://root:password@localhost:3306/shop_os
WHATSAPP_API_URL=https://graph.instagram.com/v18.0
WHATSAPP_BUSINESS_ACCOUNT_ID=your-waba-id
WHATSAPP_ACCESS_TOKEN=your-access-token
MPESA_CONSUMER_KEY=your-mpesa-key
MPESA_CONSUMER_SECRET=your-mpesa-secret
MPESA_SHORTCODE=your-shortcode
MPESA_PASSKEY=your-passkey
MPESA_IPN_URL=https://yourdomain.com/api/mpesa/ipn
EOF
fi

echo -e "${GREEN}✓ Environment files created${NC}"

# Display next steps
echo ""
echo -e "${GREEN}✓ Setup complete!${NC}"
echo ""
echo "📋 Next steps:"
echo ""
echo "1. Update environment variables:"
echo "   - admin/.env (Cloudinary, OAuth credentials)"
echo "   - shop-os/.env (WhatsApp, M-Pesa credentials)"
echo ""
echo "2. Create databases:"
echo "   mysql -u root -p -e \"CREATE DATABASE shop_os_admin;\""
echo "   mysql -u root -p -e \"CREATE DATABASE shop_os;\""
echo ""
echo "3. Run migrations (admin dashboard):"
echo "   cd admin && pnpm drizzle-kit generate && pnpm drizzle-kit migrate"
echo ""
echo "4. Start services in separate terminals:"
echo ""
echo "   Terminal 1 - Admin Dashboard:"
echo "   cd admin && pnpm dev"
echo ""
echo "   Terminal 2 - API Server:"
echo "   cd shop-os && pnpm run api-server"
echo ""
echo "   Terminal 3 - WhatsApp Bot Worker:"
echo "   cd shop-os && pnpm run bot-worker"
echo ""
echo "   Terminal 4 - Background Jobs:"
echo "   cd shop-os && pnpm run job-worker"
echo ""
echo "5. Access admin dashboard:"
echo "   http://localhost:3000"
echo ""
echo "📚 For detailed setup instructions, see SETUP.md"
echo ""
