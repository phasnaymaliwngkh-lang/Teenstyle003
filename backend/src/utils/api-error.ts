/**
 * Error code ที่ frontend ใช้ตัดสินใจแสดงข้อความ (STEP 30)
 * เพิ่มค่าใหม่ได้ แต่ห้ามเปลี่ยนความหมายของค่าที่มีอยู่แล้ว
 */
export const ERROR_CODES = {
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE: 'UNSUPPORTED_MEDIA_TYPE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/**
 * Error ที่ตั้งใจโยนออกจาก layer ต่าง ๆ ของ API
 * errorHandler จะแปลงเป็น response ตาม shape มาตรฐาน
 */
export class ApiError extends Error {
  readonly statusCode: number;
  readonly errorCode: ErrorCode;
  readonly details?: unknown;
  /** true = error ที่เราคาดไว้และปลอดภัยที่จะส่งข้อความให้ client */
  readonly isOperational = true;

  constructor(statusCode: number, message: string, errorCode: ErrorCode, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.errorCode = errorCode;
    if (details !== undefined) {
      this.details = details;
    }
    Error.captureStackTrace?.(this, ApiError);
  }

  static badRequest(message = 'คำขอไม่ถูกต้อง', details?: unknown): ApiError {
    return new ApiError(400, message, ERROR_CODES.BAD_REQUEST, details);
  }

  static unauthorized(message = 'กรุณาเข้าสู่ระบบก่อนใช้งาน'): ApiError {
    return new ApiError(401, message, ERROR_CODES.UNAUTHORIZED);
  }

  static forbidden(message = 'คุณไม่มีสิทธิ์เข้าถึงส่วนนี้'): ApiError {
    return new ApiError(403, message, ERROR_CODES.FORBIDDEN);
  }

  static notFound(message = 'ไม่พบข้อมูลที่ต้องการ'): ApiError {
    return new ApiError(404, message, ERROR_CODES.NOT_FOUND);
  }

  static conflict(message = 'ข้อมูลขัดแย้งกับสถานะปัจจุบัน', details?: unknown): ApiError {
    return new ApiError(409, message, ERROR_CODES.CONFLICT, details);
  }

  static validation(message = 'ข้อมูลที่ส่งมาไม่ถูกต้อง', details?: unknown): ApiError {
    return new ApiError(422, message, ERROR_CODES.VALIDATION_ERROR, details);
  }

  /** body ใหญ่เกินที่รับได้ (413) — ต่างจาก 400 เพราะผู้ใช้แก้ได้ด้วยการส่งน้อยลง ไม่ใช่แก้รูปแบบ */
  static payloadTooLarge(message = 'ข้อมูลที่ส่งมามีขนาดใหญ่เกินกำหนด'): ApiError {
    return new ApiError(413, message, ERROR_CODES.PAYLOAD_TOO_LARGE);
  }

  /** ชนิดหรือ charset ของ body ที่อ่านไม่ได้ (415) */
  static unsupportedMediaType(message = 'ชนิดข้อมูลที่ส่งมาไม่รองรับ'): ApiError {
    return new ApiError(415, message, ERROR_CODES.UNSUPPORTED_MEDIA_TYPE);
  }

  static tooManyRequests(message = 'ส่งคำขอถี่เกินไป กรุณารอสักครู่'): ApiError {
    return new ApiError(429, message, ERROR_CODES.TOO_MANY_REQUESTS);
  }

  static internal(message = 'เกิดข้อผิดพลาดภายในระบบ'): ApiError {
    return new ApiError(500, message, ERROR_CODES.INTERNAL_ERROR);
  }

  static serviceUnavailable(message = 'ระบบไม่พร้อมให้บริการชั่วคราว'): ApiError {
    return new ApiError(503, message, ERROR_CODES.SERVICE_UNAVAILABLE);
  }
}
