# WhatsApp Shop OS: Architecture & Feature Plan

## 1. Overview
This document outlines the architectural changes and new features required to upgrade WhatsApp Shop OS from a basic text bot into a robust, habit-forming hyperlocal commerce platform.

## 2. Core Enhancements

### 2.1 Visual Product Browsing & Multi-Item Cart
- **Images**: Update the `Product` model to include `imageUrl`. Modify the Baileys `sendMessage` implementation to send product images alongside text descriptions during search and browsing.
- **Cart System**: Introduce a `Cart` model or session state to hold multiple items. Modify the order flow to allow adding items, viewing the cart, and checking out all items at once.

### 2.2 Seller-Managed Riders (Trusted Fleet)
- **Model Update**: Add a `trustedRiders` array (list of rider phone numbers or IDs) to the `Seller` model.
- **Dispatch Logic**: Modify `dispatchRider` in `riderService.ts` to first attempt assigning the order to one of the seller's trusted riders. If none are available within a timeout (e.g., 5 mins), fallback to the global pool.
- **Seller UI**: Add commands in the seller management flow to `ADD RIDER [phone]` and `REMOVE RIDER [phone]`.

### 2.3 Improved Location Handling
- **WhatsApp Location Pins**: Update the buyer order flow to accept WhatsApp location messages (latitude/longitude) instead of just text strings. Store these coordinates in the `Order` model.
- **Rider Navigation**: Send a Google Maps link (generated from the coordinates) to the assigned rider for precise navigation.

### 2.4 Proactive Notifications
- **Order State Changes**: Implement automated push notifications to buyers when an order status changes (e.g., `confirmed`, `rider_assigned`, `on_the_way`, `delivered`).

## 3. Database Schema Updates

### Seller Model
```typescript
trustedRiders: { type: [String], default: [] }
```

### Order Model
```typescript
latitude: { type: Number }
longitude: { type: Number }
```

## 4. Implementation Steps
1. **Update Models**: Modify `Seller.ts` and `Order.ts` schemas.
2. **Implement Trusted Riders**: Update `sellerService.ts` and `riderService.ts` logic.
3. **Enhance Buyer Flow**: Update `flows.ts` to support location pins and multi-item cart (or simplified bulk ordering).
4. **Integrate Images**: Add image sending capabilities to product display in `flows.ts`.
5. **Testing**: Validate all flows end-to-end.
