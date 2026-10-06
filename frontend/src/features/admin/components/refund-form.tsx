"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { describeApiError } from "@/lib/api-error-text";
import type { RecordRefundInput, RefundMethodCode } from "@/types/returns";
import { formatBaht } from "@/utils/format";

/**
 * บันทึกการคืนเงินที่ร้าน **ทำไปแล้วจริง** (STEP 43 · `order:refund`)
 *
 * ⚠️ ระบบไม่ได้โอนเงินเอง — พนักงานคืนเงินที่ Stripe Dashboard หรือโอนเข้าบัญชีลูกค้าก่อน
 *    แล้วกรอกเลขอ้างอิงที่นี่ ฟอร์มต้องบอกเรื่องนี้ตรง ๆ ไม่งั้นพนักงานเข้าใจว่ากดแล้วเงินออกเอง
 * ⚠️ **ไม่มีช่องกรอกยอดเงิน** — ยอดคิดที่ server (`amount` ที่แสดงมาจาก server เช่นกัน)
 * ⚠️ `idempotencyKey` ครั้งเดียวต่อการเปิดฟอร์ม · ล้มแล้วลองใหม่ใช้คีย์เดิม (ไม่บันทึกซ้ำ)
 */
export function RefundForm({
  amount,
  methods,
  submit,
}: {
  /** ยอดที่จะบันทึก — คำนวณที่ server */
  amount: number;
  methods: { code: RefundMethodCode; label: string }[];
  submit: (input: RecordRefundInput) => Promise<{ applied: boolean }>;
}) {
  const router = useRouter();
  const fieldId = useId();
  const [method, setMethod] = useState<RefundMethodCode>(methods[0]?.code ?? "BANK_TRANSFER");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    if (reference.trim().length < 4) {
      setError("กรอกเลขอ้างอิงของการคืนเงิน (อย่างน้อย 4 ตัวอักษร) เพื่อให้ตรวจย้อนหลังได้");
      return;
    }

    setPending(true);

    try {
      const result = await submit({
        method,
        reference: reference.trim(),
        idempotencyKey,
        ...(note.trim() !== "" ? { note: note.trim() } : {}),
      });

      setNotice(result.applied ? "บันทึกการคืนเงินแล้ว" : "รายการนี้ถูกบันทึกไปแล้วก่อนหน้า");
      setReference("");
      setNote("");
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    } catch (failure) {
      setError(describeApiError(failure, "บันทึกการคืนเงินไม่สำเร็จ กรุณาลองอีกครั้ง"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      <p className="rounded-[12px] border border-warning/30 bg-warning/5 p-3 text-xs text-ink-soft">
        ระบบ<strong>ไม่ได้โอนเงินให้</strong> — คืนเงิน{" "}
        <strong className="text-brand-dark">{formatBaht(amount)}</strong> ในระบบปลายทางก่อน (Stripe
        Dashboard หรือแอปธนาคาร) แล้วบันทึกเลขอ้างอิงที่นี่ · ยอดนี้คำนวณจากเงินที่ลูกค้าจ่ายจริง
      </p>

      <div>
        <label htmlFor={`${fieldId}-method`} className="block text-xs font-bold">
          วิธีที่คืนเงิน
        </label>
        <select
          id={`${fieldId}-method`}
          value={method}
          onChange={(event) => setMethod(event.target.value as RefundMethodCode)}
          disabled={pending}
          className="mt-1 min-h-11 w-full max-w-sm rounded-[var(--radius-card)] border border-line bg-white px-3 text-sm"
        >
          {methods.map((option) => (
            <option key={option.code} value={option.code}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor={`${fieldId}-reference`} className="block text-xs font-bold">
          เลขอ้างอิง{" "}
          <span className="font-normal text-muted">
            ({method === "STRIPE_DASHBOARD" ? "refund id เช่น re_…" : "เลขที่รายการโอน"})
          </span>
        </label>
        <input
          id={`${fieldId}-reference`}
          value={reference}
          maxLength={100}
          onChange={(event) => setReference(event.target.value)}
          disabled={pending}
          className="mt-1 min-h-11 w-full rounded-[var(--radius-card)] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div>
        <label htmlFor={`${fieldId}-note`} className="block text-xs font-bold">
          หมายเหตุ <span className="font-normal text-muted">(ไม่บังคับ — ลูกค้าเห็น)</span>
        </label>
        <input
          id={`${fieldId}-note`}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          disabled={pending}
          className="mt-1 min-h-11 w-full rounded-[var(--radius-card)] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="btn-brand flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold transition disabled:opacity-50"
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        บันทึกว่าคืนเงินแล้ว
      </button>

      <div aria-live="polite">
        {notice !== null && <p className="text-sm font-semibold text-success">{notice}</p>}
      </div>
      {error !== null && (
        <p role="alert" className="text-sm font-semibold text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
