-- ============================================================================
-- STEP 49: Store Settings
--
-- 1. Store information that customers read — and that the AI quotes as store policy —
--    moves from constants in backend/src/config/store.ts, config/payment.ts and the
--    storefront footer into one row the store edits at /admin/settings.
--    The values inserted below are exactly what the code used until now, so nothing a
--    customer sees changes with this migration — except what was never true:
--      * the footer advertised the phone number 02-000-0000, which the store does not
--        have (config/store.ts already said "no phone") → contactPhone starts as NULL
--      * the social links pointed at instagram.com / tiktok.com / facebook.com / line.me
--        themselves, not at the store's profiles → all social links start as NULL
--    NULL means "the store has no such channel" and is not shown anywhere.
--
-- 2. Each order keeps the return window that applied when it was placed. The store can
--    now shorten the window; an order placed under the old policy must not lose its
--    rights (the return check uses the longer of the order's value and the current one).
--    Existing orders were placed under the 7-day policy.
-- ============================================================================

-- AlterTable: add, backfill, then require — a plain NOT NULL column cannot be added to
-- a table that already has orders
ALTER TABLE "Order" ADD COLUMN "returnWindowDays" INTEGER;
UPDATE "Order" SET "returnWindowDays" = 7;
ALTER TABLE "Order" ALTER COLUMN "returnWindowDays" SET NOT NULL;
ALTER TABLE "Order" ADD CONSTRAINT "Order_return_window_positive" CHECK ("returnWindowDays" >= 1);

-- CreateTable
CREATE TABLE "StoreSetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "description" TEXT NOT NULL,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "instagramUrl" TEXT,
    "tiktokUrl" TEXT,
    "facebookUrl" TEXT,
    "lineUrl" TEXT,
    "agentHours" TEXT NOT NULL,
    "shippingDays" TEXT NOT NULL,
    "cutoffTime" TEXT NOT NULL,
    "returnWindowDays" INTEGER NOT NULL,
    "codMaxTotal" DECIMAL(12,2) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreSetting_pkey" PRIMARY KEY ("id"),
    -- one row only: every reader asks for id 1, a second row would be a second truth
    CONSTRAINT "StoreSetting_single_row" CHECK ("id" = 1),
    CONSTRAINT "StoreSetting_cutoff_time" CHECK ("cutoffTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
    CONSTRAINT "StoreSetting_return_window" CHECK ("returnWindowDays" BETWEEN 1 AND 90),
    CONSTRAINT "StoreSetting_cod_max_positive" CHECK ("codMaxTotal" > 0)
);

INSERT INTO "StoreSetting" (
    "id", "description", "contactEmail", "contactPhone",
    "instagramUrl", "tiktokUrl", "facebookUrl", "lineUrl",
    "agentHours", "shippingDays", "cutoffTime", "returnWindowDays", "codMaxTotal", "updatedAt"
) VALUES (
    1,
    'ร้านค้าออนไลน์แฟชั่นสำหรับวัยรุ่น เสื้อผ้าหลากหลายสไตล์ พร้อม AI Stylist ที่ช่วยแนะนำการแต่งตัว และ AI Customer Service ที่ตอบได้ตลอด 24 ชั่วโมง',
    'hello@teenstyle.ai',
    NULL,
    NULL, NULL, NULL, NULL,
    'วันจันทร์ – เสาร์ เวลา 09:00 – 18:00 น.',
    'จันทร์ – เสาร์',
    '12:00',
    7,
    5000,
    now()
);
