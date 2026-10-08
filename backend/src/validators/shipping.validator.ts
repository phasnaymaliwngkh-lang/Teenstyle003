import { z } from 'zod';

import { SHIPPING_METHODS } from '../config/shipping.ts';
import { THAI_PROVINCES } from '../models/shipping.model.ts';

/**
 * Validator ของการจัดส่ง (STEP 44)
 *
 * ⚠️ PATCH ทุกตัวไม่มี `.default()` — ไม่ส่งฟิลด์ไหนมา = ไม่แก้ฟิลด์นั้น (บทเรียน Zod 4 ของ STEP 14)
 */

/* ───────────────────────── ข้อมูลพัสดุที่ใช้ร่วมกัน ───────────────────────── */

export const carrierSchema = z
  .string({ message: 'กรุณาระบุผู้ให้บริการขนส่ง' })
  .trim()
  .min(2, 'กรุณาระบุผู้ให้บริการขนส่ง')
  .max(80);

export const trackingNumberSchema = z
  .string({ message: 'กรุณาระบุเลขพัสดุ' })
  .trim()
  .min(4, 'เลขพัสดุสั้นเกินไป')
  .max(60)
  .regex(/^[A-Za-z0-9-]+$/, 'เลขพัสดุใช้ได้เฉพาะตัวอักษร ตัวเลข และขีดกลาง');

/**
 * ลิงก์ติดตามพัสดุ — **https เท่านั้น**
 * ลิงก์นี้ถูกแสดงเป็นปุ่มในหน้าคำสั่งซื้อของลูกค้า `z.url()` เปล่า ๆ ยอม `javascript:` และ `http:`
 * ซึ่งพาลูกค้าไปรันสคริปต์หรือไปหน้าที่ถูกดักกลางทางได้ (เพิ่มตอน STEP 44)
 */
export const trackingUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    try {
      return new URL(value).protocol === 'https:';
    } catch {
      return false;
    }
  }, 'ลิงก์ติดตามต้องเป็นลิงก์ https:// ที่ถูกต้อง');

export const estimatedDeliverySchema = z.string().datetime({ message: 'รูปแบบวันเวลาไม่ถูกต้อง' });

/* ───────────────────────── อัตราค่าจัดส่ง ───────────────────────── */

export const shippingMethodParamsSchema = z.object({
  method: z.enum(SHIPPING_METHODS, { message: 'ไม่รู้จักวิธีจัดส่งนี้' }),
});

/** จำนวนเงิน ≤ 2 ตำแหน่ง — ค่าส่งเป็นเงินที่เก็บจริง จึงไม่ยอมทศนิยมที่เก็บลงคอลัมน์ไม่ได้ */
const baht = (label: string, max: number) =>
  z
    .number({ message: `${label}ต้องเป็นตัวเลข` })
    .min(0, `${label}ต้องไม่ติดลบ`)
    .max(max, `${label}สูงเกินไป`)
    // เทียบในหน่วยสตางค์ — 0.1 + 0.2 ของ JS ไม่ได้ 0.3 พอดี (บทเรียน STEP 42)
    .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-6, {
      message: `${label}มีทศนิยมได้ไม่เกิน 2 ตำแหน่ง`,
    });

/**
 * ⚠️ คำอธิบายห้ามมีจำนวนเงิน — ค่าส่งและยอดส่งฟรีแสดงจากช่องของมันเองแล้ว
 *    ตัวเลขที่พิมพ์ลงคำอธิบายจะค้างค่าเก่าทันทีที่แก้ค่าส่ง แล้วไปโผล่ในบทความที่ AI ใช้ตอบลูกค้า
 *    (เดิมคำอธิบายของ "ส่งธรรมดา" มี "ส่งฟรีเมื่อซื้อครบ 1,000 บาท" ฝังอยู่ — ถอดออกตอน STEP 44)
 */
export const MONEY_IN_TEXT = /\d[\d,.]*\s*(บาท|฿)|฿\s*\d/;

export const updateShippingRateSchema = z
  .object({
    description: z
      .string({ message: 'กรุณากรอกคำอธิบาย' })
      .trim()
      .min(3, 'คำอธิบายสั้นเกินไป')
      .max(200, 'คำอธิบายยาวเกินไป')
      .refine((value) => !MONEY_IN_TEXT.test(value), {
        message: 'คำอธิบายห้ามมีจำนวนเงิน — ใส่ค่าส่งและยอดส่งฟรีในช่องของมันเอง',
      })
      .optional(),
    baseFee: baht('ค่าส่ง', 10_000).optional(),
    /** null = ยกเลิกโปรส่งฟรีของวิธีนี้ */
    freeOverSubtotal: baht('ยอดส่งฟรี', 1_000_000)
      .refine((value) => value > 0, 'ยอดส่งฟรีต้องมากกว่า 0 — ถ้าไม่มีโปรให้ล้างค่า')
      .nullable()
      .optional(),
    etaText: z
      .string({ message: 'กรุณากรอกระยะเวลาจัดส่ง' })
      .trim()
      .min(2, 'กรุณากรอกระยะเวลาจัดส่ง')
      .max(60, 'ระยะเวลาจัดส่งยาวเกินไป')
      .optional(),
    /** ว่าง = ทั่วประเทศ · รับเฉพาะชื่อจังหวัดตามรายการ (การเทียบเป็นการเทียบข้อความตรงตัว) */
    onlyProvinces: z
      .array(
        z
          .string()
          .trim()
          .refine((value) => THAI_PROVINCES.includes(value), {
            message: 'ชื่อจังหวัดไม่ตรงกับรายชื่อจังหวัด — เลือกจากรายการ',
          }),
      )
      .max(THAI_PROVINCES.length)
      .refine((value) => new Set(value).size === value.length, 'มีจังหวัดซ้ำในรายการ')
      .optional(),
    isActive: z.boolean({ message: 'สถานะเปิดใช้ต้องเป็นจริงหรือเท็จ' }).optional(),
  })
  .refine((value) => Object.values(value).some((field) => field !== undefined), {
    message: 'ไม่มีข้อมูลที่จะแก้',
  });

export type UpdateShippingRateInput = z.infer<typeof updateShippingRateSchema>;

/* ───────────────────────── พัสดุ ───────────────────────── */

export const SHIPMENT_STATUS_FILTERS = [
  'SHIPPED',
  'IN_TRANSIT',
  'FAILED',
  'RETURNED',
  'DELIVERED',
] as const;

export const adminShipmentQuerySchema = z.object({
  status: z.enum(SHIPMENT_STATUS_FILTERS).optional(),
  /** เฉพาะพัสดุที่เลยกำหนดส่งที่ร้านกรอกไว้แล้วยังไม่ถึง */
  overdue: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  /** ค้นจากเลขพัสดุ เลขคำสั่งซื้อ หรือชื่อขนส่ง */
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type AdminShipmentQuery = z.infer<typeof adminShipmentQuerySchema>;

export const shipmentParamsSchema = z.object({
  shipmentId: z.string().uuid('รหัสพัสดุไม่ถูกต้อง'),
});

const customerNote = z
  .string({ message: 'กรุณาเขียนข้อความถึงลูกค้า' })
  .trim()
  .min(3, 'ข้อความถึงลูกค้าสั้นเกินไป')
  .max(300, 'ข้อความถึงลูกค้ายาวเกินไป');

/** เปลี่ยนสถานะพัสดุ — "ส่งถึงแล้ว" ทำที่สถานะคำสั่งซื้อ (ดู SHIPMENT_TRANSITIONS) */
export const updateShipmentStatusSchema = z
  .object({
    status: z.enum(['IN_TRANSIT', 'FAILED', 'RETURNED'], {
      message: 'เลือกได้แค่ อยู่ระหว่างขนส่ง · ส่งไม่สำเร็จ · ตีกลับถึงร้าน',
    }),
    /** บังคับเมื่อส่งไม่สำเร็จ/ตีกลับ — ลูกค้าต้องรู้ว่าเกิดอะไรกับพัสดุของเขา */
    note: customerNote.optional(),
  })
  .refine((value) => value.status === 'IN_TRANSIT' || value.note !== undefined, {
    message: 'ส่งไม่สำเร็จหรือตีกลับต้องเขียนเหตุผลให้ลูกค้าอ่าน',
    path: ['note'],
  });

export type UpdateShipmentStatusInput = z.infer<typeof updateShipmentStatusSchema>;

/** แก้ข้อมูลพัสดุที่กรอกผิด — ต้องมีเหตุผล (เลขพัสดุคือสิ่งที่ลูกค้าใช้ตามของ) */
export const updateShipmentSchema = z
  .object({
    carrier: carrierSchema.optional(),
    trackingNumber: trackingNumberSchema.optional(),
    /** null = ล้างลิงก์ */
    trackingUrl: trackingUrlSchema.nullable().optional(),
    /** null = ล้างกำหนดส่ง */
    estimatedDelivery: estimatedDeliverySchema.nullable().optional(),
    reason: z
      .string({ message: 'กรุณาระบุเหตุผลที่แก้' })
      .trim()
      .min(3, 'เหตุผลสั้นเกินไป')
      .max(300),
  })
  .refine(
    (value) =>
      value.carrier !== undefined ||
      value.trackingNumber !== undefined ||
      value.trackingUrl !== undefined ||
      value.estimatedDelivery !== undefined,
    { message: 'ไม่มีข้อมูลที่จะแก้' },
  );

export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>;

/** ส่งพัสดุชิ้นใหม่หลังถูกตีกลับ */
export const createShipmentSchema = z.object({
  carrier: carrierSchema,
  trackingNumber: trackingNumberSchema,
  trackingUrl: trackingUrlSchema.optional(),
  estimatedDelivery: estimatedDeliverySchema.optional(),
});

export type CreateShipmentInput = z.infer<typeof createShipmentSchema>;
