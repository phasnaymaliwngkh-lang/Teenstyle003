import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { LogEntry } from "@/features/admin/components/log-entry";
import { LogExportButton } from "@/features/admin/components/log-export-button";
import { errorMessageOf } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchAdminLogFiltersOnServer, fetchAdminLogsOnServer } from "@/services/admin-log.server";
import type { AdminLogFilters, AdminLogListResult } from "@/types/admin-log";

export const metadata: Metadata = {
  title: "ประวัติการแก้ไข",
  robots: { index: false, follow: false },
};

const FILTER_KEYS = ["group", "action", "targetType", "targetId", "userId", "q"] as const;
const { withParam, withClearedFilters, hasActiveFilters } = createQueryHelpers(
  "/admin/logs",
  FILTER_KEYS,
);

/** คีย์ที่ส่งต่อไป backend ได้ — คีย์อื่นใน URL ไม่ควรไปถึง API */
const API_KEYS = [...FILTER_KEYS, "from", "to", "page"] as const;

const thaiDate = (value: string) =>
  new Date(`${value}T00:00:00.000Z`).toLocaleDateString("th-TH", {
    dateStyle: "medium",
    timeZone: "UTC",
  });

/**
 * ประวัติการแก้ไขระบบหลังบ้าน /admin/logs (STEP 27)
 *
 * ⚠️ **หน้านี้อ่านอย่างเดียว** — ไม่มีปุ่มแก้หรือลบ และ backend ก็ไม่มี endpoint ให้
 *    audit log ที่แก้ได้คือ audit log ที่เชื่อไม่ได้
 *
 * ⚠️ **ตัวเลือกในตัวกรองมาจากข้อมูลจริงในช่วงที่เลือก** ไม่ใช่รายการคงที่
 *    ถ้าโชว์ตัวเลือกที่ไม่มีข้อมูล คนกดแล้วได้หน้าว่างจะคิดว่าระบบพัง
 *
 * ⚠️ **แถวที่ผู้ทำรายการถูกลบบัญชีแล้วต้องยังแสดง** — การซ่อนคือการทำให้ประวัติหาย
 */
export default async function AdminLogsPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("log:read");

  const params = toSearchParams(await searchParams);

  const query = new URLSearchParams();
  for (const key of API_KEYS) {
    const value = params.get(key);
    if (value !== null && value !== "") query.set(key, value);
  }

  // ตัวกรองใช้ช่วงวันเดียวกับรายการ เพื่อให้ตัวเลือกตรงกับสิ่งที่กรองได้จริง
  const filterQuery = new URLSearchParams();
  for (const key of ["from", "to"]) {
    const value = params.get(key);
    if (value !== null && value !== "") filterQuery.set(key, value);
  }

  const [logs, filters] = await Promise.allSettled([
    fetchAdminLogsOnServer(query),
    fetchAdminLogFiltersOnServer(filterQuery),
  ]);

  const errorOf = (result: PromiseSettledResult<unknown>): string | null =>
    result.status === "rejected" ? errorMessageOf(result.reason, "โหลดประวัติไม่สำเร็จ") : null;

  const data: AdminLogListResult | null = logs.status === "fulfilled" ? logs.value : null;
  const filterData: AdminLogFilters | null = filters.status === "fulfilled" ? filters.value : null;

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl">ประวัติการแก้ไข</h1>
          <p className="mt-1 text-sm text-muted">
            ทุกการเปลี่ยนข้อมูลสำคัญในระบบหลังบ้านถูกบันทึกไว้พร้อมผู้ทำรายการ —
            <span className="font-semibold"> แก้หรือลบย้อนหลังไม่ได้</span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {data !== null && <LogExportButton query={query.toString()} />}
          <Link
            href="/admin"
            className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
          >
            กลับหน้าภาพรวม
          </Link>
        </div>
      </header>

      <div className="mt-4 flex gap-3 rounded-[var(--radius-card)] border border-line bg-lilac-50 p-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-brand" aria-hidden />
        <p className="text-sm text-ink-soft">
          ประวัติเก็บ <span className="font-semibold">IP และอุปกรณ์ของพนักงาน</span>{" "}
          ซึ่งเป็นข้อมูลส่วนบุคคล — เปิดดูได้เฉพาะผู้มีสิทธิ์{" "}
          <span className="font-mono text-xs">log:read</span> · นโยบายระยะเวลาเก็บข้อมูลจะกำหนดใน
          STEP 53
        </p>
      </div>

      {/* ─── ช่วงเวลา + ค้นหา ─── */}
      <form
        action="/admin/logs"
        className="mt-6 flex flex-wrap items-end gap-3 rounded-[var(--radius-card)] border border-line bg-white p-4"
      >
        <label className="flex flex-col gap-1 text-xs font-bold">
          ตั้งแต่วันที่
          <input
            type="date"
            name="from"
            defaultValue={data?.range.from ?? params.get("from") ?? ""}
            className="min-h-11 rounded-[var(--radius-card)] border border-line px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold">
          ถึงวันที่
          <input
            type="date"
            name="to"
            defaultValue={data?.range.to ?? params.get("to") ?? ""}
            className="min-h-11 rounded-[var(--radius-card)] border border-line px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
          />
        </label>
        <label className="min-w-[200px] flex-1">
          <span className="sr-only">ค้นหาด้วยชื่อหรืออีเมลผู้ทำรายการ หรือรหัสข้อมูล</span>
          <input
            type="search"
            name="q"
            defaultValue={params.get("q") ?? ""}
            placeholder="ค้นด้วยชื่อ/อีเมลผู้ทำรายการ หรือรหัสข้อมูล"
            className="min-h-11 w-full rounded-[var(--radius-pill)] border border-line px-4 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20"
          />
        </label>
        {(["group", "action", "targetType", "targetId", "userId"] as const).map((key) => {
          const value = params.get(key);
          return value === null ? null : <input key={key} type="hidden" name={key} value={value} />;
        })}
        <button
          type="submit"
          className="btn-brand flex min-h-11 items-center rounded-[var(--radius-pill)] px-6 text-sm font-bold transition"
        >
          ค้นหา
        </button>
      </form>

      {errorOf(logs) !== null ? (
        <div className="mt-6">
          <SectionError message={errorOf(logs)!} />
        </div>
      ) : (
        <>
          {/* ─── ตัวกรองที่มีข้อมูลจริง ─── */}
          {filterData !== null && (
            <div className="mt-4 space-y-3">
              <FilterRow label="หมวด">
                <Chip href={withParam(params, "group", null)} active={!params.get("group")}>
                  ทั้งหมด
                </Chip>
                {filterData.groups.map((group) => (
                  <Chip
                    key={group.value}
                    href={withParam(params, "group", group.value)}
                    active={params.get("group") === group.value}
                  >
                    {group.label} ({group.count})
                  </Chip>
                ))}
              </FilterRow>

              <FilterRow label="ชนิดข้อมูล">
                <Chip
                  href={withParam(params, "targetType", null)}
                  active={!params.get("targetType")}
                >
                  ทั้งหมด
                </Chip>
                {filterData.targetTypes.map((type) => (
                  <Chip
                    key={type.value}
                    href={withParam(params, "targetType", type.value)}
                    active={params.get("targetType") === type.value}
                  >
                    {type.label} ({type.count})
                  </Chip>
                ))}
              </FilterRow>

              {filterData.actors.length > 1 && (
                <FilterRow label="ผู้ทำรายการ">
                  <Chip href={withParam(params, "userId", null)} active={!params.get("userId")}>
                    ทุกคน
                  </Chip>
                  {filterData.actors.slice(0, 8).map((actor) => (
                    <Chip
                      key={actor.userId ?? "deleted"}
                      // บัญชีที่ถูกลบไม่มี id ให้กรอง — แสดงจำนวนไว้แต่กดไม่ได้
                      href={
                        actor.userId === null ? null : withParam(params, "userId", actor.userId)
                      }
                      active={params.get("userId") === actor.userId}
                    >
                      {actor.name ?? actor.email} ({actor.count})
                    </Chip>
                  ))}
                </FilterRow>
              )}

              {hasActiveFilters(params) && (
                <Link
                  href={withClearedFilters(params)}
                  className="inline-flex min-h-9 items-center text-xs font-bold text-brand underline"
                >
                  ล้างตัวกรองทั้งหมด
                </Link>
              )}
            </div>
          )}

          {data !== null && (
            <>
              <p className="mt-5 text-sm font-semibold text-muted" aria-live="polite">
                พบ {data.total.toLocaleString("th-TH")} รายการ · {thaiDate(data.range.from)} –{" "}
                {thaiDate(data.range.to)}
              </p>

              {data.items.length === 0 ? (
                <div className="mt-4 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-12 text-center">
                  <p className="font-extrabold">ไม่มีรายการในเงื่อนไขนี้</p>
                  <p className="mt-2 text-sm text-muted">ลองขยายช่วงวันที่ หรือล้างตัวกรอง</p>
                </div>
              ) : (
                <ul className="mt-4 space-y-3">
                  {data.items.map((entry) => (
                    <LogEntry key={entry.id} entry={entry} />
                  ))}
                </ul>
              )}

              <Pagination
                page={data.page}
                totalPages={data.totalPages}
                hrefFor={(page) => withParam(params, "page", page)}
              />
            </>
          )}
        </>
      )}
    </main>
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

function Chip({
  href,
  active,
  children,
}: {
  /** null = กดไม่ได้ (เช่น บัญชีที่ถูกลบแล้วไม่มี id ให้กรอง) */
  href: string | null;
  active: boolean;
  children: React.ReactNode;
}) {
  const className = cn(
    "flex min-h-9 items-center rounded-[var(--radius-pill)] border px-3.5 text-xs font-bold",
    active
      ? "border-brand bg-brand text-white"
      : "border-line text-muted transition hover:border-brand-soft hover:bg-lilac-50",
  );

  if (href === null) {
    return <span className={cn(className, "cursor-default opacity-60")}>{children}</span>;
  }

  return (
    <Link href={href} aria-current={active ? "true" : undefined} className={className}>
      {children}
    </Link>
  );
}
