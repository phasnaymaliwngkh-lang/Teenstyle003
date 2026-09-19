import { z } from 'zod';

/**
 * Validator ของรายการที่ถูกใจ (STEP 22)
 *
 * ⚠️ client ส่งได้แค่ `productId` และค่าเปิด/ปิดแจ้งเตือนเท่านั้น
 *    ราคา (`priceWhenAdded`) อ่านจากฐานข้อมูลที่ฝั่ง server — ฟิลด์ราคาที่แนบมาจะถูก Zod ตัดทิ้ง
 *    (แพตเทิร์นเดียวกับ STEP 8/9/10 · มี test ยืนยัน)
 *
 * ⚠️ ข้อความ error ต้องใส่ที่ระดับชนิดด้วย ไม่ใช่แค่ใน `.uuid()`
 *    ไม่งั้นกรณี "ไม่ส่งฟิลด์มาเลย" จะหลุดข้อความดิบ `expected string, received undefined`
 *    ไปถึงหน้าจอผู้ใช้ (บทเรียนจาก STEP 15)
 */

const productIdSchema = z.string({ message: 'กรุณาระบุรหัสสินค้า' }).uuid('รหัสสินค้าไม่ถูกต้อง');

export const addWishlistItemSchema = z.object({
  productId: productIdSchema,
});

export const wishlistProductParamsSchema = z.object({
  productId: productIdSchema,
});

export const notifyPreferenceSchema = z.object({
  notifyOnPriceDrop: z.boolean({ message: 'กรุณาระบุค่า notifyOnPriceDrop (true/false)' }),
});

export const wishlistQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(60).default(24),
  sort: z.enum(['newest', 'price-drop', 'price-asc', 'price-desc']).default('newest'),
  /** รับได้ทั้ง `?onlyPriceDrop=true` และไม่ส่งมาเลย */
  onlyPriceDrop: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});

export type AddWishlistItemInput = z.infer<typeof addWishlistItemSchema>;
export type NotifyPreferenceInput = z.infer<typeof notifyPreferenceSchema>;
export type WishlistQueryInput = z.infer<typeof wishlistQuerySchema>;

/**
 * ถามว่าสินค้าชุดนี้ชิ้นไหนอยู่ในรายการที่ถูกใจบ้าง
 * รับเป็น id คั่นด้วยจุลภาคเพื่อให้หน้าเดียวถามทีเดียวได้ (เช่น การ์ดทั้งหน้า /shop ในอนาคต)
 */
export const wishlistContainsSchema = z.object({
  productIds: z
    .string({ message: 'กรุณาระบุรหัสสินค้า' })
    .transform((value) =>
      value
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(z.string().uuid('รหัสสินค้าไม่ถูกต้อง'))
        .min(1, 'กรุณาระบุรหัสสินค้าอย่างน้อยหนึ่งรายการ')
        .max(100, 'ถามได้ครั้งละไม่เกิน 100 รายการ'),
    ),
});
