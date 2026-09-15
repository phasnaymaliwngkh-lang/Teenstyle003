import { ChevronLeft, MapPin, Package, Receipt, Truck } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SectionError } from "@/components/shared/section";
import { OrderTimeline } from "@/features/orders/components/order-timeline";
import {
  formatDateTime,
  orderStatusLabel,
  orderStatusTone,
  paymentStatusLabel,
  shipmentStatusLabel,
} from "@/features/orders/lib/labels";
import { PaymentPanel } from "@/features/payment/components/payment-panel";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { cn } from "@/lib/utils";
import { fetchPaymentStateOnServer } from "@/services/payment.server";
import type { PaymentState } from "@/types/catalog";
import { formatBaht } from "@/utils/format";

type PageProps = { params: Promise<{ orderNumber: string }> };

export const metadata: Metadata = {
  title: "ติดตามคำสั่งซื้อ",
  robots: { index: false, follow: false },
};

/**
 * หน้ารายละเอียด/ติดตามคำสั่งซื้อ (STEP 12)
 *
 * - อ่านจาก `GET /api/orders/:n/payment` ซึ่งรวมทั้งออเดอร์ สถานะการชำระเงิน และช่องทางที่ใช้ได้
 *   จึงใช้แผงชำระเงินของ STEP 11 ต่อได้เลยถ้ายังไม่ได้จ่าย
 * - backend กรอง `userId` → ออเดอร์ของคนอื่นได้ 404 (ไม่ใช่ 403 เพื่อไม่บอกใบ้ว่ามีจริง)
 * - ⚠️ await ที่ระดับ page ไม่ห่อ Suspense เพื่อให้เลขที่ไม่มีจริงคืน HTTP 404 (ดู CLAUDE.md)
 */
export default async function OrderTrackingPage({ params }: PageProps) {
  const session = await getSession();
  const { orderNumber } = await params;

  if (!session) {
    redirect(`/signin?callbackUrl=${encodeURIComponent(`/account/orders/${orderNumber}`)}`);
  }

  let state: PaymentState | null = null;
  let errorMessage: string | null = null;

  try {
    state = await fetchPaymentStateOnServer(orderNumber);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
      notFound();
    }
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดคำสั่งซื้อไม่สำเร็จ";
  }

  if (errorMessage !== null || state === null) {
    return (
      <main className="mx-auto w-full max-w-[900px] px-4 py-10 sm:px-6">
        <SectionError message={errorMessage ?? "โหลดคำสั่งซื้อไม่สำเร็จ"} />
      </main>
    );
  }

  const order = state.order;

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-10 sm:px-6">
      <Link
        href="/account/orders"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-muted transition hover:text-brand"
      >
        <ChevronLeft className="size-4" aria-hidden />
        ประวัติคำสั่งซื้อ
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-mono text-2xl sm:text-3xl">{order.orderNumber}</h1>
          <p className="mt-1 text-sm text-muted">
            สั่งเมื่อ {formatDateTime(order.createdAt)} · {order.itemCount} รายการ ·{" "}
            {order.totalQuantity} ชิ้น
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
        </div>
      </header>

      {/* แผงชำระเงิน (STEP 11) — แสดงสถานะจริง หรือให้เลือกวิธีจ่ายถ้ายังไม่จ่าย */}
      <div className="mt-6">
        <PaymentPanel state={state} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 className="flex items-center gap-2 text-lg">
              <Truck className="size-5 text-brand" aria-hidden />
              สถานะการจัดส่ง
            </h2>

            <div className="mt-4">
              <OrderTimeline steps={order.timeline} />
            </div>

            {order.shipments.length > 0 ? (
              <ul className="mt-5 space-y-3 border-t border-line pt-4">
                {order.shipments.map((shipment) => (
                  <li key={shipment.id} className="text-sm">
                    <p className="font-bold">
                      {shipment.carrier} · {shipmentStatusLabel(shipment.status)}
                    </p>
                    {shipment.trackingNumber !== null && (
                      <p className="text-muted">
                        เลขพัสดุ{" "}
                        {shipment.trackingUrl !== null ? (
                          <a
                            href={shipment.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono font-bold text-brand underline"
                          >
                            {shipment.trackingNumber}
                          </a>
                        ) : (
                          <span className="font-mono font-bold text-ink">
                            {shipment.trackingNumber}
                          </span>
                        )}
                      </p>
                    )}
                    {shipment.estimatedDelivery !== null && (
                      <p className="text-xs text-muted">
                        กำหนดส่งถึง {formatDateTime(shipment.estimatedDelivery)}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 border-t border-line pt-4 text-sm text-muted">
                ยังไม่มีข้อมูลพัสดุ — ร้านจะออกเลขพัสดุให้เมื่อส่งของออก
                (ระบบจัดการการจัดส่งของร้านจะเปิดใช้ใน STEP 44)
              </p>
            )}
          </section>

          <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 className="flex items-center gap-2 text-lg">
              <Package className="size-5 text-brand" aria-hidden />
              รายการสินค้า
            </h2>

            <ul className="mt-4 space-y-4">
              {order.items.map((item) => (
                <li key={item.id} className="flex gap-3">
                  <div className="relative size-16 shrink-0 overflow-hidden rounded-[10px] bg-lilac-50">
                    {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.productName}
                        fill
                        sizes="64px"
                        className="object-cover"
                      />
                    ) : (
                      <span className="grid size-full place-items-center text-xl" aria-hidden>
                        ✧
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 text-sm">
                    <p className="font-bold">
                      {item.productSlug !== null ? (
                        <Link
                          href={`/product/${item.productSlug}`}
                          className="transition hover:text-brand"
                        >
                          {item.productName}
                        </Link>
                      ) : (
                        item.productName
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {[item.colorName, item.sizeName].filter(Boolean).join(" · ")} · SKU{" "}
                      {item.variantSku}
                    </p>
                    <p className="text-xs text-muted">
                      {formatBaht(item.unitPrice)} × {item.quantity}
                    </p>
                  </div>

                  <p className="shrink-0 text-sm font-extrabold">{formatBaht(item.lineTotal)}</p>
                </li>
              ))}
            </ul>

            <p className="mt-4 border-t border-line pt-3 text-xs text-muted">
              ชื่อและราคาข้างบนคือข้อมูลตอนที่สั่งซื้อ (snapshot)
              จึงไม่เปลี่ยนตามราคาสินค้าในปัจจุบัน
            </p>
          </section>
        </div>

        <div className="space-y-6">
          <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
            <h2 className="flex items-center gap-2 text-base">
              <Receipt className="size-4 text-brand" aria-hidden />
              ยอดชำระ
            </h2>

            <dl className="mt-3 space-y-2 text-sm">
              <Row label="ยอดสินค้า" value={formatBaht(order.subtotal)} />
              {order.discountTotal > 0 && (
                <Row label="ส่วนลด" value={`-${formatBaht(order.discountTotal)}`} />
              )}
              <Row
                label={`ค่าจัดส่ง (${order.shippingMethodName})`}
                value={order.shippingFee === 0 ? "ฟรี" : formatBaht(order.shippingFee)}
              />
              <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
                <dt className="font-extrabold">รวมทั้งสิ้น</dt>
                <dd className="text-lg font-extrabold text-brand-dark">
                  {formatBaht(order.total)}
                </dd>
              </div>
            </dl>
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
                ข้อความถึงร้าน: {order.customerNote}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="shrink-0 font-semibold">{value}</dd>
    </div>
  );
}
