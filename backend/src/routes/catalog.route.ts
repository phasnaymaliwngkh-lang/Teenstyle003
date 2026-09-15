import { Router } from 'express';

import { getCategories, getLooks, getProducts } from '../controllers/catalog.controller.ts';
import {
  checkLookAvailabilityHandler,
  getLookFiltersHandler,
  getLookHandler,
  searchLooksHandler,
} from '../controllers/look.controller.ts';
import {
  checkAvailabilityHandler,
  getFiltersHandler,
  getProductHandler,
  searchProductsHandler,
} from '../controllers/shop.controller.ts';

/**
 * Route ของหน้าร้าน (STEP 5–7)
 * ไม่ต้องล็อกอิน — ใครก็ดูสินค้าได้ แต่ยังผ่าน globalRateLimiter ใน app.ts
 */

export const productRouter = Router();

/**
 * ⚠️ ลำดับสำคัญ: path คงที่ต้องมาก่อน `/:slug`
 * ไม่งั้น "search" และ "filters" จะถูกจับเป็น slug ของสินค้า
 */
productRouter.get('/', getProducts); // หน้าแรก: sort=newest|discount|bestselling|popular
productRouter.get('/search', searchProductsHandler); // /shop: กรอง + แบ่งหน้า
productRouter.get('/filters', getFiltersHandler);
productRouter.post('/availability', checkAvailabilityHandler);
productRouter.get('/:slug', getProductHandler);

export const categoryRouter = Router();
categoryRouter.get('/', getCategories);

export const lookRouter = Router();

// ⚠️ path คงที่ต้องมาก่อน `/:slug` ไม่งั้น "search" / "filters" จะถูกจับเป็น slug ของลุค
lookRouter.get('/', getLooks); // หน้าแรก: ลุคแนะนำ
lookRouter.get('/search', searchLooksHandler); // /looks: กรอง + แบ่งหน้า
lookRouter.get('/filters', getLookFiltersHandler);
lookRouter.post('/:slug/availability', checkLookAvailabilityHandler); // ตรวจสต็อกทั้งชุด (STEP 8)
lookRouter.get('/:slug', getLookHandler); // /looks/[slug]
