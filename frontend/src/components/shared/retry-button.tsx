"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cn } from "@/lib/utils";

/**
 * ปุ่มลองใหม่สำหรับ section ที่โหลดข้อมูลไม่สำเร็จ (STEP 32)
 *
 * ใช้ router.refresh() เพื่อให้ Next ดึงข้อมูลของ Server Component ใหม่
 * โดยไม่ต้องโหลดหน้าทั้งหน้า และ useTransition ทำให้รู้ว่ากำลังโหลดอยู่
 */
export function RetryButton({ label = "ลองอีกครั้ง" }: { label?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clicked, setClicked] = useState(false);

  function handleClick() {
    setClicked(true);
    startTransition(() => {
      router.refresh();
    });
  }

  const busy = isPending && clicked;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className="btn-brand inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-60"
    >
      <RefreshCw className={cn("size-4", busy && "animate-spin")} aria-hidden />
      {busy ? "กำลังโหลด…" : label}
    </button>
  );
}
