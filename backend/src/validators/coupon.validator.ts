import { z } from 'zod';

import { SHIPPING_METHODS } from '../config/shipping.ts';

/**
 * ตรวจ input ของคูปอง (STEP 41)
 *
 * ⚠️ ฝั่งลูกค้าส่งได้แค่ **รหัสคูปอง** — ไม่มีฟิลด์ส่วนลดหรือยอดเงินใน schema เลย
 *    ส่งมาก็ถูก Zod ตัดทิ้ง (มีเทสต์ยืนยัน) · ตัวเลขทุกตัวคิดที่ `models/coupon.model.ts`
 *
 * ⚠️ ข้อความ error ต้องใส่ที่ระดับชนิดด้วย ไม่ใช่แค่ใน `.min()`
 *    ไม่งั้นการไม่ส่งฟิลด์มาเลยจะได้ข้อความดิบ "expected string, received undefined"
 *    หลุดไปถึงหน้าจอผู้ใช้ (บทเรียนจาก STEP 15)
 */

/** รหัสคูปองที่คนพิมพ์เอง — ตัดช่องว่างและทำเป็นตัวพิมพ์ใหญ่ให้เสมอ */
export const couponCodeSchema = z
  .string({ message: 'กรุณากรอกรหัสคูปอง' })
  .trim()
  .min(3, 'รหัสคูปองสั้นเกินไป')
  .max(40, 'รหัสคูปองยาวเกินไป')
  .regex(/^[A-Za-z0-9_-]+$/, 'รหัสคูปองใช้ได้เฉพาะตัวอักษร ตัวเลข ขีดกลาง และขีดล่าง')
  .transform((value) => value.toUpperCase());

export const applyCouponSchema = z.object({
  code: couponCodeSchema,
  /**
   * วิธีจัดส่งที่เลือกอยู่ — ใช้คิดค่าจัดส่งที่คูปองส่งฟรีจะยกเว้น
   * ⚠️ แก้ตอน STEP 44: เดิมพิมพ์รายการเองแค่ 3 วิธี (ไม่มี PICKUP) — ลูกค้าที่เลือก "รับที่ร้าน"
   *    แล้วกดใช้คูปองได้ 422 ทุกครั้ง · ใช้รายการจาก config/shipping.ts ที่เดียว
   */
  shippingMethod: z.enum(SHIPPING_METHODS).optional(),
});

const discountTypeSchema = z.enum(['PERCENTAGE', 'FIXED_AMOUNT', 'FREE_SHIPPING'], {
  message: 'ชนิดส่วนลดไม่ถูกต้อง (PERCENTAGE, FIXED_AMOUNT หรือ FREE_SHIPPING)',
});

const money = (label: string) =>
  z.coerce
    .number({ message: `${label}ต้องเป็นตัวเลข` })
    .min(0, `${label}ต้องไม่ติดลบ`)
    .max(9_999_999, `${label}สูงเกินไป`);

/**
 * ฟิลด์ร่วมของการสร้าง/แก้ไข
 *
 * ⚠️ **ห้ามใส่ `.default()` ใน schema ที่จะเอาไป `.partial()`**
 *    `.partial()` ของ Zod 4 ห่อ ZodOptional ไว้ **นอก** ZodDefault ค่า default จึงยังถูกเติม
 *    ทุกคำขอ → PATCH แค่ชื่อจะเผลอรีเซ็ตฟิลด์อื่นเงียบ ๆ (บทเรียนจาก STEP 14)
 */
const couponCore = z.object({
  code: couponCodeSchema,
  name: z.string({ message: 'กรุณากรอกชื่อคูปอง' }).trim().min(2, 'ชื่อคูปองสั้นเกินไป').max(120),
  description: z.string().trim().max(500).optional(),
  type: discountTypeSchema,
  value: money('มูลค่าส่วนลด'),
  minOrderAmount: money('ยอดขั้นต่ำ').nullable().optional(),
  maxDiscountAmount: money('ส่วนลดสูงสุด').nullable().optional(),
  usageLimit: z.coerce.number().int().min(1, 'จำนวนครั้งต้องมากกว่า 0').nullable().optional(),
  perUserLimit: z.coerce
    .number()
    .int()
    .min(1, 'จำนวนครั้งต่อคนต้องมากกว่า 0')
    .nullable()
    .optional(),
  startsAt: z
    .string({ message: 'กรุณาระบุวันเริ่มใช้' })
    .datetime({ message: 'รูปแบบวันเวลาไม่ถูกต้อง' }),
  endsAt: z
    .string({ message: 'กรุณาระบุวันหมดอายุ' })
    .datetime({ message: 'รูปแบบวันเวลาไม่ถูกต้อง' }),
  isActive: z.boolean().optional(),
  /** จำกัดเฉพาะสินค้า/หมวดที่ระบุ — ว่างทั้งคู่ = ใช้ได้กับทุกอย่าง */
  productIds: z.array(z.string().uuid()).max(200).optional(),
  categoryIds: z.array(z.string().uuid()).max(50).optional(),
});

/** กฎที่ต้องจริงทั้งตอนสร้างและตอนแก้ — เขียนที่เดียวแล้วใช้ซ้ำ */
function refineCouponShape(
  value: {
    type?: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FREE_SHIPPING';
    value?: number;
    startsAt?: string;
    endsAt?: string;
  },
  ctx: z.RefinementCtx,
): void {
  if (value.type === 'PERCENTAGE' && value.value !== undefined && value.value > 100) {
    ctx.addIssue({
      code: 'custom',
      path: ['value'],
      message: 'ส่วนลดแบบเปอร์เซ็นต์เกิน 100% ไม่ได้',
    });
  }

  /**
   * ส่วนลดเป็น 0 แปลว่าคูปองนี้ใช้แล้วไม่ได้อะไร — สร้างไว้ให้ลูกค้ากรอกแล้วผิดหวังเปล่า ๆ
   * (ยกเว้นคูปองส่งฟรีที่ไม่ใช้ค่านี้)
   */
  if (value.type !== undefined && value.type !== 'FREE_SHIPPING' && value.value === 0) {
    ctx.addIssue({ code: 'custom', path: ['value'], message: 'มูลค่าส่วนลดต้องมากกว่า 0' });
  }

  if (
    value.startsAt !== undefined &&
    value.endsAt !== undefined &&
    new Date(value.endsAt) <= new Date(value.startsAt)
  ) {
    ctx.addIssue({ code: 'custom', path: ['endsAt'], message: 'วันหมดอายุต้องหลังวันเริ่มใช้' });
  }
}

export const createCouponSchema = couponCore
  .extend({
    isActive: z.boolean().default(true),
    productIds: z.array(z.string().uuid()).max(200).default([]),
    categoryIds: z.array(z.string().uuid()).max(50).default([]),
  })
  .superRefine(refineCouponShape);

export const updateCouponSchema = couponCore
  .partial()
  .superRefine(refineCouponShape)
  .refine((value) => Object.keys(value).length > 0, { message: 'ไม่มีข้อมูลที่จะแก้ไข' });

export const adminCouponListQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ALL', 'ACTIVE', 'SCHEDULED', 'EXPIRED', 'INACTIVE']).default('ALL'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ApplyCouponInput = z.infer<typeof applyCouponSchema>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type AdminCouponListQuery = z.infer<typeof adminCouponListQuerySchema>;
