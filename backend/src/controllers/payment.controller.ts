import type { Request, Response } from 'express';

import { paymentMethods } from '../config/payment.ts';
import {
  cancelUnpaidOrder,
  getPaymentState,
  handleStripeWebhook,
  startPayment,
} from '../services/payment.service.ts';
import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';
import { orderNumberParamsSchema } from '../validators/order.validator.ts';
import { startPaymentSchema } from '../validators/payment.validator.ts';

/**
 * Endpoint ของการชำระเงิน (STEP 11)
 *
 * เส้นทางของลูกค้าต้องล็อกอิน (requireAuth ที่ route)
 * ส่วน webhook ไม่ต้องล็อกอิน แต่ต้องมีลายเซ็นของ Stripe ที่ถูกต้อง
 */

/** GET /api/payments/methods — ช่องทางที่ระบบเปิดใช้จริง (บอกตรง ๆ ถ้าตั้งค่าไม่ครบ) */
export const getPaymentMethodsHandler = asyncHandler(
  async (_req: Request, res: Response): Promise<void> => {
    sendSuccess(res, { methods: paymentMethods(0) });
  },
);

/** GET /api/orders/:orderNumber/payment — สถานะการชำระเงินของออเดอร์ */
export const getPaymentStateHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { orderNumber } = orderNumberParamsSchema.parse(req.params);

    const state = await getPaymentState(req.user!.id, orderNumber);

    sendSuccess(res, state);
  },
);

/** POST /api/orders/:orderNumber/pay — { provider } */
export const startPaymentHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { orderNumber } = orderNumberParamsSchema.parse(req.params);
    const { provider } = startPaymentSchema.parse(req.body);

    // origin ใช้สร้าง success/cancel URL ของ Stripe — ผ่าน verifyOrigin มาแล้วว่าเป็นของเรา
    const origin = req.header('origin') ?? req.header('referer') ?? '';

    const result = await startPayment(
      req.user!.id,
      orderNumber,
      provider,
      origin.replace(/\/$/, ''),
    );

    sendSuccess(
      res,
      result,
      result.kind === 'confirmed'
        ? 'ยืนยันคำสั่งซื้อแล้ว (เก็บเงินปลายทาง)'
        : 'ไปที่หน้าชำระเงินของ Stripe',
    );
  },
);

/** POST /api/orders/:orderNumber/cancel — ยกเลิกออเดอร์ที่ยังไม่จ่ายเงิน */
export const cancelOrderHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const { orderNumber } = orderNumberParamsSchema.parse(req.params);

    const order = await cancelUnpaidOrder(req.user!.id, orderNumber);

    sendSuccess(res, order, 'ยกเลิกคำสั่งซื้อแล้ว และคืนสินค้าเข้าคลังเรียบร้อย');
  },
);

/**
 * POST /api/payments/webhook/stripe
 *
 * ⚠️ ต้องอ่าน **raw body** (app.ts mount `express.raw()` ให้เส้นทางนี้)
 * ⚠️ ไม่ผ่าน requireAuth/verifyOrigin เพราะคนเรียกคือ Stripe ไม่ใช่เบราว์เซอร์
 *    ความปลอดภัยมาจากการตรวจลายเซ็นด้วย STRIPE_WEBHOOK_SECRET
 */
export const stripeWebhookHandler = asyncHandler(
  async (req: Request, res: Response): Promise<void> => {
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');

    const result = await handleStripeWebhook(rawBody, req.header('stripe-signature'));

    // ตอบ 200 เสมอเมื่อประมวลผลได้ เพื่อให้ Stripe ไม่ยิงซ้ำ
    sendSuccess(res, result, result.duplicate ? 'event นี้ประมวลผลไปแล้ว' : 'รับ event แล้ว');
  },
);
