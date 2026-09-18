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
import {
  adjustStockHandler,
  getVariantInventoryHandler,
  listInventoryHandler,
  listMovementsHandler,
} from '../controllers/inventory.controller.ts';
import {
  acknowledgeStockAlertHandler,
  listStockAlertsHandler,
  scanStockAlertsHandler,
} from '../controllers/stock-alert.controller.ts';
import {
  assignBarcodeHandler,
  buildLabelsHandler,
  lookupBarcodeHandler,
} from '../controllers/barcode.controller.ts';
import {
  downloadTemplateHandler,
  exportInventoryHandler,
  exportOrdersHandler,
  exportProductsHandler,
  importInventoryHandler,
  importProductsHandler,
} from '../controllers/import-export.controller.ts';
import { adminSupportRouter } from './admin-support.route.ts';
import multer from 'multer';
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

/**
 * คลังสินค้า (STEP 15)
 * ⚠️ ลำดับสำคัญ: `/inventory/movements` ต้องมาก่อน `/inventory/:variantId`
 *    ไม่งั้น "movements" จะถูกจับเป็น variantId แล้วไม่ผ่าน validation (422)
 * แยกสิทธิ์ "ดู" กับ "ปรับ" — พนักงานดูได้ไม่ได้หมายความว่าปรับยอดได้
 */
adminRouter.get('/inventory', requirePermission('inventory:read'), listInventoryHandler);
adminRouter.get('/inventory/movements', requirePermission('inventory:read'), listMovementsHandler);
adminRouter.get(
  '/inventory/:variantId',
  requirePermission('inventory:read'),
  getVariantInventoryHandler,
);
adminRouter.post(
  '/inventory/:variantId/adjust',
  requirePermission('inventory:adjust'),
  adjustStockHandler,
);

/**
 * แจ้งเตือนสต็อก (STEP 16)
 * ดูได้ด้วย `inventory:read` · ส่วนการตรวจและรับทราบเขียนข้อมูล จึงขอ `inventory:adjust`
 */
adminRouter.get('/stock-alerts', requirePermission('inventory:read'), listStockAlertsHandler);
adminRouter.post(
  '/stock-alerts/scan',
  requirePermission('inventory:adjust'),
  scanStockAlertsHandler,
);
adminRouter.patch(
  '/stock-alerts/:notificationId/ack',
  requirePermission('inventory:adjust'),
  acknowledgeStockAlertHandler,
);

/**
 * บาร์โค้ด / QR (STEP 17)
 *
 * - `lookup` และ `labels` เป็นการ **อ่าน** ข้อมูลสินค้ามาแสดง/พิมพ์ → `product:read`
 *   ทั้งคู่เป็น GET เพราะหน้า admin เป็น Server Component ที่เรียก backend แบบ
 *   server-to-server ซึ่งไม่มี header `Origin` → `verifyOrigin` บล็อก POST แบบนั้นตอน production
 * - `assign` เขียนค่า `ProductVariant.barcode` จริง → `product:update`
 */
adminRouter.get('/barcodes/lookup', requirePermission('product:read'), lookupBarcodeHandler);
adminRouter.get('/barcodes/labels', requirePermission('product:read'), buildLabelsHandler);
adminRouter.post('/barcodes/assign', requirePermission('product:update'), assignBarcodeHandler);

/**
 * นำเข้าและส่งออกข้อมูล (STEP 18 — CSV, Excel)
 *
 * - ส่งออก (Export): ส่งออกข้อมูลสินค้า คลังสินค้า และคำสั่งซื้อ เป็น CSV / Excel
 * - นำเข้า (Import): นำเข้าสินค้าใหม่ หรือปรับปรุงสต็อกเป็นชุด (Stock Take)
 * - จำกัดขนาดไฟล์อัปโหลดไม่เกิน 5MB ป้องกัน DoS
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

// ส่งออก (Export)
adminRouter.get('/export/products', requirePermission('product:read'), exportProductsHandler);
adminRouter.get('/export/inventory', requirePermission('inventory:read'), exportInventoryHandler);
adminRouter.get('/export/orders', requirePermission('order:read'), exportOrdersHandler);
adminRouter.get(
  '/export/templates/:type',
  requirePermission('product:read'),
  downloadTemplateHandler,
);

// นำเข้า (Import)
adminRouter.post(
  '/import/products',
  requirePermission('product:create'),
  requirePermission('product:update'),
  upload.single('file'),
  importProductsHandler,
);
adminRouter.post(
  '/import/inventory',
  requirePermission('inventory:adjust'),
  upload.single('file'),
  importInventoryHandler,
);

// ฝ่ายบริการลูกค้า & Human Handoff (STEP 20)
adminRouter.use('/support', adminSupportRouter);
