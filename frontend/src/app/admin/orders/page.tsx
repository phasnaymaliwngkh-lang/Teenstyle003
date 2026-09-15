import { PackageOpen, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import {
  formatDateTime,
  orderStatusLabel,
  orderStatusTone,
  paymentStatusLabel,
} from "@/features/orders/lib/labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchAdminOrdersOnServer } from "@/services/admin.server";
import type { AdminOrderListResult } from "@/types/admin";
import { formatBaht } from "@/utils/format";

export const metadata: Metadata = {
  title: "จัดการคำสั่งซื้อ",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/admin/orders", ["status", "q"]);

const FILTERS = [
  "PENDING_PAYMENT",
  "PROCESSING",
  "PACKING",
  "SHIPPING",
  "DELIVERED",
  "CANCELLED",
] as const;

/**
 * รายการคำสั่งซื้อทั้งร้าน (STEP 13)
 *
 * ต้องมีสิทธิ์ `order:read` — ตรวจทั้งที่หน้านี้ (DAL) และที่ backend
 * ค้นหา/กรอง/แบ่งหน้า ทำที่ server ทั้งหมด
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("order:read");

  const raw = await searchParams;
  const params = toSearchParams(raw);
  const activeStatus = params.get("status");
  const query = params.get("q") ?? "";

  let result: AdminOrderListResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchAdminOrdersOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดคำสั่งซื้อไม่สำเร็จ";
  }

  const countOf = (status: string): number =>
    result?.counts.find((item) => item.status === status)?.count ?? 0;
  const allCount = result?.counts.reduce((sum, item) => sum + item.count, 0) ?? 0;

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">จัดการคำสั่งซื้อ</h1>
          <p className="mt-1 text-sm text-muted">
            อัปเดตสถานะ ออกเลขพัสดุ และยกเลิกคำสั่งซื้อ — ทุกการแก้ไขถูกบันทึกประวัติไว้
          </p>
        </div>

        <Link
          href="/admin"
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          ภาพรวมร้าน
        </Link>
      </header>

      {/* ค้นหา — form GET จึงใช้ได้แม้ JS ยังไม่โหลด */}
      <form action="/admin/orders" method="get" className="mt-6 flex gap-2">
        {activeStatus !== null && <input type="hidden" name="status" value={activeStatus} />}
        <label className="flex min-h-12 flex-1 items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white px-4">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="sr-only">ค้นหาคำสั่งซื้อ</span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="เลขคำสั่งซื้อ ชื่อ หรืออีเมลลูกค้า"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none"
          />
        </label>
        <button
          type="submit"
          className="btn-brand min-h-12 shrink-0 rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          ค้นหา
        </button>
      </form>

      {errorMessage !== null ? (
        <div className="mt-6">
          <SectionError message={errorMessage} />
        </div>
      ) : result === null ? null : (
        <>
          <nav aria-label="กรองตามสถานะ" className="mt-4 flex flex-wrap gap-2">
            <Link
              href={withParam(params, "status", null)}
              aria-current={activeStatus === null ? "true" : undefined}
              className={chipClass(activeStatus === null)}
            >
              ทั้งหมด ({allCount})
            </Link>
            {FILTERS.map((status) => (
              <Link
                key={status}
                href={withParam(params, "status", activeStatus === status ? null : status)}
                aria-current={activeStatus === status ? "true" : undefined}
                className={chipClass(activeStatus === status)}
              >
                {orderStatusLabel(status)} ({countOf(status)})
              </Link>
            ))}
          </nav>

          <div className="mt-6">
            {result.items.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
                <PackageOpen className="mx-auto size-10 text-brand-soft" aria-hidden />
                <p className="mt-3 font-extrabold">ไม่พบคำสั่งซื้อตามเงื่อนไขนี้</p>
                <p className="mt-2 text-sm text-muted">ลองเปลี่ยนสถานะที่กรอง หรือล้างคำค้น</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted">
                  พบ <strong className="text-ink">{result.total}</strong> คำสั่งซื้อ · หน้า{" "}
                  {result.page} / {result.totalPages}
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-muted uppercase">
                        <th scope="col" className="py-2 pr-3 font-bold">
                          เลขคำสั่งซื้อ
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          ลูกค้า
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          สถานะ
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          การชำระเงิน
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          ยอด
                        </th>
                        <th scope="col" className="py-2 font-bold">
                          สั่งเมื่อ
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((order) => (
                        <tr key={order.id} className="border-b border-line/60">
                          <td className="py-3 pr-3">
                            <Link
                              href={`/admin/orders/${order.orderNumber}`}
                              className="font-mono font-bold text-brand underline"
                            >
                              {order.orderNumber}
                            </Link>
                            <span className="block text-xs text-muted">
                              {order.itemCount} รายการ · {order.totalQuantity} ชิ้น
                            </span>
                          </td>
                          <td className="py-3 pr-3">
                            <span className="block font-semibold">
                              {order.customer?.name ?? "—"}
                            </span>
                            <span className="block text-xs break-all text-muted">
                              {order.customer?.email ?? "—"}
                            </span>
                          </td>
                          <td className="py-3 pr-3">
                            <span
                              className={cn(
                                "inline-block rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-bold",
                                orderStatusTone(order.status),
                              )}
                            >
                              {orderStatusLabel(order.status)}
                            </span>
                          </td>
                          <td className="py-3 pr-3 text-xs">
                            {paymentStatusLabel(order.paymentStatus)}
                          </td>
                          <td className="py-3 pr-3 font-extrabold text-brand-dark">
                            {formatBaht(order.total)}
                          </td>
                          <td className="py-3 text-xs text-muted">
                            {formatDateTime(order.createdAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <Pagination
                  page={result.page}
                  totalPages={result.totalPages}
                  hrefFor={(page) => withParam(params, "page", page)}
                />
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function chipClass(active: boolean): string {
  return cn(
    "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
    active
      ? "border-brand bg-brand text-white"
      : "border-line hover:border-brand-soft hover:bg-lilac-50",
  );
}
