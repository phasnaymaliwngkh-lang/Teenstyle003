"use client";

import { AlertTriangle, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { describeApiError } from "@/lib/api-error-text";
import { cn } from "@/lib/utils";
import { updateShipment, updateShipmentStatus } from "@/services/shipping.service";
import type { AdminShipmentDetail } from "@/types/shipping";

import { inputClass } from "./tracking-fields";

type NextStatus = "IN_TRANSIT" | "FAILED" | "RETURNED";

/**
 * จัดการพัสดุหนึ่งชิ้น (STEP 44) — ขึ้นเฉพาะสิ่งที่ server บอกว่าทำได้ (`allowedNextStatuses` · `canEdit`)
 *
 * ⚠️ ส่งไม่สำเร็จ/ตีกลับต้องเขียนข้อความถึงลูกค้า — ลูกค้าเห็นข้อความนี้ในหน้าคำสั่งซื้อและการแจ้งเตือน
 * ⚠️ แก้เลขพัสดุต้องมีเหตุผล และระบบแจ้งเลขใหม่ให้ลูกค้าเอง (เขาถือเลขเก่าอยู่)
 * ⚠️ "ส่งถึงแล้ว" ไม่อยู่ที่นี่ — ทำที่สถานะคำสั่งซื้อทางเดียว (ได้เงิน COD + แต้ม)
 */
export function ShipmentActions({
  shipment,
  canUpdate,
}: {
  shipment: AdminShipmentDetail;
  /** มีสิทธิ์ `shipment:update` */
  canUpdate: boolean;
}) {
  const router = useRouter();
  const id = useId();
  const [next, setNext] = useState<NextStatus | null>(null);
  const [note, setNote] = useState("");
  const [trackingNumber, setTrackingNumber] = useState(shipment.trackingNumber ?? "");
  const [carrier, setCarrier] = useState(shipment.carrier);
  const initialDate =
    shipment.estimatedDelivery === null ? "" : toDateInput(shipment.estimatedDelivery);
  const [estimatedDate, setEstimatedDate] = useState(initialDate);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const choice = shipment.allowedNextStatuses.find((option) => option.status === next);
  const noteMissing = choice?.needsNote === true && note.trim().length < 3;

  if (!canUpdate || (shipment.allowedNextStatuses.length === 0 && !shipment.canEdit)) {
    return (
      <p className="text-sm text-muted">
        {!canUpdate
          ? "คุณดูข้อมูลพัสดุได้ แต่ไม่มีสิทธิ์แก้ไข"
          : shipment.isLatest
            ? "พัสดุชิ้นนี้จบแล้ว — ไม่มีอะไรให้แก้"
            : "พัสดุชิ้นนี้เป็นประวัติ (มีชิ้นที่ส่งใหม่แล้ว) — แก้ได้เฉพาะชิ้นล่าสุด"}
      </p>
    );
  }

  async function run(task: () => Promise<unknown>, fallback: string, reset: () => void) {
    setPending(true);
    setError(null);

    try {
      await task();
      reset();
      router.refresh();
    } catch (failure) {
      setError(describeApiError(failure, fallback));
    } finally {
      setPending(false);
    }
  }

  function submitStatus() {
    if (next === null) return;

    void run(
      () =>
        updateShipmentStatus(shipment.id, {
          status: next,
          ...(note.trim() !== "" ? { note: note.trim() } : {}),
        }),
      "บันทึกสถานะพัสดุไม่สำเร็จ",
      () => {
        setNext(null);
        setNote("");
      },
    );
  }

  function submitCorrection() {
    const estimatedDelivery =
      estimatedDate === "" ? null : new Date(`${estimatedDate}T23:59:59`).toISOString();

    void run(
      () =>
        updateShipment(shipment.id, {
          ...(carrier.trim() !== shipment.carrier ? { carrier: carrier.trim() } : {}),
          ...(trackingNumber.trim() !== (shipment.trackingNumber ?? "")
            ? { trackingNumber: trackingNumber.trim() }
            : {}),
          // เทียบเป็นวันที่ที่เห็นในช่อง — ไม่แตะช่องนี้ = ไม่ส่ง (เวลาในวันของค่าเดิมอาจไม่ใช่สิ้นวัน)
          ...(estimatedDate !== initialDate ? { estimatedDelivery } : {}),
          reason: reason.trim(),
        }),
      "แก้ข้อมูลพัสดุไม่สำเร็จ",
      () => setReason(""),
    );
  }

  return (
    <div className="space-y-6">
      {shipment.allowedNextStatuses.length > 0 && (
        <fieldset disabled={pending} className="space-y-3">
          <legend className="text-sm font-bold">เปลี่ยนสถานะพัสดุ</legend>
          <div className="flex flex-wrap gap-2">
            {shipment.allowedNextStatuses.map((option) => (
              <button
                key={option.status}
                type="button"
                onClick={() => setNext(option.status as NextStatus)}
                aria-pressed={next === option.status}
                className={cn(
                  "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
                  next === option.status
                    ? "border-brand bg-brand text-white"
                    : "border-line bg-white hover:border-brand-soft",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {choice !== undefined && (
            <div className="text-sm">
              <label htmlFor={`${id}-note`} className="mb-1 block font-semibold">
                ข้อความถึงลูกค้า{choice.needsNote ? " *" : " (ไม่บังคับ)"}
              </label>
              <textarea
                id={`${id}-note`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                rows={2}
                maxLength={300}
                placeholder={
                  choice.status === "RETURNED"
                    ? "เช่น ติดต่อผู้รับไม่ได้ครบ 3 ครั้ง ขนส่งตีกลับ"
                    : "เช่น ไม่มีผู้รับที่บ้าน ขนส่งจะนำส่งใหม่พรุ่งนี้"
                }
                className="w-full rounded-[12px] border border-line bg-white p-3 text-sm"
              />
              <p className="mt-1 text-xs text-muted">
                ลูกค้าเห็นข้อความนี้ในหน้าคำสั่งซื้อและการแจ้งเตือน
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={submitStatus}
            disabled={next === null || noteMissing}
            className="btn-brand flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-sm font-bold transition disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            บันทึกสถานะ{choice !== undefined ? ` "${choice.label}"` : ""}
          </button>
        </fieldset>
      )}

      {shipment.canEdit && (
        <fieldset disabled={pending} className="space-y-3 border-t border-line pt-5">
          <legend className="text-sm font-bold">แก้ข้อมูลที่กรอกผิด</legend>
          <div className="text-sm">
            <label htmlFor={`${id}-carrier`} className="mb-1 block font-semibold">
              ผู้ให้บริการขนส่ง
            </label>
            <input
              id={`${id}-carrier`}
              value={carrier}
              onChange={(event) => setCarrier(event.target.value)}
              className={inputClass}
            />
          </div>
          <div className="text-sm">
            <label htmlFor={`${id}-tracking`} className="mb-1 block font-semibold">
              เลขพัสดุ
            </label>
            <input
              id={`${id}-tracking`}
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
              className={inputClass}
            />
          </div>
          <div className="text-sm">
            <label htmlFor={`${id}-eta`} className="mb-1 block font-semibold">
              กำหนดส่งถึง (ลบวันที่ = ไม่ระบุ)
            </label>
            <input
              id={`${id}-eta`}
              type="date"
              value={estimatedDate}
              onChange={(event) => setEstimatedDate(event.target.value)}
              className={inputClass}
            />
          </div>
          <div className="text-sm">
            <label htmlFor={`${id}-reason`} className="mb-1 block font-semibold">
              เหตุผลที่แก้ *
            </label>
            <input
              id={`${id}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              placeholder="เช่น พิมพ์เลขพัสดุผิดหนึ่งหลัก"
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={submitCorrection}
            disabled={reason.trim().length < 3}
            className="flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white text-sm font-bold transition hover:border-brand-soft disabled:opacity-60"
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            บันทึกการแก้ไข
          </button>
          <p className="text-xs text-muted">
            เปลี่ยนเลขพัสดุหรือขนส่งแล้ว ระบบแจ้งข้อมูลใหม่ให้ลูกค้าเอง
          </p>
        </fieldset>
      )}

      <div aria-live="polite">
        {error !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[12px] border border-danger/25 bg-danger/5 p-3 text-sm font-semibold break-words text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

/** ISO → ค่าของ `<input type="date">` ตามวันที่ในเครื่องของคนที่เปิดหน้า */
function toDateInput(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
