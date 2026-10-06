import { AlertTriangle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { formatDateTime } from "@/features/orders/lib/labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchAdminReturnsOnServer } from "@/services/returns.server";
import { RETURN_STATUS_TONE, type AdminReturnList, type ReturnStatus } from "@/types/returns";
import { formatBaht } from "@/utils/format";

export const metadata: Metadata = {
  title: "คืนสินค้าและคืนเงิน",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/admin/returns", ["status", "q"]);

const TABS: ReadonlyArray<{ value: ReturnStatus | null; label: string }> = [
  { value: null, label: "ทั้งหมด" },
  { value: "REQUESTED", label: "รอตรวจคำขอ" },
  { value: "APPROVED", label: "รอของคืน" },
  { value: "RECEIVED", label: "รอคืนเงิน" },
  { value: "REFUNDED", label: "คืนเงินแล้ว" },
  { value: "REJECTED", label: "ไม่รับคืน" },
  { value: "CANCELLED", label: "ลูกค้ายกเลิก" },
];

/**
 * คิวคืนสินค้าและคืนเงิน /admin/returns (STEP 43 · `order:read`)
 *
 * ⚠️ ส่วนบนสุดคือ **คำสั่งซื้อที่ร้านยกเลิกหลังชำระเงินแล้วยังไม่คืนเงิน** — เงินของลูกค้าค้างอยู่กับร้าน
 *    ต้องเห็นได้ชัด ไม่งั้นไม่มีใครรู้ว่ายังติดเงินลูกค้าอยู่ (เดิมไม่มีที่ไหนแสดงเลย)
 * ⚠️ ตัวเลขข้างแท็บมาจาก groupBy ของทั้งระบบ · ยอดเงินมาจาก server ทั้งหมด
 */
export default async function AdminReturnsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("order:read");
  const params = toSearchParams(await searchParams);
  const active = params.get("status");

  let data: AdminReturnList | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchAdminReturnsOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดคำขอคืนสินค้าไม่สำเร็จ";
  }

  const countOf = (status: ReturnStatus | null) =>
    status === null
      ? (data?.counts.reduce((sum, row) => sum + row.count, 0) ?? 0)
      : (data?.counts.find((row) => row.status === status)?.count ?? 0);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <header>
        <h1 className="text-3xl">คืนสินค้าและคืนเงิน</h1>
        <p className="mt-1 text-sm text-muted">
          คำขอเรียงจากที่รอนานที่สุด · ระบบไม่ได้โอนเงินเอง —
          คืนเงินในระบบปลายทางแล้วบันทึกเลขอ้างอิง
        </p>
      </header>

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : data === null ? null : (
        <>
          {data.cancelledAwaitingRefundCount > 0 && (
            <section
              aria-labelledby="awaiting-heading"
              className="mt-6 rounded-[var(--radius-card)] border border-warning/30 bg-warning/5 p-5"
            >
              <h2
                id="awaiting-heading"
                className="flex items-center gap-2 text-base font-extrabold"
              >
                <AlertTriangle className="size-5 text-warning" aria-hidden />
                ยกเลิกหลังชำระเงิน — ยังไม่ได้คืนเงิน{" "}
                {data.cancelledAwaitingRefundCount.toLocaleString("th-TH")} ใบ
              </h2>
              <ul className="mt-3 space-y-2 text-sm">
                {data.cancelledAwaitingRefund.map((order) => (
                  <li
                    key={order.orderNumber}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1"
                  >
                    <Link
                      href={`/admin/orders/${encodeURIComponent(order.orderNumber)}`}
                      className="font-bold text-brand underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <span className="break-all text-muted">{order.customer.email}</span>
                    <span className="font-semibold">
                      ต้องคืน {formatBaht(order.total - order.refundedTotal)}
                    </span>
                    {order.cancelledAt !== null && (
                      <span className="text-xs text-muted">
                        ยกเลิก {formatDateTime(order.cancelledAt)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {data.cancelledAwaitingRefundCount > data.cancelledAwaitingRefund.length && (
                <p className="mt-2 text-xs text-muted">
                  แสดง {data.cancelledAwaitingRefund.length} ใบที่รอนานที่สุด จากทั้งหมด{" "}
                  {data.cancelledAwaitingRefundCount.toLocaleString("th-TH")} ใบ
                </p>
              )}
            </section>
          )}

          <nav aria-label="กรองตามสถานะ" className="mt-6 flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const isActive = active === tab.value || (tab.value === null && active === null);

              return (
                <Link
                  key={tab.label}
                  href={withParam(params, "status", tab.value)}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
                    isActive
                      ? "border-brand bg-brand text-white"
                      : "border-line hover:border-brand-soft hover:bg-lilac-50",
                  )}
                >
                  {tab.label} ({countOf(tab.value).toLocaleString("th-TH")})
                </Link>
              );
            })}
          </nav>

          <form action="/admin/returns" className="mt-4 flex flex-wrap gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">ค้นหาด้วยเลขคำขอ ชื่อ หรืออีเมลลูกค้า</span>
              <input
                type="search"
                name="q"
                defaultValue={params.get("q") ?? ""}
                placeholder="ค้นหาด้วยเลขคำขอ ชื่อ หรืออีเมลลูกค้า"
                className="min-h-11 w-full rounded-[var(--radius-pill)] border border-line px-4 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
              />
            </label>
            {active !== null && <input type="hidden" name="status" value={active} />}
            <button
              type="submit"
              className="btn-brand flex min-h-11 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
            >
              ค้นหา
            </button>
          </form>

          <div className="mt-5" aria-live="polite">
            {data.items.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-12 text-center">
                <p className="font-extrabold">ไม่มีคำขอคืนในหมวดนี้</p>
                <p className="mt-2 text-sm text-muted">
                  คำขอใหม่จะขึ้นที่นี่เมื่อลูกค้ายื่นจากหน้าคำสั่งซื้อ
                </p>
              </div>
            ) : (
              <ul className="space-y-3">
                {data.items.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-soft)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link
                          href={`/admin/returns/${item.id}`}
                          className="font-extrabold break-words text-brand underline"
                        >
                          {item.returnNumber}
                        </Link>
                        <p className="text-xs break-all text-muted">
                          {item.customer.name ?? item.customer.email} · {item.reasonLabel} ·{" "}
                          {item.items.reduce((sum, row) => sum + row.quantity, 0)} ชิ้น
                        </p>
                      </div>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-1 text-[11px] font-bold",
                          RETURN_STATUS_TONE[item.status],
                        )}
                      >
                        {item.statusLabel}
                      </span>
                    </div>
                    <p className="mt-2 text-sm">
                      {item.refund !== null
                        ? `คืนเงินแล้ว ${formatBaht(item.refund.amount)}`
                        : item.estimatedRefund !== null
                          ? `ยอดที่ต้องคืน ${formatBaht(item.estimatedRefund)}`
                          : "ไม่มีการคืนเงิน"}
                      <span className="text-xs text-muted">
                        {" "}
                        · ยื่นเมื่อ {formatDateTime(item.createdAt)}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-4">
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                hrefFor={(page) => withParam(params, "page", page)}
              />
            </div>
          </div>
        </>
      )}
    </main>
  );
}
