import { z } from 'zod';

/** Validator ของการแจ้งเตือนสต็อก (STEP 16) */

export const stockAlertListQuerySchema = z.object({
  /** ไม่ระบุ = ทั้งหมด (ของหมด + เหลือน้อย) */
  severity: z.enum(['OUT_OF_STOCK', 'LOW_STOCK']).optional(),
  /**
   * จำนวนรายการสูงสุดที่ส่งกลับ (STEP 34)
   *
   * เดิมส่งทุกแถวที่ตกเกณฑ์ ซึ่งวัดแล้วได้ **1.1 MB ต่อคำขอ** ที่แคตตาล็อก 5,000 สินค้า
   * (3,659 ตัวเลือกตกเกณฑ์) ทั้งที่คนอ่านดูได้ไม่กี่สิบรายการ
   * ตัวเลขสรุปยังนับจากทั้งชุดเหมือนเดิม — จำกัดแค่ "รายการที่ส่งไปแสดง"
   */
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

export const stockAlertAckParamsSchema = z.object({
  notificationId: z.string().uuid('notificationId ต้องเป็น UUID'),
});

export type StockAlertListQuery = z.infer<typeof stockAlertListQuerySchema>;
