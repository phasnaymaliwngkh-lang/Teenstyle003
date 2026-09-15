import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { MovementTable } from "@/features/admin/components/movement-table";
import { MOVEMENT_TYPES, movementLabel } from "@/features/admin/lib/inventory-labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchMovementsOnServer } from "@/services/admin.server";
import type { MovementListResult } from "@/types/admin";

export const metadata: Metadata = {
  title: "ประวัติการเคลื่อนไหวของสต็อก",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/admin/inventory/movements", ["type", "variantId"]);

/**
 * ประวัติการเคลื่อนไหวของสต็อกทั้งร้าน (STEP 15)
 *
 * รวมทุกที่มา: รับเข้าจากแอดมิน · ตัดออกตอนขาย · รับคืนจากการยกเลิกออเดอร์ ·
 * รับเข้าครั้งแรกตอนสร้างสินค้า — **ประวัตินี้เป็น append-only** แก้ย้อนหลังไม่ได้
 */
export default async function InventoryMovementsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("inventory:read");

  const raw = await searchParams;
  const params = toSearchParams(raw);
  const activeType = params.get("type");

  let result: MovementListResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchMovementsOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดประวัติไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <Link
        href="/admin/inventory"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted transition hover:text-brand"
      >
        <ArrowLeft className="size-4" aria-hidden />
        กลับไปคลังสินค้า
      </Link>

      <header className="mt-2">
        <h1 className="text-3xl">ประวัติการเคลื่อนไหวของสต็อก</h1>
        <p className="mt-1 text-sm text-muted">
          ทุกชิ้นที่เข้าหรือออกจากคลังถูกบันทึกไว้ที่นี่ และแก้ย้อนหลังไม่ได้ —
          ถ้าบันทึกผิดต้องปรับกลับด้วยรายการใหม่
        </p>
      </header>

      {errorMessage !== null || result === null ? (
        <div className="mt-6">
          <SectionError message={errorMessage ?? "โหลดประวัติไม่สำเร็จ"} />
        </div>
      ) : (
        <>
          <nav aria-label="กรองตามชนิดรายการ" className="mt-6 flex flex-wrap gap-2">
            <Link
              href={withParam(params, "type", null)}
              aria-current={activeType === null ? "true" : undefined}
              className={chipClass(activeType === null)}
            >
              ทั้งหมด ({result.total})
            </Link>
            {MOVEMENT_TYPES.map((type) => (
              <Link
                key={type}
                href={withParam(params, "type", activeType === type ? null : type)}
                aria-current={activeType === type ? "true" : undefined}
                className={chipClass(activeType === type)}
              >
                {movementLabel(type)}
              </Link>
            ))}
          </nav>

          <div className="mt-6 space-y-4">
            <p className="text-sm text-muted">
              พบ <strong className="text-ink">{result.total}</strong> รายการ · หน้า {result.page} /{" "}
              {result.totalPages}
            </p>

            <MovementTable movements={result.items} />

            <Pagination
              page={result.page}
              totalPages={result.totalPages}
              hrefFor={(page) => withParam(params, "page", page)}
            />
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
