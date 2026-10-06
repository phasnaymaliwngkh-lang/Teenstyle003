import { z } from 'zod';

import { ORDER_STATUSES } from './order.validator.ts';
import {
  carrierSchema,
  estimatedDeliverySchema,
  trackingNumberSchema,
  trackingUrlSchema,
} from './shipping.validator.ts';

/**
 * Validator ของหลังบ้าน (STEP 13)
 *
 * ⚠️ สถานะที่รับได้ต้องอยู่ใน enum เท่านั้น และ **เส้นทางที่อนุญาต** ถูกตรวจอีกชั้นที่ service
 *    (`ALLOWED_TRANSITIONS`) — validator กันค่าผิดรูป ส่วน service กันตรรกะผิด
 */

export const adminOrderListQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  /** ค้นจากเลขคำสั่งซื้อ ชื่อ หรืออีเมลลูกค้า */
  q: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/** สถานะที่ร้านเปลี่ยนเองได้ — REFUNDED ทำผ่านระบบคืนเงิน (STEP 43) เท่านั้น */
const MANAGEABLE_STATUSES = [
  'PROCESSING',
  'PACKING',
  'SHIPPING',
  'DELIVERED',
  'CANCELLED',
] as const;

export const updateOrderStatusSchema = z.object({
  status: z.enum(MANAGEABLE_STATUSES, { message: 'สถานะที่เลือกไม่อยู่ในรายการที่จัดการได้' }),
  /** บังคับเมื่อเปลี่ยนเป็น SHIPPING (ตรวจที่ service) */
  carrier: carrierSchema.optional(),
  trackingNumber: trackingNumberSchema.optional(),
  /** https เท่านั้น — กฎเดียวกับหน้าแก้พัสดุ (STEP 44 · ดู shipping.validator.ts) */
  trackingUrl: trackingUrlSchema.optional(),
  estimatedDelivery: estimatedDeliverySchema.optional(),
  adminNote: z.string().trim().max(500).optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
export type AdminOrderListQuery = z.infer<typeof adminOrderListQuerySchema>;
