import { PackageX } from "lucide-react";
import Link from "next/link";

/**
 * แสดงเมื่อ id ของสินค้าไม่มีในฐานข้อมูล (หรือถูกลบไปแล้ว)
 * ไม่ใช่ error state — จึงไม่มีปุ่มลองใหม่ แต่ให้ทางกลับไปทำงานต่อ
 */
export default function AdminProductNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <PackageX className="mx-auto size-12 text-brand-soft" aria-hidden />
      <h1 className="mt-4 text-2xl">ไม่พบสินค้านี้</h1>
      <p className="mt-2 text-sm text-muted">
        สินค้าอาจถูกลบไปแล้ว หรือลิงก์ที่ใช้ไม่ถูกต้อง — สินค้าที่ถูกลบจะไม่แสดงในรายการ
        แต่ประวัติคำสั่งซื้อเดิมยังอ้างอิงได้
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/admin/products"
          className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          กลับไปรายการสินค้า
        </Link>
        <Link
          href="/admin"
          className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          ภาพรวมร้าน
        </Link>
      </div>
    </div>
  );
}
