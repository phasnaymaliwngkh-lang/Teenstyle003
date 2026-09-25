import { Prisma } from '@teenstyle/database';
import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { isProduction } from '../config/index.ts';
import { ApiError, ERROR_CODES, type ErrorCode } from '../utils/api-error.ts';
import { sendError } from '../utils/api-response.ts';
import { logger } from '../utils/logger.ts';

export interface NormalizedError {
  statusCode: number;
  message: string;
  errorCode: ErrorCode;
  details?: unknown;
}

/** อ่าน property จาก error ที่ไม่รู้ชนิดแบบปลอดภัย */
function propOf(error: unknown, key: string): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  return (error as Record<string, unknown>)[key];
}

/**
 * error ของ body-parser (express.json / express.urlencoded)
 *
 * มันแนบ `type` มาบอกสาเหตุ และ `status` ที่ถูกต้องตาม HTTP อยู่แล้ว
 * แต่เดิมเราไม่ได้อ่านเลย → body ที่ใหญ่เกิน 1mb กลายเป็น **500 เกิดข้อผิดพลาดภายในระบบ**
 * ทั้งที่เป็นความผิดของคำขอ และผู้ใช้แก้ได้เองด้วยการส่งน้อยลง (เจอจริงตอน STEP 30)
 */
function fromBodyParser(error: unknown): NormalizedError | null {
  const type = propOf(error, 'type');
  if (typeof type !== 'string') return null;

  switch (type) {
    case 'entity.too.large':
      return {
        statusCode: 413,
        message: 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินกำหนด (สูงสุด 1MB ต่อคำขอ)',
        errorCode: ERROR_CODES.PAYLOAD_TOO_LARGE,
      };

    case 'charset.unsupported':
    case 'encoding.unsupported':
      return {
        statusCode: 415,
        message: 'ชนิดหรือการเข้ารหัสของข้อมูลที่ส่งมาไม่รองรับ (ต้องเป็น UTF-8)',
        errorCode: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
      };

    case 'entity.parse.failed':
      return {
        statusCode: 400,
        message: 'รูปแบบ JSON ไม่ถูกต้อง',
        errorCode: ERROR_CODES.BAD_REQUEST,
      };

    default:
      return null;
  }
}

/** errorCode ที่คู่กับ HTTP status — ใช้ตอนรู้สถานะแต่ไม่มีบริบทอื่น */
function errorCodeForStatus(status: number): ErrorCode {
  switch (status) {
    case 401:
      return ERROR_CODES.UNAUTHORIZED;
    case 403:
      return ERROR_CODES.FORBIDDEN;
    case 404:
      return ERROR_CODES.NOT_FOUND;
    case 409:
      return ERROR_CODES.CONFLICT;
    case 413:
      return ERROR_CODES.PAYLOAD_TOO_LARGE;
    case 415:
      return ERROR_CODES.UNSUPPORTED_MEDIA_TYPE;
    case 422:
      return ERROR_CODES.VALIDATION_ERROR;
    case 429:
      return ERROR_CODES.TOO_MANY_REQUESTS;
    default:
      return ERROR_CODES.BAD_REQUEST;
  }
}

/**
 * error แบบ `http-errors` ที่ middleware ของ Express ใช้กันทั้งวงการ
 * (body-parser, raw-body, serve-static) — มันบอก `status` ที่ถูกต้องมาแล้ว
 * และ `expose: true` แปลว่า "ปลอดภัยที่จะบอก client ว่าเป็นความผิดของคำขอ"
 *
 * ตัวที่ทำให้ต้องมีข้อนี้: body ที่ประกาศ `Content-Encoding: gzip` แต่ส่งข้อความเปล่ามา
 * จะได้ error ที่ `status: 400, expose: true` แต่ **ไม่มี `type`** → เดิมกลายเป็น 500
 * ผลคือคำขอพัง ๆ จากไคลเอนต์ตัวเดียวทำให้ log เต็มด้วย 500 ซึ่งเป็นสัญญาณว่า "ระบบเราพัง"
 * แล้วการเฝ้าระวัง (STEP 51) จะเตือนผิดเรื่อง
 *
 * ⚠️ **ไม่ส่งข้อความของไลบรารีต่อให้ผู้ใช้** เพราะเป็นภาษาอังกฤษและเป็นศัพท์ภายใน
 *    ("incorrect header check") — ใช้ข้อความกลางของเราตามสถานะแทน
 */
function fromHttpError(error: unknown): NormalizedError | null {
  if (propOf(error, 'expose') !== true) return null;

  const raw = propOf(error, 'status') ?? propOf(error, 'statusCode');
  if (typeof raw !== 'number' || raw < 400 || raw > 499) return null;

  return {
    statusCode: raw,
    message:
      raw === 400
        ? 'อ่านเนื้อหาของคำขอไม่ได้ กรุณาตรวจสอบรูปแบบข้อมูลที่ส่งมา'
        : 'คำขอนี้ไม่ถูกต้อง',
    errorCode: errorCodeForStatus(raw),
  };
}

/**
 * URL ที่ percent-encode มาไม่ถูกต้อง → 400 ไม่ใช่ 500
 *
 * Express โยน `URIError` จาก `decodeURIComponent` ตอนแกะค่า `:param` ของ path
 * และ **ตั้ง `status = 400` มาให้แล้วแต่ไม่ตั้ง `expose`** จึงไม่เข้าเงื่อนไขของ `fromHttpError()`
 *
 * ทำไมสำคัญ: ไบต์ที่ไม่ใช่ UTF-8 ใน path เกิดขึ้นเองตลอดเวลาจากลิงก์เก่า บ็อต และเครื่องสแกน
 * (เจอจริงตอน STEP 30: `/api/products/%E4%C1%E8` — สลัก slug ไทยที่เข้ารหัสแบบ TIS-620)
 * ทุกครั้งจะได้ 500 พร้อม log ระดับ error ซึ่งอ่านว่า "ระบบเราพัง" ทั้งที่เป็นคำขอที่ส่งมาผิด
 * → การเฝ้าระวัง (STEP 51) จะเตือนผิดเรื่องและกลายเป็นเสียงรบกวนที่คนเลิกอ่าน
 */
function fromUriError(error: unknown): NormalizedError | null {
  if (!(error instanceof URIError)) return null;

  return {
    statusCode: 400,
    message: 'ที่อยู่ของคำขอเข้ารหัสมาไม่ถูกต้อง (ต้องเป็น UTF-8)',
    errorCode: ERROR_CODES.BAD_REQUEST,
  };
}

/**
 * ตาข่ายรับ error ของ Prisma ที่ไม่มีใครดักไว้
 *
 * ⚠️ **นี่คือตาข่ายกันตก ไม่ใช่ที่สำหรับแปลง error ให้ผู้ใช้อ่าน**
 *    ข้อความที่บอกสาเหตุได้จริง ("บาร์โค้ดนี้ถูกใช้กับตัวเลือกอื่นแล้ว") ต้องมาจาก service
 *    ที่รู้บริบท — ที่นี่รู้แค่ว่าชนกฎอะไรของฐานข้อมูล จึงได้แค่ข้อความกลาง ๆ
 *    แต่ดีกว่าปล่อยเป็น 500 เพราะ **สถานะที่ถูกต้องบอกผู้ใช้ว่าลองแก้เองได้หรือไม่**
 *    และบอก client ว่าควร retry ไหม
 *
 * ทำไมต้องมี: P2002 ถูกดักไว้เอง 6 ที่ในโปรเจกต์ (สินค้า บาร์โค้ด รีวิว wishlist บทความ)
 * แต่ยังมีทางที่หลุดได้ เช่น unique ของ `InventoryMovement.idempotencyKey` ที่ตรวจก่อนเขียน
 * ในทรานแซกชัน — ถ้าสองคำขอเหมือนกันเข้ามาพร้อมกันจริง ๆ ตัวที่แพ้จะโดน P2002 ตอน insert
 */
function fromPrisma(error: unknown): NormalizedError | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return {
          statusCode: 409,
          message: 'ข้อมูลนี้มีอยู่ในระบบแล้ว',
          errorCode: ERROR_CODES.CONFLICT,
        };

      case 'P2025':
        return {
          statusCode: 404,
          message: 'ไม่พบข้อมูลที่ต้องการ',
          errorCode: ERROR_CODES.NOT_FOUND,
        };

      case 'P2003':
      case 'P2014':
        return {
          statusCode: 409,
          message: 'ข้อมูลนี้ถูกใช้อยู่ที่อื่น จึงแก้หรือลบตามที่ขอไม่ได้',
          errorCode: ERROR_CODES.CONFLICT,
        };

      case 'P2000':
        return {
          statusCode: 400,
          message: 'ข้อมูลที่ส่งมายาวเกินกว่าที่เก็บได้',
          errorCode: ERROR_CODES.BAD_REQUEST,
        };

      /** ทรานแซกชันชนกัน — ลองใหม่ได้เลย จึงเป็น 409 ไม่ใช่ 500 */
      case 'P2034':
        return {
          statusCode: 409,
          message: 'มีการแก้ข้อมูลชุดเดียวกันพร้อมกัน กรุณาลองอีกครั้ง',
          errorCode: ERROR_CODES.CONFLICT,
        };

      default:
        return null;
    }
  }

  /**
   * ต่อฐานข้อมูลไม่ได้ / engine ล้ม → **503 ไม่ใช่ 500**
   * 500 แปลว่า "โค้ดเราพัง" ซึ่งชวนให้ไปหาบั๊กผิดที่ · 503 แปลว่า "ลองใหม่อีกครั้งได้"
   * และ client กับ load balancer ปฏิบัติกับสองอย่างนี้ต่างกัน
   */
  if (
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return {
      statusCode: 503,
      message: 'ระบบฐานข้อมูลไม่พร้อมให้บริการชั่วคราว กรุณาลองอีกครั้ง',
      errorCode: ERROR_CODES.SERVICE_UNAVAILABLE,
    };
  }

  return null;
}

/** error ของ multer (ขนาดไฟล์ จำนวนไฟล์ ชื่อ field) — ทั้งหมดเป็นความผิดของคำขอ */
function fromMulter(error: unknown): NormalizedError | null {
  if (propOf(error, 'name') !== 'MulterError') return null;

  const code = propOf(error, 'code');
  const rawMessage = propOf(error, 'message');

  if (code === 'LIMIT_FILE_SIZE') {
    return {
      statusCode: 413,
      message: 'ไฟล์มีขนาดใหญ่เกินกำหนด (สูงสุด 5MB)',
      errorCode: ERROR_CODES.PAYLOAD_TOO_LARGE,
    };
  }

  if (code === 'LIMIT_FILE_COUNT' || code === 'LIMIT_UNEXPECTED_FILE') {
    return {
      statusCode: 400,
      message: 'อัปโหลดได้ครั้งละ 1 ไฟล์ และต้องส่งมาในชื่อ field ว่า file',
      errorCode: ERROR_CODES.BAD_REQUEST,
    };
  }

  return {
    statusCode: 400,
    message: `ข้อผิดพลาดในการอัปโหลดไฟล์: ${typeof rawMessage === 'string' ? rawMessage : String(code)}`,
    errorCode: ERROR_CODES.BAD_REQUEST,
  };
}

/**
 * แปลง error อะไรก็ได้ให้เป็น response ตาม shape มาตรฐาน (STEP 30)
 *
 * แยกออกมาเป็นฟังก์ชันบริสุทธิ์เพื่อให้เทสต์ยิง error สังเคราะห์เข้ามาตรงได้
 * (เช่น P2002 ของ Prisma ซึ่งสร้างสถานการณ์จริงผ่าน HTTP ได้ยากเพราะ service ดักไว้ก่อนแล้ว)
 *
 * ลำดับสำคัญ: `ApiError` ต้องมาก่อนทุกอย่าง เพราะเป็น error ที่ **เราตั้งใจโยน**
 * พร้อมข้อความที่เขียนให้ผู้ใช้อ่านแล้ว — ตัวอื่นเป็นแค่ตาข่ายกันตก
 */
export function normalizeError(error: unknown): NormalizedError {
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

  return (
    fromBodyParser(error) ??
    fromMulter(error) ??
    fromUriError(error) ??
    fromPrisma(error) ??
    fromHttpError(error) ?? {
      statusCode: 500,
      message: 'เกิดข้อผิดพลาดภายในระบบ',
      errorCode: ERROR_CODES.INTERNAL_ERROR,
    }
  );
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

  const { statusCode, message, errorCode, details } = normalizeError(error);

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
