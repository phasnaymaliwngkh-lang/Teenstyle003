-- ============================================================================
-- STEP 43: Return / Refund
--
-- 1. ReturnRequest + ReturnItem — a customer asks to return items from a delivered
--    order (only for the shop's fault: defective / wrong item, inside the window).
-- 2. Refund — an append-only record that the shop HAS paid money back, with the
--    method and the reference of the real transfer. The system does not move money
--    itself: the Stripe Refund API is not wired because there is no Stripe account
--    to verify it against (same rule as Redis in STEP 34: no untestable adapters).
-- 3. "Order"."refundedTotal" — cache of SUM(Refund.amount), written in the same
--    transaction. "Money the shop actually kept" = total − refundedTotal, which the
--    dashboard, reports, customer stats and loyalty tiers all use.
-- ============================================================================


-- CreateEnum
CREATE TYPE "ReturnStatus" AS ENUM ('REQUESTED', 'APPROVED', 'RECEIVED', 'REFUNDED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReturnReason" AS ENUM ('DEFECTIVE', 'WRONG_ITEM');

-- CreateEnum
CREATE TYPE "RefundMethod" AS ENUM ('STRIPE_DASHBOARD', 'BANK_TRANSFER');

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'RETURN_UPDATE';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "refundedTotal" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ReturnRequest" (
    "id" UUID NOT NULL,
    "returnNumber" TEXT NOT NULL,
    "orderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "ReturnStatus" NOT NULL DEFAULT 'REQUESTED',
    "reason" "ReturnReason" NOT NULL,
    "detail" TEXT NOT NULL,
    "staffNote" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReturnRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReturnItem" (
    "id" UUID NOT NULL,
    "returnRequestId" UUID NOT NULL,
    "orderItemId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "restocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReturnItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "returnRequestId" UUID,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "RefundMethod" NOT NULL,
    "reference" TEXT NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_returnNumber_key" ON "ReturnRequest"("returnNumber");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnRequest_idempotencyKey_key" ON "ReturnRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ReturnRequest_userId_createdAt_idx" ON "ReturnRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnRequest_orderId_idx" ON "ReturnRequest"("orderId");

-- CreateIndex
CREATE INDEX "ReturnRequest_status_createdAt_idx" ON "ReturnRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "ReturnItem_orderItemId_idx" ON "ReturnItem"("orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "ReturnItem_returnRequestId_orderItemId_key" ON "ReturnItem"("returnRequestId", "orderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_returnRequestId_key" ON "Refund"("returnRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_idempotencyKey_key" ON "Refund"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Refund_orderId_idx" ON "Refund"("orderId");

-- CreateIndex
CREATE INDEX "Refund_createdAt_idx" ON "Refund"("createdAt");

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnRequest" ADD CONSTRAINT "ReturnRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReturnItem" ADD CONSTRAINT "ReturnItem_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "OrderItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_returnRequestId_fkey" FOREIGN KEY ("returnRequestId") REFERENCES "ReturnRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ─── Integrity (Prisma cannot express these) ───────────────────────────────

-- one order can have only one return in progress at a time — two requests created
-- together could otherwise ask for the same pieces twice
CREATE UNIQUE INDEX "ReturnRequest_one_open_per_order"
  ON "ReturnRequest" ("orderId")
  WHERE "status" IN ('REQUESTED', 'APPROVED', 'RECEIVED');

ALTER TABLE "ReturnRequest"
  ADD CONSTRAINT "ReturnRequest_detail_not_blank"
  CHECK (length(btrim("detail")) > 0);

ALTER TABLE "ReturnItem"
  ADD CONSTRAINT "ReturnItem_quantity_positive"
  CHECK ("quantity" > 0);

ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_amount_positive"
  CHECK ("amount" > 0);

-- a refund without a traceable reference cannot be audited later
ALTER TABLE "Refund"
  ADD CONSTRAINT "Refund_reference_not_blank"
  CHECK (length(btrim("reference")) > 0);

-- the shop can never give back more than the customer paid
ALTER TABLE "Order"
  ADD CONSTRAINT "Order_refunded_valid"
  CHECK ("refundedTotal" >= 0 AND "refundedTotal" <= "total");
