/**
 * โฮสต์รูปที่อนุญาต (STEP 14)
 *
 * ⚠️ ต้องตรงกับ `images.remotePatterns` ใน `frontend/next.config.ts`
 *    ถ้า backend ยอมรับ URL ที่ frontend ไม่ได้อนุญาต `next/image` จะโหลดรูปไม่ขึ้น
 *    (เห็นเป็นกรอบว่างในหน้าเว็บ) จึงต้องตรวจตั้งแต่ตอนบันทึก ไม่ใช่ปล่อยไปพังหน้าบ้าน
 *
 * STEP 47 (Image Management) จะเพิ่มโฮสต์ของ Cloudinary และการอัปโหลดไฟล์จริง
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
