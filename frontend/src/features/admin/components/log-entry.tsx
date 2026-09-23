import { ArrowRight, MonitorSmartphone, User2 } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { AdminLogEntry, LogActionGroup } from "@/types/admin-log";

/**
 * หนึ่งแถวของประวัติการแก้ไข (STEP 27)
 *
 * เป็น Server Component และกางรายละเอียดด้วย `<details>` จึง **ไม่ต้องส่ง JS ไปเลย**
 * (แพตเทิร์นเดียวกับการ์ดลุคของ STEP 7)
 *
 * ⚠️ ส่วนที่ผู้ใช้อ่านจริงคือ "ช่องไหนเปลี่ยนจากอะไรเป็นอะไร" ซึ่ง backend คำนวณมาให้
 *    JSON ดิบอยู่ในส่วนที่ต้องกดกางอีกชั้น — ใส่ไว้เพื่อตรวจสอบย้อนหลังได้จริง
 *    แต่ไม่ใช่สิ่งที่โยนใส่หน้าคนอ่านตั้งแต่แรก
 *
 * ⚠️ แถวที่ผู้ทำรายการถูกลบบัญชีไปแล้วต้องแสดงตามปกติ พร้อมบอกว่าบัญชีถูกลบ
 *    **ห้ามซ่อนแถว** เพราะนั่นคือการทำให้ประวัติหาย
 */

const GROUP_STYLE: Record<LogActionGroup, string> = {
  product: "border-brand-soft bg-lilac text-brand-dark",
  inventory: "border-warning/30 bg-warning/5 text-warning",
  order: "border-success/30 bg-success/5 text-success",
  review: "border-brand-soft bg-lilac-50 text-brand-dark",
  knowledge: "border-brand-soft bg-lilac-50 text-brand-dark",
  support: "border-line bg-lilac-50 text-muted",
  customer: "border-danger/30 bg-danger/5 text-danger",
};

/** ค่าที่บันทึกไว้เป็นการทำทีเดียวหลายรายการ ไม่ใช่ id ของของชิ้นใดชิ้นหนึ่ง */
const BATCH_TARGET = "BATCH";

function formatValue(value: string | null): string {
  if (value === null) return "—";
  return value.length > 160 ? `${value.slice(0, 160)}…` : value;
}

export function LogEntry({ entry }: { entry: AdminLogEntry }) {
  const at = new Date(entry.createdAt);
  const hasRaw = entry.before !== null || entry.after !== null;

  return (
    <li className="rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-soft)]">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-extrabold">{entry.actionLabel}</span>
            <span
              className={cn(
                "inline-flex items-center rounded-[var(--radius-pill)] border px-2.5 py-0.5 text-[11px] font-bold",
                entry.group === null ? "border-line text-muted" : GROUP_STYLE[entry.group],
              )}
            >
              {entry.targetTypeLabel}
            </span>
          </div>

          <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted">
            <User2 className="size-4" aria-hidden />
            <span className="font-semibold text-ink-soft">
              {entry.actor.name ?? entry.actor.email}
            </span>
            {entry.actor.role !== null && <span>· {entry.actor.role}</span>}
            {entry.actor.id === null && <span className="text-warning">· บัญชีนี้ถูกลบไปแล้ว</span>}
          </p>
        </div>

        <time
          dateTime={entry.createdAt}
          className="shrink-0 text-xs text-muted"
          title={at.toISOString()}
        >
          {at.toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" })}
        </time>
      </div>

      {/* ─── สิ่งที่เปลี่ยน ─── */}
      {entry.changes.length > 0 ? (
        <ul className="mt-3 space-y-1.5">
          {entry.changes.map((change) => (
            <li key={change.field} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold">{change.field}</span>
              <span className="text-muted line-through">{formatValue(change.before)}</span>
              <ArrowRight className="size-3.5 shrink-0 text-muted" aria-hidden />
              <span className="font-semibold text-brand-dark">{formatValue(change.after)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">
          รายการนี้ไม่ได้บันทึกค่าก่อน/หลังเป็นช่อง ๆ ไว้ — ดูค่าดิบได้ด้านล่าง
        </p>
      )}

      {/* ─── ข้อมูลอ้างอิง ─── */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {entry.targetId !== null && (
          <span>
            รหัสข้อมูล:{" "}
            {entry.targetId === BATCH_TARGET ? (
              <span className="font-semibold">ทำทีเดียวหลายรายการ (นำเข้าเป็นชุด)</span>
            ) : entry.link !== null ? (
              <Link href={entry.link} className="font-semibold text-brand underline">
                {entry.targetId}
              </Link>
            ) : (
              <span className="font-mono">{entry.targetId}</span>
            )}
          </span>
        )}

        {entry.ipAddress !== null && <span>IP: {entry.ipAddress}</span>}

        {entry.userAgent !== null && (
          <span className="inline-flex max-w-full items-center gap-1 truncate">
            <MonitorSmartphone className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{entry.userAgent}</span>
          </span>
        )}
      </div>

      {hasRaw && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-bold text-brand">
            ดูค่าดิบที่บันทึกไว้
          </summary>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <div>
              <p className="text-xs font-bold text-muted">ก่อน</p>
              <pre className="mt-1 overflow-x-auto rounded-[var(--radius-card)] bg-lilac-50 p-3 text-[11px] break-words whitespace-pre-wrap">
                {entry.before === null ? "—" : JSON.stringify(entry.before, null, 2)}
              </pre>
            </div>
            <div>
              <p className="text-xs font-bold text-muted">หลัง</p>
              <pre className="mt-1 overflow-x-auto rounded-[var(--radius-card)] bg-lilac-50 p-3 text-[11px] break-words whitespace-pre-wrap">
                {entry.after === null ? "—" : JSON.stringify(entry.after, null, 2)}
              </pre>
            </div>
          </div>
        </details>
      )}
    </li>
  );
}
