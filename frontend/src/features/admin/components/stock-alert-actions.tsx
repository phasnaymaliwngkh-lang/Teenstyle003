"use client";

import { AlertTriangle, Check, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { describeApiError } from "../lib/api-error-text";

import { acknowledgeStockAlert, scanStockAlerts } from "@/services/admin.service";

/**
 * ปุ่ม "ตรวจทั้งร้าน" (STEP 16)
 *
 * ⚠️ ระบบตรวจให้เองทุกครั้งที่สต็อกขยับอยู่แล้ว ปุ่มนี้ไว้ตรวจย้อนของที่ตกเกณฑ์
 *    ไปก่อนที่ระบบแจ้งเตือนจะมีอยู่ — ข้อความผลลัพธ์ต้องบอกตามจริงว่าเจอใหม่กี่รายการ
 *    **ห้ามบอกว่า "แจ้งเตือนแล้ว" ถ้าไม่มีอะไรใหม่ให้แจ้ง**
 */
export function ScanAlertsButton() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disabled = busy || isPending;

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const scan = await scanStockAlerts();

      setResult(
        scan.created + scan.escalated === 0
          ? `ตรวจแล้ว ไม่มีรายการใหม่ที่ต้องแจ้ง (เข้าเกณฑ์เตือนอยู่ ${scan.alerts} รายการ)`
          : `แจ้งเตือนใหม่ ${scan.created + scan.escalated} รายการ` +
              (scan.resolved > 0 ? ` · ปิดรายการที่กลับมาปกติ ${scan.resolved} รายการ` : ""),
      );
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(describeApiError(caught, "ตรวจสต็อกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <button
        type="button"
        onClick={() => void submit()}
        disabled={disabled}
        className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-60"
      >
        {disabled ? (
          <Loader2 className="size-4 animate-spin" aria-hidden />
        ) : (
          <RefreshCw className="size-4" aria-hidden />
        )}
        ตรวจทั้งร้าน
      </button>

      <div aria-live="polite">
        {result !== null && <p className="text-xs font-semibold text-success">{result}</p>}
        {error !== null && (
          <p role="alert" className="text-xs font-semibold text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** ปุ่มรับทราบรายตัว — ปิดรายการบนป้าย แต่ของก็ยังเหลือน้อยอยู่ */
export function AcknowledgeButton({
  notificationId,
  label,
}: {
  notificationId: string;
  label: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = busy || isPending;

  async function submit() {
    setBusy(true);
    setError(null);

    try {
      await acknowledgeStockAlert(notificationId);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(describeApiError(caught, "รับทราบไม่สำเร็จ"));
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={() => void submit()}
        disabled={disabled}
        aria-label={`รับทราบการแจ้งเตือนของ ${label}`}
        className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white px-4 text-xs font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-60"
      >
        {disabled ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Check className="size-3.5" aria-hidden />
        )}
        รับทราบ
      </button>

      {error !== null && (
        <p role="alert" className="flex items-center gap-1 text-xs font-semibold text-danger">
          <AlertTriangle className="size-3.5" aria-hidden />
          {error}
        </p>
      )}
    </div>
  );
}
