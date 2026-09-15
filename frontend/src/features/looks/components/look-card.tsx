import { AlertTriangle, Check, ChevronDown, Sparkles } from "lucide-react";
import Image from "next/image";
import Link from "next/link";

import { styleShort } from "../lib/labels";

import { cn } from "@/lib/utils";
import type { LookCard as LookCardData, LookItemPreview } from "@/types/catalog";
import { formatBaht, STOCK_LABEL } from "@/utils/format";

/**
 * การ์ด Look — ใช้ร่วมกันทั้งหน้าแรกและหน้า /looks (STEP 7)
 *
 * ราคารวม จำนวนชิ้น และสถานะ "ซื้อครบชุดได้" มาจาก backend ทั้งหมด
 * (ห้ามบวกราคาหรือเดาสถานะสต็อกฝั่ง client)
 *
 * `detailHref` ใส่เมื่อมีหน้าปลายทางจริงเท่านั้น (ตอนนี้คือ `/looks/[slug]` — STEP 8)
 * ถ้าไม่ส่งมา การ์ดจะไม่เป็นลิงก์ เพื่อไม่ให้พาไปหน้า 404
 */
export function LookCard({
  look,
  detailHref,
  showItems = false,
}: {
  look: LookCardData;
  detailHref?: string;
  showItems?: boolean;
}) {
  const missingCount = look.itemCount - look.availableItemCount;
  const outOfStockCount = look.items.filter((item) => item.stockStatus === "OUT_OF_STOCK").length;

  return (
    <article className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-soft)] transition hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]">
      <CardImage look={look} detailHref={detailHref} />

      <div className="flex flex-1 flex-col gap-2 p-4">
        <h3 className="font-extrabold">
          {detailHref ? (
            <Link href={detailHref} className="transition hover:text-brand">
              {look.name}
            </Link>
          ) : (
            look.name
          )}
        </h3>

        {look.description && (
          <p className="line-clamp-2 text-xs leading-relaxed text-muted">{look.description}</p>
        )}

        <p className="text-xs text-muted">
          {look.availableItemCount} ชิ้นในลุคนี้
          {missingCount > 0 && (
            <span className="text-warning"> · เลิกขายแล้ว {missingCount} ชิ้น</span>
          )}
        </p>

        <p
          className={cn(
            "flex items-center gap-1.5 text-xs font-bold",
            look.allItemsAvailable ? "text-success" : "text-warning",
          )}
        >
          {look.allItemsAvailable ? (
            <>
              <Check className="size-3.5 shrink-0" aria-hidden />
              ซื้อครบชุดได้
            </>
          ) : (
            <>
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              {outOfStockCount > 0 ? `สินค้าหมด ${outOfStockCount} ชิ้น` : "ซื้อครบชุดไม่ได้"}
            </>
          )}
        </p>

        <p className="mt-auto pt-2 text-sm font-extrabold text-brand-dark">
          รวม {formatBaht(look.totalPrice)}
        </p>

        {showItems && look.items.length > 0 && <LookItems items={look.items} />}
      </div>
    </article>
  );
}

function CardImage({ look, detailHref }: { look: LookCardData; detailHref?: string }) {
  const badges = (
    <>
      <span className="absolute top-3 left-3 rounded-[var(--radius-pill)] bg-white/90 px-2.5 py-1 text-xs font-bold text-brand-dark">
        {styleShort(look.style)}
      </span>
      {look.isFeatured && (
        <span className="absolute top-3 right-3 flex items-center gap-1 rounded-[var(--radius-pill)] bg-brand/90 px-2.5 py-1 text-xs font-bold text-white">
          <Sparkles className="size-3" aria-hidden />
          แนะนำ
        </span>
      )}
    </>
  );

  const picture = look.imageUrl ? (
    <Image
      src={look.imageUrl}
      alt={look.imageAlt ?? look.name}
      fill
      sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
      className="object-cover transition duration-500 group-hover:scale-105"
    />
  ) : (
    <div className="grid size-full place-items-center text-4xl" aria-hidden>
      ✧
    </div>
  );

  if (detailHref) {
    return (
      <Link href={detailHref} className="relative block aspect-3/4 overflow-hidden bg-lilac-50">
        {picture}
        {badges}
      </Link>
    );
  }

  return (
    <div className="relative aspect-3/4 overflow-hidden bg-lilac-50">
      {picture}
      {badges}
    </div>
  );
}

/**
 * รายการสินค้าในลุค — ใช้ <details> จึงพับ/ขยายได้โดยไม่ต้องมี JavaScript
 * ทุกชิ้นลิงก์ไปหน้าสินค้าจริงที่มีอยู่แล้ว (STEP 6)
 */
function LookItems({ items }: { items: LookItemPreview[] }) {
  return (
    <details className="group/items mt-2 border-t border-line pt-3">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-xs font-bold text-brand">
        ดูสินค้าในลุคนี้ ({items.length} ชิ้น)
        <ChevronDown
          className="size-4 shrink-0 transition group-open/items:rotate-180"
          aria-hidden
        />
      </summary>

      <ul className="mt-3 space-y-3">
        {items.map((item) => (
          <li key={item.productId}>
            <Link
              href={`/product/${item.slug}`}
              className="flex items-center gap-3 rounded-[12px] p-1 transition hover:bg-lilac-50"
            >
              <span className="relative size-14 shrink-0 overflow-hidden rounded-[10px] bg-lilac-50">
                {item.image ? (
                  <Image
                    src={item.image.url}
                    alt={item.image.alt}
                    fill
                    sizes="56px"
                    className="object-cover"
                  />
                ) : (
                  <span className="grid size-full place-items-center text-lg" aria-hidden>
                    ✧
                  </span>
                )}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold">{item.name}</span>
                <span className="block text-xs text-muted">
                  {formatBaht(item.finalPrice)}
                  {item.suggested?.size && ` · ไซซ์ ${item.suggested.size}`}
                  {item.suggested?.color && ` · ${item.suggested.color}`}
                </span>
                <span
                  className={cn(
                    "block text-[11px] font-semibold",
                    item.stockStatus === "IN_STOCK" && "text-success",
                    item.stockStatus === "LOW_STOCK" && "text-warning",
                    item.stockStatus === "OUT_OF_STOCK" && "text-muted-light",
                  )}
                >
                  {STOCK_LABEL[item.stockStatus]}
                </span>
              </span>
            </Link>

            {item.note && <p className="mt-1 pl-[68px] text-[11px] text-muted">{item.note}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}
