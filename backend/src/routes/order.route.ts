import { Router } from 'express';

import {
  createOrderHandler,
  getCheckoutSummaryHandler,
  getOrderHandler,
  listOrdersHandler,
} from '../controllers/order.controller.ts';
import {
  cancelOrderHandler,
  getPaymentStateHandler,
  startPaymentHandler,
} from '../controllers/payment.controller.ts';
import { requireAuth } from '../middlewares/authenticate.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

/**
 * Route ของ checkout และคำสั่งซื้อ (STEP 10)
 *
 * - **ต้องล็อกอินทุกเส้นทาง** — คำสั่งซื้อผูกกับบัญชี (`Order.userId` required)
 *   guest ต้องเข้าสู่ระบบก่อน (ตะกร้าของ guest จะถูกรวมเข้าบัญชีให้อัตโนมัติ)
 * - `verifyOrigin` กัน CSRF สำหรับคำขอที่เปลี่ยนข้อมูล
 * - รายการคำสั่งซื้อทั้งหมด + สถานะการจัดส่ง จะทำใน STEP 12 (Order Tracking)
 */
export const checkoutRouter = Router();

checkoutRouter.use(verifyOrigin, requireAuth);
checkoutRouter.get('/summary', getCheckoutSummaryHandler);

export const orderRouter = Router();

orderRouter.use(verifyOrigin, requireAuth);
orderRouter.get('/', listOrdersHandler); // STEP 12: ประวัติคำสั่งซื้อ
orderRouter.post('/', createOrderHandler);

// path ที่ยาวกว่าต้องมาก่อน `/:orderNumber` (Express จับตามลำดับ)
orderRouter.get('/:orderNumber/payment', getPaymentStateHandler);
orderRouter.post('/:orderNumber/pay', startPaymentHandler);
orderRouter.post('/:orderNumber/cancel', cancelOrderHandler);
orderRouter.get('/:orderNumber', getOrderHandler);
