import { readdir } from 'node:fs/promises';
import path from 'node:path';

import sharp from 'sharp';

/**
 * รูปทดสอบที่สร้างขึ้นสด ๆ (STEP 47) — ไม่เก็บไฟล์รูปไว้ใน repo
 *
 * `exifMarker` ใส่ข้อความลง EXIF (Copyright/Artist) เพื่อพิสูจน์ว่าไฟล์ที่ระบบเก็บไม่มี EXIF เหลือ
 * (EXIF คือก้อนเดียวกับที่เก็บพิกัด GPS ของรูปจากมือถือ — ก้อนนี้หายทั้งก้อน = GPS หายด้วย)
 */
export async function jpegFixture(
  width = 900,
  height = 900,
  options: { exifMarker?: string; orientation?: number } = {},
): Promise<Buffer> {
  let image = sharp({
    create: { width, height, channels: 3, background: { r: 124, g: 58, b: 237 } },
  }).jpeg({ quality: 80 });

  if (options.exifMarker !== undefined) {
    image = image.withExif({
      IFD0: { Copyright: options.exifMarker, Artist: options.exifMarker },
      IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '13/1 45/1 30/1' },
    });
  }

  if (options.orientation !== undefined) {
    image = image.withMetadata({ orientation: options.orientation });
  }

  return image.toBuffer();
}

export async function pngFixture(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .png()
    .toBuffer();
}

export async function gifFixture(): Promise<Buffer> {
  return sharp({ create: { width: 900, height: 900, channels: 3, background: '#000000' } })
    .gif()
    .toBuffer();
}

/** รายชื่อไฟล์ทั้งหมดใต้โฟลเดอร์ (ไล่ทุกชั้น) — ใช้ยืนยันว่าไม่มีไฟล์ค้างเมื่อบันทึกไม่สำเร็จ */
export async function listFiles(root: string): Promise<string[]> {
  try {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.join(entry.parentPath, entry.name));
  } catch {
    return [];
  }
}
