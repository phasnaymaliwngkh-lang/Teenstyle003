-- STEP 34 — index ที่วัดแล้วว่าช่วยจริง (ไม่ใส่ตามความรู้สึก)
--
-- วัดด้วยฐานข้อมูลแยกที่ใส่ข้อมูลปริมาณจริง (5,000 สินค้า · 20,000 ตัวเลือก · 60,000 คำสั่งซื้อ
-- · 120,000 รายการในบิล · 20,000 ผู้ใช้) แล้วเทียบ EXPLAIN ANALYZE แบบมี/ไม่มี index ทีละตัว
-- ตัวที่วัดแล้วไม่ช่วยจะไม่ถูกเพิ่ม (เช่น trigram ของ Product.name — ที่ 5,000 สินค้า
-- planner เลือก seq scan เองเพราะตารางเล็กกว่าที่ index จะคุ้ม)
--
-- ⚠️ ต้องมี extension pg_trgm ก่อนสร้าง GIN index แบบ gin_trgm_ops
--    (prisma migrate สร้างบรรทัดนี้ให้ไม่ได้ เพราะเราไม่ได้เปิด preview feature
--     postgresqlExtensions — เติมมือไว้ที่นี่ และห้ามลบออกตอน squash migration)
--    pg_trgm มาพร้อม postgresql-contrib ซึ่งติดตั้งมากับ PostgreSQL ทั้งบน Windows และ Docker
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- CreateIndex
CREATE INDEX "Order_paymentStatus_paidAt_idx" ON "Order"("paymentStatus", "paidAt");

-- CreateIndex
CREATE INDEX "Order_orderNumber_trgm_idx" ON "Order" USING GIN ("orderNumber" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "User_email_trgm_idx" ON "User" USING GIN ("email" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "User_name_trgm_idx" ON "User" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "User_phone_trgm_idx" ON "User" USING GIN ("phone" gin_trgm_ops);
