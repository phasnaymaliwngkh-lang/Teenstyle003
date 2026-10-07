import Image from "next/image";

import type { ReviewImage } from "@/types/catalog";

/**
 * รูปที่ลูกค้าแนบกับรีวิว (STEP 47) — ภาพย่อที่กดแล้วเปิดรูปเต็มในแท็บใหม่
 *
 * ทำเป็นลิงก์ ไม่ทำเป็นหน้าต่าง (dialog) เพื่อให้ใช้ได้ทั้งหน้าร้าน หน้ารีวิวของฉัน และหลังบ้าน
 * โดยไม่ต้องมี JS และไม่มีหน้าต่างให้ต้องดูแลเรื่อง focus/Esc (กฎหน้าต่างของโปรเจกต์)
 * รูปทุกรูปเป็นไฟล์ที่ร้านแปลงเองแล้ว (ไม่มี EXIF/GPS) — ลิงก์ไปที่ไฟล์ตรง ๆ ได้
 */
export function ReviewPhotos({ images, label }: { images: ReviewImage[]; label: string }) {
  if (images.length === 0) return null;

  return (
    <ul aria-label={`รูปจาก${label} ${images.length} รูป`} className="mt-3 flex flex-wrap gap-2">
      {images.map((image, index) => (
        <li key={image.url}>
          <a
            href={image.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`เปิดรูปที่ ${index + 1} จาก${label}ขนาดเต็ม (แท็บใหม่)`}
            className="relative block size-20 overflow-hidden rounded-[12px] border border-line bg-lilac-50 transition hover:border-brand-soft focus-visible:ring-2 focus-visible:ring-brand"
          >
            <Image src={image.url} alt="" fill sizes="80px" className="object-cover" />
          </a>
        </li>
      ))}
    </ul>
  );
}
