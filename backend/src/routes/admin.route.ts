import { Router } from 'express';

import {
  getAdminOrderHandler,
  getAdminOverview,
  listAdminOrdersHandler,
  updateOrderStatusHandler,
} from '../controllers/admin.controller.ts';
import {
  addVariantHandler,
  createProductHandler,
  deleteProductHandler,
  getAdminProductHandler,
  getProductOptionsHandler,
  listAdminProductsHandler,
  updateProductHandler,
  updateVariantHandler,
} from '../controllers/product-admin.controller.ts';
import { requireAuth } from '../middlewares/authenticate.ts';
import { requirePermission, requireStaff } from '../middlewares/authorize.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

export const adminRouter = Router();

/**
 * ทุก route ใต้ /api/admin ต้องล็อกอินและเป็นพนักงานขึ้นไป
 * แล้วแต่ละ endpoint ยังตรวจสิทธิ์เฉพาะของตัวเองอีกชั้น (defence in depth)
 * `verifyOrigin` กัน CSRF สำหรับคำขอที่เปลี่ยนข้อมูล
 */
adminRouter.use(verifyOrigin, requireAuth, requireStaff());

adminRouter.get('/overview', requirePermission('analytics:read'), getAdminOverview);

// จัดการคำสั่งซื้อ (STEP 13)
adminRouter.get('/orders', requirePermission('order:read'), listAdminOrdersHandler);
adminRouter.get('/orders/:orderNumber', requirePermission('order:read'), getAdminOrderHandler);
adminRouter.patch(
  '/orders/:orderNumber/status',
  requirePermission('order:update'),
  updateOrderStatusHandler,
);

/**
 * จัดการสินค้า (STEP 14)
 * ⚠️ ลำดับสำคัญ: `/products/options` ต้องมาก่อน `/products/:productId`
 *    ไม่งั้น "options" จะถูกจับเป็น productId แล้วไม่ผ่าน validation (422)
 */
adminRouter.get('/products', requirePermission('product:read'), listAdminProductsHandler);
adminRouter.get('/products/options', requirePermission('product:read'), getProductOptionsHandler);
adminRouter.post('/products', requirePermission('product:create'), createProductHandler);
adminRouter.get('/products/:productId', requirePermission('product:read'), getAdminProductHandler);
adminRouter.patch(
  '/products/:productId',
  requirePermission('product:update'),
  updateProductHandler,
);
adminRouter.delete(
  '/products/:productId',
  requirePermission('product:delete'),
  deleteProductHandler,
);
adminRouter.post(
  '/products/:productId/variants',
  requirePermission('product:update'),
  addVariantHandler,
);
adminRouter.patch(
  '/products/:productId/variants/:variantId',
  requirePermission('product:update'),
  updateVariantHandler,
);
