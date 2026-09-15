import type { NextFunction, Request, Response } from 'express';

import { env, isProduction } from '../config/env.ts';
import { ApiError } from '../utils/api-error.ts';

/**
 * ป้องกัน CSRF สำหรับ endpoint ที่ใช้ cookie เป็นตัวระบุตัวตน (STEP 9 — ตะกร้า)
 *
 * ทำไมต้องมี
 *   ตะกร้าของ guest อ้างอิงด้วย cookie `cart-token` และตอน production frontend/backend
 *   อยู่ต่างโดเมนจึงต้องใช้ `SameSite=None` ซึ่ง **ไม่กัน cross-site POST ให้** อีกต่อไป
 *   จึงต้องตรวจ Origin/Referer ของทุกคำขอที่เปลี่ยนข้อมูลเองที่ชั้นนี้
 *
 * กฎ
 *   - GET/HEAD/OPTIONS ผ่านได้ (ไม่เปลี่ยนข้อมูล)
 *   - คำขอที่เปลี่ยนข้อมูลต้องมี Origin (หรือ Referer) ที่อยู่ในรายการ CORS_ORIGIN
 *   - dev อนุญาตคำขอที่ไม่มี Origin เลย (curl / supertest / Postman)
 *     production ไม่อนุญาต เพราะเบราว์เซอร์ส่ง Origin มาเสมอสำหรับคำขอเหล่านี้
 */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function originOf(value: string | undefined): string | null {
  if (!value) return null;

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

export function verifyOrigin(req: Request, _res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = originOf(req.header('origin')) ?? originOf(req.header('referer'));

  if (origin === null) {
    if (isProduction) {
      next(ApiError.forbidden('คำขอนี้ต้องมาจากเว็บไซต์ของเราเท่านั้น'));
      return;
    }

    next();
    return;
  }

  if (!env.CORS_ORIGIN.includes(origin)) {
    next(ApiError.forbidden('คำขอนี้ต้องมาจากเว็บไซต์ของเราเท่านั้น'));
    return;
  }

  next();
}
