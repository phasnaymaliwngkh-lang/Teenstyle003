import { z } from 'zod';

import {
  REFUND_METHOD_CODES,
  RETURN_DETAIL_MIN_LENGTH,
  RETURN_REASON_CODES,
} from '../config/returns.ts';

import { orderNumberParamsSchema } from './order.validator.ts';

/**
 * Validator ของการคืนสินค้าและคืนเงิน (STEP 43)
 *
 * ⚠️ **client ส่งยอดเงินไม่ได้เลย** — ลูกค้าส่งได้แค่ "ชิ้นไหน กี่ชิ้น เพราะอะไร"
 *    พนักงานส่งได้แค่ "คืนด้วยวิธีไหน เลขอ้างอิงอะไร" · ยอดเงินและแต้มคิดที่ server ทั้งหมด
 *    (ฟิลด์อย่าง `amount` ที่แนบมาถูก Zod ตัดทิ้ง — มีเทสต์ยืนยัน)
 *
 * ⚠️ ข้อความ error ใส่ที่ระดับชนิดด้วย ไม่ใช่แค่ใน `.min()` (บทเรียนจาก STEP 15)
 */

const quantity = z
  .number({ message: 'จำนวนชิ้นต้องเป็นตัวเลข' })
  .int('จำนวนชิ้นต้องเป็นจำนวนเต็ม')
  .min(1, 'จำนวนชิ้นต้องมากกว่า 0')
  .max(99, 'จำนวนชิ้นมากเกินไป');

export const createReturnSchema = z
  .object({
    orderNumber: orderNumberParamsSchema.shape.orderNumber,
    reason: z.enum(RETURN_REASON_CODES, { message: 'กรุณาเลือกเหตุผลที่ขอคืน' }),
    detail: z
      .string({ message: 'กรุณาเล่ารายละเอียดของปัญหา' })
      .trim()
      .min(
        RETURN_DETAIL_MIN_LENGTH,
        `เล่ารายละเอียดอย่างน้อย ${RETURN_DETAIL_MIN_LENGTH} ตัวอักษร — ร้านต้องรู้ว่าปัญหาอยู่ตรงไหน`,
      )
      .max(1000, 'รายละเอียดยาวเกินไป (ไม่เกิน 1,000 ตัวอักษร)'),
    items: z
      .array(
        z.object({
          orderItemId: z
            .string({ message: 'ต้องระบุรายการสินค้า' })
            .uuid('รหัสรายการสินค้าไม่ถูกต้อง'),
          quantity,
        }),
        { message: 'ต้องเลือกสินค้าที่จะคืน' },
      )
      .min(1, 'เลือกสินค้าที่จะคืนอย่างน้อย 1 ชิ้น')
      .max(50),
    /** กันกดส่งซ้ำ — client สร้าง UUID ครั้งเดียวต่อการเปิดฟอร์ม */
    idempotencyKey: z
      .string({ message: 'ต้องมี idempotencyKey' })
      .uuid('idempotencyKey ต้องเป็น UUID'),
  })
  .refine(
    (value) => new Set(value.items.map((item) => item.orderItemId)).size === value.items.length,
    { message: 'มีรายการสินค้าซ้ำกัน — รวมจำนวนไว้ในรายการเดียว', path: ['items'] },
  );

export type CreateReturnInput = z.infer<typeof createReturnSchema>;

export const returnParamsSchema = z.object({
  returnId: z.string({ message: 'ต้องระบุคำขอคืน' }).uuid('รหัสคำขอคืนไม่ถูกต้อง'),
});

export const returnListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

export const RETURN_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'RECEIVED',
  'REFUNDED',
  'REJECTED',
  'CANCELLED',
] as const;

export const adminReturnQuerySchema = z.object({
  status: z.enum(RETURN_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type AdminReturnQuery = z.infer<typeof adminReturnQuerySchema>;

/** ข้อความถึงลูกค้า — ลูกค้าเห็นข้อความนี้ */
const staffNote = z.string().trim().max(500, 'ข้อความยาวเกินไป (ไม่เกิน 500 ตัวอักษร)');

export const decideReturnSchema = z
  .object({
    status: z.enum(['APPROVED', 'REJECTED'], { message: 'เลือกได้แค่อนุมัติหรือไม่รับคืน' }),
    note: staffNote.optional(),
  })
  .refine((value) => value.status !== 'REJECTED' || (value.note?.length ?? 0) >= 3, {
    // ไม่รับคืนโดยไม่บอกเหตุผล = ลูกค้าไม่รู้ว่าต้องทำอะไรต่อ (แพตเทิร์นเดียวกับรีวิวของ STEP 23 ข้อ 8)
    message: 'ไม่รับคืนต้องเขียนเหตุผลให้ลูกค้า (อย่างน้อย 3 ตัวอักษร)',
    path: ['note'],
  });

export type DecideReturnInput = z.infer<typeof decideReturnSchema>;

export const receiveReturnSchema = z.object({
  items: z
    .array(
      z.object({
        returnItemId: z.string({ message: 'ต้องระบุชิ้นที่ตรวจ' }).uuid('รหัสรายการไม่ถูกต้อง'),
        /** ขายต่อได้ → รับเข้าคลัง · ชำรุด → ไม่รับเข้าคลัง */
        restock: z.boolean({ message: 'ต้องระบุว่ารับเข้าคลังหรือไม่' }),
      }),
      { message: 'ต้องระบุผลตรวจของทุกชิ้น' },
    )
    .min(1, 'ต้องระบุผลตรวจของทุกชิ้น')
    .max(50),
  note: staffNote.optional(),
});

export type ReceiveReturnInput = z.infer<typeof receiveReturnSchema>;

export const recordRefundSchema = z.object({
  method: z.enum(REFUND_METHOD_CODES, { message: 'กรุณาเลือกวิธีคืนเงิน' }),
  /** เลขอ้างอิงของการคืนเงินจริง — re_… ของ Stripe หรือเลขที่รายการโอน */
  reference: z
    .string({ message: 'กรุณากรอกเลขอ้างอิงของการคืนเงิน เพื่อให้ตรวจย้อนหลังได้' })
    .trim()
    .min(4, 'เลขอ้างอิงสั้นเกินไป')
    .max(100, 'เลขอ้างอิงยาวเกินไป'),
  note: staffNote.optional(),
  idempotencyKey: z
    .string({ message: 'ต้องมี idempotencyKey' })
    .uuid('idempotencyKey ต้องเป็น UUID'),
});

export type RecordRefundInput = z.infer<typeof recordRefundSchema>;
