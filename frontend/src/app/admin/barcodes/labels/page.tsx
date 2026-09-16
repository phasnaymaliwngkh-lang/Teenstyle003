import { AlertTriangle, ArrowLeft, Printer } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/shared/section";
import { PrintSheetButton } from "@/features/admin/components/print-sheet-button";
import {
  encodesLabel,
  svgToDataUrl,
  symbologyLabel,
  SYMBOLOGY_CHOICES,
} from "@/features/admin/lib/barcode-labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import type { RawSearchParams } from "@/lib/query-params";
import { fetchBarcodeLabelsOnServer } from "@/services/admin.server";
import type { LabelItem, LabelSheet, RequestedSymbology } from "@/types/admin";
import { formatBaht } from "@/utils/format";

export const metadata: Metadata = {
  title: "พิมพ์ป้ายบาร์โค้ด",
  robots: { index: false, follow: false },
};

const COPY_CHOICES = [1, 2, 4, 8, 12] as const;

function firstOf(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function allOf(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];

  return Array.isArray(value) ? value : [value];
}

/**
 * แผ่นป้ายบาร์โค้ดสำหรับพิมพ์ (STEP 17)
 *
 * ⚠️ **ภาพบาร์โค้ดวาดที่ backend** แล้วส่งมาเป็น SVG — ที่นี่แค่แสดงผล
 *    เพื่อให้ป้ายที่พิมพ์จากทุกเครื่องเหมือนกัน และให้ค่าที่เข้ารหัสมาจากฐานข้อมูลเท่านั้น
 * ⚠️ SVG ถูกใส่ผ่าน data URL ใน `<img>` **ไม่ใช้ dangerouslySetInnerHTML**
 * ⚠️ ตัวเลือกที่ขอมาแต่ไม่พบ ต้องบอกให้เห็น ไม่ใช่พิมพ์ให้น้อยกว่าที่สั่งแบบเงียบ ๆ
 */
export default async function BarcodeLabelsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("product:read");

  const raw = await searchParams;
  const productId = firstOf(raw["productId"]);
  const variantIds = allOf(raw["variantId"]);
  const symbology = (firstOf(raw["symbology"]) ?? "auto") as RequestedSymbology;
  const copies = Number(firstOf(raw["copies"]) ?? "1");

  const hasTarget = productId !== undefined || variantIds.length > 0;

  /** query ที่ส่งต่อให้ backend — ชื่อพารามิเตอร์ตรงกับที่ endpoint รับ */
  const params = new URLSearchParams();
  if (productId !== undefined) params.set("productId", productId);
  for (const id of variantIds) params.append("variantId", id);
  params.set("symbology", symbology);
  params.set("copies", String(Number.isFinite(copies) && copies > 0 ? copies : 1));

  let sheet: LabelSheet | null = null;
  let errorMessage: string | null = null;

  if (hasTarget) {
    try {
      sheet = await fetchBarcodeLabelsOnServer(params);
    } catch (error) {
      errorMessage = error instanceof ApiClientError ? error.message : "สร้างป้ายบาร์โค้ดไม่สำเร็จ";
    }
  }

  /** ลิงก์เปลี่ยนตัวเลือกโดยคงเป้าหมายเดิมไว้ */
  function hrefWith(changes: { symbology?: string; copies?: string }): string {
    const next = new URLSearchParams();
    if (productId !== undefined) next.set("productId", productId);
    for (const id of variantIds) next.append("variantId", id);
    next.set("symbology", changes.symbology ?? symbology);
    next.set("copies", changes.copies ?? String(copies));

    return `/admin/barcodes/labels?${next.toString()}`;
  }

  const fallbackToSku =
    sheet?.items.filter((item) => item.encodes === "SKU" && item.barcode === null) ?? [];
  const inactive = sheet?.items.filter((item) => !item.isActive) ?? [];

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      {/* แถบควบคุม — ไม่ต้องติดไปบนกระดาษ */}
      <div className="print:hidden">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl">พิมพ์ป้ายบาร์โค้ด</h1>
            <p className="mt-1 text-sm text-muted">
              ป้ายทุกใบสร้างจากข้อมูลจริงในฐานข้อมูล — ชื่อ ราคา SKU และบาร์โค้ดตรงกับที่ระบบเก็บไว้
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link
              href="/admin/barcodes"
              className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
            >
              <ArrowLeft className="size-4" aria-hidden />
              กลับไปหน้าสแกน
            </Link>
            {sheet !== null && sheet.items.length > 0 && <PrintSheetButton />}
          </div>
        </header>

        {!hasTarget && (
          <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-12 text-center">
            <Printer className="mx-auto size-10 text-brand-soft" aria-hidden />
            <p className="mt-3 font-extrabold">ยังไม่ได้เลือกว่าจะพิมพ์ป้ายของอะไร</p>
            <p className="mt-2 text-sm text-muted">
              เข้าหน้านี้จากปุ่มพิมพ์ป้ายในหน้าสแกนบาร์โค้ด หรือหน้าจัดการสินค้า
            </p>
            <Link
              href="/admin/barcodes"
              className="mt-4 inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-4 text-sm font-semibold transition hover:border-brand-soft"
            >
              ไปหน้าสแกนบาร์โค้ด
            </Link>
          </div>
        )}

        {errorMessage !== null && (
          <div className="mt-6">
            <SectionError message={errorMessage} />
          </div>
        )}

        {sheet !== null && (
          <>
            <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-white p-5">
              <h2 className="text-lg">รูปแบบป้าย</h2>

              <nav aria-label="เลือกสัญลักษณ์" className="mt-3 grid gap-2 sm:grid-cols-3">
                {SYMBOLOGY_CHOICES.map((choice) => (
                  <Link
                    key={choice.value}
                    href={hrefWith({ symbology: choice.value })}
                    aria-current={sheet.requested === choice.value ? "true" : undefined}
                    className={
                      sheet.requested === choice.value
                        ? "rounded-[12px] border border-brand bg-lilac-50 p-3 text-sm shadow-[var(--shadow-soft)]"
                        : "rounded-[12px] border border-line p-3 text-sm transition hover:border-brand-soft"
                    }
                  >
                    <span className="block font-bold">{choice.label}</span>
                    <span className="block text-xs text-muted">{choice.hint}</span>
                  </Link>
                ))}
              </nav>

              <div className="mt-4">
                <p className="text-sm font-semibold">จำนวนป้ายต่อหนึ่งตัวเลือก</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {COPY_CHOICES.map((count) => (
                    <Link
                      key={count}
                      href={hrefWith({ copies: String(count) })}
                      aria-current={sheet.copies === count ? "true" : undefined}
                      className={
                        sheet.copies === count
                          ? "flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-pill)] border border-brand bg-brand px-4 text-sm font-bold text-white"
                          : "flex min-h-11 min-w-11 items-center justify-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
                      }
                    >
                      {count}
                    </Link>
                  ))}
                </div>
              </div>

              <p className="mt-4 text-sm text-muted">
                จะพิมพ์ทั้งหมด{" "}
                <strong className="text-ink">{sheet.items.length * sheet.copies}</strong> ป้าย (
                {sheet.items.length} ตัวเลือก × {sheet.copies} ใบ)
              </p>
            </section>

            {(sheet.missingVariantIds.length > 0 ||
              fallbackToSku.length > 0 ||
              inactive.length > 0) && (
              <section className="mt-4 space-y-2" aria-live="polite">
                {sheet.missingVariantIds.length > 0 && (
                  <Warning>
                    มี {sheet.missingVariantIds.length} ตัวเลือกที่ขอมาแต่หาไม่พบ (อาจถูกลบไปแล้ว)
                    จึงไม่มีป้ายให้
                  </Warning>
                )}
                {fallbackToSku.length > 0 && (
                  <Warning>
                    {fallbackToSku.length} ตัวเลือกยังไม่มีบาร์โค้ด ป้ายจึงใช้ Code 128 ของ SKU
                    (สแกนได้ปกติ แต่ไม่ใช่เลข EAN) — ออกเลขให้ได้ที่หน้าสแกนบาร์โค้ด
                  </Warning>
                )}
                {inactive.length > 0 && (
                  <Warning>
                    {inactive.length} ตัวเลือกปิดขายอยู่ — ป้ายยังพิมพ์ได้ แต่ของยังไม่ขึ้นหน้าร้าน
                  </Warning>
                )}
              </section>
            )}
          </>
        )}
      </div>

      {sheet !== null && sheet.items.length > 0 && <LabelSheetView sheet={sheet} />}
    </main>
  );
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 rounded-[12px] border border-warning/30 bg-warning/5 p-3 text-sm font-semibold text-ink-soft">
      <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      {children}
    </p>
  );
}

/**
 * แผ่นป้ายที่จะออกกระดาษจริง
 *
 * ขนาดใช้หน่วย **มิลลิเมตร** เพื่อให้สิ่งที่พิมพ์ออกมามีขนาดเท่าที่ตั้งใจ
 * (px ขึ้นกับ DPI ของเครื่องพิมพ์ ส่วนบาร์โค้ดที่เล็กเกินไปจะสแกนไม่ติด)
 * `break-inside: avoid` กันป้ายใบเดียวถูกตัดคาบเกี่ยว 2 หน้า
 */
function LabelSheetView({ sheet }: { sheet: LabelSheet }) {
  /** ทำสำเนาตามจำนวนที่สั่ง — ป้ายแต่ละใบเป็นกระดาษ 1 ชิ้นจริง ๆ */
  const labels = sheet.items.flatMap((item) =>
    Array.from({ length: sheet.copies }, (_, copy) => ({ item, copy })),
  );

  return (
    <>
      <style>{`
        @page { size: A4; margin: 10mm; }
        @media print {
          .barcode-sheet { grid-template-columns: repeat(4, 45mm); gap: 3mm; }
          .barcode-label { break-inside: avoid; }
        }
      `}</style>

      <section className="mt-6" aria-label="ป้ายบาร์โค้ดที่จะพิมพ์">
        <div className="barcode-sheet grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {labels.map(({ item, copy }) => (
            <Label key={`${item.variantId}-${copy}`} item={item} />
          ))}
        </div>
      </section>
    </>
  );
}

function Label({ item }: { item: LabelItem }) {
  const variantLabel = [item.colorName, item.sizeName].filter(Boolean).join(" · ");

  return (
    <article className="barcode-label flex h-[30mm] flex-col justify-between rounded-[6px] border border-line bg-white p-[2mm]">
      <div className="min-w-0">
        <p className="truncate text-[7pt] leading-tight font-bold">{item.productName}</p>
        <p className="truncate text-[6pt] leading-tight text-muted">
          {variantLabel === "" ? item.sku : `${variantLabel} · ${item.sku}`}
        </p>
      </div>

      {/*
        eslint-disable-next-line @next/next/no-img-element --
        SVG ที่ backend วาดมาถูกใส่เป็น data URL: next/image ไม่ช่วยอะไรกับภาพ inline
        และ SVG ใน <img> ไม่มีสิทธิ์รันสคริปต์ (ปลอดภัยกว่าการ inject เป็น markup)
      */}
      <img
        src={svgToDataUrl(item.svg)}
        alt={`${symbologyLabel(item.symbology)} ของ ${item.sku} (${item.encodedValue})`}
        width={item.width}
        height={item.height}
        className={
          item.symbology === "qrcode"
            ? "mx-auto h-[15mm] w-[15mm]"
            : "mx-auto h-[13mm] w-full object-contain"
        }
      />

      <div className="flex items-end justify-between gap-1">
        <span className="text-[8pt] leading-none font-extrabold">
          {formatBaht(item.finalPrice)}
        </span>
        <span className="text-[5pt] leading-none text-muted">{encodesLabel(item)}</span>
      </div>
    </article>
  );
}
