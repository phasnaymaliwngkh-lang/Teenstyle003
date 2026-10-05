-- ============================================================================
-- STEP 42: Loyalty / Points
--
-- 1. A points ledger (PointTransaction) — append-only, like InventoryMovement.
--    "User"."points" stays as the balance cache, written only together with a
--    ledger row in the same transaction, so SUM(delta) always explains it.
-- 2. "Order" records how many points paid for part of the bill. The money value is
--    already inside "discountTotal" (the bill formula keeps a single discount column
--    — STEP 41 rule 8); "pointsDiscount" only says which part of it came from points.
-- 3. "User"."loyaltyTier" / "User"."totalSpent" are dropped. No code ever wrote them
--    (every account was MEMBER / 0 forever — found in STEP 40). The tier is now
--    computed from real paid orders, so it cannot go stale when the thresholds change.
-- ============================================================================

-- CreateEnum
CREATE TYPE "PointTransactionType" AS ENUM ('EARN', 'REDEEM', 'REDEEM_REFUND', 'EARN_REVERSAL', 'ADJUSTMENT');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'LOYALTY_UPDATE';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "pointsDiscount" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN     "pointsRedeemed" INTEGER NOT NULL DEFAULT 0;

-- AlterTable (drops CHECK "User_totalSpent_non_negative" together with the column)
ALTER TABLE "User" DROP COLUMN "loyaltyTier",
DROP COLUMN "totalSpent";

-- DropEnum
DROP TYPE "LoyaltyTier";

-- CreateTable
CREATE TABLE "PointTransaction" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "PointTransactionType" NOT NULL,
    "delta" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "orderId" UUID,
    "description" TEXT NOT NULL,
    "createdById" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PointTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PointTransaction_idempotencyKey_key" ON "PointTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PointTransaction_userId_createdAt_idx" ON "PointTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "PointTransaction_orderId_idx" ON "PointTransaction"("orderId");

-- CreateIndex
CREATE INDEX "PointTransaction_type_idx" ON "PointTransaction"("type");

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PointTransaction" ADD CONSTRAINT "PointTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── Integrity of the ledger (Prisma cannot express CHECK constraints) ──────

-- the row must explain the balance change exactly
ALTER TABLE "PointTransaction"
  ADD CONSTRAINT "PointTransaction_balance_math"
  CHECK ("balanceAfter" = "balanceBefore" + "delta");

ALTER TABLE "PointTransaction"
  ADD CONSTRAINT "PointTransaction_balances_non_negative"
  CHECK ("balanceBefore" >= 0 AND "balanceAfter" >= 0);

-- direction must match the type. EARN_REVERSAL may be 0: the points were already
-- spent, so nothing could be taken back — the row still records that it was tried.
ALTER TABLE "PointTransaction"
  ADD CONSTRAINT "PointTransaction_delta_direction"
  CHECK (
    ("type" IN ('EARN', 'REDEEM_REFUND') AND "delta" > 0)
    OR ("type" = 'REDEEM' AND "delta" < 0)
    OR ("type" = 'EARN_REVERSAL' AND "delta" <= 0)
    OR ("type" = 'ADJUSTMENT' AND "delta" <> 0)
  );

-- ─── Order: points can only pay for part of the discount that exists ───────
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_points_valid"
  CHECK (
    "pointsRedeemed" >= 0
    AND "pointsDiscount" >= 0
    AND "pointsDiscount" <= "discountTotal"
    AND (("pointsRedeemed" = 0) = ("pointsDiscount" = 0))
  );

-- ─── Opening balance ───────────────────────────────────────────────────────
-- No code ever wrote "User"."points" before this step, so every balance should be 0.
-- If one is not (a manual fix, a restored dump), keep it and write it into the
-- ledger as an opening adjustment — silently zeroing it would destroy data, and
-- leaving it unexplained would break "points = SUM(delta)".
INSERT INTO "PointTransaction"
  ("id", "userId", "type", "delta", "balanceBefore", "balanceAfter", "description", "idempotencyKey")
SELECT gen_random_uuid(), "id", 'ADJUSTMENT', "points", 0, "points",
       'ยอดแต้มยกมาก่อนเปิดระบบแต้มสะสม', 'opening-balance:' || "id"
  FROM "User"
 WHERE "points" > 0;
