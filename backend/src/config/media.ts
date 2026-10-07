import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from './env.ts';

/**
 * รูปภาพของร้าน (STEP 14 · STEP 47)
 *
 * รูปมีสองแหล่ง
 *   1. **รูปที่ร้านเก็บเอง** (`/media/...`) — อัปโหลดผ่านหลังบ้านหรือแนบรีวิว
 *      ทุกไฟล์ถูกแปลงใหม่ก่อนเก็บ (ดู `services/media.service.ts`)
 *   2. **รูปจากโฮสต์ภายนอกที่อนุญาต** — ข้อมูลตัวอย่างจาก seed และ `images` ตอนสร้างสินค้าผ่าน API
 *
 * ⚠️ `ALLOWED_IMAGE_HOSTS` ต้องตรงกับ `images.remotePatterns` ใน `frontend/next.config.ts`
 *    และ `/media/` ต้องตรงกับ `images.localPatterns` + rewrite `/media/:path*` ของไฟล์เดียวกัน
 *    ถ้า backend ยอมรับ URL ที่ frontend ไม่ได้อนุญาต `next/image` จะโหลดรูปไม่ขึ้น
 *    (เห็นเป็นกรอบว่างในหน้าเว็บ) จึงต้องตรวจตั้งแต่ตอนบันทึก ไม่ใช่ปล่อยไปพังหน้าบ้าน
 *
 * ⚠️ **ยังไม่มี Cloudinary หรือ object storage** — เครื่องนี้ไม่มีบัญชีให้ยืนยันกับของจริง
 *    การเขียน adapter ที่ทดสอบกับของจริงไม่ได้เลยแย่กว่าการบอกความจริง (กฎเดียวกับ Redis ของ STEP 34)
 *    ไฟล์อยู่บนดิสก์ของ backend (`UPLOAD_DIR`) · ตอน deploy ต้องเป็น volume ที่ไม่หายตอน redeploy
 *    และรัน backend ได้ **instance เดียว** จนกว่าจะเปลี่ยนที่เก็บใน `media-storage.ts` ที่เดียว
 */
export const ALLOWED_IMAGE_HOSTS = ['images.unsplash.com', 'lh3.googleusercontent.com'] as const;

export function isAllowedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);

    // บังคับ https เท่านั้น — กัน mixed content บนหน้าเว็บที่เป็น https
    if (url.protocol !== 'https:') return false;

    return (ALLOWED_IMAGE_HOSTS as readonly string[]).includes(url.hostname);
  } catch {
    return false;
  }
}

export function allowedImageHostsText(): string {
  return ALLOWED_IMAGE_HOSTS.join(' · ');
}

/** path สาธารณะของไฟล์ที่ร้านเก็บเอง — backend เสิร์ฟที่นี่ และ frontend rewrite path เดียวกันมาหา backend */
export const MEDIA_URL_PREFIX = '/media/';

export type MediaPurposeKey = 'PRODUCT' | 'REVIEW';

export interface MediaRule {
  /** โฟลเดอร์ใน UPLOAD_DIR — ส่วนแรกของ storageKey */
  folder: string;
  /** ด้านที่สั้นที่สุดของรูปต้นฉบับต้องยาวอย่างน้อยเท่านี้ (px) */
  minShortEdge: number;
  /** ด้านที่ยาวที่สุดหลังย่อ (px) — รูปที่เล็กกว่านี้ไม่ถูกขยาย */
  maxLongEdge: number;
  /** คุณภาพ WebP ที่เก็บจริง */
  quality: number;
}

/**
 * กฎต่อการใช้งาน — ขนาดขั้นต่ำต่างกันโดยเจตนา
 *
 * รูปสินค้าแสดงเต็มกว้างในหน้าสินค้าบนจอ retina (~1200px จริง) รูปเล็กกว่า 600px จะแตกให้เห็น
 * รูปรีวิวเป็นรูปจากมือถือของลูกค้าที่แสดงเป็นภาพย่อ จึงรับขนาดเล็กกว่าได้
 */
export const MEDIA_RULES: Record<MediaPurposeKey, MediaRule> = {
  PRODUCT: { folder: 'products', minShortEdge: 600, maxLongEdge: 2000, quality: 82 },
  REVIEW: { folder: 'reviews', minShortEdge: 200, maxLongEdge: 1600, quality: 80 },
};

/**
 * ขีดจำกัดของไฟล์ที่ผู้ใช้ส่งมา (ก่อนแปลง)
 *
 * `maxInputPixels` กัน "decompression bomb" — PNG สีเดียวขนาด 30,000 × 30,000 มีขนาดไฟล์
 * ไม่กี่ร้อย KB (ผ่านด่านขนาดไฟล์) แต่ถอดออกมาแล้วกินหน่วยความจำหลาย GB
 * ตรวจจากหัวไฟล์ก่อนถอดจริง และส่งให้ sharp ตรวจซ้ำอีกชั้น
 */
export const UPLOAD_LIMITS = {
  maxBytes: 8 * 1024 * 1024,
  maxInputPixels: 40_000_000,
} as const;

/**
 * ชนิดไฟล์ที่รับ — ตัดสินจาก **เนื้อไฟล์** ที่ sharp อ่านได้ ไม่ใช่นามสกุลหรือ mimetype ที่ผู้ใช้ส่งมา
 * mimetype ใช้แค่ปฏิเสธไฟล์ที่เห็นชัดว่าไม่ใช่รูปตั้งแต่ชั้น multer (ไม่ต้องอ่านเนื้อไฟล์)
 *
 * ไม่รับ: GIF (รูปเคลื่อนไหว) · SVG (เป็นเอกสารที่มีสคริปต์ได้ ไม่ใช่รูปถ่าย) · HEIC
 * (ตัวถอดรหัส HEVC ไม่มีใน sharp รุ่นที่ติดตั้ง — iPhone ส่งเป็น JPEG ให้เองเมื่อเลือกจากคลังรูปผ่านเว็บ)
 */
export const ACCEPTED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

export const ACCEPTED_IMAGE_TEXT = 'JPEG, PNG, WebP หรือ AVIF';

/** จำนวนรูปสูงสุด — เท่ากับเพดานเดิมของ `images` ตอนสร้างสินค้า (STEP 14) */
export const PRODUCT_IMAGE_LIMIT = 10;
export const REVIEW_IMAGE_LIMIT = 4;

/**
 * ไฟล์ที่ไม่มีที่ไหนใช้แล้วต้องรอนานเท่านี้ก่อนลบได้ (ชั่วโมง)
 *
 * ทำไมไม่ลบทันที: คำสั่งซื้อที่กำลังสร้างอยู่อาจอ่าน url ของรูปไปแล้วก่อนรูปถูกถอด
 * แล้วเขียนลง `OrderItem.imageUrl` หลังจากนั้นไม่กี่มิลลิวินาที — ลบทันทีคือรูปแตกในประวัติคำสั่งซื้อ
 * ช่วงผ่อนผันยังทำให้แอดมินที่ถอดรูปผิดมีเวลาบอกให้ช่วยกู้ไฟล์ได้
 */
export const MEDIA_UNUSED_GRACE_HOURS = 24;

/**
 * โฟลเดอร์เก็บไฟล์ — `UPLOAD_DIR` หรือ `backend/uploads` ถ้าไม่ได้ตั้ง
 *
 * คิดจากตำแหน่งไฟล์นี้ (ไม่ใช่ `process.cwd()`) เพราะ dev/test/production รันจากคนละโฟลเดอร์
 * โครงสร้าง `src/config` กับ `dist/config` ลึกเท่ากัน จึงได้โฟลเดอร์เดียวกันทั้งสองแบบ
 */
export function uploadRoot(): string {
  if (env.UPLOAD_DIR !== undefined) return path.resolve(env.UPLOAD_DIR);

  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..', 'uploads');
}
