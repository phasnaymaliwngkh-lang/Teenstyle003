import { getPrisma, type Prisma } from '@teenstyle/database';

import { PRODUCT_IMAGE_LIMIT } from '../config/media.ts';
import { writeAdminLog, type AdminLogActor } from '../models/admin-log.model.ts';
import { isMediaUrl } from '../models/media.model.ts';
import { ApiError } from '../utils/api-error.ts';

import { markIfUnused, storeImage } from './media.service.ts';

/**
 * รูปสินค้าในหลังบ้าน (STEP 47) — แทน "แทนที่ทั้งชุดด้วยลิงก์" ของ STEP 14
 *
 * **กฎที่ห้ามละเมิด**
 *
 * 1. **รูปแรก = รูปหลักเสมอ** — หน้าร้าน ตะกร้า คำสั่งซื้อ ลุค และป้ายบาร์โค้ดเลือกรูปด้วย `isMain`
 *    ส่วนหน้าสินค้าเรียงด้วย `sortOrder` · ถ้าสองค่านี้ไม่ตรงกัน การ์ดกับหน้าสินค้าจะโชว์คนละรูป
 *    → "ตั้งเป็นรูปหลัก" คือการย้ายรูปขึ้นไปลำดับแรก ไม่มีปุ่มแยก
 *    (ด่านสุดท้าย: unique index `ProductImage_one_main_per_product`)
 * 2. **สินค้าที่เปิดขายอยู่ถอดรูปสุดท้ายไม่ได้** — กฎเดียวกับตอนเปิดขาย (STEP 14 ข้อ 4)
 * 3. **ล็อกแถวสินค้า (`FOR UPDATE`) ก่อนนับรูป** — สองคนอัปโหลดพร้อมกันต้องไม่เกินเพดาน
 *    และไม่ได้รูปหลักสองรูป (บทเรียน STEP 44 ข้อ 8: อ่านซ้ำในทรานแซกชันอย่างเดียวไม่กัน)
 * 4. **ถอดรูปไม่ได้ลบไฟล์** — ไฟล์อาจเป็น snapshot ของคำสั่งซื้อ ตัวล้างไฟล์ตัดสินทีหลัง
 * 5. **ทุกการเปลี่ยนเขียน AdminLog** ในทรานแซกชันเดียวกัน และนับเป็นการแก้สินค้า (`updatedAt`)
 */

export interface AdminProductImageDto {
  id: string;
  url: string;
  alt: string;
  isMain: boolean;
  sortOrder: number;
  /** true = ไฟล์ที่ร้านเก็บเอง · false = รูปจากโฮสต์ภายนอก (ข้อมูลตัวอย่าง) */
  uploaded: boolean;
}

const IMAGE_SELECT = {
  id: true,
  url: true,
  alt: true,
  isMain: true,
  sortOrder: true,
} as const satisfies Prisma.ProductImageSelect;

type ImageRow = Prisma.ProductImageGetPayload<{ select: typeof IMAGE_SELECT }>;

export function toAdminProductImage(row: ImageRow): AdminProductImageDto {
  return { ...row, uploaded: isMediaUrl(row.url) };
}

async function imagesOf(tx: Prisma.TransactionClient, productId: string): Promise<ImageRow[]> {
  return tx.productImage.findMany({
    where: { productId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: IMAGE_SELECT,
  });
}

/** ล็อกแถวสินค้าที่ยังไม่ถูกลบ — ไม่เจอ = 404 */
async function lockProduct(
  tx: Prisma.TransactionClient,
  productId: string,
): Promise<{ id: string; status: string }> {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`
    SELECT "id", "status"::text AS "status" FROM "Product"
    WHERE "id" = ${productId}::uuid AND "deletedAt" IS NULL
    FOR UPDATE
  `;

  const product = rows[0];
  if (!product) {
    throw ApiError.notFound('ไม่พบสินค้านี้');
  }

  return product;
}

/**
 * เขียนลำดับใหม่ทั้งชุด: `sortOrder` = 0..n-1 และรูปแรกเป็นรูปหลัก
 * ปลด `isMain` ทุกรูปก่อน แล้วค่อยตั้งรูปแรก — ไม่งั้นชน unique index ระหว่างทาง
 */
async function writeOrder(
  tx: Prisma.TransactionClient,
  productId: string,
  orderedIds: readonly string[],
): Promise<void> {
  await tx.productImage.updateMany({ where: { productId }, data: { isMain: false } });

  for (const [index, id] of orderedIds.entries()) {
    await tx.productImage.update({
      where: { id },
      data: { sortOrder: index, isMain: index === 0 },
    });
  }
}

/** การแก้รูปคือการแก้สินค้า — หน้า "แก้ไขล่าสุด" ของหลังบ้านต้องเห็น */
async function touchProduct(tx: Prisma.TransactionClient, productId: string): Promise<void> {
  await tx.product.update({ where: { id: productId }, data: { updatedAt: new Date() } });
}

export async function listProductImages(productId: string): Promise<AdminProductImageDto[]> {
  const prisma = getPrisma();
  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { id: true },
  });

  if (!product) {
    throw ApiError.notFound('ไม่พบสินค้านี้');
  }

  return (await imagesOf(prisma, productId)).map(toAdminProductImage);
}

function limitMessage(): string {
  return `สินค้าหนึ่งชิ้นมีรูปได้ไม่เกิน ${PRODUCT_IMAGE_LIMIT} รูป — ถอดรูปที่ไม่ใช้ออกก่อน`;
}

export async function addProductImage(
  actor: AdminLogActor & { id: string },
  productId: string,
  buffer: Buffer,
  alt: string,
): Promise<AdminProductImageDto[]> {
  const prisma = getPrisma();

  // ตรวจถูก ๆ ก่อนแปลงรูป (แปลงรูปกิน CPU) — ตัวตัดสินจริงอยู่ในทรานแซกชันที่ล็อกแถวแล้ว
  const before = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: { _count: { select: { images: true } } },
  });

  if (!before) {
    throw ApiError.notFound('ไม่พบสินค้านี้');
  }

  if (before._count.images >= PRODUCT_IMAGE_LIMIT) {
    throw ApiError.conflict(limitMessage());
  }

  return storeImage({ buffer, purpose: 'PRODUCT', uploaderId: actor.id }, async (tx, image) => {
    await lockProduct(tx, productId);
    const current = await imagesOf(tx, productId);

    if (current.length >= PRODUCT_IMAGE_LIMIT) {
      throw ApiError.conflict(limitMessage());
    }

    await tx.productImage.create({
      data: {
        productId,
        url: image.url,
        alt,
        sortOrder: current.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0),
        // รูปแรกของสินค้าเป็นรูปหลักเอง — รูปถัดไปต่อท้าย
        isMain: current.length === 0,
      },
    });

    await touchProduct(tx, productId);

    await writeAdminLog(tx, {
      actor,
      action: 'product.image.add',
      targetType: 'Product',
      targetId: productId,
      before: { imageCount: current.length, url: null, alt: null },
      after: { imageCount: current.length + 1, url: image.url, alt },
    });

    return (await imagesOf(tx, productId)).map(toAdminProductImage);
  });
}

export async function updateProductImageAlt(
  actor: AdminLogActor,
  productId: string,
  imageId: string,
  alt: string,
): Promise<AdminProductImageDto[]> {
  return getPrisma().$transaction(async (tx) => {
    await lockProduct(tx, productId);

    const image = await tx.productImage.findFirst({
      where: { id: imageId, productId },
      select: IMAGE_SELECT,
    });

    if (!image) {
      throw ApiError.notFound('ไม่พบรูปนี้ในสินค้าชิ้นนี้');
    }

    if (image.alt !== alt) {
      await tx.productImage.update({ where: { id: imageId }, data: { alt } });
      await touchProduct(tx, productId);

      await writeAdminLog(tx, {
        actor,
        action: 'product.image.update',
        targetType: 'Product',
        targetId: productId,
        before: { imageId, alt: image.alt },
        after: { imageId, alt },
      });
    }

    return (await imagesOf(tx, productId)).map(toAdminProductImage);
  });
}

/**
 * เรียงรูปใหม่ — `imageIds` ต้องเป็นรูปทั้งหมดของสินค้าตอนนี้ ไม่ขาดไม่เกินไม่ซ้ำ
 *
 * ไม่ตรง = **409** ไม่ใช่เดาเติมให้: หน้าจอของคนกดเห็นรูปไม่ครบ (มีคนเพิ่ม/ถอดรูประหว่างนั้น)
 * ถ้าเราจัดลำดับรูปที่เขาไม่เห็นให้เอง รูปหลักอาจกลายเป็นรูปที่เขาไม่ได้เลือก
 */
export async function reorderProductImages(
  actor: AdminLogActor,
  productId: string,
  imageIds: readonly string[],
): Promise<AdminProductImageDto[]> {
  return getPrisma().$transaction(async (tx) => {
    await lockProduct(tx, productId);
    const current = await imagesOf(tx, productId);

    const currentIds = new Set(current.map((row) => row.id));
    const requested = new Set(imageIds);
    const sameSet =
      requested.size === imageIds.length &&
      requested.size === currentIds.size &&
      imageIds.every((id) => currentIds.has(id));

    if (!sameSet) {
      throw ApiError.conflict(
        'รายการรูปไม่ตรงกับรูปของสินค้าตอนนี้ (อาจมีคนเพิ่มหรือถอดรูปไปแล้ว) — โหลดหน้าใหม่แล้วลองอีกครั้ง',
      );
    }

    const beforeOrder = current.map((row) => row.id);
    const changed = beforeOrder.some((id, index) => id !== imageIds[index]);

    if (changed) {
      await writeOrder(tx, productId, imageIds);
      await touchProduct(tx, productId);

      const urlOf = new Map(current.map((row) => [row.id, row.url]));
      await writeAdminLog(tx, {
        actor,
        action: 'product.image.reorder',
        targetType: 'Product',
        targetId: productId,
        before: { order: beforeOrder, mainUrl: urlOf.get(beforeOrder[0] ?? '') ?? null },
        after: { order: [...imageIds], mainUrl: urlOf.get(imageIds[0] ?? '') ?? null },
      });
    }

    return (await imagesOf(tx, productId)).map(toAdminProductImage);
  });
}

export async function removeProductImage(
  actor: AdminLogActor,
  productId: string,
  imageId: string,
): Promise<AdminProductImageDto[]> {
  return getPrisma().$transaction(async (tx) => {
    const product = await lockProduct(tx, productId);
    const current = await imagesOf(tx, productId);
    const target = current.find((row) => row.id === imageId);

    if (!target) {
      throw ApiError.notFound('ไม่พบรูปนี้ในสินค้าชิ้นนี้');
    }

    if (product.status === 'ACTIVE' && current.length === 1) {
      throw ApiError.badRequest(
        'สินค้าที่เปิดขายอยู่ต้องมีรูปอย่างน้อย 1 รูป — เพิ่มรูปอื่นก่อน หรือปิดการขายก่อนถอดรูปนี้',
      );
    }

    await tx.productImage.delete({ where: { id: imageId } });

    const remaining = current.filter((row) => row.id !== imageId).map((row) => row.id);
    // ถอดรูปหลัก = รูปถัดไปขึ้นเป็นรูปหลักเอง · เรียงเลขใหม่ไม่ให้มีช่องว่าง
    await writeOrder(tx, productId, remaining);
    await touchProduct(tx, productId);

    if (isMediaUrl(target.url)) {
      await markIfUnused(tx, [target.url]);
    }

    await writeAdminLog(tx, {
      actor,
      action: 'product.image.remove',
      targetType: 'Product',
      targetId: productId,
      before: { imageCount: current.length, url: target.url, alt: target.alt },
      after: { imageCount: remaining.length, url: null, alt: null },
    });

    return (await imagesOf(tx, productId)).map(toAdminProductImage);
  });
}
