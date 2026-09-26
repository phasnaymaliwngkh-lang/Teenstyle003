import { ArrowLeft, ExternalLink } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/shared/section";
import { DeleteProductButton } from "@/features/admin/components/delete-product-button";
import { ProductForm } from "@/features/admin/components/product-form";
import { VariantManager } from "@/features/admin/components/variant-manager";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { cn } from "@/lib/utils";
import {
  fetchAdminProductOnServer,
  fetchProductFormOptionsOnServer,
} from "@/services/admin.server";
import type { AdminProduct, ProductFormOptions } from "@/types/admin";

export const metadata: Metadata = {
  title: "แก้ไขสินค้า",
  robots: { index: false, follow: false },
};

/**
 * แก้ไขสินค้า (STEP 14)
 *
 * ⚠️ **ห้ามมี `loading.tsx` ในโฟลเดอร์นี้** และต้อง `await` ข้อมูลที่ระดับ page
 *    ไม่งั้น `notFound()` จะคืน HTTP 200 (soft 404) — ยืนยันแล้วตอน STEP 6
 * ⚠️ ฟอร์มสินค้า / ตัวเลือก / การลบ แยกกันคนละส่วน เพื่อให้แก้ทีละเรื่องได้
 *    โดยไม่ต้องกดบันทึกทั้งหน้า
 */
export default async function EditProductPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  await requirePermission("product:update");

  const { productId } = await params;

  let product: AdminProduct;

  try {
    product = await fetchAdminProductOnServer(productId);
  } catch (error) {
    // id ที่ไม่มีจริง หรือรูปแบบ id ไม่ถูกต้อง = ไม่พบหน้านี้ (404 จริง)
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
      notFound();
    }

    return (
      <main className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6">
        <SectionError
          message={error instanceof ApiClientError ? error.message : "โหลดข้อมูลสินค้าไม่สำเร็จ"}
        />
      </main>
    );
  }

  // ตัวเลือกของฟอร์มพังไม่ควรทำให้ทั้งหน้าพัง — แสดงส่วนที่อ่านได้ไว้ก่อน
  let options: ProductFormOptions | null = null;
  let optionsError: string | null = null;

  try {
    options = await fetchProductFormOptionsOnServer();
  } catch (error) {
    optionsError =
      error instanceof ApiClientError ? error.message : "โหลดตัวเลือกของฟอร์มไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6">
      <Link
        href="/admin/products"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-muted transition hover:text-brand"
      >
        <ArrowLeft className="size-4" aria-hidden />
        กลับไปรายการสินค้า
      </Link>

      <header className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl break-words">{product.name}</h1>
          <p className="mt-1 font-mono text-sm break-all text-muted">{product.sku}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-3 text-xs font-bold",
              product.status === "ACTIVE"
                ? "border-success/30 bg-success/10 text-success"
                : product.status === "DRAFT"
                  ? "border-warning/30 bg-warning/10 text-warning"
                  : "border-line bg-lilac-50 text-muted",
            )}
          >
            {product.status === "ACTIVE"
              ? "เปิดขาย"
              : product.status === "DRAFT"
                ? "ฉบับร่าง"
                : "เก็บเข้าคลัง"}
          </span>

          {product.status === "ACTIVE" && (
            <Link
              href={`/product/${product.slug}`}
              className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
            >
              <ExternalLink className="size-4" aria-hidden />
              ดูหน้าร้าน
            </Link>
          )}
        </div>
      </header>

      <dl className="mt-4 grid gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4 text-sm sm:grid-cols-4">
        <Fact label="ขายได้จริง" value={`${product.availableStock} ชิ้น`} />
        <Fact
          label="ในคลัง / จองไว้"
          value={`${product.totalStock} / ${product.reservedStock} ชิ้น`}
        />
        <Fact label="ถูกสั่งซื้อ" value={`${product.orderItemCount} ครั้ง`} />
        <Fact
          label="เผยแพร่เมื่อ"
          value={
            product.publishedAt === null
              ? "ยังไม่เผยแพร่"
              : new Date(product.publishedAt).toLocaleDateString("th-TH", { dateStyle: "medium" })
          }
        />
      </dl>

      {optionsError !== null || options === null ? (
        <div className="mt-6 space-y-6">
          <SectionError message={optionsError ?? "โหลดตัวเลือกของฟอร์มไม่สำเร็จ"} />
          <p className="text-sm text-muted">
            แก้ไขสินค้าไม่ได้จนกว่าจะโหลดตัวเลือก (หมวดหมู่/สี/ไซซ์) จากฐานข้อมูลได้
            เพราะฟอร์มจะไม่ใช้ตัวเลือกที่แต่งขึ้นเอง
          </p>
        </div>
      ) : (
        <>
          <ProductForm mode="edit" options={options} product={product} />

          <div className="mt-6 space-y-6">
            <VariantManager product={product} options={options} />
            <DeleteProductButton product={product} />
          </div>
        </>
      )}
    </main>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}
