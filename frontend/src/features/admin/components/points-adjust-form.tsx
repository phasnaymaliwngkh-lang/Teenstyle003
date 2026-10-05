"use client";

import { Loader2, Minus, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { INTEGER_FORMAT_MESSAGE, INTEGER_PATTERN } from "@/features/admin/lib/product-form";
import { describeApiError } from "@/lib/api-error-text";
import { cn } from "@/lib/utils";
import { adjustCustomerPoints } from "@/services/loyalty.service";

/**
 * ร้านปรับแต้มให้ลูกค้า (STEP 42 · `loyalty:adjust`)
 *
 * ⚠️ **ไม่มีช่อง "ตั้งยอดคงเหลือ"** — กรอกได้แค่เพิ่ม/หักเท่าไร เพราะอะไร
 *    ระบบบันทึกเป็นรายการในสมุดแต้ม ยอดคงเหลือจึงอธิบายย้อนหลังได้เสมอ (กฎเดียวกับคลังสินค้า)
 * ⚠️ **ลูกค้าเห็นเหตุผลในประวัติแต้มและการแจ้งเตือน** — ต้องบอกบนฟอร์มให้ชัด
 *    ไม่งั้นพนักงานจะเขียนหมายเหตุภายในที่ไม่ควรให้ลูกค้าอ่าน
 * ⚠️ `idempotencyKey` สร้างครั้งเดียวต่อการเปิดฟอร์ม แล้วสร้างใหม่หลังบันทึกสำเร็จ
 *    — กดปุ่มซ้ำ/เน็ตกระตุกแล้วลองใหม่จึงไม่ให้แต้มสองเท่า (กฎ STEP 15 ข้อ 6)
 * ⚠️ ปุ่มที่ซ่อนเป็นแค่ความสะดวก — ด่านจริง (สิทธิ์ · ห้ามปรับตัวเอง · หักเกินยอด) อยู่ที่ backend
 */
export function PointsAdjustForm({
  userId,
  balance,
}: {
  userId: string;
  /** แต้มคงเหลือตอนเปิดหน้า — ใช้บอกเพดานของการหักเท่านั้น backend ตรวจซ้ำเอง */
  balance: number;
}) {
  const router = useRouter();
  const fieldId = useId();

  const [direction, setDirection] = useState<"add" | "deduct">("add");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);

    const raw = amount.trim();

    // Number("abc") = NaN → JSON เป็น null — ตรวจรูปแบบก่อนส่งเสมอ (บทเรียนจาก STEP 37)
    if (!INTEGER_PATTERN.test(raw) || Number(raw) === 0) {
      setError(`จำนวนแต้ม: ${INTEGER_FORMAT_MESSAGE}ที่มากกว่า 0`);
      return;
    }

    if (reason.trim().length < 3) {
      setError("กรุณากรอกเหตุผลอย่างน้อย 3 ตัวอักษร — ลูกค้าจะเห็นข้อความนี้");
      return;
    }

    const points = Number(raw);
    const delta = direction === "add" ? points : -points;

    setPending(true);

    try {
      const result = await adjustCustomerPoints(userId, {
        delta,
        reason: reason.trim(),
        idempotencyKey,
      });

      setNotice(
        result.applied
          ? `บันทึกแล้ว — คงเหลือ ${result.standing.points.toLocaleString("th-TH")} แต้ม`
          : "รายการนี้ถูกบันทึกไปแล้วก่อนหน้า จึงไม่ได้ปรับซ้ำ",
      );
      setAmount("");
      setReason("");
      setIdempotencyKey(crypto.randomUUID());
      router.refresh();
    } catch (failure) {
      setError(describeApiError(failure, "ปรับแต้มไม่สำเร็จ กรุณาลองอีกครั้ง"));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <fieldset>
        <legend className="text-xs font-bold">ต้องการ</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              { value: "add", label: "เพิ่มแต้ม", icon: Plus },
              { value: "deduct", label: "หักแต้ม", icon: Minus },
            ] as const
          ).map((option) => {
            const Icon = option.icon;

            return (
              <label
                key={option.value}
                className={cn(
                  // input ถูกซ่อนด้วย sr-only → ต้องแสดง focus ที่ป้ายแทน ไม่งั้นคนใช้คีย์บอร์ดมองไม่เห็นว่าอยู่ตรงไหน
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-xs font-bold transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/40",
                  direction === option.value
                    ? "border-brand bg-brand text-white"
                    : "border-line text-muted hover:border-brand-soft hover:bg-lilac-50",
                )}
              >
                <input
                  type="radio"
                  name={`${fieldId}-direction`}
                  value={option.value}
                  checked={direction === option.value}
                  onChange={() => setDirection(option.value)}
                  disabled={pending}
                  className="sr-only"
                />
                <Icon className="size-4" aria-hidden />
                {option.label}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div>
        <label htmlFor={`${fieldId}-amount`} className="block text-xs font-bold">
          จำนวนแต้ม
          {direction === "deduct" && (
            <span className="font-normal text-muted">
              {" "}
              (หักได้ไม่เกิน {balance.toLocaleString("th-TH")} แต้ม)
            </span>
          )}
        </label>
        <input
          id={`${fieldId}-amount`}
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          disabled={pending}
          className="mt-1 min-h-11 w-full max-w-xs rounded-[var(--radius-card)] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
        />
      </div>

      <div>
        <label htmlFor={`${fieldId}-reason`} className="block text-xs font-bold">
          เหตุผล{" "}
          <span className="font-normal text-warning">
            — ลูกค้าเห็นข้อความนี้ในประวัติแต้มและการแจ้งเตือน
          </span>
        </label>
        <input
          id={`${fieldId}-reason`}
          type="text"
          value={reason}
          maxLength={200}
          onChange={(event) => setReason(event.target.value)}
          placeholder="เช่น ชดเชยพัสดุล่าช้า"
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
        {direction === "add" ? "เพิ่มแต้ม" : "หักแต้ม"}
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
