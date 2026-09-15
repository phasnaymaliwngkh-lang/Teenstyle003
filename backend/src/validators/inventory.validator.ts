import { z } from 'zod';

/**
 * Validator ของระบบคลังสินค้า (STEP 15)
 *
 * ⚠️ **ไม่มี endpoint ใดที่ตั้งค่า `Inventory.quantity` ได้ตรง ๆ**
 *    ทุกการเปลี่ยนจำนวนต้องบอกว่า "ทำอะไร" (`type`) "เท่าไร" และ **"เพราะอะไร"** (`reason`)
 *    เพื่อให้ทุกชิ้นที่หายไปหรือเพิ่มขึ้นในคลังมีคนรับผิดชอบและตรวจย้อนหลังได้
 *
 * `ADJUSTMENT` รับ `countedQuantity` (ยอดที่นับได้จริง) ไม่ใช่ผลต่าง —
 * เพราะคนตรวจนับของนับได้เป็น "จำนวนที่เห็น" ให้ระบบคำนวณผลต่างเอง จะพลาดยากกว่า
 */

const positiveQuantity = z.coerce
  .number({ message: 'จำนวนต้องเป็นตัวเลข' })
  .int('จำนวนต้องเป็นจำนวนเต็ม')
  .min(1, 'จำนวนต้องมากกว่า 0')
  .max(100_000, 'จำนวนสูงเกินกว่าที่ระบบรองรับ');

const countedQuantity = z.coerce
  .number({ message: 'จำนวนต้องเป็นตัวเลข' })
  .int('จำนวนต้องเป็นจำนวนเต็ม')
  .min(0, 'จำนวนติดลบไม่ได้')
  .max(100_000, 'จำนวนสูงเกินกว่าที่ระบบรองรับ');

/**
 * ต้องใส่ `message` ที่ระดับ `z.string()` ด้วย ไม่ใช่แค่ใน `.min()`
 * เพราะถ้าไม่ส่งฟิลด์นี้มาเลย Zod จะรายงาน error ชนิด invalid_type
 * แล้วตอบข้อความดิบภาษาอังกฤษ ("expected string, received undefined")
 * ซึ่งแอดมินอ่านไม่รู้เรื่อง (เจอจริงตอนตรวจงาน STEP 15)
 */
const reason = z
  .string({ message: 'กรุณาระบุเหตุผล เพื่อให้ตรวจย้อนหลังได้ว่าของเข้า/ออกเพราะอะไร' })
  .trim()
  .min(3, 'เหตุผลสั้นเกินไป — อธิบายให้คนอ่านทีหลังเข้าใจได้ว่าเกิดอะไรขึ้น')
  .max(300);

/** กันกดปุ่มซ้ำ/กด 2 ครั้ง — client สร้าง UUID ครั้งเดียวต่อการเปิดฟอร์ม */
const idempotencyKey = z.string().uuid('idempotencyKey ต้องเป็น UUID').optional();

export const adjustStockSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('STOCK_IN'),
    quantity: positiveQuantity,
    reason,
    idempotencyKey,
  }),
  z.object({
    type: z.literal('STOCK_OUT'),
    quantity: positiveQuantity,
    reason,
    idempotencyKey,
  }),
  z.object({
    type: z.literal('ADJUSTMENT'),
    /** ยอดที่นับได้จริงจากการตรวจนับ — ระบบคำนวณผลต่างให้เอง */
    countedQuantity,
    reason,
    idempotencyKey,
  }),
]);

export const inventoryListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  /** คิดจากจำนวนที่ขายได้จริง (quantity − reserved) เทียบกับจุดเตือนของสินค้า */
  stockStatus: z.enum(['OUT_OF_STOCK', 'LOW_STOCK', 'IN_STOCK']).optional(),
  categorySlug: z.string().trim().max(120).optional(),
  sort: z.enum(['available-asc', 'available-desc', 'product', 'updated']).default('available-asc'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const movementListQuerySchema = z.object({
  variantId: z.string().uuid().optional(),
  productId: z.string().uuid().optional(),
  type: z.enum(['STOCK_IN', 'STOCK_OUT', 'ADJUSTMENT', 'RETURN', 'TRANSFER']).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const inventoryVariantParamsSchema = z.object({
  variantId: z.string().uuid('variantId ต้องเป็น UUID'),
});

export type AdjustStockInput = z.infer<typeof adjustStockSchema>;
export type InventoryListQuery = z.infer<typeof inventoryListQuerySchema>;
export type MovementListQuery = z.infer<typeof movementListQuerySchema>;
