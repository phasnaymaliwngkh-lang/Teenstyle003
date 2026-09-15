import Image from "next/image";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { ProductCard as ProductCardData } from "@/types/catalog";
import { formatBaht, STOCK_LABEL } from "@/utils/format";

const STOCK_STYLE = {
  IN_STOCK: "text-success",
  LOW_STOCK: "text-warning",
  OUT_OF_STOCK: "text-muted-light",
} as const;

/**
 * การ์ดสินค้า — ใช้ร่วมกันทุกที่ที่แสดงรายการสินค้า (หน้าแรก, /shop, ผลค้นหา, AI)
 *
 * ราคาและสถานะสต็อกมาจาก backend ทั้งหมด ไม่คำนวณซ้ำฝั่ง client
 * (SECURITY REQUIREMENT: ห้ามเชื่อ/คำนวณราคาและสต็อกฝั่ง client)
 *
 * ลิงก์ไป /product/[slug] ซึ่งจะสร้างใน STEP 6
 */
export function ProductCard({ product }: { product: ProductCardData }) {
  const isOutOfStock = product.stockStatus === "OUT_OF_STOCK";

  return (
    <article className="group flex flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-soft)] transition hover:-translate-y-1 hover:shadow-[var(--shadow-lift)]">
      <Link
        href={`/product/${product.slug}`}
        className="relative block aspect-4/5 overflow-hidden bg-lilac-50"
      >
        {product.image ? (
          <Image
            src={product.image.url}
            alt={product.image.alt}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
            className="object-cover transition duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center text-4xl" aria-hidden>
            ✧
          </div>
        )}

        {product.discountPercent !== null && (
          <span className="absolute top-3 left-3 rounded-[var(--radius-pill)] bg-danger px-2.5 py-1 text-xs font-bold text-white">
            -{product.discountPercent}%
          </span>
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

        <div className="mt-auto flex flex-wrap items-baseline gap-2 pt-2">
          <span className="text-lg font-extrabold text-brand-dark">
            {formatBaht(product.finalPrice)}
          </span>
          {product.salePrice !== null && (
            <s className="text-xs text-muted-light">{formatBaht(product.price)}</s>
          )}
        </div>
      </div>
    </article>
  );
}
