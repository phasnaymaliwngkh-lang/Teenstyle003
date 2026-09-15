import { AlertTriangle, PackageOpen } from "lucide-react";
import Link from "next/link";

import { RetryButton } from "./retry-button";

/**
 * ชิ้นส่วนที่ทุก section บนหน้าแรกใช้ร่วมกัน (STEP 32)
 *
 * ทุก section ที่โหลดข้อมูลต้องมีครบ 4 สถานะ:
 *   Loading → <SectionSkeleton>  (ใส่เป็น fallback ของ <Suspense>)
 *   Empty   → <SectionEmpty>
 *   Error   → <SectionError> ซึ่งมีปุ่ม Retry
 *   Success → เนื้อหาจริง
 */

export function SectionHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  action?: { label: string; href: string };
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        {eyebrow && (
          <span className="inline-block rounded-[var(--radius-pill)] bg-lilac px-3 py-1 text-[11px] font-bold tracking-widest text-brand-dark uppercase">
            {eyebrow}
          </span>
        )}
        <h2 className="mt-2 text-2xl sm:text-3xl">{title}</h2>
        {subtitle && <p className="mt-2 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>

      {action && (
        <Link
          href={action.href}
          className="flex min-h-11 shrink-0 items-center rounded-[var(--radius-pill)] border border-line px-5 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}

/** ไม่มีข้อมูล — ไม่ใช่ข้อผิดพลาด จึงไม่มีปุ่มลองใหม่ */
export function SectionEmpty({ message, hint }: { message: string; hint?: string }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-12 text-center">
      <PackageOpen className="mx-auto size-8 text-brand-soft" aria-hidden />
      <p className="mt-3 font-semibold">{message}</p>
      {hint && <p className="mx-auto mt-2 max-w-md text-sm text-muted">{hint}</p>}
    </div>
  );
}

/** โหลดข้อมูลไม่สำเร็จ — มีปุ่มลองใหม่ */
export function SectionError({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-card)] border border-danger/25 bg-danger/5 px-6 py-10 text-center"
    >
      <AlertTriangle className="mx-auto size-8 text-danger" aria-hidden />
      <p className="mt-3 font-semibold text-danger">โหลดข้อมูลส่วนนี้ไม่สำเร็จ</p>
      <p className="mx-auto mt-2 max-w-md text-sm break-words text-ink-soft">{message}</p>
      <div className="mt-5">
        <RetryButton />
      </div>
    </div>
  );
}

/** โครงร่างตอนกำลังโหลด — จำนวนการ์ดควรเท่ากับที่จะแสดงจริง เพื่อไม่ให้เลย์เอาต์กระตุก */
export function SectionSkeleton({
  count = 4,
  aspect = "aspect-4/5",
}: {
  count?: number;
  aspect?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {Array.from({ length: count }, (_, index) => (
        <div
          key={index}
          className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white"
          aria-hidden
        >
          <div className={`${aspect} animate-pulse bg-lilac-50`} />
          <div className="space-y-2 p-4">
            <div className="h-2.5 w-1/3 animate-pulse rounded bg-lilac-50" />
            <div className="h-3.5 w-4/5 animate-pulse rounded bg-lilac-50" />
            <div className="h-3 w-1/4 animate-pulse rounded bg-lilac-50" />
            <div className="h-5 w-1/2 animate-pulse rounded bg-lilac" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** โครงร่างของ section พร้อมหัวข้อ — ใช้เป็น fallback ของ Suspense */
export function SectionLoading({ title, count = 4 }: { title: string; count?: number }) {
  return (
    <section aria-busy="true" aria-live="polite">
      <div className="mb-6">
        <h2 className="text-2xl sm:text-3xl">{title}</h2>
        <p className="mt-2 text-sm text-muted">กำลังโหลดข้อมูล…</p>
      </div>
      <SectionSkeleton count={count} />
    </section>
  );
}
