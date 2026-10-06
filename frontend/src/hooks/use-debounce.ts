"use client";

import { useEffect, useState } from "react";

/**
 * ค่าที่ "นิ่ง" แล้ว — เปลี่ยนตามหลังค่าจริง `delayMs` มิลลิวินาที (STEP 45)
 * ใช้กับช่องค้นหา: ไม่ยิง API ทุกตัวอักษรที่พิมพ์
 *
 * setState อยู่ใน callback ของ timer ไม่ใช่ใน body ของ effect (กฎ react-hooks/set-state-in-effect)
 */
export function useDebounce<TValue>(value: TValue, delayMs: number): TValue {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);

    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
