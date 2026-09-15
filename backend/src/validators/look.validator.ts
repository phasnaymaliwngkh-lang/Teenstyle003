import { z } from 'zod';

/**
 * Validator ของ Look Ideas (STEP 7)
 * ทุกค่าที่มาจาก query string ต้องผ่านที่นี่ก่อนถึง service
 */

/** ต้องตรงกับ enum LookStyle ใน schema.prisma */
export const LOOK_STYLES = [
  'CASUAL',
  'STREET',
  'MINIMAL',
  'KOREAN',
  'VINTAGE',
  'SPORT',
  'DAILY',
  'PARTY',
] as const;

export const LOOK_SORTS = ['featured', 'newest', 'popular', 'price-asc', 'price-desc'] as const;

/** "STREET,KOREAN" → ['STREET','KOREAN'] และตรวจว่าเป็นสไตล์ที่มีจริง */
const styleCsv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim().toUpperCase())
      .filter((part) => part.length > 0),
  )
  .pipe(z.array(z.enum(LOOK_STYLES)).max(LOOK_STYLES.length));

export const lookQuerySchema = z.object({
  /** คำค้นจากชื่อหรือคำอธิบายลุค */
  q: z.string().trim().max(120).optional(),
  style: styleCsv.optional(),
  minPrice: z.coerce.number().int().min(0).max(1_000_000).optional(),
  maxPrice: z.coerce.number().int().min(0).max(1_000_000).optional(),
  /** true = เฉพาะลุคที่สินค้าทุกชิ้นยังมีของ (ซื้อครบชุดได้จริง) */
  available: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  sort: z.enum(LOOK_SORTS).default('featured'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(24).default(12),
});

export type LookQuery = z.infer<typeof lookQuerySchema>;

/* ─── STEP 8: หน้ารายละเอียดลุค ─────────────────────────────────────────────── */

export const lookSlugParamsSchema = z.object({
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    // slug มาจาก URL — จำกัดรูปแบบไว้ กันอักขระแปลกปลอม (กฎเดียวกับ product)
    .regex(/^[a-z0-9-]+$/, 'slug ต้องเป็นตัวอักษรเล็ก ตัวเลข หรือขีดกลางเท่านั้น'),
});

/**
 * ตรวจว่าซื้อ "ทั้งชุด" ได้จริงไหมก่อนเพิ่มลงตะกร้า (STEP 8)
 *
 * ⚠️ client ส่งมาแค่ variantId + จำนวน — **ราคาและสต็อกดึงจากฐานข้อมูลเท่านั้น**
 *    และ server จะตรวจด้วยว่า variant ที่ส่งมาอยู่ในลุคนี้จริง
 */
export const lookAvailabilityBodySchema = z.object({
  selections: z
    .array(
      z.object({
        variantId: z.string().uuid('variantId ต้องเป็น UUID'),
        quantity: z.coerce
          .number({ message: 'quantity ต้องเป็นตัวเลข' })
          .int('quantity ต้องเป็นจำนวนเต็ม')
          .positive('quantity ต้องมากกว่า 0')
          .max(99, 'สั่งได้ไม่เกิน 99 ชิ้นต่อรายการ')
          .default(1),
      }),
    )
    .min(1, 'ต้องเลือกสินค้าอย่างน้อย 1 ชิ้น')
    .max(20, 'ลุคหนึ่งมีสินค้าได้ไม่เกิน 20 ชิ้น'),
});

export type LookAvailabilityBody = z.infer<typeof lookAvailabilityBodySchema>;
