import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * แบ่งหน้า (STEP 6 — /shop · STEP 7 — /looks)
 *
 * ใช้ <Link> ทั้งหมด ไม่ต้องมี JS · แสดงเลขหน้าแบบย่อเมื่อมีหลายหน้า
 * ผู้เรียกเป็นผู้สร้าง href เอง (`hrefFor`) จึงใช้ได้กับทุกหน้ารายการ
 */
export function Pagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;

  const pages = pageNumbers(page, totalPages);

  return (
    <nav aria-label="แบ่งหน้า" className="flex flex-wrap items-center justify-center gap-1.5">
      <PageLink href={hrefFor(page - 1)} disabled={page <= 1} label="หน้าก่อนหน้า">
        <ChevronLeft className="size-4" aria-hidden />
      </PageLink>

      {pages.map((item, index) =>
        item === null ? (
          <span key={`gap-${index}`} aria-hidden className="px-1.5 text-muted">
            …
          </span>
        ) : (
          <PageLink key={item} href={hrefFor(item)} active={item === page} label={`หน้า ${item}`}>
            {item}
          </PageLink>
        ),
      )}

      <PageLink href={hrefFor(page + 1)} disabled={page >= totalPages} label="หน้าถัดไป">
        <ChevronRight className="size-4" aria-hidden />
      </PageLink>
    </nav>
  );
}

function PageLink({
  href,
  children,
  label,
  active = false,
  disabled = false,
}: {
  href: string;
  children: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
}) {
  const className = cn(
    "grid size-11 place-items-center rounded-[12px] border text-sm font-semibold transition",
    active
      ? "border-brand bg-brand text-white"
      : "border-line hover:border-brand-soft hover:bg-lilac-50",
    disabled && "cursor-not-allowed opacity-40",
  );

  if (disabled) {
    return (
      <span aria-disabled="true" aria-label={label} className={className}>
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      aria-current={active ? "page" : undefined}
      className={className}
    >
      {children}
    </Link>
  );
}

/** คืนเลขหน้าที่จะแสดง — null คือจุดไข่ปลา */
function pageNumbers(current: number, total: number): (number | null)[] {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set<number>([1, total, current]);
  if (current - 1 > 1) pages.add(current - 1);
  if (current + 1 < total) pages.add(current + 1);

  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | null)[] = [];

  for (let index = 0; index < sorted.length; index += 1) {
    const page = sorted[index]!;
    const previous = sorted[index - 1];

    if (previous !== undefined && page - previous > 1) result.push(null);
    result.push(page);
  }

  return result;
}
