import type { Request, Response } from 'express';

import { sendSuccess } from '../utils/api-response.ts';
import { asyncHandler } from '../utils/async-handler.ts';

/**
 * GET /api/users/me — ข้อมูลผู้ใช้ที่ล็อกอินอยู่ พร้อมบทบาทและสิทธิ์
 *
 * ส่งเฉพาะฟิลด์ที่ปลอดภัยจะเปิดเผย ไม่ส่ง passwordHash / deletedAt / ข้อมูลภายในอื่น
 * (ผ่าน requireAuth มาแล้ว จึงมั่นใจได้ว่ามี req.user)
 */
export const getMe = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const user = req.user!;

  sendSuccess(res, {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    permissions: user.permissions,
  });
});
