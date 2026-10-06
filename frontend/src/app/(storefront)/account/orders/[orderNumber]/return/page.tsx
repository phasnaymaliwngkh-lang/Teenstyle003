import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { formatDateTime } from "@/features/orders/lib/labels";
import { ReturnRequestForm } from "@/features/returns/components/return-request-form";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { fetchReturnEligibilityOnServer } from "@/services/returns.server";
import type { ReturnEligibility } from "@/types/returns";

export const metadata: Metadata = {
  title: "ขอคืนสินค้า",
  robots: { index: false, follow: false },
};

/**
 * ขอคืนสินค้าจากคำสั่งซื้อหนึ่งใบ /account/orders/[orderNumber]/return (STEP 43)
 *
 * ⚠️ `await` ข้อมูลที่ใช้ตัดสิน 404 ที่ระดับ page และ **ห้ามมี `loading.tsx` ในโฟลเดอร์นี้**
 *    ไม่งั้นคำสั่งซื้อของคนอื่น/ไม่มีจริงจะได้ HTTP 200 (soft 404 — ดูหัวข้อใน CLAUDE.md)
 * ⚠️ สิทธิ์ขอคืนตัดสินที่ server — หน้านี้แค่บอกเหตุผลเมื่อขอไม่ได้ และ server ตรวจซ้ำตอนส่งคำขอ
 */
export default async function RequestReturnPage({
  params,
}: {
  params: Promise<{ orderNumber: string }>;
}) {
  const { orderNumber } = await params;
  const session = await getSession();

  if (!session) {
    const back = `/account/orders/${orderNumber}/return`;
    redirect(`/signin?callbackUrl=${encodeURIComponent(back)}`);
  }

  let eligibility: ReturnEligibility;

  try {
    eligibility = await fetchReturnEligibilityOnServer(orderNumber);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
      notFound();
    }
    throw error;
  }

  const orderHref = `/account/orders/${encodeURIComponent(eligibility.orderNumber)}`;

  return (
    <main className="mx-auto w-full max-w-[860px] px-4 py-10 sm:px-6">
      <Link
        href={orderHref}
        className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand-dark underline"
      >
        <ChevronLeft className="size-4" aria-hidden />
        กลับไปคำสั่งซื้อ {eligibility.orderNumber}
      </Link>

      <header className="mt-4">
        <h1 className="text-3xl sm:text-4xl">ขอคืนสินค้า</h1>
        <p className="mt-2 text-sm text-muted">
          รับคืนเมื่อสินค้ามีตำหนิจากการผลิตหรือร้านส่งผิด ภายใน {eligibility.windowDays}{" "}
          วันหลังได้รับสินค้า
          {eligibility.deadline !== null && ` · แจ้งได้ถึง ${formatDateTime(eligibility.deadline)}`}
        </p>
      </header>

      <div className="mt-8">
        {eligibility.eligible ? (
          <ReturnRequestForm eligibility={eligibility} />
        ) : (
          <div
            role="alert"
            className="rounded-[var(--radius-card)] border border-warning/30 bg-warning/5 p-5"
          >
            <p className="font-bold text-warning">ขอคืนจากคำสั่งซื้อนี้ไม่ได้ตอนนี้</p>
            <p className="mt-1 text-sm text-ink-soft">{eligibility.message}</p>
            <div className="mt-4 flex flex-wrap gap-3">
              <Link
                href="/account/returns"
                className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-5 text-sm font-semibold transition hover:border-brand-soft"
              >
                ดูคำขอคืนของฉัน
              </Link>
              <Link
                href="/customer-service"
                className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-5 text-sm font-semibold transition hover:border-brand-soft"
              >
                ติดต่อฝ่ายบริการลูกค้า
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
