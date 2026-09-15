"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { orderStatusLabel } from "@/features/orders/lib/labels";
import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { updateOrderStatus } from "@/services/admin.service";
import type { AdminOrder, UpdateOrderStatusInput } from "@/types/admin";

/**
 * ฟอร์มเปลี่ยนสถานะคำสั่งซื้อ (STEP 13)
 *
 * ⚠️ แสดงเฉพาะสถานะที่ `allowedNextStatuses` จาก server อนุญาต
 *    แต่ **ไม่ใช่การป้องกัน** — backend ตรวจเส้นทางและสิทธิ์ซ้ำทุกครั้ง
 * ⚠️ เปลี่ยนเป็น "จัดส่งแล้ว" ต้องกรอกขนส่ง + เลขพัสดุจริง (server บังคับเช่นกัน)
 *    ระบบไม่สร้างเลขพัสดุสมมติให้
 */
export function OrderStatusForm({ order }: { order: AdminOrder }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState(order.allowedNextStatuses[0] ?? "");
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [adminNote, setAdminNote] = useState(order.adminNote ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const disabled = busy || isPending;
  const needsTracking = status === "SHIPPING";

  if (order.allowedNextStatuses.length === 0) {
    return (
      <p className="rounded-[var(--radius-card)] border border-line bg-lilac-50 p-4 text-sm text-muted">
        คำสั่งซื้อสถานะ <strong>{orderStatusLabel(order.status)}</strong>{" "}
        เปลี่ยนสถานะต่อจากหน้านี้ไม่ได้แล้ว
        {order.status === "DELIVERED" && " — การคืนสินค้า/คืนเงินจะทำผ่านระบบของ STEP 43"}
      </p>
    );
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(null);

    const input: UpdateOrderStatusInput = {
      status,
      ...(adminNote.trim() !== "" ? { adminNote: adminNote.trim() } : {}),
      ...(needsTracking
        ? {
            carrier: carrier.trim(),
            trackingNumber: trackingNumber.trim(),
            ...(trackingUrl.trim() !== "" ? { trackingUrl: trackingUrl.trim() } : {}),
          }
        : {}),
    };

    try {
      const updated = await updateOrderStatus(order.orderNumber, input);

      setDone(`อัปเดตเป็น ${orderStatusLabel(updated.status)} แล้ว`);
      setStatus(updated.allowedNextStatuses[0] ?? "");
      setCarrier("");
      setTrackingNumber("");
      setTrackingUrl("");
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "อัปเดตสถานะไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-brand/25 bg-lilac-50 p-5">
      <h2 className="text-lg">อัปเดตสถานะ</h2>
      <p className="mt-1 text-sm text-muted">
        สถานะปัจจุบัน: <strong className="text-ink">{orderStatusLabel(order.status)}</strong>
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {order.allowedNextStatuses.map((next) => (
          <button
            key={next}
            type="button"
            onClick={() => setStatus(next)}
            disabled={disabled}
            className={cn(
              "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
              status === next
                ? "border-brand bg-brand text-white"
                : "border-line bg-white hover:border-brand-soft",
            )}
          >
            {orderStatusLabel(next)}
          </button>
        ))}
      </div>

      {needsTracking && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold">ผู้ให้บริการขนส่ง *</span>
            <input
              value={carrier}
              onChange={(event) => setCarrier(event.target.value)}
              placeholder="Flash Express / Thailand Post"
              disabled={disabled}
              className={inputClass}
            />
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-semibold">เลขพัสดุจริง *</span>
            <input
              value={trackingNumber}
              onChange={(event) => setTrackingNumber(event.target.value)}
              placeholder="TH1234567890"
              disabled={disabled}
              className={inputClass}
            />
          </label>

          <label className="block text-sm sm:col-span-2">
            <span className="mb-1 block font-semibold">ลิงก์ติดตาม (ไม่บังคับ)</span>
            <input
              value={trackingUrl}
              onChange={(event) => setTrackingUrl(event.target.value)}
              placeholder="https://..."
              disabled={disabled}
              className={inputClass}
            />
          </label>
        </div>
      )}

      <label className="mt-4 block text-sm">
        <span className="mb-1 block font-semibold">บันทึกภายใน (ไม่บังคับ)</span>
        <textarea
          value={adminNote}
          onChange={(event) => setAdminNote(event.target.value)}
          rows={2}
          maxLength={500}
          disabled={disabled}
          className="w-full rounded-[12px] border border-line bg-white p-3 text-sm"
        />
      </label>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={disabled || status === ""}
        className="btn-brand mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-sm font-bold transition disabled:opacity-60"
      >
        {disabled ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            กำลังบันทึก…
          </>
        ) : (
          <>บันทึกสถานะ {status !== "" ? orderStatusLabel(status) : ""}</>
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

        {done !== null && (
          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-success">
            <Check className="size-4 shrink-0" aria-hidden />
            {done}
          </p>
        )}
      </div>

      <p className="mt-3 text-xs text-muted">
        ทุกการเปลี่ยนสถานะถูกบันทึกไว้ในประวัติการแก้ไข (ใคร เมื่อไร จากอะไรเป็นอะไร) ·
        ยกเลิกออเดอร์ที่ตัดสต็อกแล้วจะรับของกลับเข้าคลังให้อัตโนมัติ
      </p>
    </div>
  );
}

const inputClass =
  "min-h-11 w-full rounded-[12px] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft";
