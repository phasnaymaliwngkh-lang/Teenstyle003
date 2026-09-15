-- ============================================================================
-- TEENSTYLE AI — Database-level integrity constraints
--
-- Prisma schema cannot express CHECK constraints, so they are added here.
-- They are part of the migration history, so the shadow database gets them too
-- and `prisma migrate dev` will not report drift.
--
-- Why at the database level and not only in application code:
--   STOCK REQUIREMENT says stock must never go negative. Application code can be
--   bypassed (a bad migration, a manual SQL fix, a race condition, a future bug),
--   the database cannot. These constraints are the last line of defence.
-- ============================================================================

-- ─── Inventory: stock must never go negative (STOCK REQUIREMENT) ────────────
ALTER TABLE "Inventory"
  ADD CONSTRAINT "Inventory_quantity_non_negative"
  CHECK ("quantity" >= 0);

ALTER TABLE "Inventory"
  ADD CONSTRAINT "Inventory_reservedQuantity_non_negative"
  CHECK ("reservedQuantity" >= 0);

-- cannot reserve more than what physically exists -> prevents overselling
ALTER TABLE "Inventory"
  ADD CONSTRAINT "Inventory_reserved_not_over_quantity"
  CHECK ("reservedQuantity" <= "quantity");

-- ─── InventoryMovement: append-only audit trail must stay sane ──────────────
ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_quantity_positive"
  CHECK ("quantity" > 0);

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_before_non_negative"
  CHECK ("quantityBefore" >= 0);

ALTER TABLE "InventoryMovement"
  ADD CONSTRAINT "InventoryMovement_after_non_negative"
  CHECK ("quantityAfter" >= 0);

-- ─── Product: price and stock cache ─────────────────────────────────────────
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_price_non_negative"
  CHECK ("price" >= 0);

-- sale price must be a real discount
ALTER TABLE "Product"
  ADD CONSTRAINT "Product_salePrice_valid"
  CHECK ("salePrice" IS NULL OR ("salePrice" >= 0 AND "salePrice" < "price"));

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_totalStock_non_negative"
  CHECK ("totalStock" >= 0);

ALTER TABLE "Product"
  ADD CONSTRAINT "Product_minimumStock_non_negative"
  CHECK ("minimumStock" >= 0);

-- ─── ProductVariant: optional price override ────────────────────────────────
ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_price_non_negative"
  CHECK ("price" IS NULL OR "price" >= 0);

ALTER TABLE "ProductVariant"
  ADD CONSTRAINT "ProductVariant_salePrice_valid"
  CHECK (
    "salePrice" IS NULL
    OR ("salePrice" >= 0 AND ("price" IS NULL OR "salePrice" < "price"))
  );

-- ─── User: loyalty points must never go negative (STEP 42) ──────────────────
ALTER TABLE "User"
  ADD CONSTRAINT "User_points_non_negative"
  CHECK ("points" >= 0);

ALTER TABLE "User"
  ADD CONSTRAINT "User_totalSpent_non_negative"
  CHECK ("totalSpent" >= 0);

-- ─── Order: money can never be negative ────────────────────────────────────
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_amounts_non_negative"
  CHECK (
    "subtotal" >= 0
    AND "discountTotal" >= 0
    AND "shippingFee" >= 0
    AND "total" >= 0
  );

-- discount can never exceed the value of the goods
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_discount_not_over_subtotal"
  CHECK ("discountTotal" <= "subtotal");

-- ─── OrderItem: quantity must be a real purchase ───────────────────────────
ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_quantity_positive"
  CHECK ("quantity" > 0);

ALTER TABLE "OrderItem"
  ADD CONSTRAINT "OrderItem_amounts_non_negative"
  CHECK ("unitPrice" >= 0 AND "lineTotal" >= 0);

-- ─── Payment ───────────────────────────────────────────────────────────────
ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_amount_non_negative"
  CHECK ("amount" >= 0);

ALTER TABLE "Payment"
  ADD CONSTRAINT "Payment_refundAmount_valid"
  CHECK ("refundAmount" IS NULL OR ("refundAmount" >= 0 AND "refundAmount" <= "amount"));

-- ─── Shipment ──────────────────────────────────────────────────────────────
ALTER TABLE "Shipment"
  ADD CONSTRAINT "Shipment_fee_non_negative"
  CHECK ("fee" >= 0);

-- ─── Coupon (STEP 41) ──────────────────────────────────────────────────────
ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_value_non_negative"
  CHECK ("value" >= 0);

-- a percentage discount above 100% makes no sense
ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_percentage_max_100"
  CHECK ("type" <> 'PERCENTAGE' OR "value" <= 100);

ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_usedCount_non_negative"
  CHECK ("usedCount" >= 0);

ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_usageLimit_positive"
  CHECK ("usageLimit" IS NULL OR "usageLimit" > 0);

ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_perUserLimit_positive"
  CHECK ("perUserLimit" IS NULL OR "perUserLimit" > 0);

ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_period_valid"
  CHECK ("endsAt" > "startsAt");

ALTER TABLE "Coupon"
  ADD CONSTRAINT "Coupon_minOrderAmount_non_negative"
  CHECK ("minOrderAmount" IS NULL OR "minOrderAmount" >= 0);

-- ─── Review: rating is 1..5 (STEP 23) ──────────────────────────────────────
ALTER TABLE "Review"
  ADD CONSTRAINT "Review_rating_range"
  CHECK ("rating" BETWEEN 1 AND 5);

ALTER TABLE "Review"
  ADD CONSTRAINT "Review_helpfulCount_non_negative"
  CHECK ("helpfulCount" >= 0);

-- ─── Wishlist ──────────────────────────────────────────────────────────────
ALTER TABLE "Wishlist"
  ADD CONSTRAINT "Wishlist_priceWhenAdded_non_negative"
  CHECK ("priceWhenAdded" >= 0);

-- ─── Catalog sort order ────────────────────────────────────────────────────
ALTER TABLE "Category"
  ADD CONSTRAINT "Category_not_own_parent"
  CHECK ("parentId" IS NULL OR "parentId" <> "id");

-- ─── Partial indexes for the queries the app runs most ─────────────────────
-- Only rows that are not soft-deleted are ever listed, so index just those.
CREATE INDEX "Product_active_not_deleted_idx"
  ON "Product" ("status", "publishedAt" DESC)
  WHERE "deletedAt" IS NULL;

CREATE INDEX "Order_open_idx"
  ON "Order" ("status", "createdAt" DESC)
  WHERE "deletedAt" IS NULL;

-- Low stock dashboard (STEP 16) reads only products at or below their threshold.
CREATE INDEX "Product_low_stock_idx"
  ON "Product" ("totalStock")
  WHERE "deletedAt" IS NULL AND "status" = 'ACTIVE';

-- Unread notification badge (STEP 24)
CREATE INDEX "Notification_unread_idx"
  ON "Notification" ("userId", "createdAt" DESC)
  WHERE "readAt" IS NULL;

-- Only approved reviews are shown on the storefront (STEP 23)
CREATE INDEX "Review_public_idx"
  ON "Review" ("productId", "createdAt" DESC)
  WHERE "status" = 'APPROVED' AND "deletedAt" IS NULL;

-- ─── Full-text-ish search support for product name (STEP 45) ───────────────
-- pg_trgm enables fast ILIKE '%keyword%' lookups, which plain btree cannot do.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "Product_name_trgm_idx"
  ON "Product" USING gin ("name" gin_trgm_ops);

CREATE INDEX "Product_sku_trgm_idx"
  ON "Product" USING gin ("sku" gin_trgm_ops);
