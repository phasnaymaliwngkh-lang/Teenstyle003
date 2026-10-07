import { ImageIcon } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { Pagination } from "@/components/shared/pagination";
import { SectionError } from "@/components/shared/section";
import { MediaPurgeButton } from "@/features/admin/components/media-purge-button";
import { ApiClientError } from "@/lib/api";
import { requirePermission } from "@/lib/dal";
import { megabytes } from "@/lib/image-upload";
import { createQueryHelpers, toSearchParams, type RawSearchParams } from "@/lib/query-params";
import { cn } from "@/lib/utils";
import { fetchMediaLibraryOnServer } from "@/services/admin.server";
import type { MediaLibrary, MediaLibraryItem, MediaUsageFilter } from "@/types/admin";

export const metadata: Metadata = {
  title: "คลังรูป",
  robots: { index: false, follow: false },
};

const { withParam } = createQueryHelpers("/admin/media", ["usage", "purpose"]);

const USAGE_TABS: ReadonlyArray<{ value: MediaUsageFilter; label: string }> = [
  { value: "all", label: "ทั้งหมด" },
  { value: "in-use", label: "ใช้อยู่" },
  { value: "unused", label: "ไม่ได้ใช้แล้ว" },
];

const PURPOSE_TABS = [
  { value: "", label: "ทุกประเภท" },
  { value: "PRODUCT", label: "รูปสินค้า" },
  { value: "REVIEW", label: "รูปรีวิว" },
] as const;

const PURPOSE_LABEL: Record<MediaLibraryItem["purpose"], string> = {
  PRODUCT: "รูปสินค้า",
  REVIEW: "รูปรีวิว",
};

const REVIEW_STATUS_LABEL: Record<string, string> = {
  PENDING: "รอตรวจ",
  APPROVED: "แสดงอยู่",
  HIDDEN: "ซ่อนอยู่",
  REJECTED: "ไม่อนุมัติ",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
}

/**
 * คลังรูป (STEP 47) — ไฟล์ทุกไฟล์ที่ร้านเก็บเอง ใช้อยู่ที่ไหน และลบไฟล์ที่ไม่ได้ใช้แล้ว
 *
 * ⚠️ **ไม่ลบไฟล์ทันทีที่ถอดออก** — url ของรูปถูกเก็บเป็น snapshot ในคำสั่งซื้อ
 *    ไฟล์ที่ยังอยู่ในประวัติคำสั่งซื้อนับว่า "ใช้อยู่" และลบไม่ได้ตลอดไป
 *    ส่วนไฟล์ที่ไม่มีที่ไหนใช้ต้องรอครบช่วงผ่อนผันก่อน (กันคำสั่งซื้อที่สร้างพร้อมกับการถอดรูป)
 * ⚠️ หน้านี้อ่านอย่างเดียว — เปิดดูไม่ทำให้ข้อมูลอะไรเปลี่ยน · ลบได้ทางเดียวคือปุ่มลบ
 */
export default async function AdminMediaPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  await requirePermission("media:manage");

  const params = toSearchParams(await searchParams);
  const usage = (params.get("usage") ?? "all") as MediaUsageFilter;
  const purpose = params.get("purpose") ?? "";

  let data: MediaLibrary | null = null;
  let errorMessage: string | null = null;

  try {
    data = await fetchMediaLibraryOnServer(params);
  } catch (error) {
    errorMessage = error instanceof ApiClientError ? error.message : "โหลดคลังรูปไม่สำเร็จ";
  }

  return (
    <main className="mx-auto w-full max-w-[1100px] px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-3xl">คลังรูป</h1>
          <p className="mt-1 text-sm text-muted">
            ไฟล์รูปที่ร้านเก็บเองทั้งหมด (รูปสินค้าและรูปที่ลูกค้าแนบรีวิว) — ทุกไฟล์ถูกแปลงเป็น
            WebP และลบข้อมูลตำแหน่ง/กล้องออกแล้ว · รูปตัวอย่างที่เป็นลิงก์ภายนอกไม่อยู่ในหน้านี้
          </p>
        </div>

        <Link
          href="/admin/products"
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50"
        >
          จัดการรูปของสินค้า
        </Link>
      </header>

      {errorMessage !== null || data === null ? (
        <div className="mt-8">
          <SectionError message={errorMessage ?? "โหลดคลังรูปไม่สำเร็จ"} />
        </div>
      ) : (
        <>
          <section
            aria-label="สรุปไฟล์"
            className="mt-6 grid gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Stat
              label="ไฟล์ทั้งหมด"
              value={`${data.summary.total.toLocaleString("th-TH")} ไฟล์`}
              hint={`${megabytes(data.summary.totalBytes)} (ไฟล์ที่ส่งมา ${megabytes(data.summary.originalBytes)})`}
            />
            <Stat label="ใช้อยู่" value={`${data.summary.inUse.toLocaleString("th-TH")} ไฟล์`} />
            <Stat
              label="ไม่ได้ใช้แล้ว"
              value={`${data.summary.unused.toLocaleString("th-TH")} ไฟล์`}
              hint={`ลบได้เมื่อไม่ถูกใช้ต่อเนื่องเกิน ${data.summary.graceHours} ชั่วโมง`}
            />
            <Stat
              label="ลบได้ตอนนี้"
              value={`${data.summary.deletable.toLocaleString("th-TH")} ไฟล์`}
              hint={megabytes(data.summary.deletableBytes)}
            />
            <div className="sm:col-span-2 lg:col-span-4">
              <MediaPurgeButton
                deletable={data.summary.deletable}
                deletableBytes={data.summary.deletableBytes}
                graceHours={data.summary.graceHours}
              />
              <p className="mt-2 text-xs text-muted">
                ไฟล์ที่อยู่ในประวัติคำสั่งซื้อนับว่าใช้อยู่เสมอ (ลูกค้ายังเปิดดูได้) ·
                ยังไม่มีการลบอัตโนมัติตามเวลา — ต้องกดปุ่มนี้เอง
              </p>
            </div>
          </section>

          <nav aria-label="กรองตามการใช้งาน" className="mt-6 flex flex-wrap gap-2">
            {USAGE_TABS.map((tab) => (
              <FilterLink
                key={tab.value}
                href={withParam(params, "usage", tab.value === "all" ? null : tab.value)}
                active={usage === tab.value}
                label={tab.label}
              />
            ))}
          </nav>
          <nav aria-label="กรองตามประเภทรูป" className="mt-2 flex flex-wrap gap-2">
            {PURPOSE_TABS.map((tab) => (
              <FilterLink
                key={tab.label}
                href={withParam(params, "purpose", tab.value === "" ? null : tab.value)}
                active={purpose === tab.value}
                label={tab.label}
              />
            ))}
          </nav>

          <p className="mt-4 text-sm text-muted" aria-live="polite">
            พบ {data.total.toLocaleString("th-TH")} ไฟล์
          </p>

          {data.items.length === 0 ? (
            <div className="mt-6 rounded-[var(--radius-card)] border border-dashed border-line bg-lilac-50 px-6 py-14 text-center">
              <ImageIcon className="mx-auto size-10 text-brand-soft" aria-hidden />
              <p className="mt-3 font-extrabold">ไม่มีไฟล์ในเงื่อนไขนี้</p>
              <p className="mt-2 text-sm text-muted">
                {data.summary.total === 0
                  ? "ยังไม่มีใครอัปโหลดรูป — เพิ่มรูปสินค้าได้ที่หน้าแก้ไขสินค้า"
                  : "ลองเปลี่ยนตัวกรองดู"}
              </p>
            </div>
          ) : (
            <>
              <ul className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((item) => (
                  <MediaCard key={item.id} item={item} />
                ))}
              </ul>

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

function MediaCard({ item }: { item: MediaLibraryItem }) {
  const usedBy = [
    ...item.usage.products.map((product) => ({
      key: `p-${product.id}`,
      node: (
        <Link
          href={`/admin/products/${product.id}`}
          className="font-semibold text-brand underline-offset-4 hover:underline"
        >
          {product.name}
          {product.archived ? " (ลบแล้ว)" : ""}
        </Link>
      ),
    })),
    ...item.usage.reviews.map((review) => ({
      key: `r-${review.id}`,
      node: (
        <span>
          รีวิว{review.productName} ({REVIEW_STATUS_LABEL[review.status] ?? review.status})
        </span>
      ),
    })),
    ...(item.usage.orderItemCount > 0
      ? [
          {
            key: "orders",
            node: (
              <span>
                ประวัติคำสั่งซื้อ {item.usage.orderItemCount.toLocaleString("th-TH")} รายการ
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <li className="min-w-0 rounded-[var(--radius-card)] border border-line bg-white p-3">
      <a
        href={item.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`เปิด${PURPOSE_LABEL[item.purpose]} ${item.width} × ${item.height} ขนาดเต็ม (แท็บใหม่)`}
        className="relative block aspect-[4/3] overflow-hidden rounded-[12px] bg-lilac-50"
      >
        <Image
          src={item.url}
          alt=""
          fill
          sizes="(min-width: 1024px) 340px, (min-width: 640px) 50vw, 100vw"
          className="object-contain"
        />
      </a>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-[var(--radius-pill)] bg-lilac px-2 py-0.5 font-bold text-brand-dark">
          {PURPOSE_LABEL[item.purpose]}
        </span>
        <span
          className={cn(
            "rounded-[var(--radius-pill)] border px-2 py-0.5 font-bold",
            item.inUse
              ? "border-success/30 bg-success/5 text-success"
              : item.deletable
                ? "border-danger/30 bg-danger/5 text-danger"
                : "border-warning/30 bg-warning/5 text-warning",
          )}
        >
          {item.inUse ? "ใช้อยู่" : item.deletable ? "ลบได้" : "ไม่ได้ใช้แล้ว"}
        </span>
        <span className="text-muted">
          {item.width} × {item.height} · {megabytes(item.bytes)}
        </span>
      </div>

      <dl className="mt-2 space-y-1 text-xs">
        <div className="flex flex-wrap gap-1">
          <dt className="text-muted">ใช้ที่:</dt>
          <dd className="min-w-0 break-words">
            {usedBy.length === 0 ? (
              <span className="text-muted">ไม่มีที่ไหนใช้</span>
            ) : (
              usedBy.map((entry, index) => (
                <span key={entry.key}>
                  {index > 0 && " · "}
                  {entry.node}
                </span>
              ))
            )}
          </dd>
        </div>
        {!item.inUse && (
          <div className="flex flex-wrap gap-1">
            <dt className="text-muted">ลบได้:</dt>
            <dd>
              {item.deletableAt === null
                ? "ยังไม่ถูกจดเวลา — กดลบหนึ่งครั้งเพื่อเริ่มนับ"
                : item.deletable
                  ? "ได้แล้ว"
                  : `ตั้งแต่ ${formatDate(item.deletableAt)}`}
            </dd>
          </div>
        )}
        <div className="flex flex-wrap gap-1">
          <dt className="text-muted">อัปโหลด:</dt>
          <dd className="min-w-0 break-all">
            {formatDate(item.createdAt)} โดย{" "}
            {item.uploadedBy === null
              ? "(บัญชีถูกลบแล้ว)"
              : (item.uploadedBy.name ?? item.uploadedBy.email)}
          </dd>
        </div>
      </dl>
    </li>
  );
}

function FilterLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "flex min-h-11 items-center rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
        active
          ? "border-brand bg-brand text-white"
          : "border-line hover:border-brand-soft hover:bg-lilac-50",
      )}
    >
      {label}
    </Link>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-lg font-extrabold">{value}</p>
      {hint !== undefined && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
