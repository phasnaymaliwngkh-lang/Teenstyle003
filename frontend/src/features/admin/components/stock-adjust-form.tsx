"use client";

import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ClipboardCheck,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { describeApiError } from "../lib/api-error-text";

import { cn } from "@/lib/utils";
import { adjustStock } from "@/services/admin.service";
import type { AdjustStockInput, InventoryRow } from "@/types/admin";

type Mode = "STOCK_IN" | "STOCK_OUT" | "ADJUSTMENT";

const MODES: { value: Mode; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    value: "STOCK_IN",
    label: "รับของเข้า",
    hint: "ของมาถึงคลังจริง เช่น รับจากผู้ผลิต",
    icon: <ArrowDownToLine className="size-4" aria-hidden />,
  },
  {
    value: "STOCK_OUT",
    label: "ตัดของออก",
    hint: "ของออกจากคลังโดยไม่ได้ขาย เช่น ชำรุด สูญหาย ให้ตัวอย่าง",
    icon: <ArrowUpFromLine className="size-4" aria-hidden />,
  },
  {
    value: "ADJUSTMENT",
    label: "ปรับตามการตรวจนับ",
    hint: "กรอกยอดที่นับได้จริง ระบบคำนวณผลต่างให้เอง",
    icon: <ClipboardCheck className="size-4" aria-hidden />,
  },
];

/**
 * ฟอร์มปรับสต็อก (STEP 15)
 *
 * ⚠️ **ไม่มีช่อง "ตั้งจำนวนเป็น X" แบบลอย ๆ** — ต้องบอกว่าทำอะไร (รับเข้า/ตัดออก/ตรวจนับ)
 *    และ **ต้องกรอกเหตุผล** เพราะทุกชิ้นที่เพิ่มหรือหายต้องตรวจย้อนหลังได้ว่าใครทำและเพราะอะไร
 * ⚠️ `idempotencyKey` สร้างครั้งเดียวต่อการเปิดฟอร์ม แล้วสร้างใหม่หลังบันทึกสำเร็จ
 *    → กดปุ่มซ้ำหรือ retry ตอนเน็ตหลุด จะไม่ทำให้ยอดขยับสองเท่า
 * ⚠️ ลดยอดต่ำกว่าของที่ลูกค้าจองไว้ไม่ได้ — server ปฏิเสธ (409) และ UI อธิบายเพดานให้เห็นก่อน
 */
export function StockAdjustForm({ row }: { row: InventoryRow }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>("STOCK_IN");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const disabled = busy || isPending;
  const parsed = amount.trim() === "" ? null : Number(amount);
  const validAmount =
    parsed !== null && Number.isInteger(parsed) && parsed >= (mode === "ADJUSTMENT" ? 0 : 1);

  /** ยอดหลังปรับตามที่กรอก — ใช้เตือนก่อนกด ไม่ใช่การตัดสินใจแทน server */
  const nextQuantity =
    parsed === null
      ? null
      : mode === "STOCK_IN"
        ? row.quantity + parsed
        : mode === "STOCK_OUT"
          ? row.quantity - parsed
          : parsed;

  const belowReserved = nextQuantity !== null && nextQuantity < row.reserved;
  const noChange = mode === "ADJUSTMENT" && parsed === row.quantity;

  async function submit() {
    if (!validAmount || parsed === null) return;

    setBusy(true);
    setError(null);
    setDone(null);

    const input: AdjustStockInput =
      mode === "ADJUSTMENT"
        ? { type: "ADJUSTMENT", countedQuantity: parsed, reason: reason.trim(), idempotencyKey }
        : { type: mode, quantity: parsed, reason: reason.trim(), idempotencyKey };

    try {
      const updated = await adjustStock(row.variantId, input);

      setDone(
        `บันทึกแล้ว — ยอดในคลังตอนนี้ ${updated.inventory.quantity} ชิ้น ` +
          `(ขายได้จริง ${updated.inventory.available} ชิ้น)`,
      );
      setAmount("");
      setReason("");
      // คีย์ใหม่สำหรับรายการถัดไป ไม่งั้นรายการต่อไปจะถูกมองว่าเป็นรายการเดิม
      setIdempotencyKey(crypto.randomUUID());
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(describeApiError(caught, "ปรับสต็อกไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-brand/25 bg-lilac-50 p-5">
      <h2 className="text-lg">ปรับสต็อก</h2>
      <p className="mt-1 text-sm text-muted">
        ทุกรายการถูกบันทึกเป็นประวัติการเคลื่อนไหว (ใคร เมื่อไร จากเท่าไรเป็นเท่าไร เพราะอะไร)
        และแก้ย้อนหลังไม่ได้ — ถ้ากรอกผิดให้ปรับกลับด้วยรายการใหม่
      </p>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {MODES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => {
              setMode(item.value);
              setAmount("");
            }}
            disabled={disabled}
            aria-pressed={mode === item.value}
            className={cn(
              "flex min-h-11 flex-col items-start gap-1 rounded-[12px] border p-3 text-left text-sm transition",
              mode === item.value
                ? "border-brand bg-white shadow-[var(--shadow-soft)]"
                : "border-line bg-white/60 hover:border-brand-soft",
            )}
          >
            <span className="flex items-center gap-2 font-bold">
              {item.icon}
              {item.label}
            </span>
            <span className="text-xs text-muted">{item.hint}</span>
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold">
            {mode === "ADJUSTMENT" ? "ยอดที่นับได้จริง (ชิ้น) *" : "จำนวน (ชิ้น) *"}
          </span>
          <input
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="numeric"
            placeholder={mode === "ADJUSTMENT" ? String(row.quantity) : "0"}
            disabled={disabled}
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-muted">
            ปัจจุบันในคลัง {row.quantity} ชิ้น · จองไว้ {row.reserved} ชิ้น · ลดได้ไม่ต่ำกว่า{" "}
            {row.reserved} ชิ้น
          </span>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold">เหตุผล *</span>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder={
              mode === "STOCK_IN"
                ? "รับของจากผู้ผลิต ล็อต …"
                : mode === "STOCK_OUT"
                  ? "ของชำรุดจากการขนส่ง"
                  : "ตรวจนับประจำเดือน …"
            }
            maxLength={300}
            disabled={disabled}
            className={inputClass}
          />
          <span className="mt-1 block text-xs text-muted">อย่างน้อย 3 ตัวอักษร</span>
        </label>
      </div>

      {nextQuantity !== null && validAmount && (
        <p
          className={cn(
            "mt-3 rounded-[12px] border p-3 text-sm",
            belowReserved || noChange
              ? "border-danger/25 bg-danger/5 font-semibold text-danger"
              : "border-line bg-white",
          )}
        >
          {noChange ? (
            <>ยอดที่นับได้ตรงกับระบบอยู่แล้ว ({row.quantity} ชิ้น) จึงไม่มีอะไรต้องปรับ</>
          ) : belowReserved ? (
            <>
              ทำไม่ได้: ยอดหลังปรับ ({nextQuantity} ชิ้น) ต่ำกว่าของที่ลูกค้าจองไว้ ({row.reserved}{" "}
              ชิ้น) — ต้องจัดการคำสั่งซื้อเหล่านั้นก่อน
            </>
          ) : (
            <>
              หลังบันทึก: ในคลัง <strong>{nextQuantity}</strong> ชิ้น · ขายได้จริง{" "}
              <strong>{Math.max(0, nextQuantity - row.reserved)}</strong> ชิ้น
            </>
          )}
        </p>
      )}

      <div aria-live="polite">
        {error !== null && (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-[12px] border border-danger/25 bg-white p-3 text-sm font-semibold break-words text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {done !== null && (
          <p className="mt-3 flex items-start gap-2 text-sm font-semibold text-success">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
            {done}
          </p>
        )}
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={disabled || !validAmount || reason.trim().length < 3 || belowReserved || noChange}
        className="btn-brand mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-sm font-bold transition disabled:opacity-60"
      >
        {disabled ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            กำลังบันทึก…
          </>
        ) : (
          <>บันทึก{MODES.find((item) => item.value === mode)?.label}</>
        )}
      </button>
    </section>
  );
}

const inputClass =
  "min-h-11 w-full rounded-[12px] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft";
