import {
  AlertTriangle,
  Boxes,
  ExternalLink,
  PackageSearch,
  Pencil,
  Printer,
  ScanBarcode,
  SearchX,
} from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { SectionError } from "@/components/shared/section";
import { AssignBarcodeButton } from "@/features/admin/components/assign-barcode-button";
import { barcodeKindLabel, matchedByLabel } from "@/features/admin/lib/barcode-labels";
import { stockStatusLabel, stockStatusTone } from "@/features/admin/lib/inventory-labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import type { RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchBarcodeLookupOnServer } from "@/services/admin.server";
import type { BarcodeLookupResult } from "@/types/admin";
import { formatBaht } from "@/utils/format";

export const metadata: Metadata = {
  title: "บาร์โค้ด / QR",
  robots: { index: false, follow: false },
};

/**
 * สแกนบาร์โค้ดเพื่อหาสินค้า (STEP 17)
 *
 * เป็น **ฟอร์ม GET ธรรมดา** โดยเจตนา — เครื่องสแกนบาร์โค้ดแบบ USB/บลูทูธทำงาน
 * เหมือนคีย์บอร์ด (พิมพ์โค้ดแล้วส่ง Enter) จึง submit ฟอร์มได้เองโดยไม่ต้องมี JS
 * ผลลัพธ์จึงเป็น URL ที่แชร์/รีเฟรชได้ และมีสถานะ loading/empty/error ครบตามกฎของโปรเจกต์
 *
 * ⚠️ **ยังไม่มีการสแกนด้วยกล้อง** — พูดตรง ๆ ในหน้าเว็บ ไม่ทำปุ่มกล้องที่กดแล้วไม่เกิดอะไร
 * ⚠️ ไม่พบ = บอกว่าไม่พบ **ห้ามเดา** ว่าน่าจะเป็นสินค้าตัวไหน (backend ก็ไม่ค้นแบบ LIKE)
 */
export default async function AdminBarcodesPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("product:read");

  const raw = await searchParams;
  const codeParam = raw["code"];
  const code = (Array.isArray(codeParam) ? codeParam[0] : codeParam)?.trim() ?? "";

  let result: BarcodeLookupResult | null = null;
  let notFound = false;
  let errorMessage: string | null = null;

  if (code !== "") {
    try {
      result = await fetchBarcodeLookupOnServer(code);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 404) {
        notFound = true;
      } else if (error instanceof ApiClientError && error.status === 422) {
        errorMessage = error.message;
      } else {
        errorMessage = error instanceof ApiClientError ? error.message : "ค้นหาไม่สำเร็จ";
      }
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">บาร์โค้ด / QR</h1>
          <p className="mt-1 text-sm text-muted">
            สแกนหรือพิมพ์บาร์โค้ด / SKU เพื่อหาสินค้าในระบบ แล้วไปปรับสต็อกหรือพิมพ์ป้ายต่อได้ทันที
          </p>
        </div>

        <Link
          href="/admin/products"
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          จัดการสินค้า
        </Link>
      </header>

      {/* form GET — เครื่องสแกนพิมพ์โค้ดแล้วกด Enter ก็ส่งฟอร์มได้เลย ไม่ต้องรอ JS */}
      <form action="/admin/barcodes" method="get" className="mt-6 flex flex-wrap gap-2">
        <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white px-4">
          <ScanBarcode className="size-5 shrink-0 text-brand" aria-hidden />
          <span className="sr-only">บาร์โค้ดหรือ SKU</span>
          <input
            // ช่องนี้เป็นเป้าหมายเดียวของหน้า — ยิงเครื่องสแกนแล้วต้องเข้าช่องนี้ได้ทันที
            autoFocus
            type="text"
            name="code"
            defaultValue={code}
            inputMode="text"
            autoComplete="off"
            placeholder="ยิงเครื่องสแกน หรือพิมพ์บาร์โค้ด / SKU แล้วกด Enter"
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

      <p className="mt-2 text-xs text-muted">
        เครื่องสแกนบาร์โค้ดแบบ USB / บลูทูธใช้งานได้ทันที (มันทำงานเหมือนคีย์บอร์ด) ·{" "}
        <strong className="font-semibold">ยังไม่รองรับการสแกนด้วยกล้องของเครื่อง</strong>
      </p>

      {errorMessage !== null && (
        <div className="mt-6">
          <SectionError message={errorMessage} />
        </div>
      )}

      {notFound && (
        <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-12 text-center">
          <SearchX className="mx-auto size-10 text-brand-soft" aria-hidden />
          <p className="mt-3 font-extrabold">ไม่พบสินค้าที่ตรงกับ “{code}”</p>
          <p className="mt-2 text-sm text-muted">
            ระบบเทียบแบบตรงทุกตัวอักษรเท่านั้น (ไม่เดาให้) — ตรวจว่าเป็นบาร์โค้ดหรือ SKU ของร้านนี้
            <br />
            ถ้าเป็นสินค้าใหม่ที่ยังไม่มีบาร์โค้ด ให้ค้นด้วย SKU แล้วกด “ออกบาร์โค้ดของร้านให้”
          </p>
          <Link
            href="/admin/products"
            className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-4 text-sm font-semibold transition hover:border-brand-soft"
          >
            ไปค้นหาในรายการสินค้า
          </Link>
        </div>
      )}

      {code === "" && errorMessage === null && (
        <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-12 text-center">
          <PackageSearch className="mx-auto size-10 text-brand-soft" aria-hidden />
          <p className="mt-3 font-extrabold">พร้อมรับการสแกน</p>
          <p className="mt-2 text-sm text-muted">
            ยิงบาร์โค้ดที่ป้ายสินค้า หรือพิมพ์ SKU ลงในช่องด้านบน
          </p>
        </div>
      )}

      {result !== null && <LookupResult result={result} />}
    </main>
  );
}

function LookupResult({ result }: { result: BarcodeLookupResult }) {
  const { product, variant } = result;

  return (
    <section className="mt-6 rounded-[var(--radius-card)] border border-brand/25 bg-white p-5 shadow-[var(--shadow-soft)]">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">
        {matchedByLabel(result.matchedBy)} · <span className="font-mono">{result.code}</span>
      </p>

      <div className="mt-3 flex flex-wrap gap-4">
        {product.imageUrl !== null && (
          <Image
            src={product.imageUrl}
            alt={product.name}
            width={96}
            height={96}
            className="size-24 shrink-0 rounded-[12px] border border-line object-cover"
          />
        )}

        <div className="min-w-0 flex-1">
          <h2 className="text-xl">{product.name}</h2>
          <p className="mt-1 text-sm text-muted">
            {product.category.name} · <span className="font-mono break-all">{product.sku}</span> ·{" "}
            {product.status === "ACTIVE" ? "เปิดขายอยู่" : `สถานะ ${product.status}`}
          </p>

          {variant === null ? (
            <p className="mt-3 rounded-[12px] border border-warning/30 bg-warning/5 p-3 text-sm">
              โค้ดนี้คือ SKU ของสินค้า จึงยังไม่รู้ว่าเป็นตัวเลือกไหน — สินค้านี้มี{" "}
              <strong>{result.variantCount}</strong> ตัวเลือกที่เปิดขาย
              เลือกจากหน้าจัดการสินค้าหรือพิมพ์ป้ายทั้งชุดได้
            </p>
          ) : (
            <VariantDetail variant={variant} />
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        {variant !== null && (
          <>
            <Link href={`/admin/inventory/${variant.variantId}`} className={actionClass}>
              <Boxes className="size-4" aria-hidden />
              รับของเข้า / ปรับยอด
            </Link>
            <Link
              href={`/admin/barcodes/labels?variantId=${variant.variantId}`}
              className={actionClass}
            >
              <Printer className="size-4" aria-hidden />
              พิมพ์ป้ายของตัวเลือกนี้
            </Link>
          </>
        )}
        <Link href={`/admin/barcodes/labels?productId=${product.id}`} className={actionClass}>
          <Printer className="size-4" aria-hidden />
          พิมพ์ป้ายทุกตัวเลือก
        </Link>
        <Link href={`/admin/products/${product.id}`} className={actionClass}>
          <Pencil className="size-4" aria-hidden />
          แก้ข้อมูลสินค้า
        </Link>
        <a href={product.storefrontUrl} target="_blank" rel="noreferrer" className={actionClass}>
          <ExternalLink className="size-4" aria-hidden />
          ดูหน้าร้าน
        </a>
      </div>

      {variant !== null && variant.barcode === null && (
        <div className="mt-4 rounded-[12px] border border-brand/25 bg-lilac-50 p-4">
          <p className="text-sm font-semibold">ตัวเลือกนี้ยังไม่มีบาร์โค้ด</p>
          <p className="mt-1 mb-3 text-sm text-muted">
            ป้ายที่พิมพ์จะใช้ Code 128 ของ SKU ซึ่งสแกนได้อยู่แล้ว · ถ้าต้องการเลข EAN-13
            ให้ระบบออกเลขของร้าน (ขึ้นต้น 20 = ใช้ภายในร้าน ไม่ใช่เลขที่จดทะเบียนระดับโลก)
          </p>
          <AssignBarcodeButton variantId={variant.variantId} />
        </div>
      )}
    </section>
  );
}

function VariantDetail({ variant }: { variant: NonNullable<BarcodeLookupResult["variant"]> }) {
  const label = [variant.color?.name, variant.size?.name].filter(Boolean).join(" · ") || "ไม่ระบุ";

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="rounded-[var(--radius-pill)] border border-line bg-lilac-50 px-3 py-1 text-sm font-bold">
          {label}
        </span>
        <span
          className={cn(
            "rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-bold",
            stockStatusTone(variant.stockStatus),
          )}
        >
          {stockStatusLabel(variant.stockStatus)}
        </span>
        {!variant.isActive && (
          <span className="rounded-[var(--radius-pill)] border border-line bg-lilac-50 px-2.5 py-1 text-xs font-bold text-muted">
            ตัวเลือกนี้ปิดขายอยู่
          </span>
        )}
      </div>

      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">SKU</dt>
          <dd className="font-mono break-all">{variant.sku}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">บาร์โค้ด</dt>
          <dd className="font-mono break-all">
            {variant.barcode ?? "—"}
            <span className="block font-sans text-xs text-muted">
              {barcodeKindLabel(variant.barcodeKind, variant.barcode)}
            </span>
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted">ราคาที่คิดเงินจริง</dt>
          <dd className="font-extrabold text-brand-dark">{formatBaht(variant.finalPrice)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">ที่เก็บ</dt>
          <dd className="font-semibold">{variant.location ?? "ไม่ระบุ"}</dd>
        </div>
      </dl>

      {/* 3 ตัวเลขต้องแยกกันให้เห็นเสมอ (กฎจาก STEP 15) */}
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
        <div className="rounded-[12px] border border-line p-3">
          <dt className="text-xs text-muted">ในคลัง</dt>
          <dd className="text-lg font-extrabold">{variant.quantity}</dd>
        </div>
        <div className="rounded-[12px] border border-line p-3">
          <dt className="text-xs text-muted">จองไว้</dt>
          <dd className={cn("text-lg font-extrabold", variant.reserved > 0 && "text-warning")}>
            {variant.reserved}
          </dd>
        </div>
        <div className="rounded-[12px] border border-line p-3">
          <dt className="text-xs text-muted">ขายได้จริง</dt>
          <dd
            className={cn(
              "text-lg font-extrabold",
              variant.available === 0 ? "text-danger" : "text-brand-dark",
            )}
          >
            {variant.available}
          </dd>
        </div>
      </dl>

      {variant.barcode !== null && variant.barcodeKind === null && (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-[12px] border border-danger/25 bg-danger/5 p-3 text-sm font-semibold text-danger"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          เลขบาร์โค้ดที่บันทึกไว้ไม่ผ่านการตรวจหลักตรวจสอบ จึงสแกนไม่ติด — ป้ายจะถอยไปใช้ Code 128
          ของ SKU ให้ · แก้เลขที่หน้าจัดการสินค้า
        </p>
      )}
    </>
  );
}

const actionClass =
  "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50";
