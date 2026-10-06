"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { describeApiError } from "@/lib/api-error-text";
import { cancelReturnRequest } from "@/services/returns.service";

/**
 * ลูกค้ายกเลิกคำขอคืนของตัวเอง (STEP 43) — ได้จนกว่าร้านจะตรวจรับของ (server ตัดสิน)
 * กดสองจังหวะ (ยกเลิก → ยืนยัน) กันเผลอแตะบนมือถือ
 */
export function CancelReturnButton({
  returnId,
  returnNumber,
}: {
  returnId: string;
  returnNumber: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setPending(true);
    setError(null);

    try {
      await cancelReturnRequest(returnId);
      router.refresh();
    } catch (failure) {
      setError(describeApiError(failure, "ยกเลิกไม่สำเร็จ กรุณาลองอีกครั้ง"));
      setPending(false);
    }
  }

  return (
    <div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">ยกเลิกคำขอ {returnNumber}?</span>
          <button
            type="button"
            onClick={() => void cancel()}
            disabled={pending}
            className="min-h-11 rounded-[var(--radius-pill)] border border-danger/40 px-4 text-sm font-bold text-danger transition hover:bg-danger/5 disabled:opacity-50"
          >
            ยืนยันยกเลิก
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={pending}
            className="min-h-11 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:bg-lilac-50"
          >
            ไม่ยกเลิก
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="min-h-11 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold text-muted transition hover:border-danger/40 hover:text-danger"
        >
          ยกเลิกคำขอ
        </button>
      )}
      {error !== null && (
        <p role="alert" className="mt-2 text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
