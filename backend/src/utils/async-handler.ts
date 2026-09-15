import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * ห่อ async handler ให้ error ถูกส่งต่อไป errorHandler เสมอ
 *
 * Express 5 จับ promise rejection ให้เองแล้ว แต่เรายังใช้ตัวนี้เพราะ:
 *   1. ทำให้ type ของ handler เป็น Promise<void> ได้ตรง ๆ ไม่ต้องเขียน void ครอบ
 *   2. พฤติกรรมชัดเจนเหมือนกันทุก route ไม่ต้องจำว่า version ไหนจับ error ให้
 */
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
