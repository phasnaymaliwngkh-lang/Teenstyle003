import { AlertTriangle, Check, ChevronRight, Eye, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import {
  SectionEmpty,
  SectionError,
  SectionHeader,
  SectionSkeleton,
} from "@/components/shared/section";
import { LookBuilder } from "@/features/looks/components/look-builder";
import { LookCard } from "@/features/looks/components/look-card";
import { styleLabel, styleShort } from "@/features/looks/lib/labels";
import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { fetchLookDetail, searchLooks } from "@/services/catalog.service";
import type { LookDetail } from "@/types/catalog";
import { formatBaht } from "@/utils/format";

type PageProps = { params: Promise<{ slug: string }> };

type LoadResult =
  { kind: "found"; look: LookDetail } | { kind: "missing" } | { kind: "error"; message: string };

/**
 * โหลดลุคหนึ่งชุด แล้วแยก "ไม่มีลุคนี้" ออกจาก "โหลดไม่สำเร็จ"
 * 404 = ไม่มีในฐานข้อมูล · 422 = slug ผิดรูปแบบ → ทั้งคู่คือ not found
 */
async function loadLook(slug: string): Promise<LoadResult> {
  try {
    return { kind: "found", look: await fetchLookDetail(slug) };
  } catch (error) {
    if (error instanceof ApiClientError && (error.status === 404 || error.status === 422)) {
      return { kind: "missing" };
    }

    return {
      kind: "error",
      message: error instanceof ApiClientError ? error.message : "โหลดข้อมูลลุคไม่สำเร็จ",
    };
  }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const loaded = await loadLook(slug);

  if (loaded.kind !== "found") {
    return { title: loaded.kind === "missing" ? "ไม่พบลุค" : "รายละเอียดลุค" };
  }

  const { look } = loaded;

  return {
    title: `${look.name} — ${styleShort(look.style)} Look`,
    description:
      look.description ??
      `ไอเดียการแต่งตัวสไตล์ ${styleShort(look.style)} รวม ${look.itemCount} ชิ้น ราคารวม ${look.totalPrice} บาท`,
    openGraph: {
      title: look.name,
      description: look.description ?? undefined,
      images: look.imageUrl ? [{ url: look.imageUrl }] : undefined,
    },
  };
}

/**
 * หน้ารายละเอียดลุค /looks/[slug] (STEP 8)
 *
 * ⚠️ await ข้อมูลหลักที่ระดับ page (ไม่ห่อ <Suspense> และไม่มี loading.tsx)
 *    เพื่อให้ slug ที่ไม่มีจริงคืน HTTP 404 ได้ — เหตุผลเต็มอยู่ใน CLAUDE.md
 *    ส่วน "ลุคอื่นในสไตล์นี้" ยัง stream พร้อม skeleton ตามปกติ
 */
export default async function LookDetailPage({ params }: PageProps) {
  const { slug } = await params;
  const loaded = await loadLook(slug);

  if (loaded.kind === "missing") {
    notFound();
  }

  if (loaded.kind === "error") {
    return (
      <main className="mx-auto w-full max-w-[1200px] px-4 py-10 sm:px-6">
        <SectionError message={loaded.message} />
      </main>
    );
  }

  const { look } = loaded;

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 sm:py-10">
      <nav aria-label="เส้นทางนำทาง" className="flex flex-wrap items-center gap-1 text-xs">
        <Link href="/" className="text-muted transition hover:text-brand">
          หน้าแรก
        </Link>
        <ChevronRight className="size-3 shrink-0 text-muted-light" aria-hidden />
        <Link href="/looks" className="text-muted transition hover:text-brand">
          Look Ideas
        </Link>
        <ChevronRight className="size-3 shrink-0 text-muted-light" aria-hidden />
        <Link
          href={`/looks?style=${look.style}`}
          className="text-muted transition hover:text-brand"
        >
          {styleShort(look.style)}
        </Link>
        <ChevronRight className="size-3 shrink-0 text-muted-light" aria-hidden />
        <span aria-current="page" className="font-bold text-ink">
          {look.name}
        </span>
      </nav>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,420px)_1fr] lg:gap-12">
        {/* ─── รูปลุค + สรุป ─── */}
        <div className="space-y-4">
          <div className="relative aspect-3/4 w-full overflow-hidden rounded-[var(--radius-card)] bg-lilac-50">
            {look.imageUrl ? (
              <Image
                src={look.imageUrl}
                alt={look.imageAlt ?? look.name}
                fill
                priority
                sizes="(max-width: 1024px) 100vw, 420px"
                className="object-cover"
              />
            ) : (
              <div className="grid size-full place-items-center text-5xl" aria-hidden>
                ✧
              </div>
            )}

            <span className="absolute top-3 left-3 rounded-[var(--radius-pill)] bg-white/90 px-3 py-1 text-xs font-bold text-brand-dark">
              {styleLabel(look.style)}
            </span>

            {look.isFeatured && (
              <span className="absolute top-3 right-3 flex items-center gap-1 rounded-[var(--radius-pill)] bg-brand/90 px-3 py-1 text-xs font-bold text-white">
                <Sparkles className="size-3" aria-hidden />
                แนะนำ
              </span>
            )}
          </div>

          <div className="rounded-[var(--radius-card)] border border-line bg-white p-4">
            <dl className="space-y-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted">ราคารวมทั้งลุค</dt>
                <dd className="text-xl font-extrabold text-brand-dark">
                  {formatBaht(look.totalPrice)}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted">จำนวนชิ้น</dt>
                <dd className="font-bold">
                  {look.availableItemCount}
                  {look.availableItemCount !== look.itemCount && (
                    <span className="text-warning"> / {look.itemCount} (เลิกขายบางชิ้น)</span>
                  )}
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-muted">สถานะ</dt>
                <dd
                  className={cn(
                    "flex items-center gap-1.5 font-bold",
                    look.allItemsAvailable ? "text-success" : "text-warning",
                  )}
                >
                  {look.allItemsAvailable ? (
                    <>
                      <Check className="size-4 shrink-0" aria-hidden />
                      ซื้อครบชุดได้
                    </>
                  ) : (
                    <>
                      <AlertTriangle className="size-4 shrink-0" aria-hidden />
                      ซื้อครบชุดไม่ได้
                    </>
                  )}
                </dd>
              </div>
            </dl>

            <p className="mt-3 flex items-center gap-1.5 border-t border-line pt-3 text-xs text-muted">
              <Eye className="size-3.5 shrink-0" aria-hidden />
              เปิดดู {look.viewCount.toLocaleString("th-TH")} ครั้ง
            </p>
          </div>
        </div>

        {/* ─── หัวข้อ + ตัวเลือกทั้งชุด ─── */}
        <div className="min-w-0 space-y-6">
          <header className="space-y-3">
            <h1 className="text-2xl leading-tight sm:text-3xl lg:text-4xl">{look.name}</h1>
            {look.description && (
              <p className="text-sm leading-relaxed text-muted">{look.description}</p>
            )}
            <p className="text-sm font-semibold">
              เลือกสีและไซซ์ของทุกชิ้น แล้วกดตรวจสต็อกทั้งชุดครั้งเดียว
            </p>
          </header>

          {look.items.length === 0 ? (
            <SectionEmpty
              message="ลุคนี้ยังไม่มีสินค้าที่เปิดขาย"
              hint="สินค้าในลุคอาจถูกปิดขายชั่วคราว ลองดูลุคอื่นได้ที่หน้า Look Ideas"
            />
          ) : (
            <LookBuilder look={look} />
          )}
        </div>
      </div>

      <div className="mt-14">
        <Suspense fallback={<RelatedSkeleton />}>
          <RelatedLooks style={look.style} excludeId={look.id} />
        </Suspense>
      </div>
    </main>
  );
}

/**
 * ลุคที่เกี่ยวข้อง — stream แยก ช้าหรือพังก็ไม่กระทบเนื้อหาหลัก
 *
 * ถ้าไม่มีลุคอื่นในสไตล์เดียวกัน จะแสดงลุคแนะนำอื่นแทน
 * **และเปลี่ยนหัวข้อให้ตรงกับสิ่งที่แสดงจริง** (ห้ามพาดหัวว่า "สไตล์เดียวกัน" แล้วเอาอย่างอื่นมาโชว์)
 */
async function RelatedLooks({ style, excludeId }: { style: string; excludeId: string }) {
  let items: Awaited<ReturnType<typeof searchLooks>>["items"] = [];
  let errorMessage: string | null = null;
  let sameStyle = true;

  try {
    const byStyle = await searchLooks(new URLSearchParams({ style, sort: "featured", limit: "5" }));
    items = byStyle.items.filter((look) => look.id !== excludeId).slice(0, 4);

    if (items.length === 0) {
      sameStyle = false;
      const anyLook = await searchLooks(new URLSearchParams({ sort: "featured", limit: "5" }));
      items = anyLook.items.filter((look) => look.id !== excludeId).slice(0, 4);
    }
  } catch (error) {
    errorMessage =
      error instanceof ApiClientError ? error.message : "โหลดลุคที่เกี่ยวข้องไม่สำเร็จ";
  }

  return (
    <section>
      <SectionHeader
        title={sameStyle ? `ลุคอื่นสไตล์ ${styleShort(style)}` : "ลุคอื่นที่น่าสนใจ"}
        subtitle={
          sameStyle
            ? "ไอเดียใกล้เคียงที่จัดไว้แล้วเหมือนกัน"
            : `ยังไม่มีลุคอื่นสไตล์ ${styleShort(style)} — นี่คือลุคแนะนำสไตล์อื่น`
        }
        action={{
          label: sameStyle ? "ดูทั้งหมดในสไตล์นี้" : "ดูลุคทั้งหมด",
          href: sameStyle ? `/looks?style=${style}` : "/looks",
        }}
      />

      {errorMessage !== null ? (
        <SectionError message={errorMessage} />
      ) : items.length === 0 ? (
        <SectionEmpty
          message="ยังไม่มีลุคอื่นในระบบ"
          hint="เพิ่มลุคได้ในระบบหลังบ้าน (STEP 48) หรือรัน npm run db:seed"
        />
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          {items.map((look) => (
            <LookCard key={look.id} look={look} detailHref={`/looks/${look.slug}`} />
          ))}
        </div>
      )}
    </section>
  );
}

function RelatedSkeleton() {
  return (
    <section aria-busy="true" aria-live="polite">
      <div className="mb-6">
        <h2 className="text-2xl sm:text-3xl">ลุคอื่นสไตล์เดียวกัน</h2>
        <p className="mt-2 text-sm text-muted">กำลังโหลดข้อมูล…</p>
      </div>
      <SectionSkeleton count={4} aspect="aspect-3/4" />
    </section>
  );
}
