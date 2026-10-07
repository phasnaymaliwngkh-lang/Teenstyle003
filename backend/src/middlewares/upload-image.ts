import type { RequestHandler } from 'express';
import multer from 'multer';

import { ACCEPTED_IMAGE_MIME_TYPES, ACCEPTED_IMAGE_TEXT, UPLOAD_LIMITS } from '../config/media.ts';
import { megabytes } from '../models/media.model.ts';
import { ApiError } from '../utils/api-error.ts';

import { describeMiddleware } from './describe.ts';

/**
 * รับไฟล์รูป 1 ไฟล์ในชื่อ field `file` (STEP 47)
 *
 * - เก็บในหน่วยความจำ (ไม่เขียนไฟล์ชั่วคราวลงดิสก์) เพราะต้องแปลงใหม่ทั้งไฟล์อยู่แล้ว
 *   และ `UPLOAD_LIMITS.maxBytes` จำกัดขนาดต่อคำขอไว้
 * - mimetype ใช้แค่ปฏิเสธของที่เห็นชัดว่าไม่ใช่รูปตั้งแต่ก่อนรับไฟล์ทั้งก้อน
 *   **ตัวตัดสินจริงคือเนื้อไฟล์** ที่ `processImage()` อ่าน (ผู้ใช้ตั้ง mimetype เองได้)
 * - ฟิลด์ข้อความ (เช่น `alt`) จำกัดจำนวนและขนาดไว้ด้วย ไม่ให้ใช้ multipart ส่งข้อมูลก้อนใหญ่อ้อมด่าน 1MB ของ JSON
 *
 * ⚠️ ข้อความ 413 ของ multer ในตัวแปลง error กลางเขียนไว้สำหรับไฟล์นำเข้า (5MB)
 *    จึงแปลง `LIMIT_FILE_SIZE` ที่นี่เองให้บอกขนาดของรูปที่ถูกต้อง
 */
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: UPLOAD_LIMITS.maxBytes, files: 1, fields: 5, fieldSize: 2048 },
  fileFilter: (_req, file, callback) => {
    if (!(ACCEPTED_IMAGE_MIME_TYPES as readonly string[]).includes(file.mimetype)) {
      callback(
        file.mimetype === 'image/heic' || file.mimetype === 'image/heif'
          ? ApiError.badRequest(
              `ไฟล์ HEIC ยังไม่รองรับ — กรุณาส่งเป็น ${ACCEPTED_IMAGE_TEXT} (iPhone: ตั้งค่า > กล้อง > รูปแบบ > ใช้ร่วมกันได้มากที่สุด)`,
            )
          : ApiError.badRequest(`รับเฉพาะไฟล์รูป ${ACCEPTED_IMAGE_TEXT}`),
      );
      return;
    }

    callback(null, true);
  },
});

const single = imageUpload.single('file');

const handler: RequestHandler = (req, res, next) => {
  single(req, res, (error: unknown) => {
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: unknown }).code === 'LIMIT_FILE_SIZE'
    ) {
      next(
        ApiError.payloadTooLarge(
          `รูปมีขนาดใหญ่เกินกำหนด (สูงสุด ${megabytes(UPLOAD_LIMITS.maxBytes)}) — ย่อรูปก่อนแล้วลองใหม่`,
        ),
      );
      return;
    }

    if (error !== undefined && error !== null) {
      next(error);
      return;
    }

    if (!req.file) {
      next(ApiError.badRequest('กรุณาเลือกไฟล์รูป (ส่งมาในชื่อ field ว่า file)'));
      return;
    }

    next();
  });
};

/** ติดป้ายให้แผนผัง API รู้ว่าเส้นทางนี้รับไฟล์ (STEP 29) */
export const uploadImageFile = describeMiddleware(handler, { upload: 'file' });
