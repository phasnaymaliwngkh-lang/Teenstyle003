import { z } from 'zod';

/**
 * Validator ของรีวิวสินค้า (STEP 23)
 *
 * ⚠️ client ส่งได้แค่ **ดาว หัวข้อ ข้อความ และรหัสสินค้า**
 *    `orderId` · `isVerifiedPurchase` · `status` · `helpfulCount` ตั้งที่ server ทั้งหมด
 *    ฟิลด์พวกนี้ที่แนบมากับ body จะถูก Zod ตัดทิ้ง (มี test ยืนยัน)
 *    ถ้ารับจาก client ได้ ใครก็ปั้นรีวิว "ซื้อจริง" ที่อนุมัติแล้วให้ตัวเองได้
 *
 * ⚠️ ข้อความ error ต้องใส่ที่ระดับชนิดด้วย ไม่ใช่แค่ใน `.min()`
 *    ไม่งั้นกรณี "ไม่ส่งฟิลด์มาเลย" จะหลุดข้อความดิบ `expected string, received undefined`
 *    ไปถึงหน้าจอผู้ใช้ (บทเรียนจาก STEP 15)
 */

const productIdSchema = z.string({ message: 'กรุณาระบุรหัสสินค้า' }).uuid('รหัสสินค้าไม่ถูกต้อง');
const reviewIdSchema = z.string({ message: 'กรุณาระบุรหัสรีวิว' }).uuid('รหัสรีวิวไม่ถูกต้อง');

/** 1–5 ดาว — ตรงกับ CHECK `Review_rating_range` ของฐานข้อมูล */
const ratingSchema = z
  .number({ message: 'กรุณาให้คะแนนดาว' })
  .int('คะแนนต้องเป็นจำนวนเต็ม')
  .min(1, 'ให้คะแนนอย่างน้อย 1 ดาว')
  .max(5, 'ให้คะแนนได้สูงสุด 5 ดาว');

const commentSchema = z
  .string({ message: 'กรุณาเขียนรีวิว' })
  .trim()
  .min(10, 'เขียนรีวิวอย่างน้อย 10 ตัวอักษร เพื่อให้คนอื่นได้ประโยชน์จริง')
  .max(2000, 'เขียนได้สูงสุด 2,000 ตัวอักษร');

const titleSchema = z.string().trim().max(120, 'หัวข้อยาวได้สูงสุด 120 ตัวอักษร');

export const createReviewSchema = z.object({
  productId: productIdSchema,
  rating: ratingSchema,
  title: titleSchema.optional(),
  comment: commentSchema,
});

/**
 * แก้รีวิว — ส่งเฉพาะฟิลด์ที่เปลี่ยน
 *
 * ⚠️ ไม่ใช้ `.partial()` กับ schema ที่มี `.default()` (กับดักของ Zod 4 ที่เจอตอน STEP 14)
 *    ที่นี่ประกาศ optional ตรง ๆ ทีละฟิลด์จึงไม่มีค่า default ไหนถูกเติมให้เงียบ ๆ
 *
 * `title: null` = ล้างหัวข้อทิ้ง · ไม่ส่ง `title` มาเลย = ไม่แตะของเดิม
 */
export const updateReviewSchema = z
  .object({
    rating: ratingSchema.optional(),
    title: titleSchema.nullable().optional(),
    comment: commentSchema.optional(),
  })
  .refine(
    (value) =>
      value.rating !== undefined || value.title !== undefined || value.comment !== undefined,
    { message: 'ไม่มีข้อมูลที่ต้องแก้ไข' },
  );

export const reviewParamsSchema = z.object({ reviewId: reviewIdSchema });

export const helpfulSchema = z.object({
  helpful: z.boolean({ message: 'กรุณาระบุค่า helpful (true/false)' }),
});

/** ดาวที่กรองได้บนหน้าสินค้า — ไม่ส่งมา = ดูทุกดาว */
const ratingFilterSchema = z
  .enum(['1', '2', '3', '4', '5'])
  .optional()
  .transform((value) => (value === undefined ? null : Number(value)));

export const productReviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  sort: z.enum(['newest', 'helpful', 'rating-desc', 'rating-asc']).default('newest'),
  rating: ratingFilterSchema,
});

export const myReviewsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

/** ถามสิทธิ์รีวิวของหลายสินค้าในครั้งเดียว (หน้าคำสั่งซื้อถามทีเดียวทั้งใบ) */
export const eligibilityQuerySchema = z.object({
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

export const adminReviewQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z
    .enum(['PENDING', 'APPROVED', 'HIDDEN', 'REJECTED'])
    .optional()
    .transform((value) => value ?? null),
  rating: ratingFilterSchema,
  q: z
    .string()
    .trim()
    .max(100, 'คำค้นยาวได้สูงสุด 100 ตัวอักษร')
    .optional()
    .transform((value) => (value ? value : null)),
});

/**
 * สถานะที่แอดมินตั้งได้
 *
 * ไม่มี `PENDING` โดยเจตนา — การ "ตีกลับไปรอตรวจ" ไม่ใช่การตัดสินใจ
 * ถ้ายังไม่อยากตัดสินก็ปล่อยไว้เฉย ๆ ได้อยู่แล้ว
 */
export const moderateReviewSchema = z.object({
  status: z.enum(['APPROVED', 'HIDDEN', 'REJECTED'], { message: 'กรุณาเลือกสถานะของรีวิว' }),
  adminNote: z.string().trim().max(500, 'หมายเหตุยาวได้สูงสุด 500 ตัวอักษร').nullable().optional(),
});

export type CreateReviewBody = z.infer<typeof createReviewSchema>;
export type UpdateReviewBody = z.infer<typeof updateReviewSchema>;
export type ProductReviewQueryInput = z.infer<typeof productReviewQuerySchema>;
export type AdminReviewQueryInput = z.infer<typeof adminReviewQuerySchema>;
export type ModerateReviewBody = z.infer<typeof moderateReviewSchema>;
