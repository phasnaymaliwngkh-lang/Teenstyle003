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
import { fetchAdminShipmentsOnServer } from "@/services/shipping.server";
import {
  SHIPMENT_STATUS_TONE,
  type AdminShipmentList,
  type ShipmentStatus,
} from "@/types/shipping";

export const metadata: Metadata = {
  title: "พัสดุ",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/admin/shipments", ["status", "overdue", "q"]);

const TABS: ReadonlyArray<{ value: ShipmentStatus | null; label: string }> = [
  { value: null, label: "ทั้งหมด" },
  { value: "SHIPPED", label: "ส่งมอบให้ขนส่งแล้ว" },
  { value: "IN_TRANSIT", label: "อยู่ระหว่างขนส่ง" },
  { value: "FAILED", label: "ส่งไม่สำเร็จ" },
  { value: "RETURNED", label: "ตีกลับถึงร้าน" },
  { value: "DELIVERED", label: "ส่งถึงแล้ว" },
];

/**
 * พัสดุทั้งร้าน /admin/shipments (STEP 44 · `shipment:read`)
 *
 * ⚠️ "เลยกำหนดส่ง" นับเฉพาะพัสดุที่ร้าน **กรอกกำหนดส่งไว้** แล้วเลยมาแล้วยังอยู่กับขนส่ง
 *    ไม่มีกำหนดส่ง = ไม่ถือว่าเลย — ระบบไม่เดาเวลาส่งถึงแทนร้าน (กฎ STEP 12 ข้อ 1)
 * ⚠️ ตัวเลขข้างแท็บมาจาก groupBy ของทั้งร้าน ไม่ขึ้นกับคำค้น
 */
export default async function AdminShipmentsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("shipment:read");
  const params = toSearchParams(await searchParams);
  const active = params.get("status");
  const overdueOnly = params.get("overdue") === "true";

  let data: AdminShipmentList | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchAdminShipmentsOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดรายการพัสดุไม่สำเร็จ";
  }

  const countOf = (status: ShipmentStatus | null) =>
    status === null
      ? (data?.counts.reduce((sum, row) => sum + row.count, 0) ?? 0)
      : (data?.counts.find((row) => row.status === status)?.count ?? 0);

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl">พัสดุ</h1>
          <p className="mt-1 text-sm text-muted">
            ติดตามพัสดุที่ส่งออกไป · บันทึกส่งไม่สำเร็จ/ตีกลับพร้อมเหตุผลให้ลูกค้า ·
            ส่งใหม่หรือยกเลิกเมื่อของกลับถึงร้าน
          </p>
        </div>
        <Link
          href="/admin/shipping"
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          อัตราค่าจัดส่ง
        </Link>
      </header>

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : data === null ? null : (
        <>
          {data.overdueCount > 0 && (
            <Link
              href={withParam(params, "overdue", overdueOnly ? null : "true")}
              className="mt-6 flex min-h-11 items-center gap-2 rounded-[var(--radius-card)] border border-warning/30 bg-warning/5 p-4 text-sm font-bold text-warning"
            >
              <AlertTriangle className="size-5 shrink-0" aria-hidden />
              {overdueOnly
                ? "กำลังแสดงเฉพาะพัสดุที่เลยกำหนดส่ง — กดเพื่อแสดงทั้งหมด"
                : `เลยกำหนดส่งแล้วยังอยู่กับขนส่ง ${data.overdueCount.toLocaleString("th-TH")} ชิ้น — กดเพื่อดูเฉพาะรายการนี้`}
            </Link>
          )}

          <nav aria-label="กรองตามสถานะพัสดุ" className="mt-6 flex flex-wrap gap-2">
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

          <form action="/admin/shipments" className="mt-4 flex flex-wrap gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">ค้นหาด้วยเลขพัสดุ เลขคำสั่งซื้อ หรือชื่อขนส่ง</span>
              <input
                type="search"
                name="q"
                defaultValue={params.get("q") ?? ""}
                placeholder="ค้นหาด้วยเลขพัสดุ เลขคำสั่งซื้อ หรือชื่อขนส่ง"
                className="min-h-11 w-full rounded-[var(--radius-pill)] border border-line px-4 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
              />
            </label>
            {active !== null && <input type="hidden" name="status" value={active} />}
            {overdueOnly && <input type="hidden" name="overdue" value="true" />}
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
                <p className="font-extrabold">ไม่มีพัสดุในหมวดนี้</p>
                <p className="mt-2 text-sm text-muted">
                  พัสดุจะขึ้นที่นี่เมื่อเปลี่ยนคำสั่งซื้อเป็น &quot;จัดส่งแล้ว&quot;
                  พร้อมเลขพัสดุจริง
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
                          href={`/admin/shipments/${item.id}`}
                          className="font-mono font-extrabold break-all text-brand underline"
                        >
                          {item.trackingNumber ?? "(ไม่มีเลขพัสดุ)"}
                        </Link>
                        <p className="text-xs break-all text-muted">
                          {item.carrier} · คำสั่งซื้อ {item.order.orderNumber} ·{" "}
                          {item.order.customerName ?? item.order.customerEmail}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {item.overdue && (
                          <span className="inline-flex items-center rounded-[var(--radius-pill)] border border-warning/30 bg-warning/5 px-2.5 py-1 text-[11px] font-bold text-warning">
                            เลยกำหนดส่ง
                          </span>
                        )}
                        <span
                          className={cn(
                            "inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-1 text-[11px] font-bold",
                            SHIPMENT_STATUS_TONE[item.status],
                          )}
                        >
                          {item.statusLabel}
                        </span>
                      </div>
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      ส่งออก {formatDateTime(item.shippedAt)}
                      {item.estimatedDelivery !== null &&
                        ` · กำหนดส่ง ${formatDateTime(item.estimatedDelivery)}`}
                    </p>
                    {item.latestNote !== null && (
                      <p className="mt-1 text-sm break-words text-ink-soft">{item.latestNote}</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <Pagination
            page={data.page}
            totalPages={data.totalPages}
            hrefFor={(page) => withParam(params, "page", page)}
          />
        </>
      )}
    </main>
  );
}
