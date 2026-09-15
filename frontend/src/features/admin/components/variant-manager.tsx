"use client";

import { AlertTriangle, Check, Loader2, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { describeApiError } from "../lib/api-error-text";

import { cn } from "@/lib/utils";
import { addProductVariant, updateProductVariant } from "@/services/admin.service";
import type { AdminProduct, AdminProductVariant, ProductFormOptions } from "@/types/admin";
import { formatBaht } from "@/utils/format";

/**
 * จัดการตัวเลือกสินค้าของสินค้าที่มีอยู่แล้ว (STEP 14)
 *
 * ⚠️ **จำนวนในคลังแก้ที่นี่ไม่ได้** — แสดงให้ดูเท่านั้น
 *    สต็อกต้องเดินผ่าน InventoryMovement (รับเข้า/ตัดออก/คืนของ) ที่หน้า `/admin/inventory`
 *    ตัวเลือกที่สร้างใหม่กรอก "จำนวนรับเข้าครั้งแรก" ได้ เพราะ backend บันทึกเป็น movement จริง
 * ⚠️ ปิดขายตัวเลือกที่ยังมีของจองอยู่ได้ แต่ของที่จองไว้ยังเป็นของออเดอร์นั้น
 */
export function VariantManager({
  product,
  options,
}: {
  product: AdminProduct;
  options: ProductFormOptions;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const busy = busyId !== null || isPending;

  async function run(id: string, action: () => Promise<AdminProduct>, successText: string) {
    setBusyId(id);
    setError(null);
    setNotice(null);

    try {
      await action();
      setNotice(successText);
      startTransition(() => router.refresh());
    } catch (caught) {
      setError(describeApiError(caught, "บันทึกตัวเลือกสินค้าไม่สำเร็จ"));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg">ตัวเลือกสินค้า ({product.variants.length})</h2>
          <p className="mt-1 text-sm text-muted">
            จำนวนในคลังแก้จากหน้านี้ไม่ได้ — ต้องรับเข้า/ปรับยอดที่{" "}
            <Link href="/admin/inventory" className="font-semibold text-brand underline">
              คลังสินค้า
            </Link>{" "}
            เพื่อให้มีประวัติครบทุกการเคลื่อนไหว
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowAdd((previous) => !previous)}
          disabled={busy}
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
        >
          <Plus className="size-4" aria-hidden />
          {showAdd ? "ปิดฟอร์มเพิ่ม" : "เพิ่มตัวเลือก"}
        </button>
      </div>

      <div aria-live="polite">
        {error !== null && (
          <p
            role="alert"
            className="mt-3 flex items-start gap-2 rounded-[12px] border border-danger/25 bg-danger/5 p-3 text-sm font-semibold break-words text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {notice !== null && (
          <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-success">
            <Check className="size-4 shrink-0" aria-hidden />
            {notice}
          </p>
        )}
      </div>

      {showAdd && (
        <AddVariantForm
          product={product}
          options={options}
          disabled={busy}
          onDone={(text) => {
            setShowAdd(false);
            setNotice(text);
            startTransition(() => router.refresh());
          }}
          onError={setError}
        />
      )}

      {product.variants.length === 0 ? (
        <p className="mt-4 rounded-[12px] border border-dashed border-line bg-lilac-50 p-4 text-sm text-muted">
          ยังไม่มีตัวเลือก — สินค้าจะเปิดขายได้ต้องมีตัวเลือกที่เปิดใช้งานอย่างน้อย 1 รายการ
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {product.variants.map((variant) => (
            <VariantRow
              key={variant.id}
              product={product}
              variant={variant}
              disabled={busy}
              busy={busyId === variant.id}
              onSave={run}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function VariantRow({
  product,
  variant,
  disabled,
  busy,
  onSave,
}: {
  product: AdminProduct;
  variant: AdminProductVariant;
  disabled: boolean;
  busy: boolean;
  onSave: (id: string, action: () => Promise<AdminProduct>, successText: string) => Promise<void>;
}) {
  /**
   * ช่องราคาจะว่างเมื่อตัวเลือกนี้ไม่ได้กำหนดราคาของตัวเอง (ใช้ราคาสินค้าแม่)
   * ใช้ `overridesPrice` จาก server ตรง ๆ — ห้ามเดาจากการเทียบตัวเลขกับสินค้าแม่
   * เพราะราคาที่ตั้งทับไว้อาจเท่ากับราคาสินค้าแม่พอดี
   */
  const [price, setPrice] = useState(variant.overridesPrice ? String(variant.price) : "");
  const [salePrice, setSalePrice] = useState(
    variant.overridesPrice && variant.salePrice !== null ? String(variant.salePrice) : "",
  );

  const label = [variant.color?.name, variant.size?.name].filter(Boolean).join(" · ") || "ไม่ระบุ";

  return (
    <li className="rounded-[12px] border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="min-w-0">
          <p className="font-bold">{label}</p>
          <p className="font-mono text-xs break-all text-muted">{variant.sku}</p>
        </div>

        <span
          className={cn(
            "rounded-[var(--radius-pill)] border px-2.5 py-1 text-xs font-bold",
            variant.isActive
              ? "border-success/30 bg-success/10 text-success"
              : "border-line bg-lilac-50 text-muted",
          )}
        >
          {variant.isActive ? "เปิดขาย" : "ปิดขาย"}
        </span>
      </div>

      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted">ราคาที่คิดเงินจริง</dt>
          <dd className="font-extrabold text-brand-dark">{formatBaht(variant.finalPrice)}</dd>
        </div>
        <div className="sm:col-span-4 sm:order-last">
          <Link
            href={`/admin/inventory/${variant.id}`}
            className="text-xs font-semibold text-brand underline"
          >
            รับของเข้า / ปรับยอด / ดูประวัติสต็อกของตัวเลือกนี้ →
          </Link>
        </div>
        <div>
          <dt className="text-xs text-muted">ในคลัง</dt>
          <dd className="font-semibold">{variant.quantity} ชิ้น</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">จองไว้</dt>
          <dd className="font-semibold">{variant.reserved} ชิ้น</dd>
        </div>
        <div>
          <dt className="text-xs text-muted">ขายได้จริง</dt>
          <dd className={cn("font-semibold", variant.available === 0 && "text-danger")}>
            {variant.available} ชิ้น
          </dd>
        </div>
      </dl>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold">ราคาเฉพาะตัวเลือกนี้</span>
          <input
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            inputMode="decimal"
            placeholder={`เว้นว่าง = ใช้ราคาสินค้า (${formatBaht(product.price)})`}
            disabled={disabled}
            className={inputClass}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold">ราคาลดของตัวเลือกนี้</span>
          <input
            value={salePrice}
            onChange={(event) => setSalePrice(event.target.value)}
            inputMode="decimal"
            placeholder="เว้นว่าง = ไม่ลด"
            disabled={disabled}
            className={inputClass}
          />
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            void onSave(
              variant.id,
              () =>
                updateProductVariant(product.id, variant.id, {
                  price: price.trim() === "" ? null : Number(price),
                  salePrice: salePrice.trim() === "" ? null : Number(salePrice),
                }),
              "บันทึกราคาของตัวเลือกแล้ว",
            )
          }
          disabled={disabled}
          className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-brand bg-brand px-4 text-sm font-bold text-white transition disabled:opacity-50"
        >
          {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
          บันทึกราคา
        </button>

        <button
          type="button"
          onClick={() =>
            void onSave(
              variant.id,
              () => updateProductVariant(product.id, variant.id, { isActive: !variant.isActive }),
              variant.isActive ? "ปิดขายตัวเลือกนี้แล้ว" : "เปิดขายตัวเลือกนี้แล้ว",
            )
          }
          disabled={disabled}
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
        >
          {variant.isActive ? "ปิดขายตัวเลือกนี้" : "เปิดขายตัวเลือกนี้"}
        </button>
      </div>
    </li>
  );
}

function AddVariantForm({
  product,
  options,
  disabled,
  onDone,
  onError,
}: {
  product: AdminProduct;
  options: ProductFormOptions;
  disabled: boolean;
  onDone: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [sku, setSku] = useState("");
  const [colorSlug, setColorSlug] = useState("");
  const [sizeCode, setSizeCode] = useState("");
  const [initialStock, setInitialStock] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);

    try {
      await addProductVariant(product.id, {
        sku: sku.trim().toUpperCase(),
        ...(colorSlug !== "" ? { colorSlug } : {}),
        ...(sizeCode !== "" ? { sizeCode } : {}),
        initialStock: initialStock.trim() === "" ? 0 : Number(initialStock),
        isActive: true,
      });

      setSku("");
      setColorSlug("");
      setSizeCode("");
      setInitialStock("");
      onDone("เพิ่มตัวเลือกสินค้าแล้ว");
    } catch (caught) {
      onError(describeApiError(caught, "เพิ่มตัวเลือกสินค้าไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  const blocked = disabled || busy || sku.trim().length < 3;

  return (
    <div className="mt-4 rounded-[12px] border border-brand/25 bg-lilac-50 p-4">
      <h3 className="font-bold">เพิ่มตัวเลือกใหม่</h3>
      <p className="mt-1 text-sm text-muted">
        จำนวนรับเข้าจะถูกบันทึกเป็นการรับของเข้าคลังจริง (มีประวัติว่าใครรับเข้าเมื่อไร)
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block text-sm">
          <span className="mb-1 block font-semibold">SKU *</span>
          <input
            value={sku}
            onChange={(event) => setSku(event.target.value)}
            placeholder={`${product.sku}-BLA-M`}
            disabled={disabled || busy}
            className={inputClass}
          />
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold">สี</span>
          <select
            value={colorSlug}
            onChange={(event) => setColorSlug(event.target.value)}
            disabled={disabled || busy}
            className={inputClass}
          >
            <option value="">— ไม่ระบุ —</option>
            {options.colors.map((color) => (
              <option key={color.slug} value={color.slug}>
                {color.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold">ไซซ์</span>
          <select
            value={sizeCode}
            onChange={(event) => setSizeCode(event.target.value)}
            disabled={disabled || busy}
            className={inputClass}
          >
            <option value="">— ไม่ระบุ —</option>
            {options.sizes.map((size) => (
              <option key={size.code} value={size.code}>
                {size.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <span className="mb-1 block font-semibold">จำนวนรับเข้า</span>
          <input
            value={initialStock}
            onChange={(event) => setInitialStock(event.target.value)}
            inputMode="numeric"
            placeholder="0"
            disabled={disabled || busy}
            className={inputClass}
          />
        </label>
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={blocked}
        className="btn-brand mt-3 flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold transition disabled:opacity-50"
      >
        {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
        เพิ่มตัวเลือก
      </button>
    </div>
  );
}

const inputClass =
  "min-h-11 w-full rounded-[12px] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft";
