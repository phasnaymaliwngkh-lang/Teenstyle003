import { z } from 'zod';

/** Validator ของการแจ้งเตือนสต็อก (STEP 16) */

export const stockAlertListQuerySchema = z.object({
  /** ไม่ระบุ = ทั้งหมด (ของหมด + เหลือน้อย) */
  severity: z.enum(['OUT_OF_STOCK', 'LOW_STOCK']).optional(),
});

export const stockAlertAckParamsSchema = z.object({
  notificationId: z.string().uuid('notificationId ต้องเป็น UUID'),
});

export type StockAlertListQuery = z.infer<typeof stockAlertListQuerySchema>;
