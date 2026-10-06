import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ReshipForm } from "@/features/admin/components/reship-form";
import { ShipmentActions } from "@/features/admin/components/shipment-actions";
import { formatDateTime, orderStatusLabel } from "@/features/orders/lib/labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { cn } from "@/lib/utils";
import { fetchAdminShipmentOnServer } from "@/services/shipping.server";
import { SHIPMENT_STATUS_TONE, type AdminShipmentDetail } from "@/types/shipping";

export const metadata: Metadata = {
  title: "พัสดุ",
  robots: { index: false, follow: false },
};

/**
 * พัสดุหนึ่งชิ้น /admin/shipments/[shipmentId] (STEP 44 · `shipment:read`)
 *
 * ⚠️ `await` ข้อมูลหลักที่ระดับ page และ **ห้ามมี `loading.tsx` ในโฟลเดอร์นี้** (soft 404)
 * ⚠️ ปุ่มทุกอันขึ้นตามสิ่งที่ server บอกว่าทำได้ — ด่านจริงอยู่ที่ backend
 * ⚠️ "ส่งถึงแล้ว" และ "ยกเลิก" อยู่ที่หน้าคำสั่งซื้อ (ทางเดียวที่ทำเรื่องเงิน สต็อก และแต้มครบ)
 */
export default async function AdminShipmentPage({
  params,
}: {
  params: Promise<{ shipmentId: string }>;
}) {
  const session = await requirePermission("shipment:read");
  const { shipmentId } = await params;

  let shipment: AdminShipmentDetail;

  try {
    shipment = await fetchAdminShipmentOnServer(shipmentId);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
      notFound();
    }
    throw error;
  }

  const permissions = session.user.permissions;
  const canUpdate = permissions.includes("shipment:update");
  const destination = shipment.destination;
  const orderHref = `/admin/orders/${encodeURIComponent(shipment.order.orderNumber)}`;

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
      <Link
        href="/admin/shipments"
        className="inline-flex min-h-11 items-center text-sm font-semibold text-brand underline hover:text-brand-dark"
      >
        ← กลับไปรายการพัสดุ
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-mono text-2xl break-all sm:text-3xl">
            {shipment.trackingNumber ?? "(ไม่มีเลขพัสดุ)"}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {shipment.carrier} · คำสั่งซื้อ{" "}
            <Link href={orderHref} className="font-semibold text-brand underline">
              {shipment.order.orderNumber}
            </Link>{" "}
            ({orderStatusLabel(shipment.order.status)}) · {shipment.order.shippingMethodName}
          </p>
          {shipment.trackingUrl !== null && (
            <a
              href={shipment.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1 inline-flex min-h-11 items-center text-sm font-semibold break-all text-brand underline"
            >
              เปิดหน้าติดตามของขนส่ง
            </a>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {shipment.overdue && (
            <span className="inline-flex items-center rounded-[var(--radius-pill)] border border-warning/30 bg-warning/5 px-3 py-1 text-xs font-bold text-warning">
              เลยกำหนดส่ง
            </span>
          )}
          <span
            className={cn(
              "inline-flex items-center rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-bold",
              SHIPMENT_STATUS_TONE[shipment.status],
            )}
          >
            {shipment.statusLabel}
          </span>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 className="text-lg">ประวัติสถานะ</h2>
            <ol className="mt-3 space-y-3 border-l-2 border-line pl-4 text-sm">
              {shipment.events.map((event, index) => (
                <li key={`${event.at}-${index}`}>
                  <p className="font-semibold">{event.statusLabel}</p>
                  <p className="text-xs text-muted">
                    {formatDateTime(event.at)} · บันทึกโดย{" "}
                    {event.recordedBy ?? "(ไม่มีข้อมูลผู้บันทึก)"}
                  </p>
                  {event.note !== null && (
                    <p className="mt-1 rounded-[12px] bg-lilac-50 p-2 break-words">{event.note}</p>
                  )}
                </li>
              ))}
            </ol>
            {shipment.estimatedDelivery !== null && (
              <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
                กำหนดส่งที่ร้านแจ้งลูกค้า {formatDateTime(shipment.estimatedDelivery)}
              </p>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 className="text-lg">ผู้รับ</h2>
            <address className="mt-2 text-sm not-italic text-ink-soft">
              <span className="block font-semibold text-ink">
                {destination["recipientName"] ?? "—"}
              </span>
              <span className="block">โทร {destination["phone"] ?? "—"}</span>
              <span className="block break-words">
                {[destination["line1"], destination["line2"]].filter(Boolean).join(" ")}
              </span>
              <span className="block">
                {destination["subDistrict"]} {destination["district"]} {destination["province"]}{" "}
                {destination["postalCode"]}
              </span>
            </address>
            <p className="mt-3 text-xs text-muted">
              ลูกค้า: {shipment.order.customerName ?? "—"} · {shipment.order.customerEmail}
            </p>
          </section>
        </div>

        <aside className="space-y-6 lg:self-start">
          <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 className="text-lg">ขั้นถัดไป</h2>
            <div className="mt-3">
              <ShipmentActions shipment={shipment} canUpdate={canUpdate} />
            </div>

            {shipment.isLatest &&
              (shipment.orderActions.canDeliver || shipment.orderActions.canCancel) && (
                <p className="mt-4 border-t border-line pt-3 text-sm text-muted">
                  {shipment.orderActions.canDeliver
                    ? "ลูกค้าได้รับของแล้ว? กด "
                    : "ไม่ส่งใหม่? ยกเลิกคำสั่งซื้อเพื่อรับของกลับเข้าคลังได้ที่ "}
                  <Link href={orderHref} className="font-semibold text-brand underline">
                    หน้าคำสั่งซื้อ
                  </Link>
                  {shipment.orderActions.canDeliver &&
                    ` แล้วเลือก "${orderStatusLabel("DELIVERED")}" (บันทึกการรับเงินปลายทางและแต้มในขั้นเดียวกัน)`}
                </p>
              )}
          </section>

          {shipment.isLatest && shipment.orderActions.canReship && canUpdate && (
            <ReshipForm orderNumber={shipment.order.orderNumber} />
          )}
        </aside>
      </div>
    </main>
  );
}
