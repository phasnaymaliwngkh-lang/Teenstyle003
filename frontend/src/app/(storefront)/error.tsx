"use client";

import { useEffect } from "react";

import { ErrorPanel } from "@/components/shared/error-panel";

/**
 * Error boundary ของหน้าร้านทั้งกลุ่ม (STEP 30)
 *
 * อยู่ใน `(storefront)` จึงเรนเดอร์ **ข้างใน layout ของหน้าร้าน** = ยังมี navbar และ footer
 * ผู้ใช้จึงไปที่อื่นต่อได้ ไม่ใช่เจอหน้าเปล่าที่ออกไปไหนไม่ได้
 *
 * ⚠️ ตัวนี้รับเฉพาะ error ที่ **หลุดออกมาจาก section** — section ที่ดึงข้อมูลต้องจับ error
 *    ของตัวเองแล้วแสดง `<SectionError>` ตามกฎ STEP 5 ข้อ 1 (section เดียวพังต้องไม่ทำให้ทั้งหน้าพัง)
 *    ถ้าหน้าไหนมาถึงตัวนี้บ่อย ๆ แปลว่า section นั้นยังไม่จับ error ของตัวเอง
 */
export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("หน้าร้านพัง:", error);
  }, [error]);

  return (
    <ErrorPanel
      digest={error.digest}
      onRetry={reset}
      links={[
        { href: "/shop", label: "ไปดูสินค้า" },
        { href: "/", label: "กลับหน้าแรก" },
      ]}
    />
  );
}
