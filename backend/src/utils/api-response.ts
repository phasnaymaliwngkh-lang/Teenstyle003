import type { Response } from 'express';

import type { ErrorCode } from './api-error.ts';

/** Response shape มาตรฐานของทุก API (STEP 29 / STEP 30) */
export interface ApiSuccessBody<TData> {
  success: true;
  message: string;
  data: TData;
}

export interface ApiErrorBody {
  success: false;
  message: string;
  errorCode: ErrorCode;
  details?: unknown;
}

export type ApiBody<TData> = ApiSuccessBody<TData> | ApiErrorBody;

/** ส่ง response สำเร็จ */
export function sendSuccess<TData>(
  res: Response,
  data: TData,
  message = 'สำเร็จ',
  statusCode = 200,
): void {
  const body: ApiSuccessBody<TData> = { success: true, message, data };
  res.status(statusCode).json(body);
}

/** ส่ง response ที่ผิดพลาด — ปกติเรียกผ่าน errorHandler ไม่เรียกตรงจาก controller */
export function sendError(
  res: Response,
  statusCode: number,
  message: string,
  errorCode: ErrorCode,
  details?: unknown,
): void {
  const body: ApiErrorBody = { success: false, message, errorCode };
  if (details !== undefined) {
    body.details = details;
  }
  res.status(statusCode).json(body);
}
