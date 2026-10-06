import type { Metadata } from "next";
import Link from "next/link";

import { SectionError } from "@/components/shared/section";
import { ShippingRateEditor } from "@/features/admin/components/shipping-rate-editor";
import { formatDateTime } from "@/features/orders/lib/labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { cn } from "@/lib/utils";
import { fetchAdminShippingRatesOnServer } from "@/services/shipping.server";
import type { AdminShippingRates } from "@/types/shipping";

export const metadata: Metadata = {
  title: "อัตราค่าจัดส่ง",
  robots: { index: false, follow: false },
};

/**
 * อัตราค่าจัดส่ง /admin/shipping (STEP 44)
 *
 * ดู = `shipment:read` (พนักงานต้องตอบลูกค้าเรื่องค่าส่งได้) · แก้ = `settings:manage` (ADMIN ขึ้นไป)
 * ⚠️ ตัวเลขที่นี่คือแหล่งความจริงเดียวของค่าส่ง — หน้า checkout · การคิดเงิน · บทความนโยบาย ·
 *    คำตอบของ AI · หน้าแรก อ่านจากที่เดียวกัน · คำสั่งซื้อที่สั่งไปแล้วไม่เปลี่ยนตาม (เก็บเป็น snapshot)
 */
export default async function AdminShippingPage() {
  const session = await requirePermission("shipment:read");
  const canEdit = session.user.permissions.includes("settings:manage");

  let data: AdminShippingRates | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchAdminShippingRatesOnServer();
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดอัตราค่าจัดส่งไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl">อัตราค่าจัดส่ง</h1>
          <p className="mt-1 text-sm text-muted">
            แก้แล้วมีผลกับคำสั่งซื้อใหม่ทันที · บทความนโยบายการจัดส่งและคำตอบของ AI
            ใช้ตัวเลขชุดนี้เอง · คำสั่งซื้อที่สั่งไปแล้วเก็บค่าส่งเดิมไว้
          </p>
        </div>
        <Link
          href="/admin/shipments"
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          รายการพัสดุ
        </Link>
      </header>

      {!canEdit && (
        <p className="mt-6 rounded-[var(--radius-card)] border border-line bg-lilac-50 p-4 text-sm text-muted">
          คุณดูอัตราค่าจัดส่งได้ แต่การแก้ต้องเป็นผู้ดูแลร้าน (ค่าส่งคือเงินที่เก็บจากลูกค้าทุกคน)
        </p>
      )}

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : data === null ? null : data.rates.length === 0 ? (
        <div className="mt-8 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-12 text-center">
          <p className="font-extrabold">ยังไม่มีอัตราค่าจัดส่งในระบบ</p>
          <p className="mt-2 text-sm text-muted">
            ข้อมูลตั้งต้นมาจาก migration — ตรวจว่ารัน <code>prisma migrate deploy</code> แล้ว
          </p>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {data.rates.map((rate) => (
            <li
              key={rate.code}
              className={cn(
                "rounded-[var(--radius-card)] border bg-white p-5 shadow-[var(--shadow-soft)]",
                rate.isActive ? "border-line" : "border-dashed border-line opacity-90",
              )}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg">{rate.name}</h2>
                <span className="text-xs text-muted">
                  {rate.isActive ? "เปิดให้เลือก" : "ปิดอยู่ — ลูกค้าไม่เห็นวิธีนี้"} · แก้ล่าสุด{" "}
                  {formatDateTime(rate.updatedAt)}
                </span>
              </div>
              <ShippingRateEditor rate={rate} provinces={data.provinces} canEdit={canEdit} />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
