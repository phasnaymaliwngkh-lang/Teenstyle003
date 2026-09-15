"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ApiClientError } from "@/lib/api";
import { clearCart } from "@/services/cart.service";

/** ล้างตะกร้าทั้งใบ — ถามยืนยันก่อน เพราะกดผิดแล้วกู้คืนไม่ได้ (STEP 9) */
export function ClearCartButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function doClear() {
    setBusy(true);
    setError(null);

    try {
      await clearCart();
      setConfirming(false);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ล้างตะกร้าไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-4 text-sm font-semibold text-muted transition hover:bg-danger/5 hover:text-danger"
      >
        <Trash2 className="size-4" aria-hidden />
        ล้างตะกร้า
      </button>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm font-semibold text-danger">ลบสินค้าทั้งหมดในตะกร้า?</span>

      <button
        type="button"
        onClick={() => void doClear()}
        disabled={busy || isPending}
        className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] bg-danger px-4 text-sm font-bold text-white transition disabled:opacity-60"
      >
        {busy || isPending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        ยืนยันลบทั้งหมด
      </button>

      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="min-h-11 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:bg-lilac-50"
      >
        ยกเลิก
      </button>

      {error !== null && (
        <p role="alert" className="text-xs font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
