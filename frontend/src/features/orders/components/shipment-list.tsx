import Link from "next/link";

import { formatDateTime } from "@/features/orders/lib/labels";
import { cn } from "@/lib/utils";
import type { OrderShipment } from "@/types/catalog";
import { SHIPMENT_STATUS_TONE, type ShipmentStatus } from "@/types/shipping";

/**
 * พัสดุของคำสั่งซื้อ (STEP 12 · ประวัติสถานะตั้งแต่ STEP 44) — ใช้ร่วมกันทั้งหน้าลูกค้าและหลังบ้าน
 *
 * ใหม่สุดก่อน (ส่งใหม่หลังถูกตีกลับได้หลายชิ้น) · ประวัติแสดงข้อความที่ร้านเขียนถึงลูกค้า
 * เช่น เหตุผลที่ส่งไม่สำเร็จ — **ไม่มีพัสดุ = บอกว่ายังไม่มี ห้ามสร้างเลขพัสดุให้ดูครบ** (กฎ STEP 12 ข้อ 3)
 * ชื่อสถานะมาจาก backend (`statusLabel`) ที่เดียว ไม่แปลซ้ำที่หน้าเว็บ
 */
export function ShipmentList({
  shipments,
  adminLinks = false,
}: {
  shipments: OrderShipment[];
  /** หลังบ้าน: ลิงก์ไปหน้าจัดการพัสดุแต่ละชิ้น */
  adminLinks?: boolean;
}) {
  if (shipments.length === 0) {
    return (
      <p className="mt-5 border-t border-line pt-4 text-sm text-muted">
        ยังไม่มีข้อมูลพัสดุ — ร้านจะออกเลขพัสดุให้เมื่อส่งของออก
      </p>
    );
  }

  return (
    <ul className="mt-5 space-y-4 border-t border-line pt-4">
      {shipments.map((shipment, index) => (
        <li key={shipment.id} className="text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{shipment.carrier}</span>
            <span
              className={cn(
                "inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-xs font-bold",
                SHIPMENT_STATUS_TONE[shipment.status as ShipmentStatus] ??
                  "border-line bg-white text-muted",
              )}
            >
              {shipment.statusLabel}
            </span>
            {index > 0 && <span className="text-xs text-muted">(พัสดุชิ้นก่อนหน้า)</span>}
          </div>

          {shipment.trackingNumber !== null && (
            <p className="mt-1 text-muted">
              เลขพัสดุ{" "}
              {shipment.trackingUrl !== null ? (
                <a
                  href={shipment.trackingUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono font-bold break-all text-brand underline"
                >
                  {shipment.trackingNumber}
                </a>
              ) : (
                <span className="font-mono font-bold break-all text-ink">
                  {shipment.trackingNumber}
                </span>
              )}
            </p>
          )}

          {shipment.estimatedDelivery !== null && shipment.deliveredAt === null && (
            <p className="text-xs text-muted">
              กำหนดส่งถึงที่ร้านแจ้งไว้ {formatDateTime(shipment.estimatedDelivery)}
            </p>
          )}

          {shipment.events.length > 0 && (
            <ol className="mt-2 space-y-1 border-l-2 border-line pl-3 text-xs">
              {shipment.events.map((event, eventIndex) => (
                <li key={`${event.at}-${eventIndex}`}>
                  <span className="font-semibold text-ink">{event.statusLabel}</span>
                  <span className="text-muted"> · {formatDateTime(event.at)}</span>
                  {event.note !== null && (
                    <span className="block break-words text-ink-soft">{event.note}</span>
                  )}
                </li>
              ))}
            </ol>
          )}

          {adminLinks && (
            <Link
              href={`/admin/shipments/${shipment.id}`}
              className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand underline"
            >
              จัดการพัสดุชิ้นนี้
            </Link>
          )}
        </li>
      ))}
    </ul>
  );
}
