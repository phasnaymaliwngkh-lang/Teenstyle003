import { Coins } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { LoyaltyStandingCard } from "@/features/loyalty/components/loyalty-standing-card";
import { PointHistory } from "@/features/loyalty/components/point-history";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { toSearchParams, type RawSearchParams } from "@/lib/query-params";
import {
  fetchMyLoyaltyOnServer,
  fetchMyPointTransactionsOnServer,
} from "@/services/loyalty.server";
import type { MyLoyalty, PointTransactionList } from "@/types/loyalty";
import { formatBaht } from "@/utils/format";

export const metadata: Metadata = {
  title: "แต้มสะสมของฉัน",
  description: "แต้มคงเหลือ ระดับสมาชิก และประวัติการได้/ใช้แต้ม",
  robots: { index: false, follow: false },
};

const errorText = (error: unknown, fallback: string) =>
  error instanceof ApiClientError ? error.message : fallback;

/**
 * หน้าแต้มสะสม /account/points (STEP 42)
 *
 * ⚠️ ตัวเลขทุกตัวมาจาก server — แต้มคือผลรวมของสมุดแต้มจริง ระดับคิดจากยอดที่จ่ายจริง
 *    และกติกาที่อธิบายบนหน้านี้อ่านจาก config ตัวเดียวกับที่ใช้คิดแต้ม (ไม่ได้พิมพ์ตัวเลขไว้ในหน้า)
 * ⚠️ สองส่วนโหลดแยกกัน — ประวัติโหลดไม่ได้ต้องไม่ทำให้ยอดคงเหลือหายไปด้วย (กฎ STEP 5 ข้อ 1)
 */
export default async function MyPointsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getSession();

  if (!session) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/account/points")}`);
  }

  const params = toSearchParams(await searchParams);
  const requestedPage = Number(params.get("page") ?? "1");
  const page = Number.isInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1;

  const [loyaltyResult, historyResult] = await Promise.allSettled([
    fetchMyLoyaltyOnServer(),
    fetchMyPointTransactionsOnServer(page),
  ]);

  const loyalty: MyLoyalty | null =
    loyaltyResult.status === "fulfilled" ? loyaltyResult.value : null;
  const history: PointTransactionList | null =
    historyResult.status === "fulfilled" ? historyResult.value : null;

  return (
    <main className="mx-auto w-full max-w-[860px] px-4 py-10 sm:px-6">
      <header>
        <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
          Points
        </span>
        <h1 className="mt-3 text-3xl sm:text-4xl">แต้มสะสมของฉัน</h1>
        <p className="mt-2 text-sm text-muted">
          แต้มเข้าเมื่อร้านได้รับเงินจริง · ใช้เป็นส่วนลดได้ที่หน้าชำระเงิน
        </p>
      </header>

      <section aria-labelledby="standing-heading" className="mt-8">
        <h2 id="standing-heading" className="sr-only">
          แต้มคงเหลือและระดับสมาชิก
        </h2>
        {loyalty === null ? (
          <SectionError
            message={errorText(
              loyaltyResult.status === "rejected" ? loyaltyResult.reason : null,
              "โหลดแต้มสะสมไม่สำเร็จ",
            )}
          />
        ) : (
          <LoyaltyStandingCard standing={loyalty} />
        )}
      </section>

      {loyalty !== null && <Rules loyalty={loyalty} />}

      <section aria-labelledby="history-heading" className="mt-10">
        <h2 id="history-heading" className="text-xl">
          ประวัติแต้ม
        </h2>

        <div className="mt-4">
          {history === null ? (
            <SectionError
              message={errorText(
                historyResult.status === "rejected" ? historyResult.reason : null,
                "โหลดประวัติแต้มไม่สำเร็จ",
              )}
            />
          ) : history.items.length === 0 ? (
            <EmptyHistory />
          ) : (
            <div className="space-y-6">
              <PointHistory
                items={history.items}
                orderHref={(orderNumber) => `/account/orders/${encodeURIComponent(orderNumber)}`}
              />
              <Pagination
                page={history.page}
                totalPages={history.totalPages}
                hrefFor={(target) =>
                  target <= 1 ? "/account/points" : `/account/points?page=${target}`
                }
              />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

/** กติกา — ทุกตัวเลขมาจาก API (config/loyalty.ts ของ backend) */
function Rules({ loyalty }: { loyalty: MyLoyalty }) {
  const { rules } = loyalty;

  return (
    <section aria-labelledby="rules-heading" className="mt-10">
      <h2 id="rules-heading" className="text-xl">
        ได้แต้มและใช้แต้มอย่างไร
      </h2>

      <ul className="mt-4 space-y-2 text-sm text-ink-soft">
        <li>
          • ทุก {rules.earnBahtPerPoint} บาทของยอดที่จ่ายจริงทั้งบิล (หลังหักส่วนลดแล้ว) ได้ 1 แต้ม
          · แต้มเข้าเมื่อร้านได้รับเงิน — ชำระออนไลน์เข้าทันที · เก็บเงินปลายทางเข้าตอนได้รับสินค้า
        </li>
        <li>
          • ใช้ได้ครั้งละอย่างน้อย {rules.redeemMinimumPoints.toLocaleString("th-TH")} แต้ม ·{" "}
          {rules.redeemPointsPerBaht} แต้ม = ส่วนลด 1 บาท · ไม่เกิน{" "}
          {rules.redeemMaxPercentOfSubtotal}% ของยอดสินค้า
        </li>
        <li>• คำสั่งซื้อถูกยกเลิก → แต้มที่ใช้ได้คืน และแต้มที่ได้จากใบนั้นถูกหักคืน</li>
        <li>• ระดับสมาชิกคิดจากยอดที่จ่ายจริงสะสมทั้งหมด ระดับสูงขึ้นได้แต้มมากขึ้น</li>
      </ul>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[320px] text-left text-sm">
          <caption className="sr-only">เกณฑ์ระดับสมาชิก</caption>
          <thead>
            <tr className="border-b border-line text-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">
                ระดับ
              </th>
              <th scope="col" className="py-2 pr-3 font-semibold">
                ยอดสะสมตั้งแต่
              </th>
              <th scope="col" className="py-2 font-semibold">
                แต้มที่ได้
              </th>
            </tr>
          </thead>
          <tbody>
            {rules.tiers.map((tier) => (
              <tr
                key={tier.code}
                aria-current={tier.code === loyalty.tier.code ? "true" : undefined}
                className={
                  tier.code === loyalty.tier.code
                    ? "border-b border-line bg-lilac-50 font-semibold"
                    : "border-b border-line"
                }
              >
                <td className="py-2 pr-3">
                  {tier.name}
                  {tier.code === loyalty.tier.code && (
                    <span className="ml-2 text-xs text-brand-dark">(ระดับของคุณ)</span>
                  )}
                </td>
                <td className="py-2 pr-3">{formatBaht(tier.minSpend)}</td>
                <td className="py-2">×{tier.earnMultiplierPercent / 100}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 rounded-[var(--radius-card)] border border-line bg-lilac-50 px-4 py-3 text-xs text-muted">
        แต้มยังไม่มีวันหมดอายุ และระดับสมาชิกไม่ลดลงตามเวลา — ยอดเปลี่ยนเฉพาะเมื่อมีคำสั่งซื้อ
        ใช้แต้ม คำสั่งซื้อถูกยกเลิก หรือร้านปรับให้พร้อมเหตุผล (ซึ่งแสดงอยู่ในประวัติด้านล่าง)
      </p>
    </section>
  );
}

/** ยังไม่มีรายการ — ไม่ใช่ error */
function EmptyHistory() {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
      <Coins className="mx-auto size-10 text-brand-soft" aria-hidden />
      <p className="mt-3 font-extrabold">ยังไม่มีประวัติแต้ม</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        แต้มจะเข้าบัญชีเมื่อร้านได้รับเงินจากคำสั่งซื้อของคุณ
      </p>
      <Link
        href="/shop"
        className="btn-brand mt-6 inline-flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
      >
        เลือกซื้อสินค้า
      </Link>
    </div>
  );
}
