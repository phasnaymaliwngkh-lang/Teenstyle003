import type { NextFunction, Request, Response } from 'express';

import { ApiError } from '../utils/api-error.ts';

/** วางไว้หลัง route ทั้งหมด — แปลง 404 ให้เป็น ApiError เพื่อให้ response shape เหมือนกันทุกกรณี */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(ApiError.notFound(`ไม่พบ endpoint: ${req.method} ${req.originalUrl}`));
}
