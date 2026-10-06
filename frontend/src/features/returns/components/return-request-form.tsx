"use client";

import { Loader2, PackageOpen } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { describeApiError } from "@/lib/api-error-text";
import { cn } from "@/lib/utils";
import { createReturnRequest } from "@/services/returns.service";
import type { ReturnEligibility, ReturnReasonCode } from "@/types/returns";
import { formatBaht } from "@/utils/format";

/**
 * ฟอร์มขอคืนสินค้า (STEP 43)
 *
 * ⚠️ ส่งได้แค่ "ชิ้นไหน กี่ชิ้น เพราะอะไร" — **ไม่มียอดเงินในคำขอ**
 *    ยอดที่จะได้คืนคิดที่ server ด้วยสูตรเดียวกับที่ร้านใช้ตอนคืนเงินจริง แล้วแสดงในหน้าคำขอทันทีหลังส่ง
 * ⚠️ จำนวนชิ้นเลือกจากรายการ (0 ถึงจำนวนที่ยังคืนได้) ไม่ใช่ช่องพิมพ์
 *    จึงไม่มีทางส่งจำนวนที่ไม่ใช่ตัวเลข (บทเรียน NaN → null ของ STEP 37) หรือเกินที่ซื้อ
 * ⚠️ `idempotencyKey` สร้างครั้งเดียวต่อการเปิดหน้า — กดส่งซ้ำ/เน็ตกระตุกแล้วลองใหม่ได้คำขอเดิม
 */
export function ReturnRequestForm({ eligibility }: { eligibility: ReturnEligibility }) {
  const router = useRouter();
  const fieldId = useId();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReasonCode | null>(null);
  const [detail, setDetail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const returnable = eligibility.items.filter((item) => item.returnable > 0);
  const chosen = Object.entries(quantities).filter(([, quantity]) => quantity > 0);
  const detailLength = detail.trim().length;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (chosen.length === 0) {
      setError("เลือกสินค้าที่จะคืนอย่างน้อย 1 ชิ้น");
      return;
    }
    if (reason === null) {
      setError("เลือกเหตุผลที่ขอคืน");
      return;
    }
    if (detailLength < eligibility.detailMinLength) {
      setError(`เล่ารายละเอียดอย่างน้อย ${eligibility.detailMinLength} ตัวอักษร`);
      return;
    }

    setSubmitting(true);

    try {
      await createReturnRequest({
        orderNumber: eligibility.orderNumber,
        reason,
        detail: detail.trim(),
        items: chosen.map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
        idempotencyKey,
      });

      router.push("/account/returns");
      router.refresh();
    } catch (failure) {
      setError(describeApiError(failure, "ส่งคำขอไม่สำเร็จ กรุณาลองอีกครั้ง"));
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <fieldset className="rounded-[var(--radius-card)] border border-line bg-white p-5">
        <legend className="px-1 text-base font-extrabold">1. เลือกสินค้าที่จะคืน</legend>

        <ul className="mt-2 divide-y divide-line">
          {returnable.map((item) => (
            <li key={item.orderItemId} className="flex items-center gap-3 py-3">
              <span className="relative size-14 shrink-0 overflow-hidden rounded-[12px] bg-lilac-50">
                {item.imageUrl !== null && (
                  <Image src={item.imageUrl} alt="" fill sizes="56px" className="object-cover" />
                )}
              </span>
              <span className="min-w-0 flex-1 text-sm">
                <span className="block font-semibold break-words">{item.productName}</span>
                <span className="block text-xs text-muted">
                  {[item.colorName, item.sizeName].filter(Boolean).join(" · ")} ·{" "}
                  {formatBaht(item.unitPrice)} · ซื้อ {item.purchased} ชิ้น
                </span>
              </span>
              <label className="shrink-0 text-xs text-muted">
                <span className="sr-only">จำนวนที่จะคืนของ {item.productName}</span>
                <select
                  value={quantities[item.orderItemId] ?? 0}
                  onChange={(event) =>
                    setQuantities((current) => ({
                      ...current,
                      [item.orderItemId]: Number(event.target.value),
                    }))
                  }
                  disabled={submitting}
                  className="min-h-11 rounded-[12px] border border-line bg-white px-3 text-sm"
                >
                  {Array.from({ length: item.returnable + 1 }, (_, quantity) => (
                    <option key={quantity} value={quantity}>
                      {quantity === 0 ? "ไม่คืน" : `คืน ${quantity} ชิ้น`}
                    </option>
                  ))}
                </select>
              </label>
            </li>
          ))}
        </ul>
      </fieldset>

      <fieldset className="rounded-[var(--radius-card)] border border-line bg-white p-5">
        <legend className="px-1 text-base font-extrabold">2. เหตุผลที่ขอคืน</legend>

        <div className="mt-2 space-y-2">
          {eligibility.reasons.map((option) => (
            <label
              key={option.code}
              className={cn(
                "flex min-h-11 cursor-pointer gap-3 rounded-[12px] border p-3 text-sm transition",
                reason === option.code
                  ? "border-brand bg-lilac-50"
                  : "border-line hover:border-brand-soft",
              )}
            >
              <input
                type="radio"
                name={`${fieldId}-reason`}
                value={option.code}
                checked={reason === option.code}
                onChange={() => setReason(option.code)}
                disabled={submitting}
                className="mt-1 size-4 accent-[var(--color-brand)]"
              />
              <span>
                <span className="block font-semibold">{option.label}</span>
                <span className="block text-xs text-muted">{option.description}</span>
              </span>
            </label>
          ))}
        </div>

        <p className="mt-3 text-xs text-muted">
          ใส่ไม่พอดีหรืออยากเปลี่ยนไซซ์ — ไม่ใช่การคืนเงิน แจ้งเปลี่ยนไซซ์ได้ที่{" "}
          <Link href="/customer-service" className="font-semibold text-brand-dark underline">
            ฝ่ายบริการลูกค้า
          </Link>
        </p>
      </fieldset>

      <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
        <label htmlFor={`${fieldId}-detail`} className="block text-base font-extrabold">
          3. เล่ารายละเอียด
        </label>
        <p className="mt-1 text-xs text-muted">
          ตำหนิอยู่ตรงไหน หรือได้ของผิดอย่างไร (อย่างน้อย {eligibility.detailMinLength} ตัวอักษร) ·
          ยังแนบรูปในฟอร์มนี้ไม่ได้ — ส่งรูปในแชตฝ่ายบริการลูกค้าพร้อมเลขคำขอได้
        </p>
        <textarea
          id={`${fieldId}-detail`}
          value={detail}
          onChange={(event) => setDetail(event.target.value)}
          rows={4}
          maxLength={1000}
          disabled={submitting}
          className="mt-3 w-full rounded-[12px] border border-line bg-white p-3 text-sm outline-none focus:border-brand-soft"
        />
        <p className="mt-1 text-right text-xs text-muted">{detailLength} / 1,000</p>
      </div>

      <div aria-live="polite">
        {error !== null && (
          <p role="alert" className="text-sm font-semibold text-danger">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="btn-brand flex min-h-12 items-center gap-2 rounded-[var(--radius-pill)] px-6 text-sm font-bold transition disabled:opacity-50"
        >
          {submitting ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <PackageOpen className="size-4" aria-hidden />
          )}
          ส่งคำขอคืนสินค้า
        </button>
        <p className="text-xs text-muted">
          ยอดเงินคืนคิดตามสัดส่วนของเงินที่จ่ายจริงสำหรับชิ้นที่คืน — แสดงในหน้าคำขอทันทีหลังส่ง
        </p>
      </div>
    </form>
  );
}
