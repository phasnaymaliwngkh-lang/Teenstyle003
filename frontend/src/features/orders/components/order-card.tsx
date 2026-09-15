import { ChevronRight, Package } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import {
  formatDateTime,
  orderStatusLabel,
  orderStatusTone,
  paymentStatusLabel,
} from "../lib/labels";

import { cn } from "@/lib/utils";
import type { Order } from "@/types/catalog";
import { formatBaht } from "@/utils/format";

/** การ์ดหนึ่งคำสั่งซื้อในหน้าประวัติ (STEP 12) — ตัวเลขทุกตัวมาจาก server */
export function OrderCard({ order }: { order: Order }) {
  const preview = order.items.slice(0, 4);
  const more = order.itemCount - preview.length;

  return (
    <article className="rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-soft)] transition hover:border-brand-soft">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-bold">{order.orderNumber}</p>
          <p className="text-xs text-muted">สั่งเมื่อ {formatDateTime(order.createdAt)}</p>
        </div>

        <span
          className={cn(
            "rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-bold",
            orderStatusTone(order.status),
          )}
        >
          {orderStatusLabel(order.status)}
        </span>
      </header>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-2">
          {preview.map((item) => (
            <span
              key={item.id}
              className="relative size-14 overflow-hidden rounded-[10px] bg-lilac-50"
              title={item.productName}
            >
              {item.imageUrl ? (
                <Image
                  src={item.imageUrl}
                  alt={item.productName}
                  fill
                  sizes="56px"
                  className="object-cover"
                />
              ) : (
                <span className="grid size-full place-items-center text-lg" aria-hidden>
                  ✧
                </span>
              )}
            </span>
          ))}
          {more > 0 && (
            <span className="grid size-14 place-items-center rounded-[10px] border border-line text-xs font-bold text-muted">
              +{more}
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 text-sm">
          <p className="flex items-center gap-1.5 text-muted">
            <Package className="size-3.5 shrink-0" aria-hidden />
            {order.itemCount} รายการ · {order.totalQuantity} ชิ้น · {order.shippingMethodName}
          </p>
          <p className="text-xs text-muted">
            การชำระเงิน: {paymentStatusLabel(order.paymentStatus)}
          </p>
          {order.trackingNumber !== null && (
            <p className="text-xs text-muted">เลขพัสดุ {order.trackingNumber}</p>
          )}
        </div>

        <p className="text-lg font-extrabold text-brand-dark">{formatBaht(order.total)}</p>
      </div>

      <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
        {order.status === "PENDING_PAYMENT" ? (
          <span className="text-xs font-bold text-warning">ยังไม่ได้ชำระเงิน</span>
        ) : (
          <span className="text-xs text-muted">อัปเดตล่าสุดตามไทม์ไลน์ในหน้ารายละเอียด</span>
        )}

        <Link
          href={`/account/orders/${order.orderNumber}`}
          className="flex min-h-11 items-center gap-1 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          ดูรายละเอียด / ติดตาม
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </footer>
    </article>
  );
}
