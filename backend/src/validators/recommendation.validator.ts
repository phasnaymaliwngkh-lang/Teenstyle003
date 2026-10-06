import { z } from 'zod';

/** Validator ของการแนะนำสินค้า (STEP 46) — รับแค่จำนวน ไม่มีช่องให้ส่งสัญญาณหรือ userId มาเอง */
export const forYouQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(12).default(4),
});

export type ForYouQuery = z.infer<typeof forYouQuerySchema>;
