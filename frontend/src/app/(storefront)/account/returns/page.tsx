import { PackageOpen } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { ReturnRequestCard } from "@/features/returns/components/return-request-card";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { fetchMyReturnsOnServer } from "@/services/returns.server";
import type { ReturnList } from "@/types/returns";

export const metadata: Metadata = {
  title: "คำขอคืนสินค้า",
  description: "ติดตามคำขอคืนสินค้าและการคืนเงินของคุณ",
  robots: { index: false, follow: false },
};

/**
 * คำขอคืนสินค้าของฉัน /account/returns (STEP 43)
 *
 * ⚠️ ทุกตัวเลข (ยอดที่จะได้คืน · ยอดที่คืนแล้ว) มาจาก server — backend กรอง `userId` เสมอ
 */
export default async function MyReturnsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getSession();

  if (!session) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/account/returns")}`);
  }

  const params = toSearchParams(await searchParams);
  const requested = Number(params.get("page") ?? "1");
  const page = Number.isInteger(requested) && requested > 0 ? requested : 1;

  let data: ReturnList | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchMyReturnsOnServer(page);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดคำขอคืนสินค้าไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[860px] px-4 py-10 sm:px-6">
      <header>
        <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
          Returns
        </span>
        <h1 className="mt-3 text-3xl sm:text-4xl">คำขอคืนสินค้า</h1>
        <p className="mt-2 text-sm text-muted">
          ยื่นคำขอได้จากหน้ารายละเอียดคำสั่งซื้อที่ได้รับของแล้ว — ร้านจะอนุมัติ รับของ แล้วคืนเงิน
        </p>
      </header>

      <div className="mt-8" aria-live="polite">
        {errorMessage !== null ? (
          <SectionError message={errorMessage} />
        ) : data === null ? null : data.items.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="space-y-4">
            {data.items.map((request) => (
              <ReturnRequestCard key={request.id} request={request} />
            ))}
            <Pagination
              page={data.page}
              totalPages={data.totalPages}
              hrefFor={(target) =>
                target <= 1 ? "/account/returns" : `/account/returns?page=${target}`
              }
            />
          </div>
        )}
      </div>
    </main>
  );
}

/** ยังไม่มีคำขอ — ไม่ใช่ error */
function EmptyState() {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
      <PackageOpen className="mx-auto size-10 text-brand-soft" aria-hidden />
      <p className="mt-3 font-extrabold">ยังไม่มีคำขอคืนสินค้า</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        ได้รับสินค้ามีตำหนิหรือร้านส่งผิด ขอคืนได้จากหน้ารายละเอียดคำสั่งซื้อนั้น
      </p>
      <Link
        href="/account/orders"
        className="btn-brand mt-6 inline-flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
      >
        ไปที่คำสั่งซื้อของฉัน
      </Link>
    </div>
  );
}
