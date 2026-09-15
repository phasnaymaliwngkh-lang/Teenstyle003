import type { Request, Response } from 'express';

import { listRootCategories } from '../services/catalog.service.ts';
import { listFeaturedLooks } from '../services/look.service.ts';
import { listProducts } from '../services/product.service.ts';
import { lookListQuerySchema, productListQuerySchema } from '../validators/catalog.validator.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';

/**
 * Endpoint ของหน้าร้าน (STEP 5) — เปิดให้เข้าถึงได้โดยไม่ต้องล็อกอิน
 * แต่ยังผ่าน rate limit และ validate input ทุกครั้ง
 */

/** GET /api/products?sort=newest|discount|bestselling|popular&limit=8 */
export const getProducts = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  // parse จะ throw ZodError ถ้าค่าผิด → errorHandler แปลงเป็น 422 พร้อมบอก field
  const { sort, limit } = productListQuerySchema.parse(req.query);

  const result = await listProducts(sort, limit);

  sendSuccess(res, result);
});

/** GET /api/categories — หมวดหมู่ระดับบนสุดพร้อมจำนวนสินค้า */
export const getCategories = asyncHandler(async (_req: Request, res: Response): Promise<void> => {
  const categories = await listRootCategories();

  sendSuccess(res, { items: categories, total: categories.length });
});

/** GET /api/looks?limit=4 — Look แนะนำ */
export const getLooks = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const { limit } = lookListQuerySchema.parse(req.query);

  const looks = await listFeaturedLooks(limit);

  sendSuccess(res, { items: looks, total: looks.length });
});
