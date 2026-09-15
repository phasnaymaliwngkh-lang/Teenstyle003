import { PackageOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { OrderCard } from "@/features/orders/components/order-card";
import { orderStatusLabel } from "@/features/orders/lib/labels";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchMyOrdersOnServer } from "@/services/order.server";
import type { OrderListResult } from "@/types/catalog";

export const metadata: Metadata = {
  title: "ประวัติคำสั่งซื้อ",
  description: "ดูคำสั่งซื้อทั้งหมดของคุณ สถานะการชำระเงิน และติดตามการจัดส่ง",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/account/orders", ["status"]);

/** สถานะที่ให้กรองได้ — ตรงกับ enum ที่ backend ยอมรับ */
const FILTERS = ["PENDING_PAYMENT", "PROCESSING", "SHIPPING", "DELIVERED", "CANCELLED"] as const;

/**
 * หน้าประวัติคำสั่งซื้อ /account/orders (STEP 12)
 *
 * - ต้องล็อกอิน · backend กรอง `userId` ให้เสมอ จึงไม่มีทางเห็นออเดอร์ของคนอื่น
 * - ตัวเลขข้างแท็บสถานะมาจาก `groupBy` ในฐานข้อมูลจริง (ตรงกับผลกรอง)
 * - ไม่ cache (`no-store`) เพราะสถานะเปลี่ยนได้ตลอด
 */
export default async function MyOrdersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getSession();

  if (!session) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/account/orders")}`);
  }

  const raw = await searchParams;
  const params = toSearchParams(raw);
  const activeStatus = params.get("status");

  let result: OrderListResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchMyOrdersOnServer(params);
  } catch (error) {
    errorMessage =
      error instanceof ApiClientError ? error.message : "โหลดประวัติคำสั่งซื้อไม่สำเร็จ";
  }

  const countOf = (status: string): number =>
    result?.counts.find((item) => item.status === status)?.count ?? 0;
  const allCount = result?.counts.reduce((sum, item) => sum + item.count, 0) ?? 0;

  return (
    <main className="mx-auto w-full max-w-[900px] px-4 py-10 sm:px-6">
      <header>
        <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
          My Orders
        </span>
        <h1 className="mt-3 text-3xl sm:text-4xl">ประวัติคำสั่งซื้อ</h1>
        <p className="mt-2 text-sm text-muted">
          ดูสถานะการชำระเงิน ติดตามการจัดส่ง และเปิดดูรายละเอียดของแต่ละคำสั่งซื้อ
        </p>
      </header>

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : result === null ? null : (
        <>
          <nav aria-label="กรองตามสถานะ" className="mt-6 flex flex-wrap gap-2">
            <Link
              href={withParam(params, "status", null)}
              aria-current={activeStatus === null ? "true" : undefined}
              className={chipClass(activeStatus === null)}
            >
              ทั้งหมด ({allCount})
            </Link>

            {FILTERS.map((status) => (
              <Link
                key={status}
                href={withParam(params, "status", activeStatus === status ? null : status)}
                aria-current={activeStatus === status ? "true" : undefined}
                className={chipClass(activeStatus === status)}
              >
                {orderStatusLabel(status)} ({countOf(status)})
              </Link>
            ))}
          </nav>

          <div className="mt-6">
            {result.items.length === 0 ? (
              <EmptyOrders filtered={activeStatus !== null} />
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted">
                  พบ <strong className="text-ink">{result.total}</strong> คำสั่งซื้อ · หน้า{" "}
                  {result.page} / {result.totalPages}
                </p>

                {result.items.map((order) => (
                  <OrderCard key={order.id} order={order} />
                ))}

                <Pagination
                  page={result.page}
                  totalPages={result.totalPages}
                  hrefFor={(page) => withParam(params, "page", page)}
                />
              </div>
            )}
          </div>
        </>
      )}
    </main>
  );
}

function chipClass(active: boolean): string {
  return cn(
    "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
    active
      ? "border-brand bg-brand text-white"
      : "border-line hover:border-brand-soft hover:bg-lilac-50",
  );
}

/** ยังไม่มีคำสั่งซื้อ — ไม่ใช่ error */
function EmptyOrders({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
      <PackageOpen className="mx-auto size-10 text-brand-soft" aria-hidden />
      <p className="mt-3 font-extrabold">
        {filtered ? "ไม่มีคำสั่งซื้อในสถานะนี้" : "ยังไม่มีคำสั่งซื้อ"}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        {filtered
          ? "ลองเลือกสถานะอื่น หรือดูคำสั่งซื้อทั้งหมด"
          : "เมื่อสั่งซื้อแล้ว คำสั่งซื้อจะมาอยู่ที่นี่พร้อมสถานะและการติดตามพัสดุ"}
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {filtered ? (
          <Link
            href="/account/orders"
            className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
          >
            ดูทั้งหมด
          </Link>
        ) : (
          <Link
            href="/shop"
            className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
          >
            เลือกซื้อสินค้า
          </Link>
        )}
        <Link
          href="/account"
          className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-white"
        >
          กลับไปบัญชีของฉัน
        </Link>
      </div>
    </div>
  );
}
