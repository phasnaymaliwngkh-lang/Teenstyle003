import { PackageX } from "lucide-react";
import Link from "next/link";

/** ไม่พบคำสั่งซื้อนี้ในบัญชีของผู้ใช้ (backend ตอบ 404 — ไม่บอกใบ้ว่ามีอยู่ของคนอื่นไหม) */
export default function OrderNotFound() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center">
      <PackageX className="mx-auto size-12 text-brand-soft" aria-hidden />
      <h1 className="mt-4 text-2xl">ไม่พบคำสั่งซื้อนี้</h1>
      <p className="mt-2 text-sm text-muted">
        เลขคำสั่งซื้ออาจพิมพ์ไม่ถูกต้อง หรือไม่ใช่คำสั่งซื้อของบัญชีนี้
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/account/orders"
          className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          ดูคำสั่งซื้อทั้งหมด
        </Link>
        <Link
          href="/shop"
          className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          เลือกซื้อสินค้า
        </Link>
      </div>
    </div>
  );
}
