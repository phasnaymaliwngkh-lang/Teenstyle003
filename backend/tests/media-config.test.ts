import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ACCEPTED_IMAGE_MIME_TYPES,
  ACCEPTED_IMAGE_TEXT,
  ALLOWED_IMAGE_HOSTS,
  MEDIA_URL_PREFIX,
  REVIEW_IMAGE_LIMIT,
  UPLOAD_LIMITS,
} from '../src/config/media.ts';

/**
 * โหลดไฟล์ของ frontend ตอนรัน (ไม่ import แบบ static) — tsconfig ของ backend มี rootDir เป็น backend/
 * จึงอ้างไฟล์นอกโฟลเดอร์ตรง ๆ ไม่ได้ · ชนิดด้านล่างประกาศเฉพาะส่วนที่เทสต์ใช้
 */
const frontendRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'frontend',
);

interface NextConfigLike {
  images?: {
    localPatterns?: Array<{ pathname?: string; search?: string }>;
    remotePatterns?: Array<{ hostname: string } | URL>;
  };
  rewrites?: () => Promise<Array<{ source: string; destination: string }> | unknown>;
}

const nextConfig = (
  (await import(pathToFileURL(path.join(frontendRoot, 'next.config.ts')).href)) as {
    default: NextConfigLike;
  }
).default;

const { REVIEW_PHOTO_RULES } = (await import(
  pathToFileURL(path.join(frontendRoot, 'src', 'lib', 'image-upload.ts')).href
)) as {
  REVIEW_PHOTO_RULES: {
    maxPhotos: number;
    maxBytes: number;
    acceptedTypes: readonly string[];
    acceptedText: string;
  };
};

/**
 * ค่าของรูปที่ต้องตรงกันระหว่าง backend กับ frontend (STEP 47)
 *
 * คอมเมนต์ "⚠️ ต้องตรงกับ …" เคยเป็นแค่วินัยของคนเขียน — ที่นี่ทำให้เป็นสิ่งที่เทสต์ตรวจ
 *   - ถ้า next.config ไม่อนุญาต path/โฮสต์ที่ backend เก็บไว้ `next/image` จะโหลดรูปไม่ขึ้น
 *     (หน้าเว็บเป็นกรอบว่าง แต่ API ตอบ 200 ทุกชั้น)
 *   - ถ้าเพดานรูปรีวิวในหน้าเว็บไม่ตรงกับ backend ลูกค้าจะเลือกได้แล้วโดนปฏิเสธทีหลัง
 *     หรือถูกห้ามทั้งที่ server รับได้
 */
describe('ค่าของรูปตรงกันทั้งสองฝั่ง', () => {
  it('เงื่อนไขรูปรีวิวในหน้าเว็บ = ค่าของ backend', () => {
    expect(REVIEW_PHOTO_RULES.maxPhotos).toBe(REVIEW_IMAGE_LIMIT);
    expect(REVIEW_PHOTO_RULES.maxBytes).toBe(UPLOAD_LIMITS.maxBytes);
    expect([...REVIEW_PHOTO_RULES.acceptedTypes]).toEqual([...ACCEPTED_IMAGE_MIME_TYPES]);
    expect(REVIEW_PHOTO_RULES.acceptedText).toBe(ACCEPTED_IMAGE_TEXT);
  });

  it('next.config อนุญาต /media เป็นรูปภายใน (ห้ามมี query) และ rewrite ไปที่ backend', async () => {
    const prefix = MEDIA_URL_PREFIX.replace(/\/$/, '');

    expect(nextConfig.images?.localPatterns).toContainEqual({
      pathname: `${prefix}/**`,
      search: '',
    });

    const rewrites = await nextConfig.rewrites?.();
    const list = (Array.isArray(rewrites) ? rewrites : []) as Array<{
      source: string;
      destination: string;
    }>;
    const media = list.find((rule) => rule.source === `${prefix}/:path*`);

    expect(media?.destination).toMatch(new RegExp(`${prefix}/:path\\*$`));
  });

  it('next.config อนุญาตโฮสต์ภายนอกชุดเดียวกับที่ backend ยอมให้บันทึก', () => {
    const hosts = (nextConfig.images?.remotePatterns ?? []).map((pattern) =>
      pattern instanceof URL ? pattern.hostname : pattern.hostname,
    );

    expect([...hosts].sort()).toEqual([...ALLOWED_IMAGE_HOSTS].sort());
  });
});
