"use client";

import { CheckCheck, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiClientError } from "@/lib/api";
import { markAllNotificationsRead } from "@/services/notification.service";

/**
 * ปุ่ม "อ่านทั้งหมดแล้ว" (STEP 24)
 *
 * ปิดปุ่มเมื่อไม่มีอะไรค้างอยู่ — ปุ่มที่กดแล้วไม่เกิดอะไรทำให้ผู้ใช้สับสนว่าระบบพัง
 */
export function MarkAllReadButton({ unreadCount }: { unreadCount: number }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (pending || unreadCount === 0) return;
    setPending(true);
    setError(null);

    try {
      await markAllNotificationsRead();
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "บันทึกไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={pending || unreadCount === 0}
        className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <CheckCheck className="size-4" aria-hidden />
        )}
        อ่านทั้งหมดแล้ว
      </button>

      {error !== null && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
