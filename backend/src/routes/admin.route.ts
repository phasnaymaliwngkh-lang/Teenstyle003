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
import {
  listAdminReviewsHandler,
  moderateReviewHandler,
} from '../controllers/review-admin.controller.ts';
import {
  getAdminCustomerHandler,
  listAdminCustomersHandler,
  updateCustomerRoleHandler,
  updateCustomerStatusHandler,
} from '../controllers/admin-customer.controller.ts';
import {
  customerRankingHandler,
  exportAnalyticsHandler,
  productPerformanceHandler,
  salesBreakdownHandler,
  salesSummaryHandler,
} from '../controllers/analytics.controller.ts';
import {
  adminLogFiltersHandler,
  exportAdminLogsHandler,
  listAdminLogsHandler,
  targetHistoryHandler,
} from '../controllers/admin-log.controller.ts';
import { adminSupportRouter } from './admin-support.route.ts';
import { adminKnowledgeRouter } from './knowledge.route.ts';
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

// AI Knowledge Base Management (STEP 21)
adminRouter.use('/knowledge', adminKnowledgeRouter);

/**
 * ตรวจรีวิวสินค้า (STEP 23)
 *
 * ⚠️ ใช้สิทธิ์ `review:moderate` ไม่ใช่ `product:update`
 *    รีวิวคือข้อความของลูกค้า คนที่แก้ข้อมูลสินค้าได้ไม่ควรเอาความเห็นลูกค้าลงได้ด้วย
 *    (แพตเทิร์นเดียวกับ STEP 21 ข้อ 8)
 */
adminRouter.get('/reviews', requirePermission('review:moderate'), listAdminReviewsHandler);
adminRouter.patch(
  '/reviews/:reviewId/status',
  requirePermission('review:moderate'),
  moderateReviewHandler,
);

/**
 * จัดการลูกค้า (STEP 25)
 *
 * แยกสิทธิ์สามระดับตามความเสียหายที่เกิดได้ถ้าใช้ผิด:
 *   - ดูข้อมูลลูกค้า        → `customer:read`     (EMPLOYEE มี — ต้องใช้ตอบคำถามลูกค้า)
 *   - ระงับ / ปลดระงับบัญชี → `customer:update`   (ADMIN ขึ้นไป)
 *   - เปลี่ยนบทบาทและสิทธิ์ → `user:role:manage`  (SUPER_ADMIN เท่านั้นตาม seed)
 *
 * คนที่ตอบแชตลูกค้าได้ ไม่ควรตัดลูกค้าออกจากร้านได้
 * และคนที่ตัดลูกค้าออกได้ ไม่ควรแต่งตั้งผู้ดูแลคนใหม่ได้ (แพตเทิร์นเดียวกับ STEP 17 ข้อ 8)
 *
 * ⚠️ **ไม่มี endpoint ลบลูกค้า** — การลบข้อมูลส่วนบุคคลเป็นงานของ STEP 53
 *    เครื่องมือที่ใช้ตัดคนออกจากร้านคือการระงับบัญชี ซึ่งเพิกถอน session ให้ด้วย
 */
adminRouter.get('/customers', requirePermission('customer:read'), listAdminCustomersHandler);
adminRouter.get('/customers/:userId', requirePermission('customer:read'), getAdminCustomerHandler);
adminRouter.patch(
  '/customers/:userId/status',
  requirePermission('customer:update'),
  updateCustomerStatusHandler,
);
adminRouter.patch(
  '/customers/:userId/role',
  requirePermission('user:role:manage'),
  updateCustomerRoleHandler,
);

/**
 * รายงานยอดขาย (STEP 26)
 *
 * ใช้สิทธิ์ `analytics:read` ชุดเดียวกับหน้าภาพรวมร้าน (ADMIN ขึ้นไปตาม seed)
 * **พนักงานหน้าร้านไม่ควรเห็นยอดขายทั้งร้านและอันดับลูกค้ารายคน** ซึ่งเป็นข้อมูลเชิงธุรกิจ
 * ต่างจาก `customer:read` ที่ให้ EMPLOYEE ดูได้เพราะต้องใช้ตอบคำถามลูกค้า
 *
 * ทุกเส้นทางเป็น GET เพราะหน้ารายงานเป็น Server Component ที่เรียกแบบ server-to-server
 * ซึ่งไม่มี header `Origin` → `verifyOrigin` จะบล็อก POST (บทเรียนจาก STEP 17 ข้อ 7)
 */
adminRouter.get('/analytics/summary', requirePermission('analytics:read'), salesSummaryHandler);
adminRouter.get(
  '/analytics/products',
  requirePermission('analytics:read'),
  productPerformanceHandler,
);
adminRouter.get(
  '/analytics/customers',
  requirePermission('analytics:read'),
  customerRankingHandler,
);
adminRouter.get('/analytics/breakdown', requirePermission('analytics:read'), salesBreakdownHandler);
adminRouter.get('/analytics/export', requirePermission('analytics:read'), exportAnalyticsHandler);

/**
 * Audit log (STEP 27)
 *
 * ใช้สิทธิ์ `log:read` (ADMIN ขึ้นไปตาม seed) เพราะ log เก็บ **IP · User-Agent ·
 * และเนื้อหาของ before/after** ซึ่งรวมข้อมูลส่วนบุคคลและเหตุผลที่แอดมินกรอกไว้
 * พนักงานหน้าร้านไม่ควรเห็นว่าใครถูกระงับบัญชีเพราะอะไร
 *
 * ⚠️ **มีแต่ GET** — ไม่มีทางสร้าง แก้ หรือลบ log ผ่าน API
 * ⚠️ ลำดับสำคัญ: เส้นทางคงที่ (`/filters`, `/export`, `/target/...`) ต้องมาก่อนเส้นทางอื่น
 */
adminRouter.get('/logs/filters', requirePermission('log:read'), adminLogFiltersHandler);
adminRouter.get('/logs/export', requirePermission('log:read'), exportAdminLogsHandler);
adminRouter.get(
  '/logs/target/:targetType/:targetId',
  requirePermission('log:read'),
  targetHistoryHandler,
);
adminRouter.get('/logs', requirePermission('log:read'), listAdminLogsHandler);
