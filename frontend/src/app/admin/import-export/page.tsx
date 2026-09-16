import type { Metadata } from "next";
import Link from "next/link";

import { ImportExportTabs } from "@/features/admin/components/import-export/import-export-tabs";
import { requirePermission } from "@/lib/dal";

export const metadata: Metadata = {
  title: "นำเข้า / ส่งออกข้อมูล | TeenStyle Admin",
  robots: { index: false, follow: false },
};

interface ImportExportPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function AdminImportExportPage({ searchParams }: ImportExportPageProps) {
  // สิทธิ์ขั้นต่ำในการเข้าถึงหน้านี้คือ product:read (ดูข้อมูลและส่งออกได้)
  await requirePermission("product:read");

  const resolvedParams = await searchParams;
  const validTabs = ["export", "products", "inventory"] as const;
  const initialTab = validTabs.includes(resolvedParams.tab as (typeof validTabs)[number])
    ? (resolvedParams.tab as (typeof validTabs)[number])
    : "export";

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-muted">
            <Link href="/admin" className="hover:text-brand-dark">
              หน้าหลัก
            </Link>
            <span>/</span>
            <span>นำเข้าและส่งออก</span>
          </div>
          <h1 className="mt-1 text-3xl font-extrabold text-ink">นำเข้าและส่งออกข้อมูล</h1>
          <p className="mt-1 text-sm text-muted">
            จัดการแคตตาล็อกสินค้า, ตรวจนับสต็อกเป็นชุด (Stock Take) และส่งออกรายงานในรูปแบบ CSV หรือ Excel
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href="/admin/products"
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            จัดการสินค้า
          </Link>
          <Link
            href="/admin/inventory"
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            คลังสินค้า
          </Link>
        </div>
      </header>

      <ImportExportTabs initialTab={initialTab} />
    </main>
  );
}

