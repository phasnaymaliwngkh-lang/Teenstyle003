"use client";

import { AlertTriangle, Ban, CreditCard, Info, Loader2, Truck } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { cancelOrder, startPayment } from "@/services/payment.service";
import type { PaymentProviderCode, PaymentState } from "@/types/catalog";
import { formatBaht } from "@/utils/format";

/**
 * แผงเลือกวิธีชำระเงิน (STEP 11)
 *
 * ⚠️ **ไม่มีปุ่มใดในนี้ที่ทำให้ออเดอร์กลายเป็น "จ่ายแล้ว"**
 *    - COD → server ยืนยันออเดอร์และตัดสต็อก แต่สถานะการเงินยังเป็น "รอเก็บเงินปลายทาง"
 *    - Stripe → พาไปหน้าชำระเงินของ Stripe · สถานะจ่ายแล้วมาจาก webhook ที่ลายเซ็นถูกต้องเท่านั้น
 *    - ช่องทางที่ยังตั้งค่าไม่ครบถูกปิด พร้อมบอกเหตุผลจาก server ตรง ๆ
 */
export function PaymentPanel({ state }: { state: PaymentState }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [provider, setProvider] = useState<PaymentProviderCode>(
    state.methods.find((method) => method.available)?.code ?? "COD",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const disabled = busy || isPending;
  const chosen = state.methods.find((method) => method.code === provider);

  async function pay() {
    if (chosen === undefined || !chosen.available) return;

    setBusy(true);
    setError(null);

    try {
      const result = await startPayment(state.order.orderNumber, provider);

      if (result.kind === "redirect") {
        // ออกจากเว็บเราไปหน้าชำระเงินของ Stripe (ข้อมูลบัตรกรอกที่นั่น ไม่ผ่านเซิร์ฟเวอร์เรา)
        window.location.href = result.url;
        return;
      }

      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "เริ่มการชำระเงินไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);

    try {
      await cancelOrder(state.order.orderNumber);
      setConfirmingCancel(false);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "ยกเลิกคำสั่งซื้อไม่สำเร็จ");
    } finally {
      setBusy(false);
    }
  }

  if (!state.payable) {
    return <PaymentStatusNotice state={state} />;
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-brand/25 bg-lilac-50 p-5">
      <h2 className="flex items-center gap-2 text-lg">
        <CreditCard className="size-5 text-brand" aria-hidden />
        เลือกวิธีชำระเงิน
      </h2>

      <p className="mt-1 text-sm text-muted">
        ต้องชำระภายใน{" "}
        <strong className="text-ink">
          {new Date(state.deadline).toLocaleString("th-TH", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </strong>{" "}
        · ยอด {formatBaht(state.order.total)}
      </p>

      <div className="mt-4 space-y-2">
        {state.methods.map((method) => (
          <label
            key={method.code}
            className={cn(
              "flex gap-3 rounded-[12px] border bg-white p-3 transition",
              provider === method.code && method.available ? "border-brand" : "border-line",
              method.available ? "cursor-pointer hover:border-brand-soft" : "opacity-60",
            )}
          >
            <input
              type="radio"
              name="payment-provider"
              value={method.code}
              checked={provider === method.code}
              disabled={!method.available || disabled}
              onChange={() => setProvider(method.code)}
              className="mt-1 size-4 accent-[var(--color-brand)]"
            />
            <span className="min-w-0 flex-1 text-sm">
              <span className="flex flex-wrap items-center gap-2 font-bold">
                {method.online ? (
                  <CreditCard className="size-4 shrink-0 text-brand" aria-hidden />
                ) : (
                  <Truck className="size-4 shrink-0 text-brand" aria-hidden />
                )}
                {method.name}
              </span>
              <span className="mt-0.5 block text-muted">{method.description}</span>
              {!method.available && method.unavailableReason !== null && (
                <span className="mt-1 flex items-start gap-1.5 text-xs font-semibold text-warning">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                  {method.unavailableReason}
                </span>
              )}
            </span>
          </label>
        ))}
      </div>

      <button
        type="button"
        onClick={() => void pay()}
        disabled={disabled || chosen === undefined || !chosen.available}
        className={cn(
          "mt-4 flex min-h-13 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-base font-bold transition",
          chosen?.available
            ? "btn-brand"
            : "cursor-not-allowed border border-line bg-white text-muted-light",
        )}
      >
        {disabled ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden />
            กำลังดำเนินการ…
          </>
        ) : chosen?.online ? (
          <>
            <CreditCard className="size-5" aria-hidden />
            ไปหน้าชำระเงิน
          </>
        ) : (
          <>
            <Truck className="size-5" aria-hidden />
            ยืนยันเก็บเงินปลายทาง
          </>
        )}
      </button>

      {chosen?.online === false && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          กดยืนยันแล้วคำสั่งซื้อจะเข้าคิวจัดของทันที และจ่ายเงินสดตอนรับสินค้า
        </p>
      )}

      <div aria-live="polite">
        {error !== null && (
          <p
            role="alert"
            className="mt-3 rounded-[12px] border border-danger/25 bg-danger/5 p-3 text-sm font-semibold break-words text-danger"
          >
            {error}
          </p>
        )}
      </div>

      {/* ยกเลิกคำสั่งซื้อ — คืนสินค้าที่จองไว้เข้าคลัง */}
      <div className="mt-4 border-t border-line pt-4">
        {confirmingCancel ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-danger">ยกเลิกคำสั่งซื้อนี้?</span>
            <button
              type="button"
              onClick={() => void cancel()}
              disabled={disabled}
              className="min-h-11 rounded-[var(--radius-pill)] bg-danger px-4 text-sm font-bold text-white transition disabled:opacity-60"
            >
              ยืนยันยกเลิก
            </button>
            <button
              type="button"
              onClick={() => setConfirmingCancel(false)}
              disabled={disabled}
              className="min-h-11 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition"
            >
              ไม่ยกเลิก
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingCancel(true)}
            className="flex min-h-11 items-center gap-2 text-sm font-semibold text-muted transition hover:text-danger"
          >
            <Ban className="size-4" aria-hidden />
            ยกเลิกคำสั่งซื้อนี้ (คืนสินค้าเข้าคลัง)
          </button>
        )}
      </div>
    </section>
  );
}

/** สถานะที่จ่ายไม่ได้แล้ว — บอกตามความจริงจากฐานข้อมูล */
function PaymentStatusNotice({ state }: { state: PaymentState }) {
  const { order } = state;

  const notice =
    order.paymentStatus === "PAID"
      ? {
          tone: "success" as const,
          title: "ชำระเงินแล้ว",
          detail: `ได้รับเงิน ${formatBaht(order.total)} เรียบร้อย · ร้านกำลังเตรียมจัดส่ง`,
        }
      : order.status === "CANCELLED"
        ? {
            tone: "muted" as const,
            title: "คำสั่งซื้อถูกยกเลิก",
            detail: "สินค้าที่จองไว้ถูกคืนเข้าคลังแล้ว — สั่งซื้อใหม่ได้ทุกเมื่อ",
          }
        : order.status === "PROCESSING" && order.paymentStatus === "PENDING"
          ? {
              tone: "success" as const,
              title: "ยืนยันคำสั่งซื้อแล้ว (เก็บเงินปลายทาง)",
              detail: `เตรียมเงินสด ${formatBaht(order.total)} ให้พนักงานส่งของตอนรับสินค้า`,
            }
          : state.expired
            ? {
                tone: "warning" as const,
                title: "เลยกำหนดชำระเงินแล้ว",
                detail: "คำสั่งซื้อนี้จะถูกยกเลิกและคืนสินค้าเข้าคลัง — กรุณาสั่งซื้อใหม่",
              }
            : {
                tone: "muted" as const,
                title: `สถานะคำสั่งซื้อ: ${order.status}`,
                detail: `สถานะการเงิน: ${order.paymentStatus}`,
              };

  return (
    <section
      className={cn(
        "rounded-[var(--radius-card)] border p-5",
        notice.tone === "success" && "border-success/25 bg-success/5",
        notice.tone === "warning" && "border-warning/30 bg-warning/5",
        notice.tone === "muted" && "border-line bg-white",
      )}
    >
      <h2
        className={cn(
          "text-lg",
          notice.tone === "success" && "text-success",
          notice.tone === "warning" && "text-warning",
        )}
      >
        {notice.title}
      </h2>
      <p className="mt-1 text-sm text-ink-soft">{notice.detail}</p>

      {state.attempts.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-line pt-3 text-xs text-muted">
          {state.attempts.map((attempt) => (
            <li key={`${attempt.provider}-${attempt.createdAt}`}>
              {attempt.provider} · {attempt.status} · {formatBaht(attempt.amount)} ·{" "}
              {new Date(attempt.createdAt).toLocaleString("th-TH", {
                dateStyle: "short",
                timeStyle: "short",
              })}
              {attempt.failureReason !== null && ` · ${attempt.failureReason}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
