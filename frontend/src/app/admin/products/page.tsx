import {
  AlertTriangle,
  FileSpreadsheet,
  PackageOpen,
  Plus,
  Printer,
  ScanBarcode,
  Search,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchAdminProductsOnServer } from "@/services/admin.server";
import type { AdminProduct, AdminProductListResult } from "@/types/admin";
import { formatBaht } from "@/utils/format";

export const metadata: Metadata = {
  title: "จัดการสินค้า",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/admin/products", ["status", "q", "lowStock"]);

const STATUS_FILTERS = [
  { value: "ACTIVE", label: "เปิดขาย" },
  { value: "DRAFT", label: "ฉบับร่าง" },
  { value: "ARCHIVED", label: "เก็บเข้าคลัง" },
] as const;

/**
 * รายการสินค้าทั้งร้าน (STEP 14)
 *
 * ⚠️ ตัวเลขสต็อกที่แสดงคือ **ของที่ขายได้จริง** (หักที่จองไว้ในออเดอร์ที่ยังไม่จบ)
 *    ไม่ใช่ยอดในคลังดิบ ๆ — เพื่อไม่ให้แอดมินเข้าใจว่ามีของขายมากกว่าความจริง
 * ⚠️ ค้นหา/กรอง/แบ่งหน้า ทำที่ server ทั้งหมดผ่าน query string
 */
export default async function AdminProductsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("product:read");

  const raw = await searchParams;
  const params = toSearchParams(raw);
  const activeStatus = params.get("status");
  const query = params.get("q") ?? "";
  const lowStockOnly = params.get("lowStock") === "true";

  let result: AdminProductListResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchAdminProductsOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดรายการสินค้าไม่สำเร็จ";
  }

  const countOf = (status: string): number =>
    result?.counts.find((item) => item.status === status)?.count ?? 0;
  const allCount = result?.counts.reduce((sum, item) => sum + item.count, 0) ?? 0;

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">จัดการสินค้า</h1>
          <p className="mt-1 text-sm text-muted">
            เพิ่ม แก้ไข และเปิด/ปิดการขาย — จำนวนในคลังปรับได้ที่ระบบคลังสินค้าเท่านั้น
            เพื่อให้มีประวัติครบทุกการเคลื่อนไหว
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin"
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            ภาพรวมร้าน
          </Link>
          <Link
            href="/admin/import-export?tab=products"
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            <FileSpreadsheet className="size-4 text-brand" aria-hidden />
            นำเข้า / ส่งออก
          </Link>
          <Link
            href="/admin/barcodes"
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            <ScanBarcode className="size-4" aria-hidden />
            บาร์โค้ด / QR
          </Link>
          <Link
            href="/admin/products/new"
            className="btn-brand flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold transition"
          >
            <Plus className="size-4" aria-hidden />
            เพิ่มสินค้า
          </Link>
        </div>
      </header>

      {/* ค้นหา — form GET จึงใช้ได้แม้ JS ยังไม่โหลด */}
      <form action="/admin/products" method="get" className="mt-6 flex gap-2">
        {activeStatus !== null && <input type="hidden" name="status" value={activeStatus} />}
        {lowStockOnly && <input type="hidden" name="lowStock" value="true" />}
        <label className="flex min-h-12 flex-1 items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white px-4">
          <Search className="size-4 shrink-0 text-muted" aria-hidden />
          <span className="sr-only">ค้นหาสินค้า</span>
          <input
            type="search"
            name="q"
            defaultValue={query}
            placeholder="ชื่อสินค้า SKU หรือ slug"
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
          <nav aria-label="กรองสินค้า" className="mt-4 flex flex-wrap gap-2">
            <Link
              href={withParam(params, "status", null)}
              aria-current={activeStatus === null ? "true" : undefined}
              className={chipClass(activeStatus === null)}
            >
              ทั้งหมด ({allCount})
            </Link>
            {STATUS_FILTERS.map((filter) => (
              <Link
                key={filter.value}
                href={withParam(
                  params,
                  "status",
                  activeStatus === filter.value ? null : filter.value,
                )}
                aria-current={activeStatus === filter.value ? "true" : undefined}
                className={chipClass(activeStatus === filter.value)}
              >
                {filter.label} ({countOf(filter.value)})
              </Link>
            ))}
            <Link
              href={withParam(params, "lowStock", lowStockOnly ? null : "true")}
              aria-current={lowStockOnly ? "true" : undefined}
              className={cn(chipClass(lowStockOnly), "gap-1")}
            >
              <AlertTriangle className="size-4" aria-hidden />
              สต็อกต่ำ ({result.lowStockCount})
            </Link>
          </nav>

          <div className="mt-6">
            {result.items.length === 0 ? (
              <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
                <PackageOpen className="mx-auto size-10 text-brand-soft" aria-hidden />
                <p className="mt-3 font-extrabold">ไม่พบสินค้าตามเงื่อนไขนี้</p>
                <p className="mt-2 text-sm text-muted">
                  {query !== "" || activeStatus !== null || lowStockOnly
                    ? "ลองล้างคำค้นหรือเปลี่ยนตัวกรอง"
                    : "เริ่มจากการเพิ่มสินค้าชิ้นแรก"}
                </p>
                <Link
                  href="/admin/products/new"
                  className="btn-brand mt-4 inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold transition"
                >
                  <Plus className="size-4" aria-hidden />
                  เพิ่มสินค้า
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted">
                  พบ <strong className="text-ink">{result.total}</strong> รายการ · หน้า{" "}
                  {result.page} / {result.totalPages}
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full min-w-[820px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line text-left text-xs text-muted uppercase">
                        <th scope="col" className="py-2 pr-3 font-bold">
                          สินค้า
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          สถานะ
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          ราคา
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          ขายได้จริง
                        </th>
                        <th scope="col" className="py-2 pr-3 font-bold">
                          ตัวเลือก
                        </th>
                        <th scope="col" className="py-2 font-bold">
                          หมวดหมู่
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.items.map((product) => (
                        <ProductRow key={product.id} product={product} />
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

function ProductRow({ product }: { product: AdminProduct }) {
  const mainImage = product.images.find((image) => image.isMain) ?? product.images[0];
  const lowStock = product.availableStock <= product.minimumStock;

  return (
    <tr className="border-b border-line/60">
      <td className="py-3 pr-3">
        <div className="flex items-center gap-3">
          <div className="relative size-12 shrink-0 overflow-hidden rounded-[10px] bg-lilac-50">
            {mainImage !== undefined ? (
              <Image src={mainImage.url} alt="" fill sizes="48px" className="object-cover" />
            ) : (
              <span className="grid size-full place-items-center text-[10px] text-muted">
                ไม่มีรูป
              </span>
            )}
          </div>
          <div className="min-w-0">
            <Link
              href={`/admin/products/${product.id}`}
              className="block truncate font-bold text-brand underline"
            >
              {product.name}
            </Link>
            <span className="block font-mono text-xs break-all text-muted">{product.sku}</span>
          </div>
        </div>
      </td>
      <td className="py-3 pr-3">
        <span
          className={cn(
            "inline-block rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-bold",
            statusTone(product.status),
          )}
        >
          {statusLabel(product.status)}
        </span>
      </td>
      <td className="py-3 pr-3">
        <span className="font-extrabold text-brand-dark">{formatBaht(product.finalPrice)}</span>
        {product.salePrice !== null && (
          <span className="block text-xs text-muted line-through">{formatBaht(product.price)}</span>
        )}
      </td>
      <td className="py-3 pr-3">
        <span className={cn("font-semibold", lowStock && "text-danger")}>
          {product.availableStock} ชิ้น
        </span>
        <span className="block text-xs text-muted">
          ในคลัง {product.totalStock} · จอง {product.reservedStock}
        </span>
      </td>
      <td className="py-3 pr-3 text-xs">
        {product.variants.length} รายการ
        {product.variants.length > 0 && (
          <Link
            href={`/admin/barcodes/labels?productId=${product.id}`}
            className="mt-1 flex items-center gap-1 font-semibold text-brand underline"
          >
            <Printer className="size-3" aria-hidden />
            พิมพ์ป้าย
          </Link>
        )}
      </td>
      <td className="py-3 text-xs text-muted">{product.category.name}</td>
    </tr>
  );
}

function statusLabel(status: string): string {
  if (status === "ACTIVE") return "เปิดขาย";
  if (status === "DRAFT") return "ฉบับร่าง";

  return "เก็บเข้าคลัง";
}

function statusTone(status: string): string {
  if (status === "ACTIVE") return "border-success/30 bg-success/10 text-success";
  if (status === "DRAFT") return "border-warning/30 bg-warning/10 text-warning";

  return "border-line bg-lilac-50 text-muted";
}

function chipClass(active: boolean): string {
  return cn(
    "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
    active
      ? "border-brand bg-brand text-white"
      : "border-line hover:border-brand-soft hover:bg-lilac-50",
  );
}
