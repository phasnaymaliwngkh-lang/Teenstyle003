-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingEtaText" TEXT;

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "returnedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "ShipmentEvent" (
    "id" UUID NOT NULL,
    "shipmentId" UUID NOT NULL,
    "sequence" SERIAL NOT NULL,
    "status" "ShipmentStatus" NOT NULL,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShipmentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShippingRate" (
    "id" UUID NOT NULL,
    "method" "ShippingMethod" NOT NULL,
    "description" TEXT NOT NULL,
    "baseFee" DECIMAL(12,2) NOT NULL,
    "freeOverSubtotal" DECIMAL(12,2),
    "etaText" TEXT NOT NULL,
    "onlyProvinces" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShippingRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShipmentEvent_shipmentId_sequence_idx" ON "ShipmentEvent"("shipmentId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "ShippingRate_method_key" ON "ShippingRate"("method");

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_shipmentId_fkey" FOREIGN KEY ("shipmentId") REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ============================================================================
-- STEP 44: Shipping Management
--
-- 1. Shipping rates move from constants in backend/src/config/shipping.ts into the
--    database so the store can edit them. The rows below are the exact values the code
--    used until now, so checkout charges the same as before this migration.
--    (Method names are not stored: the meaning of the ShippingMethod enum is fixed,
--    and order history refers to it.)
-- ============================================================================

INSERT INTO "ShippingRate"
  ("id", "method", "description", "baseFee", "freeOverSubtotal", "etaText", "onlyProvinces", "isActive", "sortOrder", "updatedAt")
VALUES
  (gen_random_uuid(), 'STANDARD', 'ไปรษณีย์ไทย / Flash', 50, 1000, '2–4 วันทำการ', ARRAY[]::TEXT[], true, 1, now()),
  (gen_random_uuid(), 'EXPRESS', 'ส่งเร็วขึ้น มีเลขติดตามทุกออเดอร์', 120, NULL, '1–2 วันทำการ', ARRAY[]::TEXT[], true, 2, now()),
  (gen_random_uuid(), 'SAME_DAY', 'สั่งก่อน 12:00 ส่งถึงภายในวันเดียวกัน (เฉพาะกรุงเทพฯ และปริมณฑล)', 250, NULL, 'ภายในวันเดียวกัน',
     ARRAY['กรุงเทพมหานคร', 'นนทบุรี', 'ปทุมธานี', 'สมุทรปราการ']::TEXT[], true, 3, now()),
  (gen_random_uuid(), 'PICKUP', 'รับเองที่หน้าร้าน ไม่มีค่าจัดส่ง', 0, NULL, 'พร้อมรับภายใน 1 วันทำการ', ARRAY[]::TEXT[], true, 4, now());

ALTER TABLE "ShippingRate" ALTER COLUMN "onlyProvinces" SET NOT NULL;
ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_fee_not_negative" CHECK ("baseFee" >= 0);
ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_free_over_positive"
  CHECK ("freeOverSubtotal" IS NULL OR "freeOverSubtotal" > 0);
ALTER TABLE "ShippingRate" ADD CONSTRAINT "ShippingRate_text_not_blank"
  CHECK (btrim("description") <> '' AND btrim("etaText") <> '');

-- ============================================================================
-- 2. Order.shippingEtaText — snapshot of the delivery time promised at checkout.
--    The texts never changed before this step, so existing orders get the text that
--    was shown when they were placed.
-- ============================================================================

UPDATE "Order" SET "shippingEtaText" = CASE "shippingMethod"
  WHEN 'STANDARD' THEN '2–4 วันทำการ'
  WHEN 'EXPRESS' THEN '1–2 วันทำการ'
  WHEN 'SAME_DAY' THEN 'ภายในวันเดียวกัน'
  WHEN 'PICKUP' THEN 'พร้อมรับภายใน 1 วันทำการ'
END
WHERE "shippingEtaText" IS NULL;

-- ============================================================================
-- 3. ShipmentEvent — history for shipments created before this step, rebuilt only
--    from the timestamps that were actually recorded (nothing is guessed).
-- ============================================================================

INSERT INTO "ShipmentEvent" ("id", "shipmentId", "status", "note", "createdAt")
SELECT gen_random_uuid(), "id", 'SHIPPED', NULL, COALESCE("shippedAt", "createdAt")
  FROM "Shipment"
 ORDER BY COALESCE("shippedAt", "createdAt");

INSERT INTO "ShipmentEvent" ("id", "shipmentId", "status", "note", "createdAt")
SELECT gen_random_uuid(), "id", 'DELIVERED', NULL, "deliveredAt"
  FROM "Shipment"
 WHERE "status" = 'DELIVERED' AND "deliveredAt" IS NOT NULL
 ORDER BY "deliveredAt";

ALTER TABLE "ShipmentEvent" ADD CONSTRAINT "ShipmentEvent_note_not_blank"
  CHECK ("note" IS NULL OR btrim("note") <> '');
