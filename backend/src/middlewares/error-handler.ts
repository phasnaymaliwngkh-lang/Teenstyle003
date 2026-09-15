import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { isProduction } from '../config/index.ts';
import { ApiError, ERROR_CODES, type ErrorCode } from '../utils/api-error.ts';
import { sendError } from '../utils/api-response.ts';
import { logger } from '../utils/logger.ts';

interface NormalizedError {
  statusCode: number;
  message: string;
  errorCode: ErrorCode;
  details?: unknown;
}

function normalize(error: unknown): NormalizedError {
  if (error instanceof ApiError) {
    const normalized: NormalizedError = {
      statusCode: error.statusCode,
      message: error.message,
      errorCode: error.errorCode,
    };
    if (error.details !== undefined) {
      normalized.details = error.details;
    }
    return normalized;
  }

  // Validation ที่ล้มจาก Zod → 422 พร้อมบอกว่า field ไหนผิด
  if (error instanceof ZodError) {
    return {
      statusCode: 422,
      message: 'ข้อมูลที่ส่งมาไม่ถูกต้อง',
      errorCode: ERROR_CODES.VALIDATION_ERROR,
      details: error.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
      })),
    };
  }

  // JSON body พังตอน parse (express.json โยน SyntaxError ที่มี status 400)
  if (error instanceof SyntaxError && 'body' in error) {
    return {
      statusCode: 400,
      message: 'รูปแบบ JSON ไม่ถูกต้อง',
      errorCode: ERROR_CODES.BAD_REQUEST,
    };
  }

  return {
    statusCode: 500,
    message: 'เกิดข้อผิดพลาดภายในระบบ',
    errorCode: ERROR_CODES.INTERNAL_ERROR,
  };
}

/**
 * Global error handler (STEP 30)
 * ต้องเป็น middleware ตัวสุดท้ายที่ app.use() และต้องรับ 4 อาร์กิวเมนต์
 * Express จึงจะรู้ว่านี่คือ error handler
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    next(error);
    return;
  }

  const { statusCode, message, errorCode, details } = normalize(error);

  const logPayload = {
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    statusCode,
    errorCode,
    err: error,
  };

  if (statusCode >= 500) {
    logger.error(logPayload, 'unhandled error');
  } else {
    logger.warn(logPayload, 'request failed');
  }

  // production: ไม่ส่งรายละเอียดภายในของ error 500 ออกไปให้ client (STEP 28)
  const safeDetails = statusCode >= 500 && isProduction ? undefined : details;

  sendError(res, statusCode, message, errorCode, safeDetails);
}
