import { Router } from 'express';

import {
  getAdminOrderHandler,
  getAdminOverview,
  listAdminOrdersHandler,
  updateOrderStatusHandler,
} from '../controllers/admin.controller.ts';
import {
  adminCreateShipmentHandler,
  adminGetShipmentHandler,
  adminListShipmentsHandler,
  adminListShippingRatesHandler,
  adminUpdateShipmentHandler,
  adminUpdateShipmentStatusHandler,
  adminUpdateShippingRateHandler,
} from '../controllers/shipping.controller.ts';
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
  listProductImagesHandler,
  removeProductImageHandler,
  reorderProductImagesHandler,
  updateProductImageHandler,
  uploadProductImageHandler,
} from '../controllers/product-image.controller.ts';
import { getMediaLibraryHandler, purgeMediaHandler } from '../controllers/media.controller.ts';
import {
  createBrandHandler,
  createCategoryHandler,
  createColorHandler,
  createSizeHandler,
  deleteBrandHandler,
  deleteCategoryHandler,
  deleteColorHandler,
  deleteSizeHandler,
  getCatalogHandler,
  reorderCategoriesHandler,
  reorderColorsHandler,
  reorderSizesHandler,
  updateBrandHandler,
  updateCategoryHandler,
  updateColorHandler,
  updateSizeHandler,
} from '../controllers/catalog-admin.controller.ts';
import { uploadImageFile } from '../middlewares/upload-image.ts';
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
import {
  createCouponHandler,
  deleteCouponHandler,
  listCouponsHandler,
  updateCouponHandler,
} from '../controllers/coupon.controller.ts';
import { mountRouter } from '../models/api-map.ts';
import { describeMiddleware } from '../middlewares/describe.ts';
import { requireAuth } from '../middlewares/authenticate.ts';
import { requirePermission, requireStaff } from '../middlewares/authorize.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';
import {
  adjustCustomerPointsHandler,
  adminListPointTransactionsHandler,
} from '../controllers/loyalty.controller.ts';
import {
  adminDecideReturnHandler,
  adminGetReturnHandler,
  adminListReturnsHandler,
  adminReceiveReturnHandler,
  adminRefundCancelledOrderHandler,
  adminRefundReturnHandler,
} from '../controllers/return.controller.ts';
import { ApiError } from '../utils/api-error.ts';

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
 * คืนเงินคำสั่งซื้อที่ร้านยกเลิกหลังชำระเงินแล้ว (STEP 43) — `order:refund` (ADMIN ขึ้นไป)
 * เป็นการ **บันทึก** ว่าคืนเงินแล้วจริง (วิธี + เลขอ้างอิง) — ระบบไม่ได้โอนเงินเอง
 */
adminRouter.post(
  '/orders/:orderNumber/refund',
  requirePermission('order:refund'),
  adminRefundCancelledOrderHandler,
);

/**
 * การจัดส่ง (STEP 44)
 *   - ดูอัตราค่าส่ง / ดูพัสดุ          → `shipment:read`   (EMPLOYEE มี — ต้องตอบลูกค้าเรื่องพัสดุ)
 *   - เปลี่ยนสถานะ / แก้เลข / ส่งใหม่   → `shipment:update` (งานหน้าร้านที่แพ็กและส่งของ — EMPLOYEE มี)
 *   - แก้อัตราค่าส่ง                   → `settings:manage` (ADMIN ขึ้นไป — คือเงินที่เก็บจากลูกค้าทุกคน)
 */
adminRouter.get(
  '/shipping/rates',
  requirePermission('shipment:read'),
  adminListShippingRatesHandler,
);
adminRouter.patch(
  '/shipping/rates/:method',
  requirePermission('settings:manage'),
  adminUpdateShippingRateHandler,
);
adminRouter.get('/shipments', requirePermission('shipment:read'), adminListShipmentsHandler);
adminRouter.get(
  '/shipments/:shipmentId',
  requirePermission('shipment:read'),
  adminGetShipmentHandler,
);
adminRouter.patch(
  '/shipments/:shipmentId/status',
  requirePermission('shipment:update'),
  adminUpdateShipmentStatusHandler,
);
adminRouter.patch(
  '/shipments/:shipmentId',
  requirePermission('shipment:update'),
  adminUpdateShipmentHandler,
);
adminRouter.post(
  '/orders/:orderNumber/shipments',
  requirePermission('shipment:update'),
  adminCreateShipmentHandler,
);

/**
 * คำขอคืนสินค้า (STEP 43)
 *   - ดูคิว                    → `order:read`   (EMPLOYEE มี)
 *   - อนุมัติ / ไม่รับคืน / ตรวจรับของ → `order:update` (งานหน้าร้านและคลัง — EMPLOYEE มี)
 *   - บันทึกการคืนเงิน         → `order:refund` (ADMIN ขึ้นไป — เงินออกจากร้าน)
 */
adminRouter.get('/returns', requirePermission('order:read'), adminListReturnsHandler);
adminRouter.get('/returns/:returnId', requirePermission('order:read'), adminGetReturnHandler);
adminRouter.patch(
  '/returns/:returnId/status',
  requirePermission('order:update'),
  adminDecideReturnHandler,
);
adminRouter.post(
  '/returns/:returnId/receive',
  requirePermission('order:update'),
  adminReceiveReturnHandler,
);
adminRouter.post(
  '/returns/:returnId/refund',
  requirePermission('order:refund'),
  adminRefundReturnHandler,
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
 * รูปสินค้า (STEP 47) — จัดการทีละรูป · ทั้งหมดเป็น `product:update` (ADMIN ขึ้นไป)
 * ตรวจสิทธิ์ **ก่อน** รับไฟล์ คนที่ไม่มีสิทธิ์จึงไม่ทำให้ server ต้องอ่านไฟล์ 8MB หรือแปลงรูป
 */
adminRouter.get(
  '/products/:productId/images',
  requirePermission('product:read'),
  listProductImagesHandler,
);
adminRouter.post(
  '/products/:productId/images',
  requirePermission('product:update'),
  uploadImageFile,
  uploadProductImageHandler,
);
adminRouter.put(
  '/products/:productId/images/order',
  requirePermission('product:update'),
  reorderProductImagesHandler,
);
adminRouter.patch(
  '/products/:productId/images/:imageId',
  requirePermission('product:update'),
  updateProductImageHandler,
);
adminRouter.delete(
  '/products/:productId/images/:imageId',
  requirePermission('product:update'),
  removeProductImageHandler,
);

/**
 * หมวดหมู่ · แบรนด์ · ไซซ์ · สี (STEP 48)
 *   - ดู (พร้อมจำนวนที่ใช้อยู่และเหตุผลที่ปิด/ลบไม่ได้) → `product:read` (EMPLOYEE มี — ต้องรู้ว่ามีหมวดอะไรบ้าง)
 *   - เพิ่ม · แก้ · ปิด · ลบ · เรียง → `catalog:manage` (ADMIN ขึ้นไป — เปลี่ยนโครงของหน้าร้านทั้งร้าน)
 * ⚠️ `PUT …/order` ใช้เมธอดคนละตัวกับ `PATCH …/:id` จึงไม่ถูก `/:id` จับไปก่อน
 */
const manageCatalog = requirePermission('catalog:manage');

adminRouter.get('/catalog', requirePermission('product:read'), getCatalogHandler);
adminRouter.post('/catalog/categories', manageCatalog, createCategoryHandler);
adminRouter.put('/catalog/categories/order', manageCatalog, reorderCategoriesHandler);
adminRouter.patch('/catalog/categories/:id', manageCatalog, updateCategoryHandler);
adminRouter.delete('/catalog/categories/:id', manageCatalog, deleteCategoryHandler);
adminRouter.post('/catalog/brands', manageCatalog, createBrandHandler);
adminRouter.patch('/catalog/brands/:id', manageCatalog, updateBrandHandler);
adminRouter.delete('/catalog/brands/:id', manageCatalog, deleteBrandHandler);
adminRouter.post('/catalog/sizes', manageCatalog, createSizeHandler);
adminRouter.put('/catalog/sizes/order', manageCatalog, reorderSizesHandler);
adminRouter.patch('/catalog/sizes/:id', manageCatalog, updateSizeHandler);
adminRouter.delete('/catalog/sizes/:id', manageCatalog, deleteSizeHandler);
adminRouter.post('/catalog/colors', manageCatalog, createColorHandler);
adminRouter.put('/catalog/colors/order', manageCatalog, reorderColorsHandler);
adminRouter.patch('/catalog/colors/:id', manageCatalog, updateColorHandler);
adminRouter.delete('/catalog/colors/:id', manageCatalog, deleteColorHandler);

/**
 * คลังรูป (STEP 47) — `media:manage` (ADMIN ขึ้นไป)
 * มีรูปที่ลูกค้าแนบรีวิว (รวมที่ยังรอตรวจ) และปุ่มลบไฟล์ถาวร · การดูไม่แตะข้อมูลอะไรเลย
 */
adminRouter.get('/media', requirePermission('media:manage'), getMediaLibraryHandler);
adminRouter.post('/media/purge', requirePermission('media:manage'), purgeMediaHandler);

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
/**
 * ⚠️ จำกัดชนิดไฟล์ที่รับตั้งแต่ชั้นนอกสุด (STEP 28)
 *
 * เดิมรับไฟล์อะไรก็ได้ที่ไม่เกิน 5MB แล้วปล่อยให้ตัวแปลงไปเจอเองว่าอ่านไม่ออก
 * ผลคือ ExcelJS ต้องแกะไฟล์แปลกปลอม (xlsx คือ zip — มีทั้ง zip bomb และ XML ที่ซ้อนลึก)
 * ก่อนจะรู้ว่าใช้ไม่ได้ · ปฏิเสธที่ชั้น multer จึงถูกกว่าและปลอดภัยกว่า
 *
 * ตรวจทั้ง mimetype และนามสกุล เพราะเบราว์เซอร์บนวินโดวส์ส่ง mimetype ของ CSV
 * มาไม่ตรงกันหลายแบบ (text/csv · application/vnd.ms-excel · application/octet-stream)
 * — นามสกุลจึงเป็นเกณฑ์หลัก และ **ตัวตัดสินจริงยังเป็นตัวแปลงที่อ่านเนื้อไฟล์**
 */
const ALLOWED_UPLOAD_EXTENSIONS = ['.csv', '.xlsx', '.xls'];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) => {
    const name = file.originalname.toLowerCase();
    const allowed = ALLOWED_UPLOAD_EXTENSIONS.some((ext) => name.endsWith(ext));

    if (!allowed) {
      /**
       * ⚠️ ต้องโยน ApiError ไม่ใช่ Error เปล่า — multer ส่ง error ตัวนี้ต่อให้ next() ตรง ๆ
       *    Error เปล่าจะถูกจัดเป็น 500 'เกิดข้อผิดพลาดภายในระบบ' ซึ่งทั้งผิดสถานะ
       *    (เป็นความผิดของคำขอ ไม่ใช่ของเรา) และไม่บอกผู้ใช้ว่าต้องส่งไฟล์ชนิดไหน (เจอตอน STEP 30)
       */
      callback(ApiError.badRequest('รับเฉพาะไฟล์ .csv, .xlsx หรือ .xls เท่านั้น'));
      return;
    }

    callback(null, true);
  },
});

/** ติดป้ายไว้ให้แผนผัง API ระบุได้ว่าสองเส้นทางนี้รับไฟล์ (STEP 29) */
const uploadSingleFile = describeMiddleware(upload.single('file'), { upload: 'file' });

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
  uploadSingleFile,
  importProductsHandler,
);
adminRouter.post(
  '/import/inventory',
  requirePermission('inventory:adjust'),
  uploadSingleFile,
  importInventoryHandler,
);

// ฝ่ายบริการลูกค้า & Human Handoff (STEP 20)
mountRouter(adminRouter, '/support', adminSupportRouter);

// AI Knowledge Base Management (STEP 21)
mountRouter(adminRouter, '/knowledge', adminKnowledgeRouter);

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
 * แต้มสะสมของลูกค้า (STEP 42)
 *   - ดูประวัติแต้ม → `customer:read` (EMPLOYEE มี — ต้องตอบได้ว่าแต้มมาจากไหน)
 *   - ปรับแต้ม     → `loyalty:adjust` (ADMIN ขึ้นไป — แต้มมีมูลค่าเท่าเงิน เหมือนการออกคูปอง)
 */
adminRouter.get(
  '/customers/:userId/points',
  requirePermission('customer:read'),
  adminListPointTransactionsHandler,
);
adminRouter.post(
  '/customers/:userId/points',
  requirePermission('loyalty:adjust'),
  adjustCustomerPointsHandler,
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

/**
 * คูปองส่วนลด (STEP 41) — `coupon:manage` (ADMIN ขึ้นไปตาม seed)
 *
 * พนักงานหน้าร้านไม่ควรออกส่วนลดได้เอง เพราะเป็นการให้เงินออกจากร้าน
 * (แพตเทิร์นเดียวกับ `analytics:read` ของ STEP 26 ข้อ 7 ที่ EMPLOYEE ไม่มี)
 * ⚠️ ลบคูปองเป็น **soft delete** เพราะ `Order.couponId` ยังอ้างถึงแถวนั้น
 */
adminRouter.get('/coupons', requirePermission('coupon:manage'), listCouponsHandler);
adminRouter.post('/coupons', requirePermission('coupon:manage'), createCouponHandler);
adminRouter.patch('/coupons/:couponId', requirePermission('coupon:manage'), updateCouponHandler);
adminRouter.delete('/coupons/:couponId', requirePermission('coupon:manage'), deleteCouponHandler);
