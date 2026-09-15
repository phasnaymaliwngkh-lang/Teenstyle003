import type { NextFunction, Request, RequestHandler, Response } from 'express';

import { ApiError } from '../utils/api-error.ts';

/**
 * RBAC (STEP 3) — ใช้ต่อท้าย requireAuth เสมอ
 *
 * สิทธิ์ทั้งหมดมาจากฐานข้อมูล (Role ↔ Permission) ไม่ได้ hard-code ในโค้ด
 * จึงเปลี่ยนสิทธิ์ของบทบาทได้โดยไม่ต้อง deploy ใหม่
 */

export const STAFF_ROLES = ['EMPLOYEE', 'ADMIN', 'SUPER_ADMIN'] as const;

/** ต้องมีบทบาทใดบทบาทหนึ่งในรายการ */
export function requireRole(...allowed: readonly string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }

    if (!allowed.includes(req.user.role)) {
      next(ApiError.forbidden('บทบาทของคุณไม่ได้รับอนุญาตให้ใช้ส่วนนี้'));
      return;
    }

    next();
  };
}

/** ต้องเป็นพนักงานขึ้นไป */
export function requireStaff(): RequestHandler {
  return requireRole(...STAFF_ROLES);
}

/**
 * ต้องมีสิทธิ์ทุกตัวที่ระบุ
 * ใช้ชื่อสิทธิ์ตรงกับที่ seed ไว้ เช่น requirePermission('product:create')
 */
export function requirePermission(...required: readonly string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      next(ApiError.unauthorized());
      return;
    }

    const missing = required.filter((key) => !req.user!.permissions.includes(key));

    if (missing.length > 0) {
      next(
        ApiError.forbidden(
          `ต้องมีสิทธิ์ ${missing.join(', ')} จึงจะใช้ส่วนนี้ได้`,
          // ส่ง detail ให้ frontend แสดงข้อความที่ตรงสาเหตุได้ (ไม่ใช่ข้อมูลอ่อนไหว)
        ),
      );
      return;
    }

    next();
  };
}
