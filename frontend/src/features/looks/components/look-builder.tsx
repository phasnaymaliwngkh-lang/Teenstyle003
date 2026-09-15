"use client";

import { AlertTriangle, Check, Loader2, ShoppingBag } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  findVariant,
  firstColorFor,
  firstSizeFor,
  hasStockForColor,
  pickPreferredVariant,
} from "@/features/products/lib/variant";
import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { addLookToCart } from "@/services/cart.service";
import { checkLookAvailability } from "@/services/catalog.service";
import type {
  AddLookToCartResult,
  LookAvailabilityResult,
  LookDetail,
  LookDetailItem,
  ProductVariant,
} from "@/types/catalog";
import { formatBaht, STOCK_LABEL } from "@/utils/format";

const REASON_MESSAGE = {
  OUT_OF_STOCK: "ตัวเลือกนี้หมดแล้ว",
  INSUFFICIENT_STOCK: "จำนวนที่เลือกมากกว่าที่มีในคลัง",
  NOT_IN_LOOK: "ตัวเลือกนี้ไม่ได้อยู่ในลุคนี้",
  PRODUCT_UNAVAILABLE: "สินค้าชิ้นนี้ไม่เปิดขายแล้ว",
} as const;

type Pick = { colorSlug: string | null; sizeCode: string | null };

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "blocked"; result: LookAvailabilityResult }
  | { kind: "added"; result: AddLookToCartResult }
  | { kind: "error"; message: string };

/**
 * เลือกสี/ไซซ์ของสินค้าทุกชิ้นในลุค แล้วตรวจ "ซื้อทั้งชุด" กับ server ครั้งเดียว (STEP 8)
 *
 * ⚠️ ยอดรวมที่โชว์ก่อนกดตรวจเป็นเพียงการประมาณจากราคาที่ backend ส่งมา
 *    ยอดที่ถือเป็นจริงคือยอดที่ได้จาก POST /api/looks/:slug/availability
 *    (SECURITY REQUIREMENT: ห้าม Trust Client-side Price / Stock)
 *
 * ไม่มี useEffect — การรีเซ็ตตัวเลือกทำใน event handler ทั้งหมด
 */
export function LookBuilder({ look }: { look: LookDetail }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [picks, setPicks] = useState<Record<string, Pick>>(() => initialPicks(look.items));
  const [state, setState] = useState<CheckState>({ kind: "idle" });

  const resolved = look.items.map((item) => {
    const pick = picks[item.productId] ?? { colorSlug: null, sizeCode: null };
    return { item, variant: findVariant(item.variants, pick.colorSlug, pick.sizeCode) };
  });

  const selected = resolved.filter(
    (row): row is { item: LookDetailItem; variant: ProductVariant } => row.variant !== null,
  );
  const buyable = selected.filter((row) => row.variant.available > 0);
  const estimatedTotal = buyable.reduce((sum, row) => sum + row.variant.finalPrice, 0);
  const readyToCheck = buyable.length > 0;
  const completeSet = buyable.length === look.items.length && look.items.length === look.itemCount;

  function choose(productId: string, next: Pick) {
    setPicks((current) => ({ ...current, [productId]: next }));
    // ผลตรวจเดิมใช้ไม่ได้อีกเมื่อเปลี่ยนตัวเลือก
    setState({ kind: "idle" });
  }

  function selectColor(item: LookDetailItem, colorSlug: string) {
    const pick = picks[item.productId] ?? { colorSlug: null, sizeCode: null };
    const sizeCode =
      findVariant(item.variants, colorSlug, pick.sizeCode) === null
        ? firstSizeFor(item.variants, colorSlug)
        : pick.sizeCode;

    choose(item.productId, { colorSlug, sizeCode });
  }

  function selectSize(item: LookDetailItem, sizeCode: string) {
    const pick = picks[item.productId] ?? { colorSlug: null, sizeCode: null };
    const colorSlug =
      findVariant(item.variants, pick.colorSlug, sizeCode) === null
        ? firstColorFor(item.variants, sizeCode)
        : pick.colorSlug;

    choose(item.productId, { colorSlug, sizeCode });
  }

  /**
   * ตรวจทั้งชุดกับ server แล้วเพิ่มลงตะกร้าจริง (STEP 8 → 9)
   *
   * ส่งไปแค่ variantId + จำนวน · ถ้ายังซื้อครบชุดไม่ได้จะ **ไม่เพิ่มอะไรลงตะกร้าเลย**
   * เพื่อไม่ให้ผู้ใช้ได้ของครึ่ง ๆ กลาง ๆ โดยไม่รู้ตัว
   */
  async function verifySet() {
    if (!readyToCheck) return;

    const selections = buyable.map((row) => ({ variantId: row.variant.id, quantity: 1 }));
    setState({ kind: "checking" });

    try {
      const check = await checkLookAvailability(look.slug, selections);

      if (!check.purchasable) {
        setState({ kind: "blocked", result: check });
        return;
      }

      const added = await addLookToCart(look.slug, selections);

      setState({ kind: "added", result: added });
      // ให้ตัวเลขบน navbar (Server Component) อัปเดตตาม
      startTransition(() => router.refresh());
    } catch (error) {
      setState({
        kind: "error",
        message:
          error instanceof ApiClientError
            ? error.message
            : "ตรวจสอบสต็อกไม่สำเร็จ กรุณาลองอีกครั้ง",
      });
    }
  }

  return (
    <div className="space-y-6">
      <ol className="space-y-4">
        {resolved.map(({ item, variant }, index) => (
          <li
            key={item.productId}
            className="rounded-[var(--radius-card)] border border-line bg-white p-4"
          >
            <div className="flex gap-4">
              <Link
                href={`/product/${item.slug}`}
                className="relative size-24 shrink-0 overflow-hidden rounded-[12px] bg-lilac-50"
              >
                {item.image ? (
                  <Image
                    src={item.image.url}
                    alt={item.image.alt}
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                ) : (
                  <span className="grid size-full place-items-center text-2xl" aria-hidden>
                    ✧
                  </span>
                )}
              </Link>

              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-bold tracking-wider text-brand-soft uppercase">
                  ชิ้นที่ {index + 1} · {item.brand?.name ?? item.category.name}
                </p>
                <h3 className="mt-0.5 text-sm leading-snug font-bold">
                  <Link href={`/product/${item.slug}`} className="transition hover:text-brand">
                    {item.name}
                  </Link>
                </h3>

                <p className="mt-1 flex flex-wrap items-baseline gap-2">
                  <span className="text-base font-extrabold text-brand-dark">
                    {formatBaht(variant?.finalPrice ?? item.finalPrice)}
                  </span>
                  {item.salePrice !== null && (
                    <s className="text-xs text-muted-light">{formatBaht(item.price)}</s>
                  )}
                  <span
                    className={cn(
                      "text-xs font-semibold",
                      item.stockStatus === "IN_STOCK" && "text-success",
                      item.stockStatus === "LOW_STOCK" && "text-warning",
                      item.stockStatus === "OUT_OF_STOCK" && "text-muted-light",
                    )}
                  >
                    {STOCK_LABEL[item.stockStatus]}
                  </span>
                </p>

                {item.note && <p className="mt-1 text-xs text-muted">💡 {item.note}</p>}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {item.colors.length > 0 && (
                <fieldset>
                  <legend className="mb-1.5 text-xs font-extrabold">
                    สี{" "}
                    {variant?.color && (
                      <span className="font-semibold text-muted">— {variant.color.name}</span>
                    )}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {item.colors.map((color) => {
                      const active = color.slug === (picks[item.productId]?.colorSlug ?? null);
                      const soldOut = !hasStockForColor(item.variants, color.slug);

                      return (
                        <button
                          key={color.slug}
                          type="button"
                          onClick={() => selectColor(item, color.slug)}
                          aria-pressed={active}
                          className={cn(
                            "flex min-h-11 items-center gap-1.5 rounded-[var(--radius-pill)] border px-3 text-xs font-semibold transition",
                            active
                              ? "border-brand bg-lilac text-brand-dark"
                              : "border-line hover:border-brand-soft hover:bg-lilac-50",
                            soldOut && "opacity-50",
                          )}
                        >
                          <span
                            aria-hidden
                            className="size-3.5 rounded-full border border-line"
                            style={{ backgroundColor: color.hex }}
                          />
                          {color.name}
                          {soldOut && <span className="text-muted">(หมด)</span>}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              {item.sizes.length > 0 && (
                <fieldset>
                  <legend className="mb-1.5 text-xs font-extrabold">
                    ไซซ์{" "}
                    {variant?.size && (
                      <span className="font-semibold text-muted">— {variant.size.name}</span>
                    )}
                  </legend>
                  <div className="flex flex-wrap gap-2">
                    {item.sizes.map((size) => {
                      const active = size.code === (picks[item.productId]?.sizeCode ?? null);
                      const candidate = findVariant(
                        item.variants,
                        picks[item.productId]?.colorSlug ?? null,
                        size.code,
                      );
                      const soldOut = candidate === null || candidate.available === 0;

                      return (
                        <button
                          key={size.code}
                          type="button"
                          onClick={() => selectSize(item, size.code)}
                          aria-pressed={active}
                          className={cn(
                            "grid min-h-11 min-w-11 place-items-center rounded-[12px] border px-3 text-xs font-bold transition",
                            active
                              ? "border-brand bg-brand text-white"
                              : "border-line hover:border-brand-soft hover:bg-lilac-50",
                            soldOut && !active && "text-muted-light line-through",
                          )}
                        >
                          {size.name}
                        </button>
                      );
                    })}
                  </div>
                </fieldset>
              )}

              <p className="text-xs">
                {variant === null ? (
                  <span className="font-semibold text-warning">
                    ไม่มีตัวเลือกนี้ — เลือกสีหรือไซซ์อื่น
                  </span>
                ) : variant.available === 0 ? (
                  <span className="font-semibold text-warning">
                    ตัวเลือกนี้หมด (SKU {variant.sku})
                  </span>
                ) : (
                  <span className="text-muted">
                    SKU {variant.sku} · เหลือ {variant.available} ชิ้น
                  </span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ol>

      {/* ─── สรุป + ปุ่มตรวจทั้งชุด ─── */}
      <div className="rounded-[var(--radius-card)] border border-line bg-lilac-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-extrabold">
              เลือกแล้ว {buyable.length} / {look.itemCount} ชิ้น
            </p>
            <p className="mt-0.5 text-xs text-muted">
              ยอดประมาณ {formatBaht(estimatedTotal)} — ยอดจริงยืนยันโดยเซิร์ฟเวอร์ตอนกดตรวจ
            </p>
          </div>

          {!completeSet && (
            <p className="flex items-center gap-1.5 text-xs font-bold text-warning">
              <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
              ยังเลือกไม่ครบทุกชิ้น
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={verifySet}
          disabled={!readyToCheck || state.kind === "checking"}
          className={cn(
            "mt-4 flex min-h-13 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-base font-bold transition",
            readyToCheck
              ? "btn-brand"
              : "cursor-not-allowed border border-line bg-white text-muted-light",
            state.kind === "checking" && "opacity-80",
          )}
        >
          {state.kind === "checking" ? (
            <>
              <Loader2 className="size-5 animate-spin" aria-hidden />
              กำลังตรวจสต็อกและเพิ่มทั้งชุด…
            </>
          ) : (
            <>
              <ShoppingBag className="size-5" aria-hidden />
              {readyToCheck ? "เพิ่มทั้งชุดลงตะกร้า" : "ยังเลือกไม่ได้ — สินค้าหมด"}
            </>
          )}
        </button>
      </div>

      {/* ─── ผลจากเซิร์ฟเวอร์ ─── */}
      <div aria-live="polite">
        {state.kind === "added" && <AddedResult result={state.result} />}

        {state.kind === "blocked" && <SetResult result={state.result} />}

        {state.kind === "error" && (
          <div
            role="alert"
            className="rounded-[var(--radius-card)] border border-danger/25 bg-danger/5 p-4"
          >
            <p className="flex items-center gap-2 text-sm font-bold text-danger">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              ตรวจสอบสต็อกไม่สำเร็จ
            </p>
            <p className="mt-1.5 text-sm break-words text-ink-soft">{state.message}</p>
            <button
              type="button"
              onClick={verifySet}
              className="mt-3 min-h-11 rounded-[var(--radius-pill)] border border-danger/30 px-5 text-sm font-bold text-danger transition hover:bg-danger/10"
            >
              ลองอีกครั้ง
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/** เพิ่มทั้งชุดลงตะกร้าสำเร็จ — ตัวเลขทุกตัวมาจากตะกร้าที่ server ส่งกลับ */
function AddedResult({ result }: { result: AddLookToCartResult }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-success/25 bg-success/5 p-4">
      <p className="flex items-center gap-2 text-sm font-bold text-success">
        <Check className="size-4 shrink-0" aria-hidden />
        เพิ่มทั้งชุดลงตะกร้าแล้ว {result.addedCount} ชิ้น
      </p>

      <p className="mt-1.5 text-sm text-ink-soft">
        ในตะกร้ามี {result.cart.summary.totalQuantity} ชิ้น · ยอดรวม{" "}
        {formatBaht(result.cart.summary.subtotal)}
      </p>

      {result.skipped.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs font-semibold text-warning">
          {result.skipped.map((item) => (
            <li key={item.variantId}>ข้าม 1 ชิ้น: {item.reason}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href="/cart"
          className="btn-brand flex min-h-11 items-center rounded-[var(--radius-pill)] px-5 text-sm font-bold transition"
        >
          ไปที่ตะกร้า
        </Link>
        <Link
          href="/looks"
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-5 text-sm font-semibold transition hover:border-brand-soft"
        >
          ดูลุคอื่น
        </Link>
      </div>
    </div>
  );
}

/** ผลตรวจทั้งชุดจาก server — ทุกตัวเลขในนี้มาจาก server ไม่ใช่คำนวณซ้ำที่ client */
function SetResult({ result }: { result: LookAvailabilityResult }) {
  return (
    <div
      role={result.purchasable ? undefined : "alert"}
      className={cn(
        "rounded-[var(--radius-card)] border p-4",
        result.purchasable ? "border-success/25 bg-success/5" : "border-warning/30 bg-warning/5",
      )}
    >
      <p
        className={cn(
          "flex items-center gap-2 text-sm font-bold",
          result.purchasable ? "text-success" : "text-warning",
        )}
      >
        {result.purchasable ? (
          <>
            <Check className="size-4 shrink-0" aria-hidden />
            เซิร์ฟเวอร์ยืนยันว่าซื้อทั้งชุดได้ · รวม {formatBaht(result.totalPrice)}
          </>
        ) : (
          <>
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            ยังซื้อทั้งชุดไม่ได้
          </>
        )}
      </p>

      <ul className="mt-3 space-y-1.5 text-sm text-ink-soft">
        {result.items.map((item) => (
          <li key={item.variantId} className="flex flex-wrap items-baseline gap-x-2">
            <span className={item.purchasable ? "text-success" : "text-warning"} aria-hidden>
              {item.purchasable ? "✓" : "!"}
            </span>
            <span className="font-semibold">{item.productName ?? item.variantId}</span>
            {item.color && <span className="text-xs text-muted">{item.color}</span>}
            {item.size && <span className="text-xs text-muted">ไซซ์ {item.size}</span>}
            {item.finalPrice !== null && (
              <span className="text-xs text-muted">{formatBaht(item.finalPrice)}</span>
            )}
            {!item.purchasable && (
              <span className="text-xs font-semibold text-warning">
                — {item.reason ? REASON_MESSAGE[item.reason] : "ซื้อไม่ได้"}
                {item.reason === "INSUFFICIENT_STOCK" && ` (เหลือ ${item.available} ชิ้น)`}
              </span>
            )}
          </li>
        ))}
      </ul>

      {result.missingProducts.length > 0 && (
        <p className="mt-3 text-sm text-warning">
          ยังไม่ได้เลือกตัวเลือกของ:{" "}
          {result.missingProducts.map((product, index) => (
            <span key={product.productId}>
              {index > 0 && ", "}
              <Link href={`/product/${product.slug}`} className="font-bold underline">
                {product.name}
              </Link>
            </span>
          ))}
        </p>
      )}

      <p className="mt-3 text-xs text-muted">
        ยังไม่มีอะไรถูกเพิ่มลงตะกร้า — แก้ตัวเลือกตามรายการด้านบนแล้วกดอีกครั้ง
      </p>
    </div>
  );
}

/** ตัวเลือกเริ่มต้นของแต่ละชิ้น — เคารพ variant ที่ลุคแนะนำไว้ถ้ายังมีของ */
function initialPicks(items: LookDetailItem[]): Record<string, Pick> {
  const picks: Record<string, Pick> = {};

  for (const item of items) {
    const variant = pickPreferredVariant(item.variants, item.suggestedVariantId);
    picks[item.productId] = {
      colorSlug: variant?.color?.slug ?? null,
      sizeCode: variant?.size?.code ?? null,
    };
  }

  return picks;
}
