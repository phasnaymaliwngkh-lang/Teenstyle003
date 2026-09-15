import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/shared/section";
import { ProductForm } from "@/features/admin/components/product-form";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { fetchProductFormOptionsOnServer } from "@/services/admin.server";
import type { ProductFormOptions } from "@/types/admin";

export const metadata: Metadata = {
  title: "เพิ่มสินค้า",
  robots: { index: false, follow: false },
};

/**
 * เพิ่มสินค้าใหม่ (STEP 14)
 *
 * ตัวเลือกในฟอร์ม (หมวดหมู่/แบรนด์/สี/ไซซ์/โฮสต์รูป) โหลดจากฐานข้อมูลจริง
 * ถ้าโหลดไม่ได้จะแสดง error + ปุ่มลองใหม่ **ไม่เปิดฟอร์มพร้อมตัวเลือกปลอม**
 */
export default async function NewProductPage() {
  await requirePermission("product:create");

  let options: ProductFormOptions | null = null;
  let errorMessage: string | null = null;

  try {
    options = await fetchProductFormOptionsOnServer();
  } catch (error) {
    errorMessage =
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

      <header className="mt-2">
        <h1 className="text-3xl">เพิ่มสินค้า</h1>
        <p className="mt-1 text-sm text-muted">
          กรอกข้อมูลตามจริง — ระบบไม่เติมราคา ชื่อ หรือคำอธิบายให้อัตโนมัติ
        </p>
      </header>

      {options === null ? (
        <div className="mt-6">
          <SectionError message={errorMessage ?? "โหลดตัวเลือกของฟอร์มไม่สำเร็จ"} />
        </div>
      ) : options.categories.length === 0 ? (
        <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 p-6 text-sm">
          <p className="font-extrabold">ยังไม่มีหมวดหมู่ในระบบ</p>
          <p className="mt-2 text-muted">
            สินค้าต้องอยู่ในหมวดหมู่ จึงต้องสร้างหมวดหมู่ก่อน (ระบบจัดการหมวดหมู่อยู่ใน STEP 16)
          </p>
        </div>
      ) : (
        <ProductForm mode="create" options={options} />
      )}
    </main>
  );
}
