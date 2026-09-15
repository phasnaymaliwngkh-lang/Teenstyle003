import { z } from 'zod';

/**
 * Validator ของ Product System (STEP 6)
 * ทุกค่าที่มาจาก query string / body ต้องผ่านที่นี่ก่อนถึง service
 */

export const PRODUCT_SORTS = [
  'newest',
  'price-asc',
  'price-desc',
  'discount',
  'popular',
  'bestselling',
] as const;

/** แปลง "a,b,c" เป็น ['a','b','c'] และตัดค่าว่างออก */
const csvToArray = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.string().max(120)).max(20));

export const shopQuerySchema = z.object({
  /** คำค้น — ใช้ GIN index (pg_trgm) ที่สร้างไว้ใน STEP 2 */
  q: z.string().trim().max(120).optional(),
  /** slug ของหมวดหมู่ (รวมสินค้าในหมวดย่อยให้ด้วย) */
  category: z.string().trim().max(120).optional(),
  /** slug ของแบรนด์ — เลือกได้หลายอัน คั่นด้วย comma */
  brand: csvToArray.optional(),
  /** code ของไซซ์ เช่น S,M,L */
  size: csvToArray.optional(),
  /** slug ของสี */
  color: csvToArray.optional(),
  minPrice: z.coerce.number().int().min(0).max(1_000_000).optional(),
  maxPrice: z.coerce.number().int().min(0).max(1_000_000).optional(),
  /** true = แสดงเฉพาะสินค้าที่มีของ */
  inStock: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  /** true = แสดงเฉพาะสินค้าที่ลดราคา */
  onSale: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.enum(PRODUCT_SORTS).default('newest'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});

export type ShopQuery = z.infer<typeof shopQuerySchema>;

export const productSlugParamsSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    // slug มาจาก URL — จำกัดรูปแบบไว้ กันอักขระแปลกปลอม
    .regex(/^[a-z0-9-]+$/, 'slug ต้องเป็นตัวอักษรเล็ก ตัวเลข หรือขีดกลางเท่านั้น'),
});

/**
 * ตรวจว่าซื้อได้จริงไหมก่อนเพิ่มลงตะกร้า (STEP 6)
 *
 * ⚠️ การตรวจฝั่ง client เชื่อถือไม่ได้ — endpoint นี้คือด่านจริง
 *    STEP 9 (ตะกร้า) และ STEP 10 (checkout) จะเรียกตรรกะเดียวกันนี้ซ้ำอีกครั้ง
 */
export const availabilityBodySchema = z.object({
  variantId: z.string().uuid('variantId ต้องเป็น UUID'),
  quantity: z.coerce
    .number({ message: 'quantity ต้องเป็นตัวเลข' })
    .int('quantity ต้องเป็นจำนวนเต็ม')
    .positive('quantity ต้องมากกว่า 0')
    .max(99, 'สั่งได้ไม่เกิน 99 ชิ้นต่อครั้ง'),
});

export type AvailabilityBody = z.infer<typeof availabilityBodySchema>;
