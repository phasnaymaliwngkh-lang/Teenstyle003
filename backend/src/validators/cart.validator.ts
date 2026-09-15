import { z } from 'zod';

/**
 * Validator ของตะกร้าสินค้า (STEP 9)
 *
 * ⚠️ รับจาก client ได้แค่ "อะไร" กับ "กี่ชิ้น" เท่านั้น
 *    ราคา ส่วนลด ค่าจัดส่ง และสต็อก คำนวณที่ server ทั้งหมด
 *    (SECURITY REQUIREMENT: ห้าม Trust Client-side Price / Stock)
 */

/** จำนวนต่อรายการ — ตรงกับ CHECK `CartItem_quantity_range` ในฐานข้อมูล */
const quantity = z.coerce
  .number({ message: 'quantity ต้องเป็นตัวเลข' })
  .int('quantity ต้องเป็นจำนวนเต็ม')
  .min(1, 'quantity ต้องมากกว่า 0')
  .max(99, 'สั่งได้ไม่เกิน 99 ชิ้นต่อรายการ');

export const addCartItemSchema = z.object({
  variantId: z.string().uuid('variantId ต้องเป็น UUID'),
  quantity: quantity.default(1),
});

export const updateCartItemSchema = z.object({
  quantity,
});

export const selectCartItemSchema = z.object({
  selected: z.boolean({ message: 'selected ต้องเป็น true หรือ false' }),
});

export const cartItemParamsSchema = z.object({
  itemId: z.string().uuid('itemId ต้องเป็น UUID'),
});

export const lookSlugParamsSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/, 'slug ต้องเป็นตัวอักษรเล็ก ตัวเลข หรือขีดกลางเท่านั้น'),
});

/** เพิ่มทั้งลุคลงตะกร้า — client ส่งได้แค่ variant ที่เลือกไว้ของแต่ละชิ้น */
export const addLookToCartSchema = z.object({
  selections: z
    .array(
      z.object({
        variantId: z.string().uuid('variantId ต้องเป็น UUID'),
        quantity: quantity.default(1),
      }),
    )
    .min(1, 'ต้องเลือกสินค้าอย่างน้อย 1 ชิ้น')
    .max(20, 'ลุคหนึ่งมีสินค้าได้ไม่เกิน 20 ชิ้น'),
});

export type AddCartItemInput = z.infer<typeof addCartItemSchema>;
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;
export type AddLookToCartInput = z.infer<typeof addLookToCartSchema>;
