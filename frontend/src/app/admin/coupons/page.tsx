import { Ticket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { CouponManager } from "@/features/admin/components/coupon-manager";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchAdminCouponsOnServer } from "@/services/coupon.server";
import type { AdminCouponListResult } from "@/types/admin";

export const metadata: Metadata = {
  title: "คูปองส่วนลด",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/admin/coupons", ["status", "q"]);

const TABS = [
  { value: "ALL", label: "ทั้งหมด" },
  { value: "ACTIVE", label: "ใช้ได้ตอนนี้" },
  { value: "SCHEDULED", label: "ยังไม่เริ่ม" },
  { value: "EXPIRED", label: "หมดอายุ" },
  { value: "INACTIVE", label: "ปิดใช้งาน" },
] as const;

/**
 * จัดการคูปองส่วนลด (STEP 41)
 *
 * ⚠️ สิทธิ์ `coupon:manage` = ADMIN ขึ้นไปตาม seed — พนักงานหน้าร้านไม่ควรออกส่วนลดได้เอง
 *    เพราะเป็นการให้เงินออกจากร้าน (แพตเทิร์นเดียวกับ `analytics:read` ของ STEP 26 ข้อ 7)
 *
 * ⚠️ สถานะของคูปอง (ใช้ได้ / ยังไม่เริ่ม / หมดอายุ / ใช้ครบ) **คำนวณที่ server สด ๆ**
 *    ไม่ได้เก็บเป็นคอลัมน์ จึงไม่มีทางมีสถานะที่ไม่จริง
 *    (แพตเทิร์นเดียวกับการแจ้งเตือนสต็อกของ STEP 16 ที่คิดสถานะสดจาก Inventory)
 */
export default async function AdminCouponsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("coupon:manage");

  const params = toSearchParams(await searchParams);
  const activeStatus = params.get("status") ?? "ALL";

  const query = new URLSearchParams(params);

  query.set("status", activeStatus);

  let data: AdminCouponListResult | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchAdminCouponsOnServer(query);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดรายการคูปองไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-3xl">
            <Ticket className="size-7 text-brand" aria-hidden />
            คูปองส่วนลด
          </h1>
          <p className="mt-1 text-sm text-muted">
            ส่วนลดทุกบาทคิดที่เซิร์ฟเวอร์จากตะกร้าจริงของลูกค้า — ยอดที่ลูกค้าเห็นกับยอดที่เก็บเงิน
            มาจากการคำนวณชุดเดียวกันเสมอ
          </p>
        </div>

        <Link
          href="/admin"
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          กลับหน้าภาพรวมร้าน
        </Link>
      </header>

      <nav aria-label="กรองตามสถานะ" className="mt-6 flex flex-wrap gap-2">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={withParam(params, "status", tab.value === "ALL" ? null : tab.value)}
            aria-current={activeStatus === tab.value ? "page" : undefined}
            className={cn(
              "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
              activeStatus === tab.value
                ? "border-brand bg-brand text-white"
                : "border-line bg-white hover:border-brand-soft hover:bg-lilac-50",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <div className="mt-6">
        {errorMessage !== null && <SectionError message={errorMessage} />}

        {data !== null && (
          <>
            <p className="mb-4 text-sm text-muted">
              ทั้งหมด {data.total} ใบ · หน้า {data.page} จาก {data.totalPages}
            </p>

            <CouponManager coupons={data.items} />

            <div className="mt-6">
              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                hrefFor={(page) => withParam(params, "page", page === 1 ? null : String(page))}
              />
            </div>
          </>
        )}
      </div>
    </main>
  );
}
