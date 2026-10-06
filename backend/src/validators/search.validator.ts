import { z } from 'zod';

import { PRODUCT_SORTS } from './product.validator.ts';

/**
 * Validator ของการค้นหา (STEP 45)
 *
 * ทุกเส้นทางเป็น GET สาธารณะ — คำค้นผ่านตัวตีความที่ใช้คำศัพท์ของร้านเท่านั้น ไม่มีช่องให้ส่งตัวกรองดิบมาเอง
 * (ตัวกรองละเอียดใช้หน้า /shop ซึ่งรับ query ของมันเองอยู่แล้ว)
 */

const query = z
  .string({ message: 'กรุณาพิมพ์คำที่ต้องการค้นหา' })
  .trim()
  .min(1, 'กรุณาพิมพ์คำที่ต้องการค้นหา');

export const searchQuerySchema = z.object({
  q: query.max(120, 'คำค้นยาวเกินไป (ไม่เกิน 120 ตัวอักษร)'),
  /** true = ค้นตามตัวอักษรที่พิมพ์ ไม่ตีความสี/ไซซ์/ราคา */
  literal: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default(false),
  sort: z.enum(PRODUCT_SORTS).default('relevance'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const suggestQuerySchema = z.object({
  q: query.max(60, 'คำค้นยาวเกินไป'),
});

export type SuggestQuery = z.infer<typeof suggestQuerySchema>;
