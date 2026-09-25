import type { NextFunction, Request, Response } from 'express';

import { findUserBySessionToken, type AuthenticatedUser } from '../services/auth.service.ts';
import { ApiError } from '../utils/api-error.ts';
import { describeMiddleware } from './describe.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** ผู้ใช้ที่ล็อกอินแล้ว — undefined ถ้ายังไม่ได้ล็อกอิน */
      user?: AuthenticatedUser;
    }
  }
}

/** ชื่อ cookie ของ Auth.js v5 (production ใช้ prefix __Secure-) */
const SESSION_COOKIE_NAMES = ['authjs.session-token', '__Secure-authjs.session-token'] as const;

/**
 * ดึง session token จาก request
 *
 * รองรับ 2 ทาง เพราะ frontend กับ backend อยู่ต่างที่กันได้:
 *   1. cookie — ใช้ได้ตอน dev เพราะ cookie ของ localhost ไม่แยกตาม port
 *   2. Authorization: Bearer <token> — ใช้ตอน production ที่ frontend กับ backend ต่างโดเมน
 *      โดยฝั่ง server ของ Next.js อ่าน cookie แล้วส่งต่อมาเป็น header
 */
function extractSessionToken(req: Request): string | null {
  const authHeader = req.header('authorization');
  if (authHeader?.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token.length > 0) return token;
  }

  for (const name of SESSION_COOKIE_NAMES) {
    const value = req.cookies?.[name];
    if (typeof value === 'string' && value.length > 0) return value;
  }

  return null;
}

/**
 * แนบผู้ใช้เข้า req ถ้ามี session ที่ใช้ได้ — ไม่บังคับว่าต้องล็อกอิน
 * ใช้กับ endpoint ที่ทำงานได้ทั้งแบบล็อกอินและไม่ล็อกอิน (เช่น ตะกร้าของ guest)
 */
export async function attachUser(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractSessionToken(req);
    if (token) {
      const user = await findUserBySessionToken(token);
      if (user) req.user = user;
    }
    next();
  } catch (error) {
    next(error);
  }
}

/** บังคับว่าต้องล็อกอิน — ไม่ผ่านคืน 401 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = extractSessionToken(req);

    if (!token) {
      next(ApiError.unauthorized('ต้องเข้าสู่ระบบก่อนใช้งานส่วนนี้'));
      return;
    }

    const user = await findUserBySessionToken(token);

    if (!user) {
      next(ApiError.unauthorized('เซสชันหมดอายุหรือใช้งานไม่ได้ กรุณาเข้าสู่ระบบอีกครั้ง'));
      return;
    }

    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * ติดป้ายให้ตัวสร้างแผนผัง API อ่านได้ว่าเส้นทางไหนบังคับล็อกอิน (STEP 29)
 * ดูเหตุผลที่ต้องติดป้ายใน middlewares/describe.ts
 */
describeMiddleware(requireAuth, { auth: 'required' });
describeMiddleware(attachUser, { auth: 'optional' });
