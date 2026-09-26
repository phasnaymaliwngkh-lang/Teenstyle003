"use client";

import { AlertTriangle, Loader2, Minus, Plus, Trash2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { removeCartItem, selectCartItem, updateCartItem } from "@/services/cart.service";
import type { CartItem } from "@/types/catalog";
import { formatBaht, STOCK_LABEL } from "@/utils/format";

const ISSUE_MESSAGE = {
  OUT_OF_STOCK: "สินค้าหมดแล้ว — ลบออกหรือเลือกตัวเลือกอื่น",
  INSUFFICIENT_STOCK: "จำนวนในตะกร้ามากกว่าที่มีในคลัง — ลดจำนวนก่อนสั่งซื้อ",
  PRODUCT_UNAVAILABLE: "สินค้านี้ไม่เปิดขายแล้ว — กรุณาลบออกจากตะกร้า",
} as const;

/**
 * หนึ่งรายการในตะกร้า (STEP 9)
 *
 * ทุกการกดปุ่มคือการเรียก API แล้ว `router.refresh()` ให้ Server Component
 * อ่านตะกร้าใหม่จาก backend — **ไม่มีการคำนวณยอดเงินฝั่ง client**
 * (SECURITY REQUIREMENT: ห้าม Trust Client-side Price / Stock)
 */
export function CartItemRow({ item }: { item: CartItem }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const disabled = busy || isPending;
  const maxQuantity = Math.max(1, item.available);

  /** เรียก API แล้วให้หน้าอ่านข้อมูลใหม่จาก server */
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);

    try {
      await action();
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(
        caught instanceof ApiClientError ? caught.message : "ทำรายการไม่สำเร็จ กรุณาลองอีกครั้ง",
      );
    } finally {
      setBusy(false);
    }
  }

  function changeQuantity(next: number) {
    const clamped = Math.min(Math.max(1, Math.trunc(next) || 1), maxQuantity);
    if (clamped === item.quantity) return;

    void run(() => updateCartItem(item.id, clamped));
  }

  return (
    <li
      className={cn(
        "rounded-[var(--radius-card)] border bg-white p-4 transition",
        item.issue === null ? "border-line" : "border-warning/40 bg-warning/5",
        disabled && "opacity-70",
      )}
    >
      <div className="flex gap-3 sm:gap-4">
        <label className="grid size-11 shrink-0 place-items-center">
          <span className="sr-only">เลือกรายการนี้เพื่อสั่งซื้อ</span>
          <input
            type="checkbox"
            checked={item.selected}
            disabled={disabled}
            onChange={(event) => void run(() => selectCartItem(item.id, event.target.checked))}
            className="size-5 accent-[var(--color-brand)]"
          />
        </label>

        <Link
          href={`/product/${item.slug}`}
          className="relative size-20 shrink-0 overflow-hidden rounded-[12px] bg-lilac-50 sm:size-24"
        >
          {item.image ? (
            <Image
              src={item.image.url}
              alt={item.image.alt}
              fill
              sizes="(min-width: 640px) 96px, 80px"
              className="object-cover"
            />
          ) : (
            <span className="grid size-full place-items-center text-2xl" aria-hidden>
              ✧
            </span>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <h3 className="text-sm leading-snug font-bold">
            <Link href={`/product/${item.slug}`} className="transition hover:text-brand">
              {item.name}
            </Link>
          </h3>

          <p className="mt-0.5 text-xs text-muted">
            {[item.color, item.size].filter(Boolean).join(" · ") || "ตัวเลือกเดียว"} · SKU{" "}
            {item.sku}
          </p>

          <p className="mt-1 flex flex-wrap items-baseline gap-2">
            <span className="font-extrabold text-brand-dark">{formatBaht(item.unitPrice)}</span>
            {item.unitPrice < item.listPrice && (
              <s className="text-xs text-muted-light">{formatBaht(item.listPrice)}</s>
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

          {item.priceChanged && (
            <p className="mt-1 text-xs font-semibold text-warning">
              ราคาเปลี่ยนจาก {formatBaht(item.addedPrice)} เป็น {formatBaht(item.unitPrice)}{" "}
              ตั้งแต่ที่คุณหยิบใส่ตะกร้า — ยอดที่คิดเงินใช้ราคาปัจจุบัน
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-0.5 rounded-[var(--radius-pill)] border border-line p-0.5 sm:gap-1 sm:p-1">
              <button
                type="button"
                onClick={() => changeQuantity(item.quantity - 1)}
                disabled={disabled || item.quantity <= 1}
                aria-label="ลดจำนวน"
                className="grid size-11 place-items-center rounded-full transition hover:bg-lilac-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Minus className="size-4" aria-hidden />
              </button>

              <label className="flex min-h-11 min-w-11 items-center justify-center">
                <span className="sr-only">จำนวนของ {item.name}</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={maxQuantity}
                  step={1}
                  defaultValue={item.quantity}
                  disabled={disabled}
                  key={item.quantity}
                  onBlur={(event) => changeQuantity(Number(event.target.value))}
                  className="w-10 bg-transparent text-center text-sm font-bold outline-none disabled:opacity-40 sm:w-12"
                />
              </label>

              <button
                type="button"
                onClick={() => changeQuantity(item.quantity + 1)}
                disabled={disabled || item.quantity >= maxQuantity}
                aria-label="เพิ่มจำนวน"
                className="grid size-11 place-items-center rounded-full transition hover:bg-lilac-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-sm font-extrabold">{formatBaht(item.lineTotal)}</span>

              <button
                type="button"
                onClick={() => void run(() => removeCartItem(item.id))}
                disabled={disabled}
                aria-label={`ลบ ${item.name} ออกจากตะกร้า`}
                className="grid size-11 place-items-center rounded-full text-muted transition hover:bg-danger/5 hover:text-danger disabled:opacity-40"
              >
                {disabled ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-4" aria-hidden />
                )}
              </button>
            </div>
          </div>

          {item.available > 0 && item.quantity >= maxQuantity && item.issue === null && (
            <p className="mt-2 text-xs text-muted">สูงสุด {maxQuantity} ชิ้นตามจำนวนที่มีในคลัง</p>
          )}
        </div>
      </div>

      {item.issue !== null && (
        <p
          role="alert"
          className="mt-3 flex items-center gap-2 border-t border-warning/30 pt-3 text-xs font-bold text-warning"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden />
          {ISSUE_MESSAGE[item.issue]}
          {item.issue === "INSUFFICIENT_STOCK" && ` (เหลือ ${item.available} ชิ้น)`}
        </p>
      )}

      {error !== null && (
        <p role="alert" className="mt-3 text-xs font-semibold break-words text-danger">
          {error}
        </p>
      )}
    </li>
  );
}
