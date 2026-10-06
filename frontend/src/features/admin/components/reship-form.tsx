"use client";

import { AlertTriangle, Loader2, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { describeApiError } from "@/lib/api-error-text";
import { createShipment } from "@/services/shipping.service";

import { EMPTY_TRACKING, toTrackingInput, TrackingFields, trackingReady } from "./tracking-fields";

/**
 * ส่งพัสดุใหม่หลังพัสดุชิ้นเดิมถูกตีกลับถึงร้าน (STEP 44)
 *
 * แสดงเมื่อ server บอกว่าทำได้ (`canReship`) — ด่านจริงอยู่ที่ backend
 * ไม่เก็บเงินลูกค้าเพิ่มและไม่ตัดสต็อกซ้ำ (ของชิ้นเดิมที่กลับมาคือของที่ส่งออกไปใหม่)
 */
export function ReshipForm({ orderNumber }: { orderNumber: string }) {
  const router = useRouter();
  const [tracking, setTracking] = useState(EMPTY_TRACKING);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setPending(true);
    setError(null);

    try {
      await createShipment(orderNumber, toTrackingInput(tracking));
      setTracking(EMPTY_TRACKING);
      router.refresh();
    } catch (failure) {
      setError(describeApiError(failure, "บันทึกการส่งพัสดุใหม่ไม่สำเร็จ"));
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-warning/30 bg-white p-5">
      <h2 className="flex items-center gap-2 text-lg">
        <Truck className="size-5 text-brand" aria-hidden />
        ส่งพัสดุใหม่
      </h2>
      <p className="mt-1 text-sm text-muted">
        กรอกขนส่งและเลขพัสดุของชิ้นที่ส่งออกไปใหม่ — ลูกค้าได้รับแจ้งเลขพัสดุใหม่ทันที
      </p>

      <div className="mt-4">
        <TrackingFields value={tracking} onChange={setTracking} disabled={pending} />
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={pending || !trackingReady(tracking)}
        className="btn-brand mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-sm font-bold transition disabled:opacity-60"
      >
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            กำลังบันทึก…
          </>
        ) : (
          "บันทึกการส่งพัสดุใหม่"
        )}
      </button>

      <div aria-live="polite">
        {error !== null && (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-[12px] border border-danger/25 bg-danger/5 p-3 text-sm font-semibold break-words text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
