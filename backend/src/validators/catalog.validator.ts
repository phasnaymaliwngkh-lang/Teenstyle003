import { z } from 'zod';

/**
 * ตรวจ query string ของ endpoint หน้าร้าน (UNIVERSAL RULE #10: ทุก API ต้อง validate input)
 *
 * จำกัด `limit` ไม่ให้ใหญ่เกินไป เพื่อกันคนยิง ?limit=999999 แล้วดึงฐานข้อมูลทั้งก้อน
 * error ที่เกิดขึ้นจะถูก errorHandler แปลงเป็น HTTP 422 + errorCode VALIDATION_ERROR ให้เอง
 */

export const productListQuerySchema = z.object({
  sort: z.enum(['newest', 'discount', 'bestselling', 'popular']).default('newest'),
  limit: z.coerce.number().int().min(1).max(48).default(8),
});

export type ProductListQuery = z.infer<typeof productListQuerySchema>;

export const lookListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(24).default(4),
});

export type LookListQuery = z.infer<typeof lookListQuerySchema>;
