import { PackageX } from "lucide-react";
import Link from "next/link";

/** แสดงเมื่อ variantId ไม่มีในฐานข้อมูล (หรือถูกลบไปแล้ว) */
export default function VariantInventoryNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <PackageX className="mx-auto size-12 text-brand-soft" aria-hidden />
      <h1 className="mt-4 text-2xl">ไม่พบตัวเลือกสินค้านี้</h1>
      <p className="mt-2 text-sm text-muted">
        ตัวเลือกอาจถูกลบไปแล้ว หรือลิงก์ที่ใช้ไม่ถูกต้อง — ประวัติการเคลื่อนไหวของสต็อกเดิม
        ยังอยู่ในหน้าประวัติรวม
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/admin/inventory"
          className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          กลับไปคลังสินค้า
        </Link>
        <Link
          href="/admin/inventory/movements"
          className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          ประวัติการเคลื่อนไหว
        </Link>
      </div>
    </div>
  );
}
