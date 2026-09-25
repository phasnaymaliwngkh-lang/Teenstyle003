import rateLimit from 'express-rate-limit';

import { env, isTest } from '../config/index.ts';
import { ERROR_CODES } from '../utils/api-error.ts';
import { describeMiddleware } from './describe.ts';
import type { ApiErrorBody } from '../utils/api-response.ts';

const tooManyRequestsBody: ApiErrorBody = {
  success: false,
  message: 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองอีกครั้ง',
  errorCode: ERROR_CODES.TOO_MANY_REQUESTS,
};

/**
 * Rate limiting ทั่วทั้ง API (STEP 28)
 * ปิดตอนรันเทสต์ เพื่อไม่ให้เทสต์ชุดใหญ่ชน limit
 *
 * STEP 34: จะเปลี่ยน store เป็น Redis เพื่อให้ limit ใช้ร่วมกันได้หลาย instance
 */
export const globalRateLimiter = rateLimit({
  windowMs: env.RATE_LIMIT_WINDOW_MS,
  limit: env.RATE_LIMIT_MAX,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyRequestsBody,
  skip: () => isTest,
});

/** เข้มกว่าปกติ สำหรับ endpoint ที่อ่อนไหว เช่น login / webhook (ใช้จริง STEP 3, 11) */
export const strictRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: tooManyRequestsBody,
  skip: () => isTest,
});

/** ติดป้ายให้ตัวสร้างแผนผัง API รู้ว่าเส้นทางไหนคุมความถี่แบบเข้ม (STEP 29) */
describeMiddleware(strictRateLimiter, { rateLimit: 'strict' });
