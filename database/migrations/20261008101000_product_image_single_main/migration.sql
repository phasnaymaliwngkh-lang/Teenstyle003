/*
  STEP 47 — สินค้าหนึ่งชิ้นมีรูปหลักได้รูปเดียว

  หน้าร้าน ตะกร้า คำสั่งซื้อ ลุค และป้ายบาร์โค้ด เลือกรูปด้วย `isMain = true` (take 1)
  ถ้ามีรูปหลักสองรูป แต่ละที่จะหยิบคนละรูปได้ · ถ้าไม่มีเลย การ์ดสินค้าจะไม่มีรูป
  กฎ "รูปแรก = รูปหลัก" อยู่ที่ product-image.service.ts · index นี้คือด่านสุดท้ายของฐานข้อมูล
  (ตรวจข้อมูลก่อนสร้างแล้ว: ทุกสินค้ามีรูปหลัก 1 รูปและอยู่ลำดับแรก)

  ⚠️ partial index ประกาศใน schema.prisma ไม่ได้ — Prisma ไม่แตะ index แบบนี้ตอน diff
     (เหมือน "ReturnRequest_one_open_per_order" ของ STEP 43)
*/
CREATE UNIQUE INDEX "ProductImage_one_main_per_product" ON "ProductImage"("productId") WHERE "isMain";
