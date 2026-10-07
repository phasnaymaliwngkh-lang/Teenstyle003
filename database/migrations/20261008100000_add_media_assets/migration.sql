/*
  STEP 47 — Image Management

  - ถอด `ProductImage.publicId` — คอลัมน์ที่จองไว้ให้ Cloudinary แต่ไม่เคยมีโค้ดไหนเขียน
    (ตรวจแล้วว่าว่างทุกแถว) · รูปที่อัปโหลดผูกกับไฟล์ผ่าน url ที่ตรงกับ `MediaAsset.url`
  - ตาราง `MediaAsset` = หนึ่งแถวต่อหนึ่งไฟล์ที่ร้านเก็บเอง
  - สิทธิ์ `media:manage` มากับ migration นี้ (ไม่ต้องรอรัน seed ซ้ำตอน deploy)
*/
-- CreateEnum
CREATE TYPE "MediaPurpose" AS ENUM ('PRODUCT', 'REVIEW');

-- AlterTable
ALTER TABLE "ProductImage" DROP COLUMN "publicId";

-- CreateTable
CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "purpose" "MediaPurpose" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "originalBytes" INTEGER NOT NULL,
    "uploadedById" UUID,
    "unusedSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "MediaAsset_url_key" ON "MediaAsset"("url");

-- CreateIndex
CREATE INDEX "MediaAsset_purpose_createdAt_idx" ON "MediaAsset"("purpose", "createdAt");

-- CreateIndex
CREATE INDEX "MediaAsset_unusedSince_idx" ON "MediaAsset"("unusedSince");

-- CreateIndex
CREATE INDEX "MediaAsset_uploadedById_idx" ON "MediaAsset"("uploadedById");

-- AddForeignKey
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ด่านสุดท้ายของฐานข้อมูล: ขนาดต้องเป็นบวก และ url ต้องตรงกับที่เก็บไฟล์เสมอ
-- (ตัวล้างไฟล์เทียบด้วย url — ถ้า url กับ storageKey ไม่ตรงกัน จะลบไฟล์ผิดตัวหรือไม่เจอไฟล์)
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_dimensions_positive" CHECK ("width" > 0 AND "height" > 0 AND "bytes" > 0 AND "originalBytes" > 0);
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_url_matches_key" CHECK ("url" = '/media/' || "storageKey");

-- สิทธิ์ใหม่ของคลังรูป (ADMIN ขึ้นไป) — ถ้ายังไม่มีบทบาท (ฐานข้อมูลใหม่ที่ยังไม่รัน seed) จะไม่ผูกอะไร
-- แล้ว seed จะผูกให้เองจาก database/seed/data.ts
INSERT INTO "Permission" ("id", "key", "description", "createdAt")
VALUES (gen_random_uuid(), 'media:manage', 'ดูคลังรูปทั้งหมดและลบไฟล์รูปที่ไม่ได้ใช้แล้ว', CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

INSERT INTO "_PermissionToRole" ("A", "B")
SELECT p."id", r."id"
FROM "Permission" p
CROSS JOIN "Role" r
WHERE p."key" = 'media:manage' AND r."name" IN ('ADMIN', 'SUPER_ADMIN')
ON CONFLICT DO NOTHING;
