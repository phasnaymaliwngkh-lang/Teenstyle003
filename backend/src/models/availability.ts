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

/*
 * ⚠️ นิพจน์ SQL ทุกตัวในไฟล์นี้ใช้ได้กับคิวรีที่ตั้ง alias ของตาราง `Product` ไว้เป็น `p` เท่านั้น
 *    (จงใจ hardcode ไม่รับ alias เป็นพารามิเตอร์ เพราะชื่อ identifier ส่งผ่าน
 *    parameter ของ Prisma ไม่ได้ ต้องต่อสตริง ซึ่งเสี่ยงเปิดช่อง SQL injection)
 */

/**
 * "สินค้านี้ยังขายได้ไหม" — ใช้ตอบคำถามแบบมี/ไม่มี (STEP 34)
 *
 * ⚠️ เดิมที่นี่มีนิพจน์เดียวคือ `sum(GREATEST(q - r, 0))` แบบ subquery ที่อ้าง `p."id"`
 *    แล้วทุกที่นำไปเทียบ `> 0` / `= 0` / `<= minimumStock` เอา
 *    ปัญหาคือ subquery แบบนั้น PostgreSQL ต้องรัน **ซ้ำทีละแถวของ Product**
 *    → ที่ 5,000 สินค้าคือ 5,000 รอบ (วัดแล้ว: 83,168 buffer hits ต่อคิวรีเดียว)
 *    ตอนนี้จึงแยกเป็นสองรูปแบบตามคำถามที่ถามจริง และไม่มีนิพจน์แบบเดิมให้ใช้อีก
 *
 * `sum(...)` ต้องอ่าน **ทุก** ตัวเลือกให้ครบก่อนจะรู้ผลรวม แต่คำถาม "ขายได้ไหม"
 * ตอบได้ทันทีที่เจอตัวเลือกแรกที่มีของ → `EXISTS` หยุดตรงนั้นเลย
 * ทั้งสองให้คำตอบเดียวกันเพราะ `GREATEST(q - r, 0)` ไม่เคยติดลบ ผลรวมจึงมากกว่า 0
 * เมื่อ **มีอย่างน้อยหนึ่งตัวเลือก** ที่ q > r เท่านั้น
 * (วัดที่ 5,000 สินค้า / 20,000 ตัวเลือก: ตัวกรอง "พร้อมส่ง" ของ /shop 92ms → 18ms)
 */
export const HAS_AVAILABLE_STOCK_SQL = Prisma.sql`EXISTS (
  SELECT 1
  FROM "ProductVariant" v
  JOIN "Inventory" i ON i."variantId" = v."id"
  WHERE v."productId" = p."id" AND v."deletedAt" IS NULL
    AND i."quantity" > i."reservedQuantity"
)`;

/**
 * ตารางสรุป "ขายได้จริงเท่าไร" ต่อสินค้า สำหรับคิวรีที่ต้องใช้ **ตัวเลข** ไม่ใช่แค่มี/ไม่มี
 * (เช่น เทียบกับจุดเตือน `p."minimumStock"` ซึ่งเป็นค่าของสินค้าแต่ละชิ้น)
 *
 * ใช้เป็น JOIN คู่กับ `AVAILABLE_STOCK_JOINED_SQL` แทนการเขียน subquery ที่อ้าง `p."id"`
 * ในตัวเอง เพราะ subquery แบบนั้น PostgreSQL รันซ้ำทีละแถวของ Product
 * (วัดที่ข้อมูลจริง: รายการ "สต็อกต่ำ" ของหลังบ้าน 105ms → 21ms)
 *
 * ⚠️ ต้องวางไว้หลัง `FROM "Product" p` และใช้ alias `stock` — ห้ามตั้ง alias ซ้ำในคิวรีเดียวกัน
 */
export const AVAILABLE_STOCK_JOIN = Prisma.sql`
  LEFT JOIN (
    SELECT v."productId" AS product_id,
           sum(GREATEST(i."quantity" - i."reservedQuantity", 0)) AS available
    FROM "ProductVariant" v
    JOIN "Inventory" i ON i."variantId" = v."id"
    WHERE v."deletedAt" IS NULL
    GROUP BY v."productId"
  ) stock ON stock.product_id = p."id"`;

/** จำนวนที่ขายได้จริงของแถวนั้น เมื่อคิวรีมี `AVAILABLE_STOCK_JOIN` อยู่แล้ว */
export const AVAILABLE_STOCK_JOINED_SQL = Prisma.sql`COALESCE(stock.available, 0)`;

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
