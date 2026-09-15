import { Router } from 'express';

import {
  getPaymentMethodsHandler,
  stripeWebhookHandler,
} from '../controllers/payment.controller.ts';

/**
 * Route ของการชำระเงิน (STEP 11)
 *
 * - `/methods` เปิดสาธารณะ (หน้าเว็บต้องรู้ว่าช่องทางไหนใช้ได้)
 * - `/webhook/stripe` ไม่ต้องล็อกอินและ **ไม่ผ่าน verifyOrigin** เพราะผู้เรียกคือ Stripe
 *   ความปลอดภัยมาจากลายเซ็น `stripe-signature` ที่ตรวจด้วย STRIPE_WEBHOOK_SECRET
 *   (raw body ถูกเตรียมไว้ใน app.ts ก่อน express.json)
 *
 * ส่วนที่ผูกกับออเดอร์ (`/pay`, `/cancel`, `/payment`) อยู่ใน order.route.ts
 * เพราะต้องล็อกอินและตรวจความเป็นเจ้าของออเดอร์
 */
export const paymentRouter = Router();

paymentRouter.get('/methods', getPaymentMethodsHandler);
paymentRouter.post('/webhook/stripe', stripeWebhookHandler);
