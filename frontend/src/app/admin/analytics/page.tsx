import { Info, Minus, TrendingDown, TrendingUp, Users, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/shared/section";
import { AnalyticsExportButton } from "@/features/admin/components/analytics-export-button";
import { SalesChart } from "@/features/admin/components/sales-chart";
import { errorMessageOf } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import {
  fetchCustomerRankingOnServer,
  fetchProductPerformanceOnServer,
  fetchSalesBreakdownOnServer,
  fetchSalesSummaryOnServer,
} from "@/services/analytics.server";
import { GRANULARITIES, type Granularity, type Metric } from "@/types/analytics";

export const metadata: Metadata = {
  title: "รายงานยอดขาย",
  robots: { index: false, follow: false },
};

const GRANULARITY_LABEL: Record<Granularity, string> = {
  day: "รายวัน",
  week: "รายสัปดาห์",
  month: "รายเดือน",
};

const baht = (value: number) => `฿${value.toLocaleString("th-TH")}`;

const thaiDate = (value: string) =>
  new Date(`${value}T00:00:00.000Z`).toLocaleDateString("th-TH", {
    dateStyle: "medium",
    timeZone: "UTC",
  });

/**
 * รายงานยอดขาย /admin/analytics (STEP 26)
 *
 * ⚠️ **ตัวเลขทุกตัวมาจากคำสั่งซื้อจริง ไม่มีข้อมูลตัวอย่างแม้แต่จุดเดียว**
 *    ช่วงที่ไม่มียอดขาย = แสดงว่าไม่มี ไม่ใช่วาดกราฟให้ดูมีข้อมูล (กฎ STEP 13 ข้อ 6)
 *
 * ⚠️ "ยอดขาย" นับเฉพาะเงินที่ **ได้รับจริง** และตัดรอบตามวันที่ได้เงิน (`paidAt`)
 *    ไม่ใช่วันที่ลูกค้ากดสั่ง — สำคัญมากกับ COD ที่ได้เงินตอนส่งถึง
 *    หน้านี้ต้องเขียนกำกับให้ชัด ไม่งั้นคนอ่านจะเทียบกับจำนวนออเดอร์แล้วงง
 *
 * ⚠️ วันถูกตัดตามโซนเวลาของร้าน (`Asia/Bangkok`) ไม่ใช่ UTC — แสดงไว้บนหน้าด้วย
 */
export default async function AdminAnalyticsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("analytics:read");

  const raw = await searchParams;
  const params = toSearchParams(raw);

  // ส่งต่อเฉพาะคีย์ที่ backend รู้จัก — คีย์อื่นใน URL ไม่ควรไปถึง API
  const query = new URLSearchParams();
  for (const key of ["from", "to", "granularity"]) {
    const value = params.get(key);
    if (value !== null && value !== "") query.set(key, value);
  }

  const [summary, products, customers, breakdown] = await Promise.allSettled([
    fetchSalesSummaryOnServer(query),
    fetchProductPerformanceOnServer(
      new URLSearchParams({ ...Object.fromEntries(query), limit: "10" }),
    ),
    fetchCustomerRankingOnServer(
      new URLSearchParams({ ...Object.fromEntries(query), limit: "10" }),
    ),
    fetchSalesBreakdownOnServer(query),
  ]);

  /**
   * ⚠️ ใช้ `errorMessageOf` ไม่ใช่ `error.message` ตรง ๆ
   *    ช่วงวันที่ที่ผู้ใช้เลือกเองผิดเงื่อนไข (ยาวเกิน 366 วัน · วันเริ่มอยู่หลังวันจบ)
   *    จะได้ข้อความรวมว่า "ข้อมูลที่ส่งมาไม่ถูกต้อง" ซึ่งไม่บอกว่าต้องแก้อะไร
   *    สาเหตุจริงอยู่ใน `details` ของ response (บทเรียนเดียวกับ STEP 15)
   */
  const errorOf = (result: PromiseSettledResult<unknown>): string | null =>
    result.status === "rejected" ? errorMessageOf(result.reason, "โหลดรายงานไม่สำเร็จ") : null;

  const summaryData = summary.status === "fulfilled" ? summary.value : null;
  const productData = products.status === "fulfilled" ? products.value : null;
  const customerData = customers.status === "fulfilled" ? customers.value : null;
  const breakdownData = breakdown.status === "fulfilled" ? breakdown.value : null;

  const activeGranularity = (params.get("granularity") ?? "day") as Granularity;

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">รายงานยอดขาย</h1>
          <p className="mt-1 text-sm text-muted">
            นับเฉพาะคำสั่งซื้อที่ได้รับเงินแล้ว และตัดรอบตาม
            <span className="font-semibold"> วันที่ได้รับเงิน</span> ไม่ใช่วันที่ลูกค้ากดสั่ง
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {summaryData !== null && <AnalyticsExportButton query={query.toString()} />}
          <Link
            href="/admin"
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            กลับหน้าภาพรวม
          </Link>
        </div>
      </header>

      {/* ─── เลือกช่วงเวลา ─── */}
      <form
        action="/admin/analytics"
        className="mt-6 flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-xs font-bold">
          ตั้งแต่วันที่
          <input
            type="date"
            name="from"
            defaultValue={summaryData?.range.from ?? params.get("from") ?? ""}
            className="min-h-11 rounded-[var(--radius-card)] border border-line px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold">
          ถึงวันที่
          <input
            type="date"
            name="to"
            defaultValue={summaryData?.range.to ?? params.get("to") ?? ""}
            className="min-h-11 rounded-[var(--radius-card)] border border-line px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold">
          ความละเอียด
          <select
            name="granularity"
            defaultValue={activeGranularity}
            className="min-h-11 rounded-[var(--radius-card)] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
          >
            {GRANULARITIES.map((value) => (
              <option key={value} value={value}>
                {GRANULARITY_LABEL[value]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="btn-brand flex min-h-11 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          ดูรายงาน
        </button>

        {summaryData !== null && (
          <p className="w-full text-xs text-muted">
            {thaiDate(summaryData.range.from)} – {thaiDate(summaryData.range.to)} (
            {summaryData.range.days} วัน) · ตัดวันตามเวลา {summaryData.range.timeZone} · เทียบกับ{" "}
            {thaiDate(summaryData.range.comparedTo.from)} –{" "}
            {thaiDate(summaryData.range.comparedTo.to)}
          </p>
        )}
      </form>

      {/* ─── ตัวเลขหลัก ─── */}
      <section className="mt-6">
        {errorOf(summary) !== null ? (
          <SectionError message={errorOf(summary)!} />
        ) : summaryData === null ? null : (
          <>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="ยอดขายที่ได้รับ" metric={summaryData.revenue} format={baht} />
              <MetricCard
                label="คำสั่งซื้อที่ได้รับเงิน"
                metric={summaryData.paidOrders}
                format={(value) => `${value.toLocaleString("th-TH")} ใบ`}
              />
              <MetricCard
                label="ยอดเฉลี่ยต่อใบ"
                metric={summaryData.averageOrderValue}
                format={baht}
              />
              <MetricCard
                label="ลูกค้าที่ซื้อ"
                metric={summaryData.payingCustomers}
                format={(value) => `${value.toLocaleString("th-TH")} คน`}
              />
            </div>

            {summaryData.pendingCodAmount > 0 && (
              <div className="mt-4 flex gap-3 rounded-[var(--radius-card)] border border-line bg-lilac-50 p-4">
                <Wallet className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden />
                <p className="text-sm text-ink-soft">
                  <span className="font-bold">
                    COD ที่ยังไม่ได้เก็บเงิน {baht(summaryData.pendingCodAmount)}
                  </span>{" "}
                  — เป็นยอดคงค้าง <span className="font-semibold">ณ วันนี้</span>{" "}
                  ไม่ใช่ยอดของช่วงที่เลือก และ
                  <span className="font-semibold">ยังไม่นับเป็นรายได้</span>{" "}
                  จนกว่าพนักงานจะกดยืนยันว่าส่งถึงแล้ว
                </p>
              </div>
            )}

            <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-white p-5">
              <h2 className="text-lg">ยอดขาย{GRANULARITY_LABEL[summaryData.range.granularity]}</h2>
              <div className="mt-4">
                <SalesChart
                  series={summaryData.series}
                  granularity={summaryData.range.granularity}
                />
              </div>
            </section>
          </>
        )}
      </section>

      {/* ─── อันดับสินค้า + ลูกค้า ─── */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <h2 className="text-lg">สินค้าขายดี 10 อันดับ</h2>
          <p className="mt-1 text-xs text-muted">
            คิดจากยอดสินค้าใน `OrderItem` ของใบที่ได้รับเงินแล้ว
          </p>

          {errorOf(products) !== null ? (
            <div className="mt-4">
              <SectionError message={errorOf(products)!} />
            </div>
          ) : productData === null ? null : productData.items.length === 0 ? (
            <p className="mt-4 text-sm text-muted">ยังไม่มีสินค้าที่ขายได้ในช่วงนี้</p>
          ) : (
            <ol className="mt-4 space-y-2">
              {productData.items.map((item, index) => (
                <li
                  key={item.productId ?? `deleted-${index}`}
                  className="flex items-center gap-3 border-b border-line pb-2 last:border-0"
                >
                  <span className="grid size-7 shrink-0 place-items-center rounded-full bg-lilac text-xs font-bold text-brand-dark">
                    {index + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    {item.slug === null ? (
                      <span className="block truncate font-semibold">{item.productName}</span>
                    ) : (
                      <Link
                        href={`/product/${item.slug}`}
                        className="block truncate font-semibold text-brand underline"
                      >
                        {item.productName}
                      </Link>
                    )}
                    <span className="block text-xs text-muted">
                      {item.quantity.toLocaleString("th-TH")} ชิ้น · {item.orders} ใบ
                    </span>
                  </span>
                  <span className="shrink-0 font-bold">{baht(item.revenue)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <h2 className="text-lg">ลูกค้าที่ซื้อมากที่สุด 10 อันดับ</h2>
          <p className="mt-1 text-xs text-muted">
            เรียงจากยอดซื้อทั้งช่วง (คำนวณก่อนแบ่งหน้า จึงเป็นอันดับจริง)
          </p>

          {errorOf(customers) !== null ? (
            <div className="mt-4">
              <SectionError message={errorOf(customers)!} />
            </div>
          ) : customerData === null ? null : customerData.items.length === 0 ? (
            <p className="mt-4 text-sm text-muted">ยังไม่มีลูกค้าที่ซื้อในช่วงนี้</p>
          ) : (
            <>
              <ol className="mt-4 space-y-2">
                {customerData.items.map((item, index) => (
                  <li
                    key={item.userId}
                    className="flex items-center gap-3 border-b border-line pb-2 last:border-0"
                  >
                    <span className="grid size-7 shrink-0 place-items-center rounded-full bg-lilac text-xs font-bold text-brand-dark">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <Link
                        href={`/admin/customers/${item.userId}`}
                        className="block truncate font-semibold text-brand underline"
                      >
                        {item.name ?? item.email}
                      </Link>
                      <span className="block text-xs text-muted">
                        {item.orders} ใบ · เฉลี่ย {baht(item.averageOrderValue)}
                      </span>
                    </span>
                    <span className="shrink-0 font-bold">{baht(item.revenue)}</span>
                  </li>
                ))}
              </ol>

              <p className="mt-3 flex items-center gap-2 text-xs text-muted">
                <Users className="size-4" aria-hidden />
                ลูกค้าที่ซื้อซ้ำในช่วงนี้ {customerData.repeatCustomers} คน จากทั้งหมด{" "}
                {customerData.total} คน
              </p>
            </>
          )}
        </section>
      </div>

      {/* ─── แยกตามมิติ ─── */}
      <section className="mt-6">
        {errorOf(breakdown) !== null ? (
          <SectionError message={errorOf(breakdown)!} />
        ) : breakdownData === null ? null : (
          <>
            <div className="grid gap-6 lg:grid-cols-3">
              <BreakdownCard title="หมวดหมู่สินค้า" rows={breakdownData.byCategory} />
              <BreakdownCard title="ช่องทางชำระเงิน" rows={breakdownData.byPaymentProvider} />
              <BreakdownCard title="วิธีจัดส่ง" rows={breakdownData.byShippingMethod} />
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
                <h2 className="text-lg">คำสั่งซื้อที่เข้ามาในช่วงนี้</h2>
                <p className="mt-1 text-xs text-muted">
                  ตารางนี้นับ<span className="font-semibold">ใบที่ถูกสร้าง</span>ในช่วงนี้
                  (รวมที่ยกเลิกและที่ยังไม่จ่าย) จึงเป็นคนละเกณฑ์กับยอดขายด้านบน —
                  อย่าเอาสองตัวเลขนี้มาบวกกัน
                </p>

                {breakdownData.ordersByStatus.length === 0 ? (
                  <p className="mt-4 text-sm text-muted">ไม่มีคำสั่งซื้อเข้ามาในช่วงนี้</p>
                ) : (
                  <ul className="mt-4 space-y-2">
                    {breakdownData.ordersByStatus.map((row) => (
                      <li key={row.key} className="flex justify-between gap-2 text-sm">
                        <span>{row.label}</span>
                        <span className="font-semibold">{row.orders} ใบ</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
                <h2 className="text-lg">ยอดตามบิล กับ ยอดเฉพาะสินค้า</h2>
                <div className="mt-3 flex gap-3 rounded-[var(--radius-card)] border border-line bg-lilac-50 p-3">
                  <Info className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                  <p className="text-xs text-ink-soft">
                    สองยอดนี้<span className="font-bold">ไม่เท่ากันเป็นเรื่องปกติ</span> —
                    ต่างกันที่ค่าจัดส่งที่เก็บเพิ่มและส่วนลดท้ายบิล
                  </p>
                </div>

                <dl className="mt-4 space-y-2 text-sm">
                  <Row label="ยอดตามบิล (เงินที่ได้รับ)">
                    {baht(breakdownData.reconciliation.orderRevenue)}
                  </Row>
                  <Row label="ยอดเฉพาะสินค้า">
                    {baht(breakdownData.reconciliation.productRevenue)}
                  </Row>
                  <Row label="− ส่วนลดท้ายบิล">{baht(breakdownData.reconciliation.discounts)}</Row>
                  <Row label="+ ค่าจัดส่งที่เก็บได้">
                    {baht(breakdownData.reconciliation.shippingFees)}
                  </Row>
                </dl>
              </section>
            </div>
          </>
        )}
      </section>

      {summaryData !== null && (
        <p className="mt-8 text-xs text-muted">
          ข้อมูล ณ{" "}
          {new Date(summaryData.generatedAt).toLocaleString("th-TH", {
            dateStyle: "medium",
            timeStyle: "short",
          })}
        </p>
      )}
    </main>
  );
}

function MetricCard({
  label,
  metric,
  format,
}: {
  label: string;
  metric: Metric;
  format: (value: number) => string;
}) {
  const change = metric.changePercent;
  const Icon = change === null ? Minus : change >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-2xl font-extrabold">{format(metric.value)}</p>

      <p
        className={cn(
          "mt-2 flex items-center gap-1.5 text-xs font-semibold",
          change === null ? "text-muted" : change >= 0 ? "text-success" : "text-danger",
        )}
      >
        <Icon className="size-4" aria-hidden />
        {/* ⚠️ ช่วงก่อนหน้าเป็น 0 → บอกว่าเทียบไม่ได้ ห้ามแสดง 0% หรือ +100% */}
        {change === null
          ? "ช่วงก่อนหน้าไม่มีข้อมูลให้เทียบ"
          : `${change > 0 ? "+" : ""}${change}% จาก ${format(metric.previous)}`}
      </p>
    </div>
  );
}

function BreakdownCard({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ key: string; label: string; orders: number; revenue: number; share: number }>;
}) {
  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <h2 className="text-lg">{title}</h2>

      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">ไม่มีข้อมูลในช่วงนี้</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {rows.map((row) => (
            <li key={row.key}>
              <div className="flex justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{row.label}</span>
                <span className="shrink-0 font-semibold">{baht(row.revenue)}</span>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-lilac" aria-hidden>
                  <div
                    className="h-full rounded-full bg-brand"
                    style={{ width: `${Math.min(100, row.share)}%` }}
                  />
                </div>
                <span className="shrink-0 text-xs text-muted">{row.share}%</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}
