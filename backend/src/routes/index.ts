import { Router } from 'express';

import { API_VERSION } from '../config/index.ts';
import { sendSuccess } from '../utils/api-response.ts';

import { adminRouter } from './admin.route.ts';
import { aiRouter } from './ai.route.ts';
import { cartRouter } from './cart.route.ts';
import { categoryRouter, lookRouter, productRouter } from './catalog.route.ts';
import { healthRouter } from './health.route.ts';
import { checkoutRouter, orderRouter } from './order.route.ts';
import { paymentRouter } from './payment.route.ts';
import { userRouter } from './user.route.ts';

/**
 * แผนผัง REST API ทั้งหมดตาม STEP 29
 * ค่า status บอกตรง ๆ ว่า endpoint ไหนพร้อมใช้แล้ว เพื่อไม่ให้เข้าใจผิดว่ามีของที่ยังไม่มี
 */
const API_ROUTES = [
  { path: '/api/auth', status: 'ready (จัดการที่ Next.js /api/auth/*)', step: 3 },
  { path: '/api/users', status: 'ready', step: 3 },
  { path: '/api/products', status: 'ready', step: 6 },
  { path: '/api/categories', status: 'ready', step: 48 },
  { path: '/api/brands', status: 'planned', step: 48 },
  { path: '/api/looks', status: 'ready', step: 7 },
  { path: '/api/cart', status: 'ready', step: 9 },
  { path: '/api/checkout', status: 'ready', step: 10 },
  { path: '/api/orders', status: 'ready (สร้าง/รายการ/ติดตาม/จ่าย/ยกเลิก)', step: 12 },
  { path: '/api/payments', status: 'partial (COD พร้อมใช้ · Stripe รอตั้งค่า key)', step: 11 },
  { path: '/api/shipments', status: 'planned', step: 44 },
  { path: '/api/inventory', status: 'planned', step: 15 },
  { path: '/api/customers', status: 'planned', step: 25 },
  { path: '/api/reviews', status: 'planned', step: 23 },
  { path: '/api/wishlist', status: 'planned', step: 22 },
  { path: '/api/ai', status: 'ready (AI Stylist STEP 19 · AI CS STEP 20)', step: 20 },
  { path: '/api/notifications', status: 'planned', step: 24 },
  { path: '/api/admin', status: 'partial (overview พร้อมแล้ว)', step: 13 },
  { path: '/api/reports', status: 'planned', step: 26 },
] as const;

export const apiRouter = Router();

/** GET /api — index ของ API บอกว่ามี endpoint อะไรและสถานะเป็นอย่างไร */
apiRouter.get('/', (_req, res) => {
  sendSuccess(
    res,
    {
      name: 'TEENSTYLE AI REST API',
      version: API_VERSION,
      endpoints: API_ROUTES,
    },
    'TEENSTYLE AI REST API',
  );
});

apiRouter.use('/users', userRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/products', productRouter);
apiRouter.use('/categories', categoryRouter);
apiRouter.use('/looks', lookRouter);
apiRouter.use('/cart', cartRouter);
apiRouter.use('/checkout', checkoutRouter);
apiRouter.use('/orders', orderRouter);
apiRouter.use('/payments', paymentRouter);
apiRouter.use('/ai', aiRouter);

// STEP 12+ : จะ mount router เพิ่มที่นี่ เช่น apiRouter.use('/shipments', shipmentRouter)

export const rootRouter = Router();

rootRouter.use('/health', healthRouter);
rootRouter.use('/api', apiRouter);
