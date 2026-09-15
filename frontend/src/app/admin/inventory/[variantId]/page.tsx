import { ArrowLeft, History, Package } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/shared/section";
import { MovementTable } from "@/features/admin/components/movement-table";
import { StockAdjustForm } from "@/features/admin/components/stock-adjust-form";
import { stockStatusLabel, stockStatusTone } from "@/features/admin/lib/inventory-labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { cn } from "@/lib/utils";
import { fetchVariantInventoryOnServer } from "@/services/admin.server";
import type { VariantInventory } from "@/types/admin";

export const metadata: Metadata = {
  title: "สต็อกของตัวเลือกสินค้า",
  robots: { index: false, follow: false },
};

/**
 * สต็อกของตัวเลือกสินค้าหนึ่งตัว + ฟอร์มปรับ + ประวัติ (STEP 15)
 *
 * ⚠️ **ห้ามมี `loading.tsx` ในโฟลเดอร์นี้** และต้อง `await` ข้อมูลที่ระดับ page
 *    ไม่งั้น `notFound()` จะคืน HTTP 200 (soft 404) — ยืนยันแล้วตอน STEP 6
 * ⚠️ ฟอร์มปรับสต็อกแสดงเฉพาะผู้มีสิทธิ์ `inventory:adjust` แต่ **การป้องกันจริงอยู่ที่ backend**
 */
export default async function VariantInventoryPage({
  params,
}: {
  params: Promise<{ variantId: string }>;
}) {
  const session = await requirePermission("inventory:read");
  const { variantId } = await params;

  const canAdjust = session.user.permissions.includes("inventory:adjust");

  let data: VariantInventory;

  try {
    data = await fetchVariantInventoryOnServer(variantId);
  } catch (error) {
    // id ที่ไม่มีจริงหรือรูปแบบผิด = ไม่พบหน้านี้ (404 จริง)
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
      notFound();
    }

    return (
      <main className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6">
        <SectionError
          message={error instanceof ApiClientError ? error.message : "โหลดข้อมูลคลังไม่สำเร็จ"}
        />
      </main>
    );
  }

  const row = data.inventory;
  const variantLabel = [row.color?.name, row.size?.name].filter(Boolean).join(" · ") || "ไม่ระบุ";

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6">
      <Link
        href="/admin/inventory"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted transition hover:text-brand"
      >
        <ArrowLeft className="size-4" aria-hidden />
        กลับไปคลังสินค้า
      </Link>

      <header className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl break-words">{row.product.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {variantLabel} · <span className="font-mono break-all">{row.sku}</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "flex min-h-9 items-center rounded-[var(--radius-pill)] border px-3 text-xs font-bold",
              stockStatusTone(row.stockStatus),
            )}
          >
            {stockStatusLabel(row.stockStatus)}
          </span>
          <Link
            href={`/admin/products/${row.product.id}`}
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            <Package className="size-4" aria-hidden />
            แก้ไขสินค้า
          </Link>
        </div>
      </header>

      {/* 3 ตัวเลขต้องแยกกันให้เห็นชัด — ยุบเป็นตัวเดียวคือต้นเหตุของการเข้าใจผิด */}
      <dl className="mt-6 grid gap-4 sm:grid-cols-3">
        <Fact
          label="ของในคลัง"
          value={`${row.quantity} ชิ้น`}
          hint={row.location === null ? "ไม่ระบุตำแหน่ง" : `ตำแหน่ง ${row.location}`}
        />
        <Fact
          label="จองไว้แล้ว"
          value={`${row.reserved} ชิ้น`}
          hint={row.reserved > 0 ? "อยู่ในคำสั่งซื้อที่ยังไม่จบ — ตัดออกไม่ได้" : "ไม่มีใครจอง"}
          tone={row.reserved > 0 ? "text-warning" : undefined}
        />
        <Fact
          label="ขายได้จริง"
          value={`${row.available} ชิ้น`}
          hint={`จุดเตือนของสินค้านี้ ${row.minimumStock} ชิ้น`}
          tone={row.available === 0 ? "text-danger" : "text-brand-dark"}
        />
      </dl>

      {row.available === 0 && row.quantity > 0 && (
        <p className="mt-4 rounded-[12px] border border-warning/30 bg-warning/10 p-3 text-sm font-semibold text-warning">
          คลังมีของ {row.quantity} ชิ้น แต่ถูกจองไว้ทั้งหมด — หน้าร้านจึงแสดงว่า “สินค้าหมด”
          ซึ่งถูกต้องแล้ว
        </p>
      )}

      {canAdjust ? (
        <div className="mt-6">
          <StockAdjustForm row={row} />
        </div>
      ) : (
        <p className="mt-6 rounded-[var(--radius-card)] border border-line bg-lilac-50 p-4 text-sm text-muted">
          บัญชีของคุณดูข้อมูลคลังได้ แต่ไม่มีสิทธิ์ปรับยอด (ต้องมีสิทธิ์{" "}
          <code>inventory:adjust</code>)
        </p>
      )}

      <section className="mt-8">
        <h2 className="flex items-center gap-2 text-lg">
          <History className="size-5 text-brand" aria-hidden />
          ประวัติการเคลื่อนไหว
        </h2>
        <p className="mt-1 text-sm text-muted">
          {data.movementCount === 0
            ? "ยังไม่มีการเคลื่อนไหว"
            : `ทั้งหมด ${data.movementCount} รายการ · แสดง ${data.movements.length} รายการล่าสุด`}
        </p>

        <div className="mt-3">
          <MovementTable movements={data.movements} showProduct={false} />
        </div>

        {data.movementCount > data.movements.length && (
          <Link
            href={`/admin/inventory/movements?variantId=${row.variantId}`}
            className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            ดูประวัติทั้งหมดของตัวเลือกนี้
          </Link>
        )}
      </section>
    </main>
  );
}

function Fact({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone?: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <dt className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</dt>
      <dd className={cn("mt-2 text-2xl font-extrabold", tone ?? "text-ink")}>{value}</dd>
      <p className="mt-1 text-xs text-muted">{hint}</p>
    </div>
  );
}
