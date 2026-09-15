-- กฎของตะกร้าที่ฐานข้อมูลบังคับเอง (STEP 9)
--
-- เหตุผลเดียวกับ 20260913223800_add_check_constraints:
-- โค้ดอาจมีบั๊ก แต่ฐานข้อมูลต้องไม่ยอมให้ข้อมูลผิดกฎถูกบันทึกลงไปได้เลย

-- ตะกร้าต้องมีเจ้าของอย่างใดอย่างหนึ่งเท่านั้น (ผู้ใช้ที่ล็อกอิน หรือ guest token)
ALTER TABLE "Cart"
  ADD CONSTRAINT "Cart_owner_exclusive"
  CHECK (
    ("userId" IS NOT NULL AND "guestToken" IS NULL)
    OR ("userId" IS NULL AND "guestToken" IS NOT NULL)
  );

-- ตะกร้าของ guest ต้องมีวันหมดอายุ · ตะกร้าของผู้ใช้ต้องไม่มี
ALTER TABLE "Cart"
  ADD CONSTRAINT "Cart_guest_expires"
  CHECK (
    ("guestToken" IS NULL AND "expiresAt" IS NULL)
    OR ("guestToken" IS NOT NULL AND "expiresAt" IS NOT NULL)
  );

-- guest token ต้องยาวพอที่จะเดาไม่ได้
ALTER TABLE "Cart"
  ADD CONSTRAINT "Cart_guestToken_length"
  CHECK ("guestToken" IS NULL OR length("guestToken") BETWEEN 20 AND 200);

-- จำนวนในตะกร้าห้ามเป็น 0 หรือติดลบ และไม่เกิน 99 ต่อรายการ
ALTER TABLE "CartItem"
  ADD CONSTRAINT "CartItem_quantity_range"
  CHECK ("quantity" >= 1 AND "quantity" <= 99);

-- ราคาที่บันทึกไว้ตอนหยิบใส่ตะกร้าห้ามติดลบ
ALTER TABLE "CartItem"
  ADD CONSTRAINT "CartItem_addedPrice_non_negative"
  CHECK ("addedPrice" >= 0);

-- ตะกร้าของ guest ที่หมดอายุแล้วต้องหาเจอเร็ว (job ลบทิ้งใน STEP 52)
CREATE INDEX "Cart_expired_guest_idx"
  ON "Cart" ("expiresAt")
  WHERE "guestToken" IS NOT NULL;
