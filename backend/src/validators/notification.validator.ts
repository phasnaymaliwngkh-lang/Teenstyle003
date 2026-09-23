import { z } from 'zod';

/**
 * Validator ของการแจ้งเตือน (STEP 24)
 *
 * ⚠️ client **สร้างหรือแก้เนื้อหาการแจ้งเตือนไม่ได้เลย** — มีแค่การอ่านและทำเครื่องหมายว่าอ่านแล้ว
 *    เนื้อหาทุกบรรทัดถูกสร้างจากเหตุการณ์จริงที่ฝั่ง server (สั่งซื้อ · ชำระเงิน · จัดส่ง · ราคาลด)
 *    ถ้าเปิดให้ client สร้างได้ ใครก็ปั้นข้อความในนามร้านใส่หน้าจอตัวเองหรือคนอื่นได้
 *
 * ⚠️ ข้อความ error ใส่ที่ระดับชนิดด้วย ไม่ใช่แค่ใน `.uuid()` (บทเรียนจาก STEP 15)
 */

export const notificationParamsSchema = z.object({
  notificationId: z
    .string({ message: 'กรุณาระบุรหัสการแจ้งเตือน' })
    .uuid('รหัสการแจ้งเตือนไม่ถูกต้อง'),
});

export const notificationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  /** รับได้ทั้ง `?unreadOnly=true` และไม่ส่งมาเลย */
  unreadOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  group: z
    .enum(['ORDER', 'PRICE', 'REVIEW', 'OTHER'])
    .optional()
    .transform((value) => value ?? null),
});

export type NotificationQueryInput = z.infer<typeof notificationQuerySchema>;
