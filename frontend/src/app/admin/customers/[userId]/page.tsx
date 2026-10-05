import { Heart, Mail, MapPin, MonitorSmartphone, Phone, Star, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { CustomerAccountActions } from "@/features/admin/components/customer-account-actions";
import { PointsAdjustForm } from "@/features/admin/components/points-adjust-form";
import { LoyaltyStandingCard } from "@/features/loyalty/components/loyalty-standing-card";
import { PointHistory } from "@/features/loyalty/components/point-history";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchAdminCustomerOnServer } from "@/services/customer.server";
import { fetchCustomerPointsOnServer } from "@/services/loyalty.server";
import type { AdminCustomerDetail } from "@/types/customer";
import type { AdminPointTransactionList } from "@/types/loyalty";

export const metadata: Metadata = {
  title: "ข้อมูลลูกค้า",
  robots: { index: false, follow: false },
};

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: "ใช้งานได้",
  SUSPENDED: "ถูกระงับ",
  BANNED: "ถูกแบน",
};

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "border-success/30 bg-success/5 text-success",
  SUSPENDED: "border-warning/30 bg-warning/5 text-warning",
  BANNED: "border-danger/30 bg-danger/5 text-danger",
};

const ORDER_STATUS_LABEL: Record<string, string> = {
  PENDING_PAYMENT: "รอชำระเงิน",
  PAID: "ชำระแล้ว",
  PROCESSING: "กำลังเตรียม",
  PACKING: "กำลังแพ็ก",
  SHIPPING: "กำลังส่ง",
  DELIVERED: "ได้รับแล้ว",
  CANCELLED: "ยกเลิก",
  REFUNDED: "คืนเงินแล้ว",
};

const baht = (value: number) => `฿${value.toLocaleString("th-TH")}`;

const thaiDateTime = (value: string) =>
  new Date(value).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });

const thaiDate = (value: string) =>
  new Date(value).toLocaleDateString("th-TH", { dateStyle: "medium" });

/**
 * ข้อมูลลูกค้ารายคน /admin/customers/[userId] (STEP 25)
 *
 * ⚠️ `await` ข้อมูลหลักที่ระดับ page และ **ห้ามมี `loading.tsx` ในโฟลเดอร์นี้**
 *    ไม่งั้น `notFound()` จะคืน HTTP 200 (soft 404) — ดูหัวข้อใน CLAUDE.md
 *
 * ⚠️ หน้านี้เห็นชื่อจริง อีเมล และเบอร์โทรของลูกค้า เพราะร้านต้องติดต่อกลับได้
 *    (ต่างจากหน้าร้านที่ย่อชื่อเป็น "สมชาย ก." ตามกฎ STEP 23 ข้อ 5)
 *    จึงต้องมีสิทธิ์ `customer:read` และ metadata ตั้ง `robots: noindex`
 */
export default async function AdminCustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ userId: string }>;
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await requirePermission("customer:read");
  const { userId } = await params;
  const query = toSearchParams(await searchParams);
  const requestedPointsPage = Number(query.get("pointsPage") ?? "1");
  const pointsPage =
    Number.isInteger(requestedPointsPage) && requestedPointsPage > 0 ? requestedPointsPage : 1;

  let customer: AdminCustomerDetail;

  try {
    customer = await fetchAdminCustomerOnServer(userId);
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
      notFound();
    }
    throw error;
  }

  const stats = customer.stats;

  /**
   * แต้มสะสมโหลดแยกจากข้อมูลหลัก (STEP 42) — โหลดไม่ได้ต้องไม่ทำให้ทั้งหน้าพัง (กฎ STEP 5 ข้อ 1)
   * และไม่ใช้ข้อมูลชุดนี้ตัดสิน 404 (ตัดสินจากข้อมูลหลักด้านบนไปแล้ว)
   */
  let points: AdminPointTransactionList | null = null;
  let pointsError: string | null = null;

  try {
    points = await fetchCustomerPointsOnServer(customer.id, pointsPage);
  } catch (error) {
    pointsError = error instanceof ApiClientError ? error.message : "โหลดแต้มสะสมไม่สำเร็จ";
  }

  const canAdjustPoints =
    session.user.permissions.includes("loyalty:adjust") && session.user.id !== customer.id;

  return (
    <main className="mx-auto w-full max-w-[1000px] px-4 py-8 sm:px-6">
      <Link
        href="/admin/customers"
        className="text-sm font-semibold text-brand underline hover:text-brand-dark"
      >
        ← กลับไปรายการลูกค้า
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl break-words">{customer.name ?? "(ยังไม่ตั้งชื่อ)"}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-1 text-[11px] font-bold",
                STATUS_STYLE[customer.status] ?? "border-line text-muted",
              )}
            >
              {STATUS_LABEL[customer.status] ?? customer.status}
            </span>
            <span className="inline-flex items-center rounded-[var(--radius-pill)] bg-lilac px-2.5 py-1 text-[11px] font-bold text-brand-dark">
              {customer.role}
            </span>
            {/* ระดับคิดจาก "ยอดที่ได้รับ" ตัวเดียวกับในหน้านี้ · แต้ม = ผลรวมของสมุดแต้ม (STEP 42) */}
            <span className="inline-flex items-center rounded-[var(--radius-pill)] border border-line px-2.5 py-1 text-[11px] font-bold text-ink-soft">
              {customer.tier.name} · {customer.points.toLocaleString("th-TH")} แต้ม
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={`/admin/logs?targetType=User&targetId=${customer.id}`}
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            ประวัติการแก้ไขบัญชีนี้
          </Link>
          <Link
            href={`/admin/orders?q=${encodeURIComponent(customer.email)}`}
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            ดูคำสั่งซื้อทั้งหมด
          </Link>
        </div>
      </header>

      {/* ─── ช่องทางติดต่อ ─── */}
      <section className="mt-6 grid gap-4 sm:grid-cols-2">
        <InfoCard icon={<Mail className="size-5 text-brand" aria-hidden />} label="อีเมล">
          <span className="break-all">{customer.email}</span>
          {!customer.emailVerified && (
            <span className="mt-1 block text-xs font-normal text-warning">ยังไม่ยืนยันอีเมล</span>
          )}
        </InfoCard>
        <InfoCard icon={<Phone className="size-5 text-brand" aria-hidden />} label="เบอร์โทร">
          {customer.phone ?? <span className="text-muted">ลูกค้ายังไม่ได้กรอก</span>}
        </InfoCard>
      </section>

      {/* ─── ยอดซื้อจริง ─── */}
      <section className="mt-6">
        <h2 className="text-lg">ยอดซื้อ</h2>
        <p className="mt-1 text-sm text-muted">
          นับจากคำสั่งซื้อจริงในฐานข้อมูล — &ldquo;ยอดที่ได้รับ&rdquo; คือใบที่เก็บเงินแล้วเท่านั้น
        </p>
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<Wallet className="size-5 text-brand" aria-hidden />}
            label="ยอดที่ได้รับ"
            value={baht(stats.totalPaid)}
          />
          <StatCard
            icon={<Wallet className="size-5 text-warning" aria-hidden />}
            label="COD ที่ยังไม่เก็บเงิน"
            value={baht(stats.pendingCodAmount)}
          />
          <StatCard
            icon={<Star className="size-5 text-brand" aria-hidden />}
            label="คำสั่งซื้อที่จ่ายแล้ว"
            value={`${stats.paidOrders} / ${stats.totalOrders} ใบ`}
          />
          <StatCard
            icon={<Heart className="size-5 text-brand" aria-hidden />}
            label="รีวิว · ถูกใจ"
            value={`${customer.reviewCount} · ${customer.wishlistCount}`}
          />
        </div>
      </section>

      {/* ─── แต้มสะสม (STEP 42) ─── */}
      <section aria-labelledby="points-heading" className="mt-6">
        <h2 id="points-heading" className="text-lg">
          แต้มสะสม
        </h2>
        <p className="mt-1 text-sm text-muted">
          แต้มคงเหลือคือผลรวมของประวัติด้านล่างทุกบรรทัด — ระดับคิดจากยอดที่ได้รับด้านบน
        </p>

        <div className="mt-3 space-y-4">
          {points === null ? (
            <SectionError message={pointsError ?? "โหลดแต้มสะสมไม่สำเร็จ"} />
          ) : (
            <>
              <LoyaltyStandingCard standing={points.standing} audience="staff" />

              {points.items.length === 0 ? (
                <p className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 p-4 text-sm text-muted">
                  ยังไม่มีประวัติแต้ม — แต้มเข้าเมื่อร้านได้รับเงินจากคำสั่งซื้อของลูกค้าคนนี้
                </p>
              ) : (
                <>
                  <PointHistory
                    items={points.items}
                    orderHref={(orderNumber) => `/admin/orders/${encodeURIComponent(orderNumber)}`}
                  />
                  <Pagination
                    page={points.page}
                    totalPages={points.totalPages}
                    hrefFor={(target) =>
                      target <= 1
                        ? `/admin/customers/${customer.id}`
                        : `/admin/customers/${customer.id}?pointsPage=${target}`
                    }
                  />
                </>
              )}

              {canAdjustPoints && (
                <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
                  <h3 className="text-sm font-extrabold">ปรับแต้ม</h3>
                  <p className="mt-1 text-xs text-muted">
                    บันทึกเป็นรายการใหม่ในประวัติ (แก้/ลบรายการเดิมไม่ได้) และเขียนลง Audit log
                  </p>
                  <div className="mt-3">
                    <PointsAdjustForm userId={customer.id} balance={points.standing.points} />
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        {/* ─── คำสั่งซื้อล่าสุด ─── */}
        <section className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
          <h2 className="text-lg">คำสั่งซื้อล่าสุด</h2>

          {customer.recentOrders.length === 0 ? (
            <p className="mt-3 text-sm text-muted">ยังไม่เคยสั่งซื้อ</p>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {customer.recentOrders.map((order) => (
                <li key={order.orderNumber} className="flex flex-wrap gap-2 py-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/orders/${order.orderNumber}`}
                      className="font-bold text-brand underline"
                    >
                      {order.orderNumber}
                    </Link>
                    <span className="block text-xs text-muted">{thaiDate(order.createdAt)}</span>
                  </div>
                  <div className="text-right">
                    <span className="block font-semibold">{baht(order.total)}</span>
                    <span className="block text-xs text-muted">
                      {ORDER_STATUS_LABEL[order.status] ?? order.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ─── การใช้งานบัญชี ─── */}
        <section className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
          <h2 className="text-lg">การใช้งานบัญชี</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <Row label="สมัครเมื่อ">{thaiDate(customer.createdAt)}</Row>
            <Row label="เข้าใช้ล่าสุด">
              {customer.lastLoginAt === null ? (
                <span className="text-muted">ยังไม่เคยเข้าสู่ระบบ</span>
              ) : (
                thaiDateTime(customer.lastLoginAt)
              )}
            </Row>
            <Row label="ซื้อครั้งล่าสุด">
              {stats.lastOrderAt === null ? (
                <span className="text-muted">ยังไม่เคยสั่ง</span>
              ) : (
                thaiDate(stats.lastOrderAt)
              )}
            </Row>
            <Row label="วันเกิด">
              {customer.birthDate ?? <span className="text-muted">ลูกค้ายังไม่ได้กรอก</span>}
            </Row>
            <Row label="การแนะนำแบบ personalized">
              {customer.allowPersonalization ? "เปิดอยู่" : "ลูกค้าปิดไว้"}
            </Row>
            <Row label="เครื่องที่ล็อกอินค้างอยู่">
              <span className="inline-flex items-center gap-1.5">
                <MonitorSmartphone className="size-4 text-muted" aria-hidden />
                {customer.activeSessions} session
              </span>
            </Row>
          </dl>
        </section>
      </div>

      {/* ─── ที่อยู่ ─── */}
      <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
        <h2 className="flex items-center gap-2 text-lg">
          <MapPin className="size-5 text-brand" aria-hidden />
          สมุดที่อยู่ของลูกค้า
        </h2>
        <p className="mt-1 text-xs text-muted">
          ที่อยู่ปลายทางของแต่ละคำสั่งซื้อถูกบันทึกแยกไว้ตอนสั่ง — แก้ที่นี่ไม่กระทบใบที่สั่งแล้ว
        </p>

        {customer.addresses.length === 0 ? (
          <p className="mt-3 text-sm text-muted">ยังไม่มีที่อยู่บันทึกไว้</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {customer.addresses.map((address) => (
              <li
                key={address.id}
                className="rounded-[var(--radius-card)] border border-line bg-lilac-50 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{address.label ?? "ที่อยู่จัดส่ง"}</span>
                  {address.isDefault && (
                    <span className="rounded-[var(--radius-pill)] bg-lilac px-2.5 py-1 text-[11px] font-bold text-brand-dark">
                      ค่าเริ่มต้น
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm font-semibold">
                  {address.recipientName} · {address.phone}
                </p>
                <p className="mt-1 text-sm text-muted">
                  {[
                    address.line1,
                    address.line2,
                    address.subDistrict,
                    address.district,
                    address.province,
                    address.postalCode,
                  ]
                    .filter((part) => part !== null && part !== "")
                    .join(" ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ─── จัดการบัญชี ─── */}
      <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)] sm:p-6">
        <h2 className="text-lg">จัดการบัญชี</h2>
        <p className="mt-1 text-sm text-muted">
          ทุกการเปลี่ยนต้องกรอกเหตุผล และถูกบันทึกลง Audit log พร้อมชื่อผู้ทำรายการ
          {" · "}
          <span className="font-semibold">ไม่มีปุ่มลบบัญชี</span> — การลบข้อมูลส่วนบุคคลจะทำใน STEP
          53
        </p>

        <div className="mt-4">
          <CustomerAccountActions
            userId={customer.id}
            currentStatus={customer.status}
            currentRole={customer.role}
            canUpdateStatus={session.user.permissions.includes("customer:update")}
            canManageRole={session.user.permissions.includes("user:role:manage")}
            isSelf={session.user.id === customer.id}
          />
        </div>
      </section>
    </main>
  );
}

function InfoCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center gap-2 text-xs font-semibold tracking-wide text-muted uppercase">
        {icon}
        {label}
      </div>
      <p className="mt-2 font-semibold">{children}</p>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-2">
        {icon}
        <span className="text-xl font-extrabold">{value}</span>
      </div>
      <p className="mt-2 text-sm text-muted">{label}</p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}
