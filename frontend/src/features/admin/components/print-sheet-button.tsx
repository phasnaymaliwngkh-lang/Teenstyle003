"use client";

import { Printer } from "lucide-react";

/**
 * ปุ่มสั่งพิมพ์ (STEP 17)
 *
 * เป็น client component เล็ก ๆ เพราะต้องเรียก `window.print()`
 * ถ้า JS ยังไม่โหลด ผู้ใช้ยังกด Ctrl+P ได้เหมือนกัน — หน้านี้จึงไม่พึ่ง JS ในการพิมพ์
 */
export function PrintSheetButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-brand flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold transition"
    >
      <Printer className="size-4" aria-hidden />
      พิมพ์ป้าย
    </button>
  );
}
