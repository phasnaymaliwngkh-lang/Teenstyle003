import { UserX } from "lucide-react";
import Link from "next/link";

/**
 * แสดงเมื่อ id ของบัญชีไม่มีในฐานข้อมูล หรือลิงก์ที่ใช้ไม่ใช่ UUID
 * ไม่ใช่ error state — จึงไม่มีปุ่มลองใหม่ แต่ให้ทางกลับไปทำงานต่อ
 */
export default function AdminCustomerNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <UserX className="mx-auto size-12 text-brand-soft" aria-hidden />
      <h1 className="mt-4 text-2xl">ไม่พบบัญชีผู้ใช้นี้</h1>
      <p className="mt-2 text-sm text-muted">
        ลิงก์ที่ใช้อาจไม่ถูกต้อง — ลองค้นหาด้วยอีเมลหรือเบอร์โทรจากรายการลูกค้า
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/admin/customers"
          className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          กลับไปรายการลูกค้า
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
