"use client";

import { Coins } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { INTEGER_FORMAT_MESSAGE, INTEGER_PATTERN } from "@/features/admin/lib/product-form";
import { describeApiError } from "@/lib/api-error-text";
import { fetchCheckoutSummary } from "@/services/order.service";
import type { ShippingMethodCode } from "@/types/catalog";
import type { CheckoutLoyalty } from "@/types/loyalty";
import { formatBaht } from "@/utils/format";

export interface AppliedPoints {
  points: number;
  /** มูลค่าส่วนลด (บาท) ที่ server คิดให้ */
  discount: number;
}

/**
 * ใช้แต้มสะสมเป็นส่วนลดในหน้า checkout (STEP 42)
 *
 * ⚠️ **หน้าเว็บไม่คิดส่วนลดจากแต้มเอง** — กด "ใช้แต้ม" แล้วถามยอดจาก server
 *    (`GET /api/checkout/summary?pointsToRedeem=`) ด้วยคูปองและวิธีจัดส่งชุดเดียวกับที่จะสั่งจริง
 *    แล้วแสดงตัวเลขที่ server ตอบ · ตอนกดสั่งซื้อ server ยังคิดใหม่อีกรอบจากแต้มคงเหลือจริง
 *
 * ⚠️ ใช้ไม่ได้ต้องบอกเหตุผล (ข้อความไทยจาก server) — ไม่ใช่เงียบแล้วไม่ลดให้
 *
 * ผู้เรียกต้องล้างค่าที่ใช้ไว้ (`onApplied(null)`) เมื่อคูปองหรือวิธีจัดส่งเปลี่ยน
 * เพราะเพดานของแต้มคิดจากยอดที่เหลือหลังหักคูปอง ตัวเลขเดิมอาจใช้ไม่ได้แล้ว
 */
export function PointsRedeemer({
  loyalty,
  shippingMethod,
  couponCode,
  applied,
  onApplied,
  disabled = false,
  notice = null,
}: {
  loyalty: CheckoutLoyalty;
  shippingMethod: ShippingMethodCode;
  couponCode: string | null;
  applied: AppliedPoints | null;
  onApplied: (next: AppliedPoints | null) => void;
  disabled?: boolean;
  /** ข้อความจากผู้เรียก เช่น "เปลี่ยนคูปองแล้ว กดใช้แต้มอีกครั้ง" */
  notice?: string | null;
}) {
  const { rules } = loyalty;
  const [input, setInput] = useState(applied === null ? "" : String(applied.points));
  const [maxPoints, setMaxPoints] = useState(loyalty.maxRedeemablePoints);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const multiplier = loyalty.tier.earnMultiplierPercent / 100;
  const earnRule = (
    <p className="mt-2 text-xs text-muted">
      คำสั่งซื้อนี้จะได้แต้มเมื่อร้านได้รับเงิน — ทุก {rules.earnBahtPerPoint} บาทที่จ่ายจริง = 1
      แต้ม
      {multiplier !== 1 && ` (ระดับ ${loyalty.tier.name} ×${multiplier})`}
    </p>
  );

  async function apply(requestedText: string) {
    const raw = requestedText.trim();
    setError(null);

    if (raw === "" || raw === "0") {
      onApplied(null);
      return;
    }

    // Number("abc") = NaN → JSON เป็น null — ตรวจรูปแบบก่อนส่งเสมอ (บทเรียนจาก STEP 37)
    if (!INTEGER_PATTERN.test(raw)) {
      setError(`จำนวนแต้ม: ${INTEGER_FORMAT_MESSAGE}`);
      return;
    }

    setChecking(true);

    try {
      const summary = await fetchCheckoutSummary(
        shippingMethod,
        couponCode ?? undefined,
        Number(raw),
      );
      const result = summary.loyalty;

      setMaxPoints(result.maxRedeemablePoints);

      if (result.error !== null || result.appliedPoints === 0) {
        setError(result.error ?? "ใช้แต้มกับคำสั่งซื้อนี้ไม่ได้");
        onApplied(null);
      } else {
        onApplied({ points: result.appliedPoints, discount: result.pointsDiscount });
      }
    } catch (failure) {
      setError(describeApiError(failure, "ตรวจแต้มไม่สำเร็จ กรุณาลองอีกครั้ง"));
    } finally {
      setChecking(false);
    }
  }

  function clear() {
    setInput("");
    setError(null);
    onApplied(null);
  }

  const busy = checking || disabled;

  return (
    <div className="mt-4 border-b border-line pb-4">
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Coins className="size-4 text-brand" aria-hidden />
        แต้มสะสม
        <span className="font-normal text-muted">
          · มี {loyalty.balance.toLocaleString("th-TH")} แต้ม
        </span>
      </p>

      {loyalty.balance < rules.redeemMinimumPoints ? (
        <p className="mt-2 text-xs text-muted">
          สะสมครบ {rules.redeemMinimumPoints.toLocaleString("th-TH")} แต้มจึงใช้เป็นส่วนลดได้ (
          {rules.redeemPointsPerBaht} แต้ม = 1 บาท) ·{" "}
          <Link href="/account/points" className="font-semibold text-brand-dark underline">
            ดูแต้มของฉัน
          </Link>
        </p>
      ) : (
        <>
          <label htmlFor="points-to-redeem" className="mt-2 block text-xs text-muted">
            จำนวนแต้มที่จะใช้ ({rules.redeemPointsPerBaht} แต้ม = 1 บาท · ทีละ{" "}
            {rules.redeemStepPoints} แต้ม · ใช้ได้ไม่เกิน {rules.redeemMaxPercentOfSubtotal}%
            ของยอดสินค้า)
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="points-to-redeem"
              inputMode="numeric"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={maxPoints > 0 ? `สูงสุด ${maxPoints.toLocaleString("th-TH")}` : "0"}
              disabled={busy}
              className="min-h-11 w-full min-w-0 rounded-[12px] border border-line px-3 text-sm outline-none focus:border-brand-soft"
            />
            <button
              type="button"
              onClick={() => void apply(input)}
              disabled={busy || input.trim() === ""}
              className="min-h-11 shrink-0 rounded-[var(--radius-pill)] border border-brand px-4 text-sm font-bold text-brand-dark transition hover:bg-lilac-50 disabled:opacity-50"
            >
              {checking ? "ตรวจ…" : "ใช้แต้ม"}
            </button>
          </div>
          {maxPoints > 0 && applied?.points !== maxPoints && (
            <button
              type="button"
              onClick={() => {
                setInput(String(maxPoints));
                void apply(String(maxPoints));
              }}
              disabled={busy}
              className="mt-1 min-h-11 rounded-[var(--radius-pill)] px-2 text-xs font-bold text-brand-dark underline disabled:opacity-50"
            >
              ใช้สูงสุด {maxPoints.toLocaleString("th-TH")} แต้ม
            </button>
          )}
        </>
      )}

      <div aria-live="polite">
        {applied !== null && (
          <p className="mt-2 flex flex-wrap items-center gap-2 text-sm font-semibold text-success">
            <span>
              ใช้ {applied.points.toLocaleString("th-TH")} แต้ม — ลด {formatBaht(applied.discount)}
            </span>
            <button
              type="button"
              onClick={clear}
              disabled={disabled}
              className="min-h-11 rounded-[var(--radius-pill)] px-2 text-xs font-bold text-muted underline transition hover:text-danger"
            >
              ไม่ใช้แต้ม
            </button>
          </p>
        )}
        {notice !== null && applied === null && error === null && (
          <p className="mt-2 text-sm font-semibold text-warning">{notice}</p>
        )}
        {error !== null && (
          <p role="alert" className="mt-2 text-sm font-semibold text-warning">
            {error}
          </p>
        )}
      </div>

      {earnRule}
    </div>
  );
}
