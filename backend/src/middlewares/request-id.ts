import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** id ของ request ใช้ผูก log กับ response ที่ client ได้รับ */
      requestId: string;
    }
  }
}

/**
 * ใส่ request id ให้ทุก request เพื่อไล่ log ย้อนหลังได้
 * ถ้า client/reverse proxy ส่ง X-Request-Id มาแล้ว ให้ใช้ค่านั้นต่อ
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && incoming.length <= 128 ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
