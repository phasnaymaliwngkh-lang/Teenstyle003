import { BellOff } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { MarkAllReadButton } from "@/features/notifications/components/mark-all-read-button";
import { NotificationItem } from "@/features/notifications/components/notification-item";
import { ApiClientError } from "@/lib/api";
import { getSession } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchNotificationsOnServer } from "@/services/notification.server";
import type { NotificationGroup, NotificationListResult } from "@/types/catalog";

export const metadata: Metadata = {
  title: "การแจ้งเตือน",
  description: "ความเคลื่อนไหวของคำสั่งซื้อ รีวิว และราคาสินค้าที่คุณถูกใจ",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/account/notifications", ["group", "unreadOnly"]);

const TABS: ReadonlyArray<{ value: NotificationGroup | null; label: string }> = [
  { value: null, label: "ทั้งหมด" },
  { value: "ORDER", label: "คำสั่งซื้อ" },
  { value: "PRICE", label: "ราคาและโปรโมชัน" },
  { value: "REVIEW", label: "รีวิว" },
];

/**
 * หน้าการแจ้งเตือน /account/notifications (STEP 24)
 *
 * ⚠️ เนื้อหาทุกบรรทัดเกิดจากเหตุการณ์จริงในฐานข้อมูล — ไม่มีข้อความตัวอย่าง
 *    และ backend กรอง `userId` เสมอ จึงไม่มีทางเห็นการแจ้งเตือนของคนอื่น
 *    หรือประกาศภายในร้าน (เช่นการเตือนสต็อก ซึ่งเป็นแถวที่ไม่มีเจ้าของ)
 *
 * ⚠️ ยังไม่มีการส่งอีเมล — หน้านี้คือช่องทางเดียวที่ใช้ได้จริงตอนนี้ และต้องบอกตรง ๆ
 */
export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getSession();

  if (!session) {
    redirect(`/signin?callbackUrl=${encodeURIComponent("/account/notifications")}`);
  }

  const params = toSearchParams(await searchParams);
  const activeGroup = params.get("group");
  const unreadOnly = params.get("unreadOnly") === "true";

  let result: NotificationListResult | null = null;
  let errorMessage: string | null = null;

  try {
    result = await fetchNotificationsOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดการแจ้งเตือนไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[860px] px-4 py-10 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
            Notifications
          </span>
          <h1 className="mt-3 text-3xl sm:text-4xl">การแจ้งเตือน</h1>
          <p className="mt-2 text-sm text-muted">
            ความเคลื่อนไหวของคำสั่งซื้อ ผลการตรวจรีวิว และราคาสินค้าที่คุณกดถูกใจไว้
          </p>
        </div>

        {result !== null && <MarkAllReadButton unreadCount={result.unreadCount} />}
      </header>

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : result === null ? null : (
        <>
          <nav aria-label="กรองการแจ้งเตือน" className="mt-6 flex flex-wrap gap-2">
            {TABS.map((tab) => {
              const isActive =
                activeGroup === tab.value || (tab.value === null && activeGroup === null);

              return (
                <Link
                  key={tab.label}
                  href={withParam(params, "group", tab.value)}
                  aria-current={isActive ? "true" : undefined}
                  className={cn(
                    "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
                    isActive
                      ? "border-brand bg-brand text-white"
                      : "border-line hover:border-brand-soft hover:bg-lilac-50",
                  )}
                >
                  {tab.label}
                </Link>
              );
            })}

            <Link
              href={withParam(params, "unreadOnly", unreadOnly ? null : "true")}
              aria-pressed={unreadOnly}
              className={cn(
                "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
                unreadOnly
                  ? "border-brand-soft bg-lilac text-brand-dark"
                  : "border-line hover:border-brand-soft hover:bg-lilac-50",
              )}
            >
              เฉพาะที่ยังไม่อ่าน
              {result.unreadCount > 0 && ` (${result.unreadCount.toLocaleString("th-TH")})`}
            </Link>
          </nav>

          <div className="mt-6">
            {result.items.length === 0 ? (
              <EmptyState filtered={activeGroup !== null || unreadOnly} />
            ) : (
              <div className="space-y-6">
                {/* รายการเปลี่ยนตามตัวกรอง — ประกาศให้ screen reader รู้โดยไม่ต้องย้าย focus */}
                <ul aria-live="polite" className="space-y-3">
                  {result.items.map((notification) => (
                    <NotificationItem key={notification.id} notification={notification} />
                  ))}
                </ul>

                <Pagination
                  page={result.page}
                  totalPages={result.totalPages}
                  hrefFor={(page) => withParam(params, "page", page)}
                />
              </div>
            )}
          </div>

          {/**
           * ⚠️ บอกตรง ๆ ว่ายังไม่มีการส่งอีเมล/push จริง
           * SMTP ยังไม่ได้ตั้งค่า (ดู backend/src/config/notification.ts) การส่งจริงเป็นงานของ STEP 50
           * ถ้าไม่บอก ลูกค้าจะรอเมลที่ไม่มีวันมา
           */}
          <p className="mt-8 rounded-[var(--radius-card)] border border-line bg-lilac-50 px-4 py-3 text-xs text-muted">
            ตอนนี้ร้านแจ้งเตือนผ่านหน้านี้เท่านั้น — ยังไม่ได้เปิดการส่งอีเมลและ push notification
            จึงควรแวะดูที่นี่เมื่อรอความเคลื่อนไหวของคำสั่งซื้อ
          </p>
        </>
      )}
    </main>
  );
}

/** ไม่มีการแจ้งเตือน — ไม่ใช่ error */
function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
      <BellOff className="mx-auto size-10 text-brand-soft" aria-hidden />
      <p className="mt-3 font-extrabold">
        {filtered ? "ไม่มีการแจ้งเตือนที่ตรงกับตัวกรองนี้" : "ยังไม่มีการแจ้งเตือน"}
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        {filtered
          ? "ลองเอาตัวกรองออกเพื่อดูทั้งหมด"
          : "เมื่อคำสั่งซื้อมีความเคลื่อนไหว หรือสินค้าที่คุณถูกใจลดราคา เราจะแจ้งให้รู้ที่นี่"}
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        {filtered ? (
          <Link
            href="/account/notifications"
            className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line bg-white px-6 text-sm font-semibold transition hover:border-brand-soft"
          >
            ดูทั้งหมด
          </Link>
        ) : (
          <>
            <Link
              href="/shop"
              className="btn-brand flex min-h-12 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
            >
              เลือกซื้อสินค้า
            </Link>
            <Link
              href="/wishlist"
              className="flex min-h-12 items-center rounded-[var(--radius-pill)] border border-line px-6 text-sm font-semibold transition hover:border-brand-soft hover:bg-white"
            >
              รายการที่ถูกใจ
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
