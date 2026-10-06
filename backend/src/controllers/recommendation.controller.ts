import type { Request, Response } from 'express';

import { recommendForProduct, recommendForUser } from '../services/recommendation.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { productSlugParamsSchema } from '../validators/product.validator.ts';
import { forYouQuerySchema } from '../validators/recommendation.validator.ts';

/**
 * GET /api/recommendations/for-you?limit= — ล็อกอินถ้ามี (STEP 46)
 *
 * ตัวตนมาจาก session เท่านั้น — ไม่มีทางขอดูคำแนะนำ (ซึ่งเผยประวัติการซื้อ/ถูกใจ) ของคนอื่น
 * ⚠️ ผลขึ้นกับว่าใครเรียก → `Cache-Control: private, no-store` ห้าม cache กลางเก็บไปตอบคนอื่น
 */
export const forYouHandler = asyncHandler(async (req: Request, res: Response) => {
  const { limit } = forYouQuerySchema.parse(req.query);

  res.set('Cache-Control', 'private, no-store');
  sendSuccess(res, await recommendForUser(req.user?.id ?? null, limit), 'ดึงคำแนะนำสำเร็จ');
});

/** GET /api/products/:slug/recommendations — ซื้อด้วยกัน · ลุคเดียวกัน · คล้ายกัน (สาธารณะ ไม่ขึ้นกับผู้เรียก) */
export const productRecommendationsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { slug } = productSlugParamsSchema.parse(req.params);

  sendSuccess(res, await recommendForProduct(slug), 'ดึงสินค้าแนะนำสำเร็จ');
});
