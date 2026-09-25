"use client";

import { useEffect } from "react";

import { ErrorPanel } from "@/components/shared/error-panel";

/**
 * Error boundary ของทุกหน้าที่อยู่นอกกลุ่ม (storefront) และ /admin — คือ /signin และ /after-signin (STEP 30)
 *
 * แต่ละกลุ่มมี `error.tsx` ของตัวเองเพื่อให้ยัง **เห็นเมนูของกลุ่มนั้น** ตอนหน้าพัง
 * ส่วนไฟล์นี้เป็นตัวรับที่เหลือ ซึ่งเรนเดอร์ใน root layout จึงไม่มี navbar
 * (error ที่เกิดใน root layout เองไปที่ `global-error.tsx`)
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // ยังไม่มีปลายทางรับรายงาน error (STEP 51) — log ลง console ให้ตามรอยตอน dev ได้ก่อน
    console.error("หน้าพัง:", error);
  }, [error]);

  return <ErrorPanel digest={error.digest} onRetry={reset} />;
}
