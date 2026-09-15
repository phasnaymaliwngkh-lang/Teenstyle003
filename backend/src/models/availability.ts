import { Prisma, type getPrisma } from '@teenstyle/database';

/**
 * "จำนวนที่ขายได้จริง" — แหล่งความจริงเดียวของระบบ (STEP 15)
 *
 * ก่อน STEP 15 มี 2 นิยามปนกันอยู่ ซึ่งเป็นหนี้ที่ค้างมาตั้งแต่ STEP 7:
 *   - `Product.totalStock` = cache ของ `SUM(Inventory.quantity)` = **ของในคลัง ยังไม่หักที่จองไว้**
 *   - `SUM(GREATEST(quantity - reservedQuantity, 0))` = ของที่ขายได้จริง
 *
 * ผลคือ `/shop` เคยโฆษณาว่า "พร้อมส่ง" ทั้งที่ของถูกจองไปหมดแล้ว
 * → ตั้งแต่ STEP 15 **ทุกที่ที่ตัดสินใจเรื่อง "ขายได้/ไม่ได้" ต้องใช้โมดูลนี้**
 *   ส่วน `totalStock` เหลือหน้าที่เดียวคือบอก "ของที่มีอยู่ในคลัง" ให้ฝั่งหลังบ้านดู
 *
 * ทำไมต้องมีทั้งนิพจน์ SQL และ Map
 *   - หน้า `/shop` กรอง/เรียงด้วย SQL อยู่แล้ว จึงต้องใช้เป็นนิพจน์ในเงื่อนไข
 *   - หน้าแรกดึงข้อมูลด้วย Prisma (type safe) จึงขอค่ามาเป็น Map แล้วแมปทีหลัง
 *   ทั้งสองทางต้องให้คำตอบเดียวกันเสมอ — มี test เทียบตรง ๆ
 */

/**
 * นิพจน์ SQL ของจำนวนที่ขายได้จริงต่อสินค้าหนึ่งแถว
 *
 * ⚠️ ใช้ได้กับคิวรีที่ตั้ง alias ของตาราง `Product` ไว้เป็น `p` เท่านั้น
 *    (จงใจ hardcode ไม่รับ alias เป็นพารามิเตอร์ เพราะชื่อ identifier ส่งผ่าน
 *    parameter ของ Prisma ไม่ได้ ต้องต่อสตริง ซึ่งเสี่ยงเปิดช่อง SQL injection)
 */
export const AVAILABLE_STOCK_SQL = Prisma.sql`COALESCE((
  SELECT sum(GREATEST(i."quantity" - i."reservedQuantity", 0))
  FROM "ProductVariant" v
  JOIN "Inventory" i ON i."variantId" = v."id"
  WHERE v."productId" = p."id" AND v."deletedAt" IS NULL
), 0)`;

/**
 * จำนวนที่ขายได้จริงของสินค้าหลายตัวในคิวรีเดียว
 *
 * นับเฉพาะ variant ที่ยังไม่ถูกลบ (variant ที่ลบแล้วขายไม่ได้ ของที่เหลือในคลัง
 * ต้องไม่ถูกนับเป็นของขายได้) · สินค้าที่ไม่มี variant เลยจะไม่มีคีย์ใน Map → อ่านเป็น 0
 */
export async function getAvailableStockByProduct(
  prisma: ReturnType<typeof getPrisma>,
  productIds: string[],
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map();

  const rows = await prisma.$queryRaw<Array<{ productId: string; available: bigint | number }>>`
    SELECT v."productId" AS "productId",
           sum(GREATEST(i."quantity" - i."reservedQuantity", 0)) AS available
    FROM "ProductVariant" v
    JOIN "Inventory" i ON i."variantId" = v."id"
    WHERE v."productId" IN (${Prisma.join(productIds)})
      AND v."deletedAt" IS NULL
    GROUP BY v."productId"
  `;

  return new Map(rows.map((row) => [row.productId, Number(row.available)]));
}

/** อ่านค่าจาก Map แบบปลอดภัย — ไม่มีข้อมูลคลัง = ขายไม่ได้ (0) ไม่ใช่ "ไม่จำกัด" */
export function availableOf(map: Map<string, number>, productId: string): number {
  return map.get(productId) ?? 0;
}
