import { Crown } from "lucide-react";

import type { LoyaltyStanding } from "@/types/loyalty";
import { formatBaht } from "@/utils/format";

/**
 * แต้มคงเหลือ + ระดับสมาชิก + ความคืบหน้าสู่ระดับถัดไป (STEP 42)
 *
 * ทุกตัวเลขมาจาก server — ระดับคำนวณจากยอดที่จ่ายจริงสะสม (ไม่ใช่คอลัมน์ที่อาจค้างค่าเก่า)
 * ใช้ทั้งหน้า "แต้มของฉัน" และหน้าลูกค้าในหลังบ้าน จึงเป็น Server Component ล้วน
 */
export function LoyaltyStandingCard({
  standing,
  audience = "customer",
}: {
  standing: LoyaltyStanding;
  /** หลังบ้านใช้สรรพนามบุรุษที่สาม ("ลูกค้า") แทน "คุณ" */
  audience?: "customer" | "staff";
}) {
  const next = standing.nextTier;
  const progress =
    next === null
      ? 100
      : Math.min(
          100,
          Math.round(
            ((standing.lifetimeSpend - standing.tier.minSpend) /
              Math.max(1, next.minSpend - standing.tier.minSpend)) *
              100,
          ),
        );
  const who = audience === "customer" ? "คุณ" : "ลูกค้า";

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
        <p className="text-sm text-muted">แต้มคงเหลือ</p>
        <p className="mt-1 text-4xl font-extrabold text-brand-dark">
          {standing.points.toLocaleString("th-TH")}
          <span className="ml-2 text-base font-semibold text-muted">แต้ม</span>
        </p>
      </div>

      <div className="rounded-[var(--radius-card)] border border-line bg-lilac-50 p-5">
        <p className="flex items-center gap-2 text-sm text-muted">
          <Crown className="size-4 text-brand" aria-hidden />
          ระดับสมาชิก
        </p>
        <p className="mt-1 text-2xl font-extrabold">
          {standing.tier.name}
          {standing.tier.earnMultiplierPercent !== 100 && (
            <span className="ml-2 text-sm font-semibold text-brand-dark">
              แต้ม ×{standing.tier.earnMultiplierPercent / 100}
            </span>
          )}
        </p>
        <p className="mt-1 text-xs text-muted">
          ยอดที่จ่ายจริงสะสม {formatBaht(standing.lifetimeSpend)}
        </p>

        {next === null ? (
          <p className="mt-3 text-sm font-semibold text-success">{who}อยู่ระดับสูงสุดแล้ว</p>
        ) : (
          <>
            <div
              role="progressbar"
              aria-label={`ความคืบหน้าสู่ระดับ ${next.name}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              className="mt-3 h-2 overflow-hidden rounded-[var(--radius-pill)] bg-white"
            >
              <div
                className="h-full rounded-[var(--radius-pill)] bg-brand"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted">
              อีก {formatBaht(next.remaining)} จะได้ระดับ {next.name} (แต้ม ×
              {next.earnMultiplierPercent / 100})
            </p>
          </>
        )}
      </div>
    </div>
  );
}
