import { Shapes } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/shared/section";
import { CatalogManager } from "@/features/admin/components/catalog-manager";
import { CATALOG_TABS } from "@/features/admin/lib/catalog-form";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchCatalogOnServer } from "@/services/admin.server";
import type { CatalogKind, CatalogOverview } from "@/types/admin";

export const metadata: Metadata = {
  title: "หมวดหมู่และตัวเลือกสินค้า",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/admin/catalog", ["tab"]);

const TAB_HINT: Record<CatalogKind, string> = {
  categories:
    "ซ้อนได้ 2 ชั้น (หมวดแม่ → หมวดย่อย) · หมวดที่มีสินค้าขายอยู่ปิดไม่ได้ · ลำดับตรงนี้คือลำดับบนหน้าแรกและแผงกรอง",
  brands: "แบรนด์ที่มีสินค้าขายอยู่ปิดไม่ได้ · หน้าร้านเรียงแบรนด์ตามชื่อ",
  sizes:
    "ลำดับตรงนี้คือลำดับที่ลูกค้าเห็นตอนเลือกไซซ์ · ไซซ์ที่ตัวเลือกเคยใช้ลบไม่ได้ (ปิดใช้งานแทน)",
  colors:
    "แผงกรองหน้าร้านแสดงเฉพาะสีที่มีสินค้าขายอยู่ใช้ · สีที่ตัวเลือกเคยใช้ลบไม่ได้ (ปิดใช้งานแทน)",
};

/**
 * หมวดหมู่ · แบรนด์ · ไซซ์ · สี (STEP 48)
 *
 * ⚠️ **ข้อตกลงหลัก: สินค้าที่เปิดขายใช้ได้เฉพาะของที่เปิดใช้อยู่** — ปิดของที่สินค้าขายอยู่ใช้
 *    ไม่ได้ และผูกของที่ปิดกับสินค้าไม่ได้ (server ตัดสินทุกครั้ง · หน้านี้แสดงเหตุผลให้เห็นล่วงหน้า)
 * ⚠️ ดูได้ด้วย `product:read` (พนักงานต้องรู้ว่ามีหมวดอะไร) · แก้ต้องมี `catalog:manage`
 * ⚠️ หน้าร้านแคชรายการหมวด/ตัวกรองไว้ 60 วินาที — แก้แล้วหน้าร้านเปลี่ยนตามภายในหนึ่งนาที
 */
export default async function AdminCatalogPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await requirePermission("product:read");
  const canManage = session.user.permissions.includes("catalog:manage");

  const params = toSearchParams(await searchParams);
  const requested = params.get("tab");
  const kind: CatalogKind =
    CATALOG_TABS.find((tab) => tab.kind === requested)?.kind ?? "categories";

  let data: CatalogOverview | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchCatalogOnServer();
  } catch (error) {
    errorMessage =
      error instanceof ApiClientError ? error.message : "โหลดหมวดหมู่และตัวเลือกสินค้าไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-3xl">
            <Shapes className="size-7 text-brand" aria-hidden />
            หมวดหมู่และตัวเลือกสินค้า
          </h1>
          <p className="mt-1 text-sm text-muted">
            สินค้าที่เปิดขายใช้ได้เฉพาะหมวด แบรนด์ ไซซ์ และสีที่เปิดใช้อยู่ —
            หน้าร้านจึงไม่มีสินค้าที่หาไม่เจอ · หน้าร้านเปลี่ยนตามภายใน 1 นาที
          </p>
        </div>

        <Link
          href="/admin/products"
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          จัดการสินค้า
        </Link>
      </header>

      <nav aria-label="ชนิดข้อมูล" className="mt-6 flex flex-wrap gap-2">
        {CATALOG_TABS.map((tab) => {
          const active = tab.kind === kind;
          const count = data === null ? null : data[tab.kind].length;

          return (
            <Link
              key={tab.kind}
              href={withParam(params, "tab", tab.kind === "categories" ? null : tab.kind)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
                active
                  ? "border-brand bg-brand text-white"
                  : "border-line hover:border-brand-soft hover:bg-lilac-50",
              )}
            >
              {tab.label}
              {count !== null && (
                <span
                  className={cn(
                    "rounded-[var(--radius-pill)] px-2 py-0.5 text-xs font-bold",
                    active ? "bg-white/25" : "bg-lilac text-brand-dark",
                  )}
                >
                  {count.toLocaleString("th-TH")}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <p className="mt-3 text-sm text-muted">{TAB_HINT[kind]}</p>

      <div className="mt-4">
        {errorMessage !== null || data === null ? (
          <SectionError message={errorMessage ?? "โหลดหมวดหมู่และตัวเลือกสินค้าไม่สำเร็จ"} />
        ) : (
          // key = แท็บ — เปลี่ยนแท็บแล้วฟอร์มที่พิมพ์ค้างของแท็บก่อนต้องไม่ติดมา
          <CatalogManager key={kind} kind={kind} initial={data} canManage={canManage} />
        )}
      </div>
    </main>
  );
}
