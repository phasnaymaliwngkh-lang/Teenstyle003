import { CheckCircle2, Clock, MapPin, Package, Truck } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SectionError } from "@/components/shared/section";
import { PaymentPanel } from "@/features/payment/components/payment-panel";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { fetchPaymentStateOnServer } from "@/services/payment.server";
import type { PaymentState } from "@/types/catalog";
import { formatBaht } from "@/utils/format";

export const metadata: Metadata = {
  title: "สั่งซื้อสำเร็จ",
  robots: { index: false, follow: false },
};

/**
 * หน้ายืนยันคำสั่งซื้อ /checkout/success?order=TS-YYYYMMDD-#### (STEP 10)
 *
 * อ่านคำสั่งซื้อจาก backend ใหม่ทุกครั้ง (ไม่รับตัวเลขใด ๆ จาก query string
 * นอกจากเลขคำสั่งซื้อ) และ backend ให้ดูได้เฉพาะออเดอร์ของเจ้าของเท่านั้น
 *
 * ⚠️ ตั้งใจไม่ห่อ <Suspense> เพื่อให้ออเดอร์ที่ไม่มีจริงคืน HTTP 404 ได้ (ดู CLAUDE.md)
 */
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string; canceled?: string }>;
}) {
  const session = await getSession();

  if (!session) {
    redirect("/signin");
  }

  const { order: orderNumber, canceled } = await searchParams;

  if (!orderNumber) {
    notFound();
  }

  let state: PaymentState | null = null;
  let errorMessage: string | null = null;

  try {
    // อ่านสถานะจริงจากฐานข้อมูลทุกครั้ง — ไม่เชื่อ query string ว่าจ่ายแล้วหรือยัง
    state = await fetchPaymentStateOnServer(orderNumber);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
      notFound();
    }
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดคำสั่งซื้อไม่สำเร็จ";
  }

  if (errorMessage !== null || state === null) {
    return (
      <main className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
        <SectionError message={errorMessage ?? "โหลดคำสั่งซื้อไม่สำเร็จ"} />
      </main>
    );
  }

  const order = state.order;
  const paidLabel =
    order.paymentStatus === "PAID"
      ? "ชำระเงินแล้ว"
      : order.status === "CANCELLED"
        ? "ยกเลิกแล้ว"
        : order.status === "PROCESSING"
          ? "ยืนยันแล้ว — เก็บเงินปลายทาง"
          : "รอชำระเงิน";

  return (
    <main className="mx-auto w-full max-w-[720px] px-4 py-10 sm:px-6">
      <div className="rounded-[var(--radius-card)] border border-success/25 bg-success/5 p-6 text-center">
        <CheckCircle2 className="mx-auto size-12 text-success" aria-hidden />
        <h1 className="mt-3 text-2xl sm:text-3xl">สั่งซื้อสำเร็จ</h1>
        <p className="mt-2 text-sm text-ink-soft">
          เลขคำสั่งซื้อของคุณคือ{" "}
          <strong className="font-mono text-base text-ink">{order.orderNumber}</strong>
        </p>
        <p className="mt-1 text-sm text-muted">
          สถานะปัจจุบัน: <strong>{paidLabel}</strong>
        </p>
      </div>

      {canceled === "1" && order.paymentStatus !== "PAID" && (
        <p
          role="status"
          className="mt-6 flex items-start gap-2 rounded-[var(--radius-card)] border border-warning/30 bg-warning/5 p-4 text-sm font-semibold text-warning"
        >
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          คุณออกจากหน้าชำระเงินก่อนจ่ายเงิน — คำสั่งซื้อยังรออยู่ เลือกวิธีชำระเงินใหม่ได้ด้านล่าง
        </p>
      )}

      {/* แผงชำระเงินจริง (STEP 11) — ไม่มีปุ่มที่ทำให้ "จ่ายแล้ว" โดยไม่มีหลักฐานจาก provider */}
      <div className="mt-6">
        <PaymentPanel state={state} />
      </div>

      <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-white p-5">
        <h2 className="flex items-center gap-2 text-lg">
          <Package className="size-5 text-brand" aria-hidden />
          รายการสินค้า ({order.itemCount} รายการ · {order.totalQuantity} ชิ้น)
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
                  {item.productSlug ? (
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

        <dl className="mt-5 space-y-2 border-t border-line pt-4 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">ยอดสินค้า</dt>
            <dd className="font-semibold">{formatBaht(order.subtotal)}</dd>
          </div>
          {order.discountTotal > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="text-muted">ส่วนลด</dt>
              <dd className="font-semibold">-{formatBaht(order.discountTotal)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-3">
            <dt className="text-muted">ค่าจัดส่ง ({order.shippingMethodName})</dt>
            <dd className="font-semibold">
              {order.shippingFee === 0 ? "ฟรี" : formatBaht(order.shippingFee)}
            </dd>
          </div>
          <div className="flex justify-between gap-3 border-t border-line pt-3">
            <dt className="font-extrabold">ยอดที่ต้องชำระ</dt>
            <dd className="text-xl font-extrabold text-brand-dark">{formatBaht(order.total)}</dd>
          </div>
        </dl>
      </section>

      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-base">
            <MapPin className="size-4 text-brand" aria-hidden />
            ที่อยู่จัดส่ง
          </h2>
          <address className="mt-2 text-sm not-italic text-ink-soft">
            <span className="block font-semibold text-ink">{order.address.recipientName}</span>
            <span className="block">โทร {order.address.phone}</span>
            <span className="block">
              {order.address.line1}
              {order.address.line2 ? ` ${order.address.line2}` : ""}
            </span>
            <span className="block">
              {order.address.subDistrict} {order.address.district}
            </span>
            <span className="block">
              {order.address.province} {order.address.postalCode}
            </span>
          </address>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-base">
            <Truck className="size-4 text-brand" aria-hidden />
            การจัดส่ง
          </h2>
          <p className="mt-2 text-sm text-ink-soft">
            <span className="block font-semibold text-ink">{order.shippingMethodName}</span>
            <span className="block">{order.shippingEtaText}</span>
          </p>
          {order.customerNote && (
            <p className="mt-2 text-xs text-muted">ข้อความถึงร้าน: {order.customerNote}</p>
          )}
        </div>
      </section>

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Link
          href={`/account/orders/${order.orderNumber}`}
          className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          ติดตามคำสั่งซื้อนี้
        </Link>
        <Link
          href="/account/orders"
          className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          ประวัติคำสั่งซื้อ
        </Link>
        <Link
          href="/shop"
          className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          เลือกซื้อต่อ
        </Link>
      </div>
    </main>
  );
}
