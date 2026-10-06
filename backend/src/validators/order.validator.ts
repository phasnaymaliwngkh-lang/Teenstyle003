import { z } from 'zod';

import { couponCodeSchema } from './coupon.validator.ts';
import { pointsToRedeemSchema } from './loyalty.validator.ts';

import { SHIPPING_METHODS } from '../config/shipping.ts';

/**
 * Validator ของการสั่งซื้อ (STEP 10)
 *
 * ⚠️ รับจาก client ได้แค่ "ส่งที่ไหน" + "ส่งแบบไหน" + "ข้อความถึงร้าน"
 *    **ห้ามรับราคา ยอดรวม ค่าจัดส่ง หรือรายการสินค้า** จาก client เด็ดขาด
 *    ทั้งหมดอ่านจากตะกร้าและฐานข้อมูลที่ server (SECURITY REQUIREMENT)
 */

const phone = z
  .string()
  .trim()
  .min(9, 'เบอร์โทรสั้นเกินไป')
  .max(20, 'เบอร์โทรยาวเกินไป')
  .regex(/^[0-9+\-\s()]+$/, 'เบอร์โทรมีอักขระที่ไม่ถูกต้อง');

/** ที่อยู่ใหม่ที่กรอกในหน้า checkout */
export const newAddressSchema = z.object({
  label: z.string().trim().max(60).optional(),
  recipientName: z.string().trim().min(2, 'กรุณากรอกชื่อผู้รับ').max(120),
  phone,
  line1: z.string().trim().min(5, 'กรุณากรอกที่อยู่').max(200),
  line2: z.string().trim().max(200).optional(),
  subDistrict: z.string().trim().min(2, 'กรุณากรอกแขวง/ตำบล').max(120),
  district: z.string().trim().min(2, 'กรุณากรอกเขต/อำเภอ').max(120),
  province: z.string().trim().min(2, 'กรุณากรอกจังหวัด').max(120),
  postalCode: z
    .string()
    .trim()
    .regex(/^\d{5}$/, 'รหัสไปรษณีย์ต้องเป็นเลข 5 หลัก'),
  /** บันทึกที่อยู่นี้ไว้ใช้ครั้งต่อไป */
  saveForLater: z.boolean().default(true),
});

export const createOrderSchema = z
  .object({
    /** ที่อยู่ที่บันทึกไว้แล้ว */
    addressId: z.string().uuid('addressId ต้องเป็น UUID').optional(),
    /** หรือที่อยู่ใหม่ */
    newAddress: newAddressSchema.optional(),
    shippingMethod: z.enum(SHIPPING_METHODS),
    customerNote: z.string().trim().max(500, 'ข้อความถึงร้านยาวเกินไป').optional(),
    /**
     * กันสร้างคำสั่งซื้อซ้ำ (กดปุ่มสองครั้ง / เน็ตหลุดแล้ว retry)
     * client สร้าง UUID หนึ่งค่าต่อการ checkout หนึ่งครั้ง แล้วใช้ค่าเดิมทุกครั้งที่ลองใหม่
     */
    idempotencyKey: z.string().uuid('idempotencyKey ต้องเป็น UUID'),
    /**
     * รหัสคูปอง (STEP 41) — client ส่งได้แค่ **รหัส** เท่านั้น
     * ยอดส่วนลดคิดที่ server ใหม่ทุกครั้งตอนสร้างออเดอร์ ห้ามเชื่อยอดจาก client
     */
    couponCode: couponCodeSchema.optional(),
    /**
     * แต้มที่จะใช้เป็นส่วนลด (STEP 42) — client ส่งได้แค่ **จำนวนแต้ม**
     * มูลค่าเป็นบาท · แต้มคงเหลือ · เพดานของบิล คิดที่ server จากฐานข้อมูลทั้งหมด
     */
    pointsToRedeem: pointsToRedeemSchema.optional(),
    /**
     * ยอดรวมที่หน้าเว็บ **แสดงอยู่** ตอนกดยืนยัน (STEP 44) — ใช้ **เทียบ** อย่างเดียว ไม่ใช้คิดเงิน
     * ไม่ตรงกับที่ server คิดได้ (ค่าส่ง/ราคา/ส่วนลดเพิ่งเปลี่ยน) → 409 ไม่เก็บยอดใหม่เงียบ ๆ
     * ไม่บังคับ เพื่อให้ผู้เรียกเดิมยังใช้ได้ — หน้า checkout ส่งมาเสมอ
     */
    expectedTotal: z.number({ message: 'ยอดรวมต้องเป็นตัวเลข' }).min(0).max(100_000_000).optional(),
  })
  .refine((value) => value.addressId !== undefined || value.newAddress !== undefined, {
    message: 'ต้องเลือกที่อยู่จัดส่ง หรือกรอกที่อยู่ใหม่',
    path: ['addressId'],
  });

export const checkoutSummaryQuerySchema = z.object({
  /** ดูค่าจัดส่งของวิธีที่เลือกไว้ (ไม่ส่งมา = คิดจาก STANDARD) */
  shippingMethod: z.enum(SHIPPING_METHODS).default('STANDARD'),
  /** ดูยอดหลังใช้คูปองนี้ (STEP 41) — ไม่ส่งมา = ไม่คิดส่วนลด */
  couponCode: couponCodeSchema.optional(),
  /** ดูยอดหลังใช้แต้มจำนวนนี้ (STEP 42) — ไม่ส่งมา = ไม่ใช้แต้ม */
  pointsToRedeem: pointsToRedeemSchema.optional(),
});

/** สถานะคำสั่งซื้อ — ต้องตรงกับ enum OrderStatus ใน schema.prisma */
export const ORDER_STATUSES = [
  'PENDING_PAYMENT',
  'PAID',
  'PROCESSING',
  'PACKING',
  'SHIPPING',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
] as const;

/** query ของหน้าประวัติคำสั่งซื้อ (STEP 12) */
export const orderListQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const orderNumberParamsSchema = z.object({
  orderNumber: z
    .string()
    .trim()
    .regex(/^TS-\d{8}-\d{4}$/, 'รูปแบบเลขคำสั่งซื้อไม่ถูกต้อง'),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
export type NewAddressInput = z.infer<typeof newAddressSchema>;
