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
 * ⚠️ **store อยู่ในหน่วยความจำของ process นี้เท่านั้น** (ค่าเริ่มต้นของ express-rate-limit)
 *    ตรวจตอน STEP 34 แล้วยืนยันว่ายังเป็นแบบนี้ และ **ยังเปลี่ยนเป็น Redis ไม่ได้**
 *    เพราะเครื่องนี้ไม่มี Redis (Windows Home → ไม่มี WSL2 → Docker Desktop ใช้ไม่ได้)
 *    การเขียน adapter ที่ทดสอบกับของจริงไม่ได้เลย แย่กว่าการบอกความจริงว่ายังไม่มี
 *
 *    ผลที่ตามมาตอน deploy หลาย instance (ต้องรู้ก่อนขึ้น production — STEP 38)
 *      1. limit จริงกลายเป็น `RATE_LIMIT_MAX × จำนวน instance` เพราะแต่ละตัวนับแยกกัน
 *      2. deploy ใหม่ = ตัวนับเริ่มจากศูนย์ทั้งหมด
 *      3. `strictRateLimiter` (20/นาที) ที่กัน endpoint ซึ่งมีค่าใช้จ่ายจริง (OpenAI)
 *         จึงกันได้หลวมกว่าที่เขียนไว้ตามจำนวน instance
 *
 *    ถ้ารันหลาย instance ให้ทำอย่างใดอย่างหนึ่งก่อน: ตั้ง rate limit ที่ชั้น proxy/ingress
 *    (nginx, Cloudflare) หรือใส่ Redis แล้วเปลี่ยน `store` ที่นี่ **ที่เดียว**
 *    · `/health` รายงานสถานะ Redis ตามความจริงอยู่แล้ว (`not-configured`)
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
