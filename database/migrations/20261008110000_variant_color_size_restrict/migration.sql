/*
  STEP 48 — ลบสี/ไซซ์ที่ยังมีตัวเลือกสินค้าใช้อยู่ไม่ได้

  เดิม ON DELETE SET NULL: ลบสีทิ้งแล้วตัวเลือกที่ใช้สีนั้นกลายเป็น "ไม่มีสี" เงียบ ๆ
  (หน้าสินค้าโชว์ตัวเลือกที่ไม่มีสี · unique [productId, colorId, sizeId] ชนกันได้)
  ตอนนี้ฐานข้อมูลปฏิเสธ — service ตรวจก่อนแล้วตอบ 409 พร้อมเหตุผล นี่คือด่านสุดท้าย
*/
-- DropForeignKey
ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_colorId_fkey";

-- DropForeignKey
ALTER TABLE "ProductVariant" DROP CONSTRAINT "ProductVariant_sizeId_fkey";

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_colorId_fkey" FOREIGN KEY ("colorId") REFERENCES "Color"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductVariant" ADD CONSTRAINT "ProductVariant_sizeId_fkey" FOREIGN KEY ("sizeId") REFERENCES "Size"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
