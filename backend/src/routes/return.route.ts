import { Router } from 'express';

import {
  cancelMyReturnHandler,
  createReturnHandler,
  getReturnEligibilityHandler,
  listMyReturnsHandler,
} from '../controllers/return.controller.ts';
import { requireAuth } from '../middlewares/authenticate.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

/**
 * คำขอคืนสินค้าของลูกค้า (STEP 43)
 *
 * - **ต้องล็อกอินทุกเส้นทาง** และเจ้าของมาจาก session เท่านั้น (แพตเทิร์นเดียวกับ `/api/orders`)
 *   ขอบเขตความปลอดภัยคือ "เป็นเจ้าของคำสั่งซื้อ/คำขอไหม" — ไม่ใช่ของตัวเองได้ 404
 * - `verifyOrigin` ทุกเส้นทาง กัน CSRF
 * - ลูกค้า **ส่งยอดเงินไม่ได้** — ส่งได้แค่ชิ้น จำนวน เหตุผล (ดู return.validator.ts)
 */
export const returnRouter = Router();

returnRouter.use(verifyOrigin, requireAuth);

returnRouter.get('/', listMyReturnsHandler);
returnRouter.get('/eligibility/:orderNumber', getReturnEligibilityHandler);
returnRouter.post('/', createReturnHandler);
returnRouter.post('/:returnId/cancel', cancelMyReturnHandler);
