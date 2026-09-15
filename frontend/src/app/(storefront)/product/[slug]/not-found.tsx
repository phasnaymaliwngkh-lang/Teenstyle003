import { PackageX } from "lucide-react";
import Link from "next/link";

/**
 * แสดงเมื่อ slug ไม่มีในฐานข้อมูล (backend ตอบ 404)
 * ไม่ใช่ error state — จึงไม่มีปุ่มลองใหม่ แต่ให้ทางไปต่อ
 */
export default function ProductNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <PackageX className="mx-auto size-12 text-brand-soft" aria-hidden />
      <h1 className="mt-4 text-2xl">ไม่พบสินค้านี้</h1>
      <p className="mt-2 text-sm text-muted">
        สินค้าอาจถูกนำออกจากร้าน หรือลิงก์ที่ใช้ไม่ถูกต้อง ลองเลือกจากสินค้าทั้งหมดได้เลย
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/shop"
          className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          ดูสินค้าทั้งหมด
        </Link>
        <Link
          href="/"
          className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          กลับหน้าแรก
        </Link>
      </div>
    </div>
  );
}
