"use client";

import { useEffect } from "react";

import { ErrorPanel } from "@/components/shared/error-panel";

/**
 * Error boundary ของหลังบ้านทั้งกลุ่ม (STEP 30)
 *
 * เรนเดอร์ข้างใน `admin/layout.tsx` จึงยังมีแถบเมนูของ admin
 * และ **ยังผ่าน `requireStaff()` ของ layout อยู่** — หน้าพังไม่ได้เปิดช่องให้คนนอกเห็นหลังบ้าน
 *
 * ข้อความต่างจากหน้าร้านเพราะคนอ่านคือพนักงาน: บอกตรง ๆ ว่าอย่าเดาว่าบันทึกสำเร็จหรือไม่
 * ให้กลับไปดูข้อมูลจริงก่อน — การเดาผิดในงานหลังบ้านหมายถึงสต็อกหรือสถานะออเดอร์เพี้ยน
 */
export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("หน้าหลังบ้านพัง:", error);
  }, [error]);

  return (
    <ErrorPanel
      title="หน้านี้ทำงานต่อไม่ได้"
      description="เกิดข้อผิดพลาดที่เราไม่ได้คาดไว้ ถ้าเพิ่งกดบันทึกอะไรไป ให้กลับไปตรวจข้อมูลจริงก่อนว่าบันทึกสำเร็จหรือไม่ อย่าเดาจากหน้านี้"
      digest={error.digest}
      onRetry={reset}
      links={[{ href: "/admin", label: "กลับหน้าภาพรวมร้าน" }]}
    />
  );
}
