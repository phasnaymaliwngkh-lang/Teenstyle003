import {
  ACCEPTED_IMAGE_TEXT,
  MEDIA_RULES,
  MEDIA_URL_PREFIX,
  UPLOAD_LIMITS,
  type MediaPurposeKey,
} from '../config/media.ts';

/**
 * กฎล้วนของไฟล์รูป (STEP 47) — ไม่แตะดิสก์ ไม่แตะฐานข้อมูล
 *
 * **รูปแบบของ storageKey มีที่นี่ที่เดียว** ทั้งตัวสร้าง (`mediaStorageKey`) ตัวอ่านกลับ
 * (`mediaIdFromUrl`) และตัวตรวจตอนเสิร์ฟไฟล์ (`MEDIA_KEY_PATTERN`)
 * — บทเรียนจาก STEP 40: ตัวสร้างเลขคำสั่งซื้อกับตัวอ่านเคยใช้รูปแบบคนละแบบจนอ่านไม่เจอเลย
 */

const FOLDERS = Object.values(MEDIA_RULES).map((rule) => rule.folder);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

/** `products/2026/10/<uuid>.webp` — ใช้ตรวจ path ก่อนเสิร์ฟไฟล์ (กัน path traversal อีกชั้น) */
export const MEDIA_KEY_PATTERN = new RegExp(
  `^(?:${FOLDERS.join('|')})/\\d{4}/\\d{2}/(${UUID})\\.webp$`,
);

/**
 * ที่อยู่ของไฟล์ — ทุกส่วนมาจากระบบ (โฟลเดอร์ตามการใช้งาน · ปี/เดือน UTC · id ที่สุ่มเอง)
 * **ไม่มีส่วนไหนมาจากชื่อไฟล์ของผู้ใช้** จึงไม่มีทางมี `..` หรืออักขระแปลก ๆ หลุดเข้ามา
 */
export function mediaStorageKey(purpose: MediaPurposeKey, id: string, at: Date): string {
  const year = at.getUTCFullYear();
  const month = String(at.getUTCMonth() + 1).padStart(2, '0');

  return `${MEDIA_RULES[purpose].folder}/${year}/${month}/${id}.webp`;
}

export function mediaUrlOf(storageKey: string): string {
  return `${MEDIA_URL_PREFIX}${storageKey}`;
}

export function isMediaUrl(url: string): boolean {
  return url.startsWith(MEDIA_URL_PREFIX);
}

/** id ของไฟล์จาก url ที่ระบบสร้าง — url ภายนอกหรือรูปแบบไม่ตรง = null */
export function mediaIdFromUrl(url: string): string | null {
  if (!isMediaUrl(url)) return null;

  const match = MEDIA_KEY_PATTERN.exec(url.slice(MEDIA_URL_PREFIX.length));
  return match?.[1] ?? null;
}

/** สิ่งที่อ่านได้จากหัวไฟล์ (รูปเดียวกับ `sharp().metadata()` เฉพาะช่องที่ใช้) */
export interface SourceImageInfo {
  format?: string | undefined;
  /** HEIF เป็นกล่องที่ใส่ได้ทั้ง AV1 (AVIF) และ HEVC (HEIC) — ต้องดูช่องนี้แยก */
  compression?: string | undefined;
  width?: number | undefined;
  height?: number | undefined;
  /** มากกว่า 1 = รูปเคลื่อนไหว */
  pages?: number | undefined;
}

export function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

/**
 * ตรวจรูปต้นฉบับก่อนถอดรหัสจริง — คืนข้อความที่บอกผู้ใช้ว่าต้องแก้อะไร หรือ null = ผ่าน
 *
 * ⚠️ ตัดสินจาก **เนื้อไฟล์** ไม่ใช่นามสกุล/mimetype ที่ผู้ใช้ส่งมา
 *    ไฟล์ HTML ที่ตั้งชื่อว่า .jpg จะไม่มี `format` ที่รู้จัก แล้วถูกปฏิเสธตรงนี้
 */
export function checkSourceImage(info: SourceImageInfo, purpose: MediaPurposeKey): string | null {
  const rule = MEDIA_RULES[purpose];

  switch (info.format) {
    case 'jpeg':
    case 'png':
    case 'webp':
      break;
    case 'heif':
      if (info.compression !== 'av1') {
        return `ไฟล์ HEIC ยังไม่รองรับ — กรุณาส่งเป็น ${ACCEPTED_IMAGE_TEXT} (iPhone: ตั้งค่า > กล้อง > รูปแบบ > ใช้ร่วมกันได้มากที่สุด)`;
      }
      break;
    case 'gif':
      return `ไม่รับรูปเคลื่อนไหว (GIF) — กรุณาส่งเป็น ${ACCEPTED_IMAGE_TEXT}`;
    case 'svg':
      return `ไม่รับไฟล์ SVG — กรุณาส่งเป็นรูปถ่าย ${ACCEPTED_IMAGE_TEXT}`;
    default:
      return `ไฟล์นี้ไม่ใช่รูปที่ระบบรองรับ — กรุณาส่งเป็น ${ACCEPTED_IMAGE_TEXT}`;
  }

  if ((info.pages ?? 1) > 1) {
    return `ไม่รับรูปเคลื่อนไหว — กรุณาส่งเป็นรูปนิ่ง ${ACCEPTED_IMAGE_TEXT}`;
  }

  const width = info.width ?? 0;
  const height = info.height ?? 0;

  if (width <= 0 || height <= 0) {
    return 'อ่านขนาดของรูปไม่ได้ — ไฟล์อาจเสียหาย';
  }

  if (width * height > UPLOAD_LIMITS.maxInputPixels) {
    return `รูปมีความละเอียดสูงเกินกว่าที่รองรับ (สูงสุด ${(UPLOAD_LIMITS.maxInputPixels / 1_000_000).toLocaleString('th-TH')} ล้านพิกเซล) — ย่อรูปก่อนแล้วลองใหม่`;
  }

  // ด้านที่สั้นที่สุดไม่ขึ้นกับการหมุนตาม EXIF จึงเทียบกับขนาดในหัวไฟล์ได้เลย
  if (Math.min(width, height) < rule.minShortEdge) {
    return `รูปเล็กเกินไป (${width} × ${height} px) — ด้านที่สั้นที่สุดต้องยาวอย่างน้อย ${rule.minShortEdge} px`;
  }

  return null;
}

export interface MediaAssetDto {
  id: string;
  url: string;
  purpose: MediaPurposeKey;
  width: number;
  height: number;
  bytes: number;
  originalBytes: number;
  createdAt: string;
}

/** รูปที่แนบกับรีวิว — `id` ใช้ลบรูปนั้น (null = url ที่ไม่ได้มาจากระบบอัปโหลด) */
export interface ReviewImageDto {
  id: string | null;
  url: string;
}

export function toReviewImages(urls: readonly string[]): ReviewImageDto[] {
  return urls.map((url) => ({ id: mediaIdFromUrl(url), url }));
}
