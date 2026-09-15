import type { Request, Response } from 'express';

import {
  checkAvailability,
  getProductBySlug,
  getShopFilters,
  searchProducts,
} from '../services/shop.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import {
  availabilityBodySchema,
  productSlugParamsSchema,
  shopQuerySchema,
} from '../validators/product.validator.ts';

/** GET /api/products/search — ค้นหา/กรอง/เรียง/แบ่งหน้า (STEP 6) */
export const searchProductsHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const query = shopQuerySchema.parse(req.query);
    const result = await searchProducts(query);

    sendSuccess(res, result);
  },
);

/** GET /api/products/filters — ตัวเลือกของแผงกรอง */
export const getFiltersHandler = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    const filters = await getShopFilters();

    sendSuccess(res, filters);
  },
);

/** GET /api/products/:slug — รายละเอียดสินค้า */
export const getProductHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { slug } = productSlugParamsSchema.parse(req.params);
    const product = await getProductBySlug(slug);

    sendSuccess(res, product);
  },
);

/**
 * POST /api/products/availability — ตรวจว่าซื้อได้จริงก่อนเพิ่มลงตะกร้า
 *
 * คืน 200 พร้อม purchasable: false เมื่อของหมด/ไม่พอ (เป็นคำตอบทางธุรกิจ ไม่ใช่ข้อผิดพลาด)
 * และคืน 404 เมื่อไม่พบสินค้าหรือตัวเลือกนั้นจริง ๆ
 */
export const checkAvailabilityHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { variantId, quantity } = availabilityBodySchema.parse(req.body);
    const result = await checkAvailability(variantId, quantity);

    sendSuccess(
      res,
      result,
      result.purchasable ? 'สินค้าพร้อมให้สั่งซื้อ' : 'สินค้าไม่พร้อมให้สั่งซื้อตามจำนวนที่ขอ',
    );
  },
);
