import { randomUUID } from 'node:crypto';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { uploadRoot } from '../config/media.ts';
import { MEDIA_KEY_PATTERN } from '../models/media.model.ts';

/**
 * ที่เก็บไฟล์รูป (STEP 47) — **จุดเดียวที่แตะดิสก์**
 *
 * ตอนนี้เป็นดิสก์ของเครื่อง backend (`UPLOAD_DIR`) — ถ้าวันหนึ่งย้ายไป object storage
 * (Cloudinary / S3 / R2) ให้เปลี่ยนไฟล์นี้ไฟล์เดียว แล้วเปลี่ยนการเสิร์ฟ `/media` ใน app.ts
 * ส่วนอื่นของระบบรู้จักแค่ `storageKey` กับ url ไม่รู้ว่าไฟล์อยู่ที่ไหน
 *
 * ⚠️ ข้อจำกัดของดิสก์ในเครื่อง (ต้องรู้ก่อน deploy)
 *    1. ต้องเป็น volume ถาวร — container ที่ไม่มี volume ลบรูปทั้งหมดทุกครั้งที่ redeploy
 *    2. รัน backend ได้ instance เดียว — instance อื่นมองไม่เห็นไฟล์ที่อีกตัวเขียน
 *    3. backup ฐานข้อมูลอย่างเดียวไม่พอ ต้อง backup โฟลเดอร์นี้ด้วย (STEP 50)
 */

/** path จริงบนดิสก์ — ปฏิเสธ key ที่ไม่ใช่รูปแบบที่ระบบสร้าง (กัน `..` และ path แปลก ๆ) */
export function mediaFilePath(storageKey: string): string {
  if (!MEDIA_KEY_PATTERN.test(storageKey)) {
    throw new Error(`storageKey ไม่ถูกต้อง: ${storageKey}`);
  }

  return path.join(uploadRoot(), ...storageKey.split('/'));
}

/**
 * เขียนไฟล์แบบ atomic — เขียนลงไฟล์ชั่วคราวในโฟลเดอร์เดียวกันก่อนแล้วค่อย rename
 * คนที่ขอไฟล์ระหว่างเขียนจะได้ 404 หรือไฟล์ครบทั้งไฟล์ ไม่มีทางได้ครึ่งไฟล์
 */
export async function writeMediaFile(storageKey: string, data: Buffer): Promise<void> {
  const target = mediaFilePath(storageKey);
  const temp = `${target}.${randomUUID()}.tmp`;

  await mkdir(path.dirname(target), { recursive: true });

  try {
    await writeFile(temp, data, { flag: 'wx' });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

/** ลบไฟล์ — ไม่มีไฟล์อยู่แล้วไม่ถือว่าผิด (ผลที่ต้องการเกิดขึ้นแล้ว) */
export async function removeMediaFile(storageKey: string): Promise<void> {
  await rm(mediaFilePath(storageKey), { force: true });
}

export async function mediaFileExists(storageKey: string): Promise<boolean> {
  try {
    return (await stat(mediaFilePath(storageKey))).isFile();
  } catch {
    return false;
  }
}
