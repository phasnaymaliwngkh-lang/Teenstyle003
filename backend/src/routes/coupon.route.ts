import { Router } from 'express';

import { applyCouponHandler } from '../controllers/coupon.controller.ts';
import { requireAuth } from '../middlewares/authenticate.ts';
import { strictRateLimiter } from '../middlewares/rate-limit.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

/**
 * Route ของคูปองส่วนลด ฝั่งลูกค้า (STEP 41)
 *
 * - **ต้องล็อกอิน** เพราะต้องอ่านตะกร้าของคนนั้นและนับว่าเขาใช้คูปองนี้ไปกี่ครั้งแล้ว
 * - `verifyOrigin` กัน CSRF เหมือนทุกเส้นทางที่รับ POST
 * - **`strictRateLimiter`** เพราะเป็นช่องที่เดารหัสคูปองได้ — ยิงรัวได้แปลว่าไล่เดาได้
 *   และเส้นทางนี้ถูกเรียกจาก **เบราว์เซอร์** เท่านั้น (ไม่ใช่ Server Component)
 *   จึงใช้ limit ต่อ IP ได้ตามกฎของ STEP 29
 */
export const couponRouter = Router();

couponRouter.use(verifyOrigin, requireAuth);

couponRouter.post('/apply', strictRateLimiter, applyCouponHandler);
