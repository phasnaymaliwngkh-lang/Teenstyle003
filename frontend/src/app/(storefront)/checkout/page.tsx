import { AlertTriangle, ShoppingBag } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { SectionError } from "@/components/shared/section";
import { CheckoutForm } from "@/features/checkout/components/checkout-form";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { fetchCheckoutSummaryOnServer } from "@/services/order.server";
import type { CheckoutSummary } from "@/types/catalog";

export const metadata: Metadata = {
  title: "ชำระเงิน",
  description: "ยืนยันที่อยู่จัดส่ง วิธีจัดส่ง และตรวจยอดก่อนสั่งซื้อ",
};

/**
 * หน้า checkout /checkout (STEP 10)
 *
 * - **ต้องล็อกอิน** เพราะคำสั่งซื้อผูกกับบัญชี → ยังไม่ล็อกอินเด้งไป /signin
 *   (ของในตะกร้าของ guest จะถูกรวมเข้าบัญชีให้อัตโนมัติหลังล็อกอิน — STEP 9)
 * - ยอดทุกบรรทัดมาจาก `GET /api/checkout/summary` ที่คำนวณด้วยราคาจริงในฐานข้อมูล
 *   และตรวจสต็อกใหม่ · ฟอร์มไม่เคยส่งราคากลับไป
 */
export default async function CheckoutPage() {
  const session = await getSession();

  if (!session) {
    /**
     * ยังไม่ล็อกอิน → ไปหน้าเข้าสู่ระบบ แล้ว **กลับมาที่ checkout ผ่าน /api/cart/merge**
     * เพื่อให้ของในตะกร้าของ guest ถูกรวมเข้าบัญชีก่อนถึงหน้านี้ (STEP 9)
     * `callbackUrl` ถูกกรองให้เป็น path ภายในเท่านั้นใน features/auth/actions.ts
     */
    const callbackUrl = encodeURIComponent("/api/cart/merge?next=%2Fcheckout");
    redirect(`/signin?callbackUrl=${callbackUrl}`);
  }

  let summary: CheckoutSummary | null = null;
  let errorMessage: string | null = null;

  try {
    summary = await fetchCheckoutSummaryOnServer();
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดข้อมูลสั่งซื้อไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
      <header>
        <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
          Checkout
        </span>
        <h1 className="mt-3 text-3xl sm:text-4xl">ยืนยันคำสั่งซื้อ</h1>
        <p className="mt-2 text-sm text-muted">
          ตรวจที่อยู่ วิธีจัดส่ง และยอดรวม — ราคาและสต็อกถูกตรวจใหม่จากเซิร์ฟเวอร์ในขั้นนี้
        </p>
      </header>

      <div className="mt-8">
        {errorMessage !== null ? (
          <SectionError message={errorMessage} />
        ) : summary === null ? null : summary.items.length === 0 ? (
          <NothingToCheckout />
        ) : (
          <>
            {summary.items.some((item) => item.issue !== null) && (
              <p
                role="alert"
                className="mb-6 flex items-start gap-2 rounded-[var(--radius-card)] border border-warning/30 bg-warning/5 p-4 text-sm font-semibold text-warning"
              >
                <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                มีสินค้าที่ซื้อไม่ได้อยู่ในรายการ —{" "}
                <Link href="/cart" className="underline">
                  กลับไปแก้ที่ตะกร้า
                </Link>{" "}
                ก่อนสั่งซื้อ
              </p>
            )}

            <CheckoutForm summary={summary} />
          </>
        )}
      </div>
    </main>
  );
}

/** ไม่มีของที่เลือกไว้ — ไม่ใช่ error */
function NothingToCheckout() {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-16 text-center">
      <ShoppingBag className="mx-auto size-12 text-brand-soft" aria-hidden />
      <p className="mt-4 text-lg font-extrabold">ยังไม่มีสินค้าที่เลือกไว้สำหรับสั่งซื้อ</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        กลับไปที่ตะกร้าเพื่อติ๊กเลือกสินค้าที่ต้องการสั่ง หรือเลือกซื้อสินค้าเพิ่ม
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Link
          href="/cart"
          className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          ไปที่ตะกร้า
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
