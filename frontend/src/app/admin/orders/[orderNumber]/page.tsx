import { ChevronLeft, CreditCard, MapPin, Package, User } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SectionError } from "@/components/shared/section";
import { OrderStatusForm } from "@/features/admin/components/order-status-form";
import { OrderTimeline } from "@/features/orders/components/order-timeline";
import {
  formatDateTime,
  orderStatusLabel,
  orderStatusTone,
  paymentStatusLabel,
  shipmentStatusLabel,
} from "@/features/orders/lib/labels";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { cn } from "@/lib/utils";
import { fetchAdminOrderOnServer } from "@/services/admin.server";
import type { AdminOrder } from "@/types/admin";
import { formatBaht } from "@/utils/format";

type PageProps = { params: Promise<{ orderNumber: string }> };

export const metadata: Metadata = {
  title: "รายละเอียดคำสั่งซื้อ (ร้าน)",
  robots: { index: false, follow: false },
};

/**
 * หน้ารายละเอียดคำสั่งซื้อฝั่งร้าน (STEP 13)
 *
 * ⚠️ await ข้อมูลที่ระดับ page (ไม่ห่อ Suspense) เพื่อให้เลขที่ไม่มีจริงคืน 404 ได้ — ดู CLAUDE.md
 */
export default async function AdminOrderDetailPage({ params }: PageProps) {
  await requirePermission("order:read");

  const { orderNumber } = await params;

  let order: AdminOrder | null = null;
  let errorMessage: string | null = null;

  try {
    order = await fetchAdminOrderOnServer(orderNumber);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
      notFound();
    }
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดคำสั่งซื้อไม่สำเร็จ";
  }

  if (errorMessage !== null || order === null) {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
        <SectionError message={errorMessage ?? "โหลดคำสั่งซื้อไม่สำเร็จ"} />
      </main>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <Link
        href="/admin/orders"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted transition hover:text-brand"
      >
        <ChevronLeft className="size-4" aria-hidden />
        จัดการคำสั่งซื้อ
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-2xl sm:text-3xl">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted">
            สั่งเมื่อ {formatDateTime(order.createdAt)} · {order.itemCount} รายการ ·{" "}
            {order.totalQuantity} ชิ้น · {order.shippingMethodName}
          </p>
        </div>

        <div className="text-right">
          <span
            className={cn(
              "inline-block rounded-[var(--radius-pill)] border px-3 py-1 text-xs font-bold",
              orderStatusTone(order.status),
            )}
          >
            {orderStatusLabel(order.status)}
          </span>
          <p className="mt-2 text-xs text-muted">
            การชำระเงิน: {paymentStatusLabel(order.paymentStatus)}
          </p>
          <p className="text-lg font-extrabold text-brand-dark">{formatBaht(order.total)}</p>
        </div>
      </header>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <OrderStatusForm order={order} />

          <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 className="flex items-center gap-2 text-lg">
              <Package className="size-5 text-brand" aria-hidden />
              รายการสินค้า
            </h2>

            <ul className="mt-4 space-y-3">
              {order.items.map((item) => (
                <li key={item.id} className="flex gap-3 text-sm">
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-[10px] bg-lilac-50">
                    {item.imageUrl !== null ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.productName}
                        fill
                        sizes="56px"
                        className="object-cover"
                      />
                    ) : (
                      <span className="grid size-full place-items-center" aria-hidden>
                        ✧
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{item.productName}</p>
                    <p className="text-xs text-muted">
                      {[item.colorName, item.sizeName].filter(Boolean).join(" · ")} · SKU{" "}
                      {item.variantSku}
                    </p>
                    <p className="text-xs text-muted">
                      {formatBaht(item.unitPrice)} × {item.quantity}
                    </p>
                  </div>

                  <p className="shrink-0 font-extrabold">{formatBaht(item.lineTotal)}</p>
                </li>
              ))}
            </ul>

            <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-sm">
              <Row label="ยอดสินค้า" value={formatBaht(order.subtotal)} />
              <Row
                label="ค่าจัดส่ง"
                value={order.shippingFee === 0 ? "ฟรี" : formatBaht(order.shippingFee)}
              />
              <Row label="รวม" value={formatBaht(order.total)} strong />
            </dl>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 className="text-lg">ไทม์ไลน์</h2>
            <div className="mt-4">
              <OrderTimeline steps={order.timeline} />
            </div>

            {order.shipments.length > 0 && (
              <ul className="mt-4 space-y-2 border-t border-line pt-3 text-sm">
                {order.shipments.map((shipment) => (
                  <li key={shipment.id}>
                    <span className="font-bold">
                      {shipment.carrier} · {shipmentStatusLabel(shipment.status)}
                    </span>
                    {shipment.trackingNumber !== null && (
                      <span className="block font-mono text-xs text-muted">
                        {shipment.trackingNumber}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 className="flex items-center gap-2 text-base">
              <User className="size-4 text-brand" aria-hidden />
              ลูกค้า
            </h2>
            <p className="mt-2 text-sm">
              <span className="block font-semibold">{order.customer?.name ?? "—"}</span>
              <span className="block break-all text-muted">{order.customer?.email ?? "—"}</span>
            </p>
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 className="flex items-center gap-2 text-base">
              <MapPin className="size-4 text-brand" aria-hidden />
              ที่อยู่จัดส่ง
            </h2>
            <address className="mt-2 text-sm not-italic text-ink-soft">
              <span className="block font-semibold text-ink">{order.address.recipientName}</span>
              <span className="block">โทร {order.address.phone}</span>
              <span className="block">
                {order.address.line1}
                {order.address.line2 !== null ? ` ${order.address.line2}` : ""}
              </span>
              <span className="block">
                {order.address.subDistrict} {order.address.district}
              </span>
              <span className="block">
                {order.address.province} {order.address.postalCode}
              </span>
            </address>

            {order.customerNote !== null && (
              <p className="mt-3 border-t border-line pt-3 text-xs text-muted">
                ข้อความจากลูกค้า: {order.customerNote}
              </p>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 className="flex items-center gap-2 text-base">
              <CreditCard className="size-4 text-brand" aria-hidden />
              การชำระเงิน
            </h2>

            {order.payments.length === 0 ? (
              <p className="mt-2 text-sm text-muted">ยังไม่มีรายการชำระเงิน</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {order.payments.map((payment) => (
                  <li key={`${payment.provider}-${payment.paidAt ?? "pending"}`}>
                    <span className="font-semibold">
                      {payment.provider} · {payment.status}
                    </span>
                    <span className="block text-xs text-muted">
                      {formatBaht(payment.amount)}
                      {payment.paidAt !== null && ` · จ่ายเมื่อ ${formatDateTime(payment.paidAt)}`}
                      {payment.failureReason !== null && ` · ${payment.failureReason}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {order.adminNote !== null && (
            <section className="rounded-[var(--radius-card)] border border-warning/30 bg-warning/5 p-5">
              <h2 className="text-base">บันทึกภายใน</h2>
              <p className="mt-2 text-sm text-ink-soft">{order.adminNote}</p>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn("text-muted", strong && "font-extrabold text-ink")}>{label}</dt>
      <dd
        className={cn("shrink-0 font-semibold", strong && "text-lg font-extrabold text-brand-dark")}
      >
        {value}
      </dd>
    </div>
  );
}
