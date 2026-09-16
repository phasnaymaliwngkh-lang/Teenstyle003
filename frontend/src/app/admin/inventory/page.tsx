import { AlertTriangle, Boxes, History, PackageOpen, ScanBarcode, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { stockStatusLabel, stockStatusTone } from "@/features/admin/lib/inventory-labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchInventoryOnServer } from "@/services/admin.server";
import type { InventoryListResult, InventoryRow } from "@/types/admin";

export const metadata: Metadata = {
  title: "คลังสินค้า",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/admin/inventory", ["stockStatus", "q", "sort"]);

const STATUS_FILTERS = [
  { value: "OUT_OF_STOCK", label: "ของหมด" },
  { value: "LOW_STOCK", label: "เหลือน้อย" },
  { value: "IN_STOCK", label: "พร้อมขาย" },
] as const;

/**
 * คลังสินค้า — รายการสต็อกต่อตัวเลือก (STEP 15)
 *
 * ⚠️ แสดง 3 ตัวเลขแยกกันเสมอ: **ในคลัง / จองไว้ / ขายได้จริง**
 *    เพราะการยุบเป็นตัวเลขเดียวคือต้นเหตุของบั๊กที่หน้าร้านโฆษณาว่ามีของทั้งที่ขายไม่ได้
 * ⚠️ ตัวเลขสรุปด้านบนนับจากคลังทั้งร้าน ไม่ใช่แค่หน้าที่กำลังดู
 */
export default async function AdminInventoryPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("inventory:read");

  const raw = await searchParams;
  const params = toSearchParams(raw);
  const activeStatus = params.get("stockStatus");
  const query = params.get("q") ?? "";

  let result: InventoryListResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchInventoryOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดข้อมูลคลังไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">คลังสินค้า</h1>
          <p className="mt-1 text-sm text-muted">
            รับของเข้า ตัดของออก และปรับยอดตามการตรวจนับ — ทุกรายการมีประวัติว่าใครทำและเพราะอะไร
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/barcodes"
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            <ScanBarcode className="size-4" aria-hidden />
            สแกนบาร์โค้ด
          </Link>
          <Link
            href="/admin/alerts"
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            <AlertTriangle className="size-4" aria-hidden />
            แจ้งเตือนสต็อก
          </Link>
          <Link
            href="/admin/inventory/movements"
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            <History className="size-4" aria-hidden />
            ประวัติการเคลื่อนไหว
          </Link>
          <Link
            href="/admin/products"
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            จัดการสินค้า
          </Link>
        </div>
      </header>

      {errorMessage !== null || result === null ? (
        <div className="mt-6">
          <SectionError message={errorMessage ?? "โหลดข้อมูลคลังไม่สำเร็จ"} />
        </div>
      ) : (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              icon={<Boxes className="size-5 text-brand" aria-hidden />}
              label="ของในคลัง"
              value={`${result.summary.totalUnits.toLocaleString("th-TH")} ชิ้น`}
              hint={`${result.summary.variants} ตัวเลือกสินค้า`}
            />
            <Stat
              icon={<Boxes className="size-5 text-success" aria-hidden />}
              label="ขายได้จริง"
              value={`${result.summary.availableUnits.toLocaleString("th-TH")} ชิ้น`}
              hint={`จองไว้ ${result.summary.reservedUnits.toLocaleString("th-TH")} ชิ้น`}
            />
            <Stat
              icon={<AlertTriangle className="size-5 text-warning" aria-hidden />}
              label="เหลือน้อย"
              value={`${result.summary.lowStock} ตัวเลือก`}
              hint="ต่ำกว่าหรือเท่าจุดเตือนของสินค้า"
            />
            <Stat
              icon={<AlertTriangle className="size-5 text-danger" aria-hidden />}
              label="ของหมด"
              value={`${result.summary.outOfStock} ตัวเลือก`}
              hint="ขายไม่ได้แม้แต่ชิ้นเดียว"
            />
          </section>

          {/* ค้นหา — form GET จึงใช้ได้แม้ JS ยังไม่โหลด */}
          <form action="/admin/inventory" method="get" className="mt-6 flex gap-2">
            {activeStatus !== null && (
              <input type="hidden" name="stockStatus" value={activeStatus} />
            )}
            <label className="flex min-h-12 flex-1 items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white px-4">
              <Search className="size-4 shrink-0 text-muted" aria-hidden />
              <span className="sr-only">ค้นหาในคลัง</span>
              <input
                type="search"
                name="q"
                defaultValue={query}
                placeholder="ชื่อสินค้า SKU ของสินค้า หรือ SKU ของตัวเลือก"
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

          <nav aria-label="กรองตามสถานะสต็อก" className="mt-4 flex flex-wrap gap-2">
            <Link
              href={withParam(params, "stockStatus", null)}
              aria-current={activeStatus === null ? "true" : undefined}
              className={chipClass(activeStatus === null)}
            >
              ทั้งหมด ({result.summary.variants})
            </Link>
            {STATUS_FILTERS.map((filter) => (
              <Link
                key={filter.value}
                href={withParam(
                  params,
                  "stockStatus",
                  activeStatus === filter.value ? null : filter.value,
                )}
                aria-current={activeStatus === filter.value ? "true" : undefined}
                className={chipClass(activeStatus === filter.value)}
              >
                {filter.label}
                {filter.value === "OUT_OF_STOCK" && ` (${result.summary.outOfStock})`}
                {filter.value === "LOW_STOCK" && ` (${result.summary.lowStock})`}
              </Link>
            ))}
          </nav>

          <div className="mt-6">
            {result.items.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
                <PackageOpen className="mx-auto size-10 text-brand-soft" aria-hidden />
                <p className="mt-3 font-extrabold">ไม่พบรายการในคลังตามเงื่อนไขนี้</p>
                <p className="mt-2 text-sm text-muted">ลองล้างคำค้นหรือเปลี่ยนตัวกรอง</p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted">
                  พบ <strong className="text-ink">{result.total}</strong> ตัวเลือก · หน้า{" "}
                  {result.page} / {result.totalPages} · เรียงจากของที่ใกล้หมดก่อน
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-muted uppercase">
                        <th scope="col" className="py-2 pr-3 font-bold">
                          สินค้า / ตัวเลือก
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          สถานะ
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          ในคลัง
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          จองไว้
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          ขายได้จริง
                        </th>
                        <th scope="col" className="py-2 font-bold">
                          จุดเตือน
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((row) => (
                        <InventoryTableRow key={row.variantId} row={row} />
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

function InventoryTableRow({ row }: { row: InventoryRow }) {
  const variantLabel = [row.color?.name, row.size?.name].filter(Boolean).join(" · ") || "ไม่ระบุ";

  return (
    <tr className="border-b border-line/60">
      <td className="py-3 pr-3">
        <Link href={`/admin/inventory/${row.variantId}`} className="font-bold text-brand underline">
          {row.product.name}
        </Link>
        <span className="block text-xs text-muted">
          {variantLabel} · <span className="font-mono break-all">{row.sku}</span>
        </span>
        {!row.isActive && (
          <span className="mt-1 inline-block rounded-[var(--radius-pill)] border border-line bg-lilac-50 px-2 py-0.5 text-[11px] font-bold text-muted">
            ตัวเลือกนี้ปิดขายอยู่
          </span>
        )}
      </td>
      <td className="py-3 pr-3">
        <span
          className={cn(
            "inline-block rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-bold",
            stockStatusTone(row.stockStatus),
          )}
        >
          {stockStatusLabel(row.stockStatus)}
        </span>
      </td>
      <td className="py-3 pr-3 font-semibold">{row.quantity}</td>
      <td
        className={cn("py-3 pr-3", row.reserved > 0 ? "font-semibold text-warning" : "text-muted")}
      >
        {row.reserved}
      </td>
      <td
        className={cn(
          "py-3 pr-3 font-extrabold",
          row.available === 0 ? "text-danger" : "text-brand-dark",
        )}
      >
        {row.available}
      </td>
      <td className="py-3 text-xs text-muted">{row.minimumStock}</td>
    </tr>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        {icon}
        {label}
      </div>
      <p className="mt-2 text-xl font-extrabold text-brand-dark">{value}</p>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
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
