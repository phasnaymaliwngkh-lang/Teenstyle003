import { z } from 'zod';

import { ADJUSTMENT_MAX_POINTS } from '../config/loyalty.ts';

/**
 * Validator ของแต้มสะสม (STEP 42)
 *
 * ⚠️ **ไม่มี endpoint ใดตั้งค่า `User.points` ได้ตรง ๆ** — ลูกค้าเห็นได้อย่างเดียว
 *    ส่วนร้านปรับได้แค่ "เพิ่ม/หักเท่าไร เพราะอะไร" ซึ่งระบบบันทึกเป็นรายการในสมุดแต้ม
 *    (กฎเดียวกับคลังสินค้าของ STEP 15 ข้อ 1)
 *
 * ⚠️ ข้อความ error ใส่ที่ระดับชนิดด้วย ไม่ใช่แค่ใน `.min()` (บทเรียนจาก STEP 15)
 */

export const pointTransactionQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const adjustPointsSchema = z.object({
  /** บวก = เพิ่มแต้ม · ลบ = หักแต้ม */
  delta: z
    .number({ message: 'กรุณาระบุจำนวนแต้มเป็นตัวเลข (บวก = เพิ่ม · ลบ = หัก)' })
    .int('จำนวนแต้มต้องเป็นจำนวนเต็ม')
    .min(
      -ADJUSTMENT_MAX_POINTS,
      `ปรับได้ครั้งละไม่เกิน ${ADJUSTMENT_MAX_POINTS.toLocaleString('th-TH')} แต้ม`,
    )
    .max(
      ADJUSTMENT_MAX_POINTS,
      `ปรับได้ครั้งละไม่เกิน ${ADJUSTMENT_MAX_POINTS.toLocaleString('th-TH')} แต้ม`,
    )
    .refine((value) => value !== 0, 'จำนวนแต้มต้องไม่เป็น 0'),
  /** ลูกค้าเห็นเหตุผลนี้ในประวัติแต้มของตัวเอง — และถูกเขียนลง AdminLog */
  reason: z
    .string({ message: 'กรุณาระบุเหตุผล — ลูกค้าจะเห็นข้อความนี้ในประวัติแต้มของตัวเอง' })
    .trim()
    .min(3, 'เหตุผลสั้นเกินไป — อธิบายให้ลูกค้าและคนตรวจย้อนหลังเข้าใจได้')
    .max(200, 'เหตุผลยาวเกินไป (ไม่เกิน 200 ตัวอักษร)'),
  /** กันกดปุ่มซ้ำ — client สร้าง UUID ครั้งเดียวต่อการเปิดฟอร์ม */
  idempotencyKey: z
    .string({ message: 'ต้องมี idempotencyKey' })
    .uuid('idempotencyKey ต้องเป็น UUID'),
});

export type AdjustPointsInput = z.infer<typeof adjustPointsSchema>;

/**
 * แต้มที่ขอใช้ตอน checkout — ตรวจได้แค่ "เป็นจำนวนเต็มที่ไม่ติดลบ" ที่ชั้นนี้
 * เกณฑ์จริง (ขั้นต่ำ · ทวีคูณ · แต้มพอไหม · เพดานของบิล) อยู่ที่ models/loyalty.model.ts
 * เพราะต้องรู้ยอดในตะกร้าและแต้มคงเหลือจากฐานข้อมูลก่อน
 */
export const pointsToRedeemSchema = z.coerce
  .number({ message: 'จำนวนแต้มต้องเป็นตัวเลข' })
  .int('จำนวนแต้มต้องเป็นจำนวนเต็ม')
  .min(0, 'จำนวนแต้มติดลบไม่ได้')
  .max(10_000_000, 'จำนวนแต้มสูงเกินกว่าที่ระบบรองรับ');
