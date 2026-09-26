import { ShieldAlert, UserRound, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchAdminCustomersOnServer } from "@/services/customer.server";
import { ROLE_NAMES, USER_STATUSES, type AdminCustomerListResult } from "@/types/customer";

export const metadata: Metadata = {
  title: "จัดการลูกค้า",
  robots: { index: false, follow: false },
};

const FILTER_KEYS = ["status", "role", "tier", "q"] as const;
const { withParam, withClearedFilters, hasActiveFilters } = createQueryHelpers(
  "/admin/customers",
  FILTER_KEYS,
);

const SORTS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "recent", label: "สมัครล่าสุด" },
  { value: "oldest", label: "สมัครก่อน" },
  { value: "name", label: "ชื่อ ก–ฮ" },
  { value: "lastLogin", label: "เข้าใช้ล่าสุด" },
];

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

const ROLE_LABEL: Record<string, string> = {
  CUSTOMER: "ลูกค้า",
  EMPLOYEE: "พนักงาน",
  ADMIN: "ผู้ดูแล",
  SUPER_ADMIN: "ผู้ดูแลระบบ",
};

const TIER_LABEL: Record<string, string> = {
  MEMBER: "Member",
  SILVER: "Silver",
  GOLD: "Gold",
  VIP: "VIP",
};

const baht = (value: number) => `฿${value.toLocaleString("th-TH")}`;

const thaiDate = (value: string) =>
  new Date(value).toLocaleDateString("th-TH", { dateStyle: "medium" });

/**
 * จัดการลูกค้า /admin/customers (STEP 25)
 *
 * ⚠️ **ยอดซื้อในตารางนับจากตาราง `Order` จริง** ไม่ใช่คอลัมน์ `User.totalSpent`
 *    ซึ่งยังไม่มีใครเขียน (จะมาพร้อมระบบแต้ม STEP 42) — เอามาแสดงคือบอกร้านว่า
 *    ลูกค้าทุกคนไม่เคยซื้ออะไรเลย (ปัญหาชนิดเดียวกับ `Product.totalStock` ของ STEP 15)
 *
 * ⚠️ **ยังไม่มีการเรียงตามยอดซื้อโดยเจตนา** — ยอดซื้อไม่ใช่คอลัมน์ในตาราง `User`
 *    การเรียงต้องทำก่อนแบ่งหน้า ไม่ใช่เรียงเฉพาะ 20 แถวที่หยิบมา
 *    (บั๊กชนิดเดียวกับตัวกรอง "สต็อกต่ำ" ของ STEP 14 ข้อ 7) → เป็นงานของรายงาน STEP 26
 *
 * ⚠️ รายการนี้แสดง **บัญชีผู้ใช้ทุกบทบาท** เพราะหน้านี้เป็นที่เดียวที่เปลี่ยนบทบาทได้
 *    ตัวเลขสรุปด้านบนจึงแยก "ลูกค้า" กับ "ทีมงาน" ออกจากกันให้ชัด
 */
export default async function AdminCustomersPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await requirePermission("customer:read");
  const params = toSearchParams(await searchParams);

  let data: AdminCustomerListResult | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchAdminCustomersOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดรายการลูกค้าไม่สำเร็จ";
  }

  const canManage = session.user.permissions.includes("customer:update");

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">จัดการลูกค้า</h1>
          <p className="mt-1 text-sm text-muted">
            ยอดซื้อทุกตัวเลขนับจากคำสั่งซื้อจริง — เฉพาะใบที่ได้รับเงินแล้ว
          </p>
        </div>

        <Link
          href="/admin"
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          กลับหน้าภาพรวม
        </Link>
      </header>

      {errorMessage !== null ? (
        <div className="mt-8">
          <SectionError message={errorMessage} />
        </div>
      ) : data === null ? null : (
        <>
          <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              icon={<Users className="size-5 text-brand" aria-hidden />}
              label="ลูกค้าทั้งหมด"
              value={data.counts.customers.toLocaleString("th-TH")}
            />
            <SummaryCard
              icon={<UserRound className="size-5 text-brand" aria-hidden />}
              label="ลูกค้าใหม่ 30 วัน"
              value={data.counts.newLast30Days.toLocaleString("th-TH")}
            />
            <SummaryCard
              icon={<ShieldAlert className="size-5 text-danger" aria-hidden />}
              label="บัญชีที่ถูกระงับ/แบน"
              value={data.counts.suspended.toLocaleString("th-TH")}
            />
            <SummaryCard
              icon={<Users className="size-5 text-brand-soft" aria-hidden />}
              label="บัญชีทีมงาน"
              value={data.counts.staff.toLocaleString("th-TH")}
            />
          </section>

          <form action="/admin/customers" className="mt-6 flex flex-wrap gap-2">
            <label className="min-w-0 flex-1">
              <span className="sr-only">ค้นหาด้วยชื่อ อีเมล หรือเบอร์โทร</span>
              <input
                type="search"
                name="q"
                defaultValue={params.get("q") ?? ""}
                placeholder="ค้นหาด้วยชื่อ อีเมล หรือเบอร์โทร"
                className="min-h-11 w-full rounded-[var(--radius-pill)] border border-line px-4 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
              />
            </label>
            {FILTER_KEYS.filter((key) => key !== "q").map((key) => {
              const value = params.get(key);
              return value === null ? null : (
                <input key={key} type="hidden" name={key} value={value} />
              );
            })}
            <button
              type="submit"
              className="btn-brand flex min-h-11 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
            >
              ค้นหา
            </button>
          </form>

          <div className="mt-4 space-y-3">
            <FilterRow label="สถานะ">
              <FilterChip href={withParam(params, "status", null)} active={!params.get("status")}>
                ทุกสถานะ
              </FilterChip>
              {USER_STATUSES.map((status) => (
                <FilterChip
                  key={status}
                  href={withParam(params, "status", status)}
                  active={params.get("status") === status}
                >
                  {STATUS_LABEL[status]}
                </FilterChip>
              ))}
            </FilterRow>

            <FilterRow label="บทบาท">
              <FilterChip href={withParam(params, "role", null)} active={!params.get("role")}>
                ทุกบทบาท
              </FilterChip>
              {ROLE_NAMES.map((role) => (
                <FilterChip
                  key={role}
                  href={withParam(params, "role", role)}
                  active={params.get("role") === role}
                >
                  {ROLE_LABEL[role]}
                </FilterChip>
              ))}
            </FilterRow>

            <FilterRow label="เรียงตาม">
              {SORTS.map((sort) => (
                <FilterChip
                  key={sort.value}
                  href={withParam(params, "sort", sort.value)}
                  active={(params.get("sort") ?? "recent") === sort.value}
                >
                  {sort.label}
                </FilterChip>
              ))}
            </FilterRow>

            {hasActiveFilters(params) && (
              <Link
                href={withClearedFilters(params)}
                className="inline-flex min-h-11 items-center text-xs font-bold text-brand underline"
              >
                ล้างตัวกรองทั้งหมด
              </Link>
            )}
          </div>

          <p className="mt-5 text-sm font-semibold text-muted" aria-live="polite">
            พบ {data.total.toLocaleString("th-TH")} บัญชี
            {canManage ? "" : " · คุณมีสิทธิ์ดูเท่านั้น ระงับบัญชีไม่ได้"}
          </p>

          {data.items.length === 0 ? (
            <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-12 text-center">
              <p className="font-extrabold">ไม่พบบัญชีที่ตรงกับเงื่อนไข</p>
              <p className="mt-2 text-sm text-muted">ลองล้างตัวกรองหรือเปลี่ยนคำค้น</p>
            </div>
          ) : (
            <>
              {/* จอเล็ก: การ์ด · จอใหญ่: ตาราง (กัน horizontal overflow ที่ 360px) */}
              <ul className="mt-4 space-y-3 lg:hidden">
                {data.items.map((item) => (
                  <li
                    key={item.id}
                    className="rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-soft)]"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <Link
                        href={`/admin/customers/${item.id}`}
                        className="min-w-0 font-extrabold break-words text-brand underline"
                      >
                        {item.name ?? "(ยังไม่ตั้งชื่อ)"}
                      </Link>
                      <StatusBadge status={item.status} />
                    </div>
                    <p className="mt-1 text-sm break-all text-muted">{item.email}</p>
                    <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <Cell label="บทบาท">{ROLE_LABEL[item.role] ?? item.role}</Cell>
                      <Cell label="ระดับ">{TIER_LABEL[item.loyaltyTier] ?? item.loyaltyTier}</Cell>
                      <Cell label="คำสั่งซื้อ">
                        {item.stats.paidOrders} / {item.stats.totalOrders} ใบ
                      </Cell>
                      <Cell label="ยอดที่ได้รับ">{baht(item.stats.totalPaid)}</Cell>
                    </dl>
                  </li>
                ))}
              </ul>

              <div className="mt-4 hidden overflow-hidden rounded-[var(--radius-card)] border border-line bg-white lg:block">
                <table className="w-full text-left text-sm">
                  <thead className="bg-lilac-50 text-xs tracking-wide text-muted uppercase">
                    <tr>
                      <th scope="col" className="px-4 py-3">
                        ลูกค้า
                      </th>
                      <th scope="col" className="px-4 py-3">
                        บทบาท
                      </th>
                      <th scope="col" className="px-4 py-3">
                        สถานะ
                      </th>
                      <th scope="col" className="px-4 py-3 text-right">
                        คำสั่งซื้อ
                      </th>
                      <th scope="col" className="px-4 py-3 text-right">
                        ยอดที่ได้รับ
                      </th>
                      <th scope="col" className="px-4 py-3">
                        ซื้อครั้งล่าสุด
                      </th>
                      <th scope="col" className="px-4 py-3">
                        สมัครเมื่อ
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((item) => (
                      <tr key={item.id} className="border-t border-line align-top">
                        <td className="px-4 py-3">
                          <Link
                            href={`/admin/customers/${item.id}`}
                            className="font-bold text-brand underline"
                          >
                            {item.name ?? "(ยังไม่ตั้งชื่อ)"}
                          </Link>
                          <span className="block text-xs break-all text-muted">{item.email}</span>
                          {item.phone !== null && (
                            <span className="block text-xs text-muted">{item.phone}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {ROLE_LABEL[item.role] ?? item.role}
                          <span className="block text-xs text-muted">
                            {TIER_LABEL[item.loyaltyTier] ?? item.loyaltyTier}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={item.status} />
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {item.stats.paidOrders}
                          <span className="text-xs font-normal text-muted">
                            {" "}
                            / {item.stats.totalOrders}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">
                          {baht(item.stats.totalPaid)}
                          {item.stats.pendingCodAmount > 0 && (
                            <span className="block text-xs font-normal text-warning">
                              COD ค้าง {baht(item.stats.pendingCodAmount)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {item.stats.lastOrderAt === null
                            ? "ยังไม่เคยสั่ง"
                            : thaiDate(item.stats.lastOrderAt)}
                        </td>
                        <td className="px-4 py-3 text-muted">{thaiDate(item.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                hrefFor={(page) => withParam(params, "page", page)}
              />
            </>
          )}

          <p className="mt-6 text-xs text-muted">
            อันดับลูกค้าตามยอดซื้อยังไม่มีในหน้านี้ — ต้องคิดจากคำสั่งซื้อทั้งระบบก่อนแบ่งหน้า
            จะทำพร้อมรายงานใน STEP 26
          </p>
        </>
      )}
    </main>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
      <div className="flex items-center justify-between gap-2">
        {icon}
        <span className="text-2xl font-extrabold">{value}</span>
      </div>
      <p className="mt-2 text-sm text-muted">{label}</p>
    </div>
  );
}

function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-bold tracking-wide text-muted uppercase">{label}</span>
      {children}
    </div>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-3.5 text-xs font-bold transition",
        active
          ? "border-brand bg-brand text-white"
          : "border-line text-muted hover:border-brand-soft hover:bg-lilac-50",
      )}
    >
      {children}
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-1 text-[11px] font-bold",
        STATUS_STYLE[status] ?? "border-line text-muted",
      )}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

function Cell({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="font-semibold">{children}</dd>
    </div>
  );
}
