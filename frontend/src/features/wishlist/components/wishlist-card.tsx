"use client";

import { Check, Heart, Loader2, ShoppingBag, SlidersHorizontal, TrendingDown } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { addToCart } from "@/services/cart.service";
import { removeFromWishlist, setWishlistNotify } from "@/services/wishlist.service";
import { cn } from "@/lib/utils";
import type { WishlistItem } from "@/types/catalog";
import { formatBaht, STOCK_LABEL } from "@/utils/format";

const STOCK_STYLE = {
  IN_STOCK: "text-success",
  LOW_STOCK: "text-warning",
  OUT_OF_STOCK: "text-muted-light",
} as const;

/**
 * การ์ดในหน้ารายการที่ถูกใจ (STEP 22)
 *
 * ต่างจาก `ProductCard` ตรงที่มีปุ่มจัดการ (เอาออก · เพิ่มลงตะกร้า · เตือนเมื่อลดราคา)
 * จึงต้องเป็น client component — ส่วนราคา/สต็อก/ป้ายราคาลด **คำนวณมาจาก backend ทั้งหมด**
 *
 * ⚠️ ปุ่ม "เพิ่มลงตะกร้า" โผล่เฉพาะเมื่อ backend ยืนยันว่ามีตัวเลือกที่ซื้อได้เพียงตัวเดียว
 *    สินค้าหลายสี/ไซซ์ต้องพาไปเลือกที่หน้าสินค้า **ห้ามเดาตัวเลือกให้ลูกค้า**
 *    และการกดเพิ่มยังต้องผ่านการตรวจสต็อกของ `/api/cart/items` อีกชั้นอยู่ดี
 */
export function WishlistCard({ item }: { item: WishlistItem }) {
  const router = useRouter();
  const { product } = item;

  const [removing, setRemoving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState(false);
  const [notify, setNotify] = useState(item.notifyOnPriceDrop);
  const [error, setError] = useState<string | null>(null);

  const isOutOfStock = product.stockStatus === "OUT_OF_STOCK";
  const canQuickAdd = item.quickAddVariantId !== null && !isOutOfStock;

  const handleRemove = async () => {
    if (removing) return;
    setRemoving(true);
    setError(null);

    try {
      await removeFromWishlist(product.id);
      // ให้ Server Component ดึงรายการใหม่ ยอดสรุปด้านบนจะได้ตรงกับของจริง
      router.refresh();
    } catch {
      setError("เอาออกจากรายการไม่สำเร็จ กรุณาลองใหม่");
      setRemoving(false);
    }
  };

  const handleAddToCart = async () => {
    if (!item.quickAddVariantId || adding) return;
    setAdding(true);
    setError(null);

    try {
      await addToCart(item.quickAddVariantId, 1);
      setAdded(true);
      router.refresh();
    } catch {
      setError("เพิ่มลงตะกร้าไม่สำเร็จ — สินค้าอาจหมดพอดี ลองเปิดหน้าสินค้าอีกครั้ง");
    } finally {
      setAdding(false);
    }
  };

  const handleToggleNotify = async () => {
    const next = !notify;
    setNotify(next);
    setError(null);

    try {
      await setWishlistNotify(product.id, next);
    } catch {
      setNotify(!next); // คืนสวิตช์กลับ ไม่ให้ UI โกหกว่าบันทึกแล้ว
      setError("บันทึกการตั้งค่าแจ้งเตือนไม่สำเร็จ");
    }
  };

  return (
    <article
      className={cn(
        "group flex h-full flex-col overflow-hidden rounded-[var(--radius-card)] border bg-white shadow-[var(--shadow-soft)] transition",
        item.priceDrop ? "border-success/30" : "border-line",
        removing && "opacity-50",
      )}
    >
      <Link
        href={`/product/${product.slug}`}
        className="relative block aspect-4/5 overflow-hidden bg-lilac-50"
      >
        {product.image ? (
          <Image
            src={product.image.url}
            alt={product.image.alt}
            fill
            sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center text-4xl" aria-hidden>
            ✧
          </div>
        )}

        {item.priceDrop ? (
          <span className="absolute top-3 left-3 flex items-center gap-1 rounded-[var(--radius-pill)] bg-success px-2.5 py-1 text-xs font-bold text-white">
            <TrendingDown className="size-3.5" aria-hidden />
            ถูกลง {formatBaht(item.priceDrop.amount)}
          </span>
        ) : (
          product.discountPercent !== null && (
            <span className="absolute top-3 left-3 rounded-[var(--radius-pill)] bg-danger px-2.5 py-1 text-xs font-bold text-white">
              -{product.discountPercent}%
            </span>
          )
        )}

        {isOutOfStock && (
          <span className="absolute inset-0 grid place-items-center bg-white/70 text-sm font-bold text-ink">
            สินค้าหมด
          </span>
        )}
      </Link>

      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <p className="text-[11px] font-bold tracking-wider text-brand-soft uppercase">
          {product.brand?.name ?? product.category.name}
        </p>

        <h3 className="text-sm leading-snug font-bold">
          <Link href={`/product/${product.slug}`} className="transition hover:text-brand">
            {product.name}
          </Link>
        </h3>

        <p className={cn("text-xs font-semibold", STOCK_STYLE[product.stockStatus])}>
          {STOCK_LABEL[product.stockStatus]}
        </p>

        <div className="mt-2 flex flex-wrap items-baseline gap-2">
          <span className="text-lg font-extrabold text-brand-dark">
            {formatBaht(product.finalPrice)}
          </span>
          {product.salePrice !== null && (
            <s className="text-xs text-muted-light">{formatBaht(product.price)}</s>
          )}
        </div>

        {item.priceDrop ? (
          <p className="text-xs font-semibold text-success">
            ถูกลง {item.priceDrop.percent}% จาก {formatBaht(item.priceWhenAdded)} ตอนที่คุณกดถูกใจ
          </p>
        ) : (
          <p className="text-xs text-muted">ราคาตอนกดถูกใจ {formatBaht(item.priceWhenAdded)}</p>
        )}

        {/* ─── ปุ่มจัดการ ─────────────────────────────────────────────────── */}
        <div className="mt-auto space-y-2 pt-3">
          {canQuickAdd ? (
            <button
              type="button"
              onClick={() => void handleAddToCart()}
              disabled={adding || removing}
              className="btn-brand flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] px-4 text-sm font-bold transition disabled:opacity-50"
            >
              {adding ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : added ? (
                <Check className="size-4" aria-hidden />
              ) : (
                <ShoppingBag className="size-4" aria-hidden />
              )}
              {added ? "อยู่ในตะกร้าแล้ว" : "เพิ่มลงตะกร้า"}
            </button>
          ) : (
            <Link
              href={`/product/${product.slug}`}
              className={cn(
                "flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] border px-4 text-sm font-semibold transition",
                isOutOfStock
                  ? "border-line text-muted hover:bg-lilac-50"
                  : "border-brand-soft text-brand-dark hover:bg-lilac-50",
              )}
            >
              <SlidersHorizontal className="size-4" aria-hidden />
              {isOutOfStock
                ? "ดูรายละเอียดสินค้า"
                : item.activeVariantCount > 1
                  ? "เลือกสี / ไซซ์"
                  : "ดูรายละเอียดสินค้า"}
            </Link>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleToggleNotify()}
              aria-pressed={notify}
              className={cn(
                "flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition",
                notify
                  ? "border-brand-soft bg-lilac-50 text-brand-dark"
                  : "border-line text-muted hover:bg-lilac-50",
              )}
            >
              <TrendingDown className="size-3.5" aria-hidden />
              {notify ? "เตือนเมื่อลดราคา" : "ไม่เตือน"}
            </button>

            <button
              type="button"
              onClick={() => void handleRemove()}
              disabled={removing}
              aria-label={`เอา ${product.name} ออกจากรายการที่ถูกใจ`}
              className="grid size-11 shrink-0 place-items-center rounded-[var(--radius-pill)] border border-line text-muted transition hover:border-danger/30 hover:bg-danger/5 hover:text-danger disabled:opacity-50"
            >
              {removing ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Heart className="size-4 fill-current" aria-hidden />
              )}
            </button>
          </div>

          {error !== null && (
            <p role="alert" className="text-xs font-semibold text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </article>
  );
}
