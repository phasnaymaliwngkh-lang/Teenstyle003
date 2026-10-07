/**
 * ตรวจไฟล์รูปก่อนอัปโหลด (STEP 47) — **เพื่อ UX เท่านั้น**
 *
 * บอกผู้ใช้ทันทีว่าไฟล์ผิดชนิดหรือใหญ่เกิน ไม่ต้องรอส่งไฟล์ 8MB ขึ้นไปก่อนแล้วค่อยรู้
 * ตัวตัดสินจริงคือ backend ที่อ่าน **เนื้อไฟล์** (ชนิดที่เบราว์เซอร์บอกมาปลอมได้)
 */
export interface ImageUploadRules {
  maxBytes: number;
  acceptedTypes: readonly string[];
  acceptedText: string;
}

export function megabytes(bytes: number): string {
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

export function precheckImageFile(file: File, rules: ImageUploadRules): string | null {
  if (file.type === "image/heic" || file.type === "image/heif") {
    return `ไฟล์ HEIC ยังไม่รองรับ — กรุณาส่งเป็น ${rules.acceptedText}`;
  }

  if (!rules.acceptedTypes.includes(file.type)) {
    return `รับเฉพาะ ${rules.acceptedText}`;
  }

  if (file.size > rules.maxBytes) {
    return `ไฟล์ใหญ่ ${megabytes(file.size)} — สูงสุด ${megabytes(rules.maxBytes)}`;
  }

  return null;
}

/**
 * เงื่อนไขรูปรีวิว — ตัวเลขชุดเดียวกับ `REVIEW_IMAGE_LIMIT` / `UPLOAD_LIMITS` /
 * `ACCEPTED_IMAGE_MIME_TYPES` ใน backend/src/config/media.ts
 * ⚠️ backend/tests/media-config.test.ts เทียบค่าทุกตัวกับ backend — แก้ฝั่งเดียวแล้วเทสต์ล้ม
 */
export const REVIEW_PHOTO_RULES = {
  maxPhotos: 4,
  maxBytes: 8 * 1024 * 1024,
  acceptedTypes: ["image/jpeg", "image/png", "image/webp", "image/avif"],
  acceptedText: "JPEG, PNG, WebP หรือ AVIF",
} as const;
