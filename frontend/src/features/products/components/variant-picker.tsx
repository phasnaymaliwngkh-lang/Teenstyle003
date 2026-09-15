"use client";

import { AlertTriangle, Check, Loader2, Minus, Plus, ShoppingBag } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  findVariant,
  firstColorFor,
  firstSizeFor,
  hasStockForColor,
  pickInitialVariant,
} from "../lib/variant";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { checkAvailability } from "@/services/catalog.service";
import { addToCart } from "@/services/cart.service";
import type { AvailabilityResult, Cart, ProductDetail } from "@/types/catalog";
import { formatBaht, STOCK_LABEL } from "@/utils/format";

const REASON_MESSAGE = {
  OUT_OF_STOCK: "สินค้าตัวเลือกนี้หมดแล้ว",
  INSUFFICIENT_STOCK: "จำนวนที่เลือกมากกว่าที่มีในคลัง",
} as const;

type CheckState =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "added"; result: AvailabilityResult; cart: Cart }
  | { kind: "unavailable"; result: AvailabilityResult }
  | { kind: "error"; message: string };

/**
 * ตัวเลือกสินค้า: สี → ไซซ์ → จำนวน (STEP 6)
 *
 * ความจริงเรื่องสต็อกอยู่ที่ backend เท่านั้น
 * ค่า `available` ที่ส่งมากับหน้านี้ใช้แค่ "จำกัด input ล่วงหน้า" เพื่อ UX
 * แต่ก่อนจะเพิ่มลงตะกร้าต้องถาม POST /api/products/availability ทุกครั้ง
 * (SECURITY REQUIREMENT: ห้าม Trust Client-side Stock / Client-side Price)
 *
 * ไม่มี useEffect เลย — การรีเซ็ตไซซ์/จำนวนเมื่อเปลี่ยนตัวเลือก ทำใน event handler
 */
export function VariantPicker({ product }: { product: ProductDetail }) {
  const initial = pickInitialVariant(product.variants);
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [colorSlug, setColorSlug] = useState<string | null>(initial?.color?.slug ?? null);
  const [sizeCode, setSizeCode] = useState<string | null>(initial?.size?.code ?? null);
  const [quantity, setQuantity] = useState(1);
  const [state, setState] = useState<CheckState>({ kind: "idle" });

  const selected = findVariant(product.variants, colorSlug, sizeCode);
  // ถ้ายังเลือกไม่ครบ ใช้ยอดรวมของสินค้าเป็นค่าที่แสดง
  const available = selected?.available ?? 0;
  const maxQuantity = Math.max(1, available);
  const canBuy = selected !== null && available > 0;

  /** เปลี่ยนตัวเลือกแล้วผลตรวจเดิมใช้ไม่ได้อีก */
  function selectColor(nextColor: string) {
    setColorSlug(nextColor);
    // ไซซ์เดิมอาจไม่มีในสีใหม่ → เลือกไซซ์ที่มีจริงให้
    if (findVariant(product.variants, nextColor, sizeCode) === null) {
      setSizeCode(firstSizeFor(product.variants, nextColor));
    }
    setQuantity(1);
    setState({ kind: "idle" });
  }

  function selectSize(nextSize: string) {
    setSizeCode(nextSize);
    if (findVariant(product.variants, colorSlug, nextSize) === null) {
      setColorSlug(firstColorFor(product.variants, nextSize));
    }
    setQuantity(1);
    setState({ kind: "idle" });
  }

  function changeQuantity(next: number) {
    // ห้ามติดลบ ห้ามเป็น 0 และห้ามเกินจำนวนที่มี
    setQuantity(Math.min(Math.max(1, Math.trunc(next) || 1), maxQuantity));
    setState({ kind: "idle" });
  }

  /**
   * ตรวจสต็อกกับเซิร์ฟเวอร์ แล้วเพิ่มลงตะกร้าจริง (STEP 9)
   *
   * ตรวจ 2 ชั้นโดยเจตนา:
   *   1. `POST /api/products/availability` — บอกผู้ใช้ได้ละเอียดว่าเพราะอะไรถึงซื้อไม่ได้
   *   2. `POST /api/cart/items` — ด่านจริง ตรวจสต็อกอีกครั้งในทรานแซกชันตอนเขียนลงตะกร้า
   * ถ้าสต็อกเปลี่ยนระหว่างสองขั้น ขั้นที่ 2 จะปฏิเสธและผู้ใช้เห็น error จริง ไม่ใช่ข้อมูลเก่า
   */
  async function verifyAndAdd() {
    if (!selected) return;

    setState({ kind: "checking" });

    try {
      const result = await checkAvailability(selected.id, quantity);

      if (!result.purchasable) {
        // เชื่อคำตอบของเซิร์ฟเวอร์ ไม่ใช่ค่าที่ถืออยู่ฝั่ง client
        setQuantity(Math.min(Math.max(1, quantity), Math.max(1, result.available)));
        setState({ kind: "unavailable", result });
        return;
      }

      const cart = await addToCart(selected.id, quantity);

      setState({ kind: "added", result, cart });
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
      {/* ─── สี ─── */}
      {product.colors.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-extrabold">
            สี{" "}
            {selected?.color && (
              <span className="font-semibold text-muted">— {selected.color.name}</span>
            )}
          </legend>
          <div className="flex flex-wrap gap-2">
            {product.colors.map((color) => {
              const active = color.slug === colorSlug;
              const soldOut = !hasStockForColor(product.variants, color.slug);

              return (
                <button
                  key={color.slug}
                  type="button"
                  onClick={() => selectColor(color.slug)}
                  aria-pressed={active}
                  className={cn(
                    "flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border px-3 text-sm font-semibold transition",
                    active
                      ? "border-brand bg-lilac text-brand-dark"
                      : "border-line hover:border-brand-soft hover:bg-lilac-50",
                    soldOut && "opacity-50",
                  )}
                >
                  <span
                    aria-hidden
                    className="size-4 rounded-full border border-line"
                    style={{ backgroundColor: color.hex }}
                  />
                  {color.name}
                  {soldOut && <span className="text-xs text-muted">(หมด)</span>}
                </button>
              );
            })}
          </div>
        </fieldset>
      )}

      {/* ─── ไซซ์ ─── */}
      {product.sizes.length > 0 && (
        <fieldset>
          <legend className="mb-2 text-sm font-extrabold">
            ไซซ์{" "}
            {selected?.size && (
              <span className="font-semibold text-muted">— {selected.size.name}</span>
            )}
          </legend>
          <div className="flex flex-wrap gap-2">
            {product.sizes.map((size) => {
              const active = size.code === sizeCode;
              const variant = findVariant(product.variants, colorSlug, size.code);
              // ไซซ์ที่ไม่มีในสีที่เลือก หรือหมด → กดได้แต่บอกให้รู้ว่าหมด
              const soldOut = variant === null || variant.available === 0;

              return (
                <button
                  key={size.code}
                  type="button"
                  onClick={() => selectSize(size.code)}
                  aria-pressed={active}
                  className={cn(
                    "relative grid min-h-11 min-w-11 place-items-center rounded-[12px] border px-3 text-sm font-bold transition",
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

      {/* ─── สถานะของตัวเลือกที่เลือก ─── */}
      <div className="rounded-[var(--radius-card)] border border-line bg-lilac-50 p-4">
        {selected === null ? (
          <p className="text-sm font-semibold text-warning">
            ไม่มีตัวเลือกนี้ในร้าน — กรุณาเลือกสีหรือไซซ์อื่น
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm">
                <span className="font-extrabold">{formatBaht(selected.finalPrice)}</span>
                {selected.salePrice !== null && (
                  <s className="ml-2 text-xs text-muted-light">{formatBaht(selected.price)}</s>
                )}
              </p>
              <p className="mt-0.5 text-xs text-muted">SKU {selected.sku}</p>
            </div>

            <p
              className={cn(
                "text-sm font-bold",
                selected.stockStatus === "IN_STOCK" && "text-success",
                selected.stockStatus === "LOW_STOCK" && "text-warning",
                selected.stockStatus === "OUT_OF_STOCK" && "text-muted-light",
              )}
            >
              {STOCK_LABEL[selected.stockStatus]}
              {available > 0 && <span className="font-semibold"> · เหลือ {available} ชิ้น</span>}
            </p>
          </div>
        )}
      </div>

      {/* ─── จำนวน ─── */}
      <div className="flex flex-wrap items-center gap-4">
        <span className="text-sm font-extrabold">จำนวน</span>

        <div className="flex items-center gap-1 rounded-[var(--radius-pill)] border border-line p-1">
          <button
            type="button"
            onClick={() => changeQuantity(quantity - 1)}
            disabled={!canBuy || quantity <= 1}
            aria-label="ลดจำนวน"
            className="grid size-10 place-items-center rounded-full transition hover:bg-lilac-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Minus className="size-4" aria-hidden />
          </button>

          <label>
            <span className="sr-only">จำนวนที่ต้องการ</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={maxQuantity}
              step={1}
              value={quantity}
              disabled={!canBuy}
              onChange={(event) => changeQuantity(Number(event.target.value))}
              className="w-14 bg-transparent text-center text-sm font-bold outline-none disabled:opacity-40"
            />
          </label>

          <button
            type="button"
            onClick={() => changeQuantity(quantity + 1)}
            disabled={!canBuy || quantity >= maxQuantity}
            aria-label="เพิ่มจำนวน"
            className="grid size-10 place-items-center rounded-full transition hover:bg-lilac-50 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus className="size-4" aria-hidden />
          </button>
        </div>

        {canBuy && quantity >= maxQuantity && (
          <span className="text-xs text-muted">สูงสุด {maxQuantity} ชิ้นตามจำนวนที่มีในคลัง</span>
        )}
      </div>

      {/* ─── ปุ่มหลัก ─── */}
      <button
        type="button"
        onClick={verifyAndAdd}
        disabled={!canBuy || state.kind === "checking"}
        className={cn(
          "flex min-h-13 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-base font-bold transition",
          canBuy
            ? "btn-brand"
            : "cursor-not-allowed border border-line bg-lilac-50 text-muted-light",
          state.kind === "checking" && "opacity-80",
        )}
      >
        {state.kind === "checking" ? (
          <>
            <Loader2 className="size-5 animate-spin" aria-hidden />
            กำลังตรวจสต็อกและเพิ่มลงตะกร้า…
          </>
        ) : (
          <>
            <ShoppingBag className="size-5" aria-hidden />
            {canBuy ? "เพิ่มลงตะกร้า" : "สินค้าหมด"}
          </>
        )}
      </button>

      {/* ─── ผลจากเซิร์ฟเวอร์ ─── */}
      <div aria-live="polite">
        {state.kind === "added" && (
          <div className="rounded-[var(--radius-card)] border border-success/25 bg-success/5 p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-success">
              <Check className="size-4 shrink-0" aria-hidden />
              เพิ่มลงตะกร้าแล้ว {quantity} ชิ้น
            </p>
            <p className="mt-1.5 text-sm text-ink-soft">
              {state.result.variant.productName}
              {state.result.variant.color && ` · ${state.result.variant.color}`}
              {state.result.variant.size && ` · ไซซ์ ${state.result.variant.size}`} · ราคา{" "}
              {formatBaht(state.result.variant.finalPrice)}
            </p>
            <p className="mt-1.5 text-sm text-ink-soft">
              ในตะกร้ามี {state.cart.summary.totalQuantity} ชิ้น · ยอดรวม{" "}
              {formatBaht(state.cart.summary.subtotal)}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/cart"
                className="btn-brand flex min-h-11 items-center rounded-[var(--radius-pill)] px-5 text-sm font-bold transition"
              >
                ไปที่ตะกร้า
              </Link>
              <Link
                href="/shop"
                className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-5 text-sm font-semibold transition hover:border-brand-soft"
              >
                เลือกซื้อต่อ
              </Link>
            </div>
          </div>
        )}

        {state.kind === "unavailable" && (
          <div
            role="alert"
            className="rounded-[var(--radius-card)] border border-warning/30 bg-warning/5 p-4"
          >
            <p className="flex items-center gap-2 text-sm font-bold text-warning">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />
              {state.result.reason ? REASON_MESSAGE[state.result.reason] : "ยังซื้อไม่ได้"}
            </p>
            <p className="mt-1.5 text-sm text-ink-soft">
              ซื้อได้จริงตอนนี้ {state.result.available} ชิ้น — ปรับจำนวนแล้วลองอีกครั้ง
            </p>
          </div>
        )}

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
              onClick={verifyAndAdd}
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
