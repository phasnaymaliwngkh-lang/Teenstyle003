"use client";

import { AlertTriangle, Check, Loader2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { describeApiError } from "@/lib/api-error-text";
import { megabytes } from "@/lib/image-upload";
import { purgeUnusedMedia } from "@/services/admin.service";

/**
 * ปุ่มลบไฟล์ที่ไม่ได้ใช้แล้ว (STEP 47)
 *
 * ⚠️ ลบถาวร กู้คืนไม่ได้ จึงต้องกดยืนยันสองจังหวะ
 * ⚠️ ตัวเลขที่บอกว่า "ลบได้กี่ไฟล์" มาจาก server ตอนโหลดหน้า — server ตรวจซ้ำทุกไฟล์ตอนลบจริง
 *    (ไฟล์ที่กลับมาถูกใช้ระหว่างนั้นจะไม่ถูกลบ) แล้วรายงานผลจริงกลับมา
 */
export function MediaPurgeButton({
  deletable,
  deletableBytes,
  graceHours,
}: {
  deletable: number;
  deletableBytes: number;
  graceHours: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function purge() {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const outcome = await purgeUnusedMedia();
      const parts = [
        outcome.deleted > 0
          ? `ลบแล้ว ${outcome.deleted.toLocaleString("th-TH")} ไฟล์ (${megabytes(outcome.freedBytes)})`
          : "ไม่มีไฟล์ที่ลบได้ตอนนี้",
      ];
      if (outcome.waiting > 0) {
        parts.push(
          `อีก ${outcome.waiting.toLocaleString("th-TH")} ไฟล์ยังอยู่ในช่วงรอ ${graceHours} ชั่วโมง`,
        );
      }
      setResult(parts.join(" · "));
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(describeApiError(caught, "ลบไฟล์ไม่สำเร็จ"));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const disabled = busy || isPending;

  return (
    <div>
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void purge()}
            disabled={disabled}
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-danger bg-danger px-5 text-sm font-bold text-white disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-4" aria-hidden />
            )}
            ยืนยันลบถาวร {deletable.toLocaleString("th-TH")} ไฟล์
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            disabled={disabled}
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold"
          >
            ยกเลิก
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={disabled || deletable === 0}
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-danger hover:text-danger disabled:opacity-50"
        >
          <Trash2 className="size-4" aria-hidden />
          {deletable === 0
            ? "ยังไม่มีไฟล์ที่ลบได้"
            : `ลบไฟล์ที่ไม่ได้ใช้ ${deletable.toLocaleString("th-TH")} ไฟล์ (${megabytes(deletableBytes)})`}
        </button>
      )}

      <div aria-live="polite" className="mt-2">
        {error !== null && (
          <p role="alert" className="flex items-start gap-2 text-sm font-semibold text-danger">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {result !== null && (
          <p className="flex items-start gap-2 text-sm font-semibold text-success">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            {result}
          </p>
        )}
      </div>
    </div>
  );
}
