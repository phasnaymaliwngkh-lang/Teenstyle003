import { Router } from 'express';

import {
  createReviewHandler,
  deleteReviewHandler,
  listMyReviewsHandler,
  reviewEligibilityHandler,
  setReviewHelpfulHandler,
  updateReviewHandler,
} from '../controllers/review.controller.ts';
import { requireAuth } from '../middlewares/authenticate.ts';
import { requirePermission } from '../middlewares/authorize.ts';
import { strictRateLimiter } from '../middlewares/rate-limit.ts';
import { verifyOrigin } from '../middlewares/verify-origin.ts';

/**
 * Route ของรีวิวที่ต้องล็อกอิน (STEP 23)
 *
 * การ **อ่าน** รีวิวเป็นของสาธารณะและอยู่ที่ `GET /api/products/:slug/reviews`
 * (ดู [catalog.route.ts](./catalog.route.ts)) — ที่นี่คือส่วนที่ต้องรู้ว่าเป็นใคร
 *
 * - `review:create` เป็นสิทธิ์ของ CUSTOMER ตาม seed — ตรวจจากฐานข้อมูล ไม่ได้ hard-code ตามบทบาท
 * - `verifyOrigin` ทุกเส้นทาง กัน CSRF (production ใช้ `SameSite=None` จึงต้องตรวจ Origin เอง)
 * - **`strictRateLimiter` ที่การเขียนรีวิวและการโหวต** — สองอย่างนี้สร้างเนื้อหาสาธารณะ
 *   และขยับตัวเลขที่คนอื่นใช้ตัดสินใจซื้อ ยิงรัวได้แปลว่าปั่นได้
 */
export const reviewRouter = Router();

reviewRouter.use(verifyOrigin, requireAuth, requirePermission('review:create'));

reviewRouter.get('/me', listMyReviewsHandler);
reviewRouter.get('/eligibility', reviewEligibilityHandler);

reviewRouter.post('/', strictRateLimiter, createReviewHandler);
reviewRouter.patch('/:reviewId', strictRateLimiter, updateReviewHandler);
reviewRouter.delete('/:reviewId', deleteReviewHandler);
reviewRouter.patch('/:reviewId/helpful', strictRateLimiter, setReviewHelpfulHandler);
