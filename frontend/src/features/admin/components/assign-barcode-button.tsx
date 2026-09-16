"use client";

import { AlertTriangle, Check, Loader2, ScanBarcode } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { describeApiError } from "../lib/api-error-text";

import { assignBarcode } from "@/services/admin.service";

/**
 * ออกบาร์โค้ดของร้านให้ตัวเลือกที่ยังไม่มี (STEP 17)
 *
 * ⚠️ ปุ่มนี้แสดงเฉพาะตอนที่ยังไม่มีบาร์โค้ด — backend ปฏิเสธการเขียนทับ (409) อยู่แล้ว
 *    เพราะเลขเดิมอาจพิมพ์ติดกับสินค้าไปแล้ว การเปลี่ยนเงียบ ๆ ทำให้ของในร้านสแกนไม่ตรงระบบ
 * ⚠️ ไม่ใช่ปุ่ม "สุ่มเลขใหม่" — ถ้าจะเปลี่ยนต้องล้างเลขเดิมที่หน้าจัดการสินค้าก่อน
 */
export function AssignBarcodeButton({ variantId }: { variantId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const disabled = busy || isPending;

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(null);

    try {
      const result = await assignBarcode(variantId);

      setDone(`ออกบาร์โค้ด ${result.barcode} แล้ว (${result.barcodeKind})`);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(describeApiError(caught, "ออกบาร์โค้ดไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void submit()}
        disabled={disabled}
        className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-brand bg-brand px-4 text-sm font-bold text-white transition disabled:opacity-60"
      >
        {disabled ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <ScanBarcode className="size-4" aria-hidden />
        )}
        ออกบาร์โค้ดของร้านให้
      </button>

      <div aria-live="polite">
        {error !== null && (
          <p
            role="alert"
            className="mt-2 flex items-start gap-2 text-sm font-semibold break-words text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {done !== null && (
          <p className="mt-2 flex items-start gap-2 text-sm font-semibold text-success">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            {done}
          </p>
        )}
      </div>
    </div>
  );
}
