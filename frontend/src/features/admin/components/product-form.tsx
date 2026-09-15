"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Check, ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useFieldArray, useForm, useWatch } from "react-hook-form";

import { describeApiError } from "../lib/api-error-text";
import {
  createProductFormSchema,
  emptyFormValues,
  emptyVariantRow,
  PRODUCT_STATUSES,
  toCreateInput,
  toFormValues,
  toUpdateInput,
  type ProductFormValues,
} from "../lib/product-form";

import { cn } from "@/lib/utils";
import { createProduct, updateProduct } from "@/services/admin.service";
import type { AdminProduct, ProductFormOptions } from "@/types/admin";

/**
 * ฟอร์มสร้าง/แก้ไขสินค้า (STEP 14)
 *
 * ⚠️ **ไม่มีช่องแก้จำนวนสต็อกของตัวเลือกที่มีอยู่แล้ว** — สต็อกเดินผ่าน
 *    InventoryMovement เท่านั้น (รับเข้าครั้งแรกกรอกได้ตอนสร้างตัวเลือก
 *    ส่วนการปรับยอดภายหลังทำที่หน้าคลังสินค้า `/admin/inventory`)
 * ⚠️ ตัวเลือกหมวดหมู่/แบรนด์/สี/ไซซ์ และโฮสต์รูปที่อนุญาต มาจากฐานข้อมูลจริง
 *    ผ่าน `options` — ฟอร์มไม่ฮาร์ดโค้ดรายการเหล่านี้เอง
 * ⚠️ โหมดแก้ไขส่งเฉพาะฟิลด์ที่เปลี่ยนจริง ไม่เขียนทับทั้งก้อน
 */
export function ProductForm({
  mode,
  options,
  product,
}: {
  mode: "create" | "edit";
  options: ProductFormOptions;
  product?: AdminProduct;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const hasActiveVariant = (product?.variants ?? []).some((variant) => variant.isActive);

  const form = useForm<ProductFormValues>({
    resolver: zodResolver(
      createProductFormSchema({
        allowedImageHosts: options.allowedImageHosts,
        mode,
        hasActiveVariant,
      }),
    ),
    defaultValues: product !== undefined ? toFormValues(product) : emptyFormValues(),
    mode: "onBlur",
  });

  const images = useFieldArray({ control: form.control, name: "images" });
  const variants = useFieldArray({ control: form.control, name: "variants" });

  const imageValues = useWatch({ control: form.control, name: "images" });
  const priceValue = useWatch({ control: form.control, name: "price" });
  const salePriceValue = useWatch({ control: form.control, name: "salePrice" });
  const statusValue = useWatch({ control: form.control, name: "status" });

  const disabled = busy || isPending;
  const errors = form.formState.errors;

  async function onSubmit(values: ProductFormValues) {
    setBusy(true);
    setSubmitError(null);
    setNotice(null);

    try {
      if (mode === "create") {
        const created = await createProduct(toCreateInput(values));

        startTransition(() => router.push(`/admin/products/${created.id}`));
        return;
      }

      if (product === undefined) return;

      const input = toUpdateInput(values, product);

      if (Object.keys(input).length === 0) {
        setNotice("ยังไม่มีอะไรเปลี่ยน จึงไม่ได้บันทึก");
        return;
      }

      const updated = await updateProduct(product.id, input);

      form.reset(toFormValues(updated));
      setNotice("บันทึกการแก้ไขแล้ว");
      startTransition(() => router.refresh());
    } catch (error) {
      setSubmitError(describeApiError(error, "บันทึกสินค้าไม่สำเร็จ"));
    } finally {
      setBusy(false);
    }
  }

  const finalPrice =
    salePriceValue !== undefined && salePriceValue !== "" ? salePriceValue : priceValue;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="mt-6 space-y-6" noValidate>
      {/* ─── ข้อมูลหลัก ─── */}
      <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
        <h2 className="text-lg">ข้อมูลสินค้า</h2>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="ชื่อสินค้า *" error={errors.name?.message} className="sm:col-span-2">
            <input {...form.register("name")} disabled={disabled} className={inputClass} />
          </Field>

          <Field
            label="slug (ลิงก์หน้าร้าน) *"
            error={errors.slug?.message}
            hint="ตัวอักษรเล็ก ตัวเลข ขีดกลาง เช่น oversized-tee-purple"
          >
            <input {...form.register("slug")} disabled={disabled} className={inputClass} />
          </Field>

          <Field label="SKU *" error={errors.sku?.message} hint="ตัวพิมพ์ใหญ่ ตัวเลข ขีดกลาง">
            <input {...form.register("sku")} disabled={disabled} className={inputClass} />
          </Field>

          <Field
            label="คำอธิบาย *"
            error={errors.description?.message}
            className="sm:col-span-2"
            hint="อธิบายเนื้อผ้า ทรง และการดูแลตามจริง"
          >
            <textarea
              {...form.register("description")}
              rows={5}
              disabled={disabled}
              className="w-full rounded-[12px] border border-line bg-white p-3 text-sm outline-none focus:border-brand-soft"
            />
          </Field>

          <Field
            label="คำอธิบายสั้น"
            error={errors.shortDescription?.message}
            className="sm:col-span-2"
          >
            <input
              {...form.register("shortDescription")}
              disabled={disabled}
              className={inputClass}
            />
          </Field>

          <Field label="หมวดหมู่ *" error={errors.categorySlug?.message}>
            <select {...form.register("categorySlug")} disabled={disabled} className={inputClass}>
              <option value="">— เลือกหมวดหมู่ —</option>
              {options.categories.map((category) => (
                <option key={category.id} value={category.slug}>
                  {category.parentName !== null
                    ? `${category.parentName} › ${category.name}`
                    : category.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="แบรนด์" error={errors.brandSlug?.message}>
            <select {...form.register("brandSlug")} disabled={disabled} className={inputClass}>
              <option value="">— ไม่ระบุ —</option>
              {options.brands.map((brand) => (
                <option key={brand.id} value={brand.slug}>
                  {brand.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="ราคาปกติ (บาท) *" error={errors.price?.message}>
            <input
              {...form.register("price")}
              inputMode="decimal"
              disabled={disabled}
              className={inputClass}
            />
          </Field>

          <Field
            label="ราคาลด (บาท)"
            error={errors.salePrice?.message}
            hint="เว้นว่าง = ไม่มีโปรโมชัน"
          >
            <input
              {...form.register("salePrice")}
              inputMode="decimal"
              disabled={disabled}
              className={inputClass}
            />
          </Field>

          <Field
            label="จุดเตือนสต็อกต่ำ"
            error={errors.minimumStock?.message}
            hint="เหลือน้อยกว่าหรือเท่านี้จะถูกนับว่าสต็อกต่ำ"
          >
            <input
              {...form.register("minimumStock")}
              inputMode="numeric"
              disabled={disabled}
              className={inputClass}
            />
          </Field>

          <Field
            label="แท็ก"
            error={errors.tags?.message}
            hint="คั่นด้วยจุลภาค เช่น ครอปท็อป, ลำลอง"
          >
            <input {...form.register("tags")} disabled={disabled} className={inputClass} />
          </Field>
        </div>

        <p className="mt-4 rounded-[12px] border border-line bg-lilac-50 p-3 text-sm">
          ราคาที่ลูกค้าจ่ายจริง:{" "}
          <strong className="text-brand-dark">
            {finalPrice !== undefined && finalPrice !== "" ? `฿${finalPrice}` : "—"}
          </strong>{" "}
          <span className="text-muted">(server คำนวณซ้ำทุกครั้งที่สั่งซื้อ)</span>
        </p>
      </section>

      {/* ─── สถานะ ─── */}
      <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
        <h2 className="text-lg">สถานะการขาย</h2>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {PRODUCT_STATUSES.map((status) => (
            <label
              key={status.value}
              className={cn(
                "flex cursor-pointer flex-col gap-1 rounded-[12px] border p-4 text-sm transition",
                statusValue === status.value
                  ? "border-brand bg-lilac-50"
                  : "border-line hover:border-brand-soft",
              )}
            >
              <span className="flex items-center gap-2 font-bold">
                <input
                  type="radio"
                  value={status.value}
                  {...form.register("status")}
                  disabled={disabled}
                  className="size-4 accent-[var(--color-brand)]"
                />
                {status.label}
              </span>
              <span className="text-xs text-muted">{status.hint}</span>
            </label>
          ))}
        </div>

        {errors.status?.message !== undefined && (
          <p role="alert" className="mt-2 text-sm font-semibold text-danger">
            {errors.status.message}
          </p>
        )}
      </section>

      {/* ─── รูปสินค้า ─── */}
      <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg">รูปสินค้า</h2>
            <p className="mt-1 text-sm text-muted">
              ใส่ลิงก์รูปจากโฮสต์ที่ระบบอนุญาตเท่านั้น: {options.allowedImageHosts.join(", ")}
              {mode === "edit" && " · การบันทึกจะแทนที่ชุดรูปเดิมทั้งหมด"}
            </p>
          </div>

          <button
            type="button"
            onClick={() => images.append({ url: "", alt: "", isMain: images.fields.length === 0 })}
            disabled={disabled || images.fields.length >= 10}
            className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
          >
            <ImagePlus className="size-4" aria-hidden />
            เพิ่มรูป
          </button>
        </div>

        {images.fields.length === 0 ? (
          <p className="mt-4 rounded-[12px] border border-dashed border-line bg-lilac-50 p-4 text-sm text-muted">
            ยังไม่มีรูป — สินค้าที่ไม่มีรูปบันทึกเป็นฉบับร่างได้ แต่เปิดขายไม่ได้
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {images.fields.map((field, index) => {
              const url = imageValues?.[index]?.url ?? "";
              const previewable = isHttpsUrl(url, options.allowedImageHosts);

              return (
                <li key={field.id} className="rounded-[12px] border border-line p-3">
                  <div className="flex gap-3">
                    <div className="relative size-16 shrink-0 overflow-hidden rounded-[10px] bg-lilac-50">
                      {previewable ? (
                        <Image
                          src={url}
                          alt=""
                          fill
                          sizes="64px"
                          className="object-cover"
                          unoptimized
                        />
                      ) : (
                        <span className="grid size-full place-items-center text-xs text-muted">
                          ไม่มีภาพ
                        </span>
                      )}
                    </div>

                    <div className="grid min-w-0 flex-1 gap-2">
                      <input
                        {...form.register(`images.${index}.url`)}
                        placeholder="https://images.unsplash.com/..."
                        disabled={disabled}
                        className={inputClass}
                      />
                      <input
                        {...form.register(`images.${index}.alt`)}
                        placeholder="คำอธิบายรูปสำหรับผู้ใช้ screen reader"
                        disabled={disabled}
                        className={inputClass}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => images.remove(index)}
                      disabled={disabled}
                      aria-label={`ลบรูปที่ ${index + 1}`}
                      className="grid size-11 shrink-0 place-items-center rounded-full border border-line transition hover:border-danger hover:text-danger"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  </div>

                  <label className="mt-2 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      {...form.register(`images.${index}.isMain`)}
                      disabled={disabled}
                      className="size-4 accent-[var(--color-brand)]"
                    />
                    ใช้เป็นรูปหลัก
                  </label>

                  {(errors.images?.[index]?.url?.message !== undefined ||
                    errors.images?.[index]?.alt?.message !== undefined) && (
                    <p role="alert" className="mt-2 text-sm font-semibold text-danger">
                      {errors.images[index]?.url?.message ?? errors.images[index]?.alt?.message}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {typeof errors.images?.message === "string" && (
          <p role="alert" className="mt-2 text-sm font-semibold text-danger">
            {errors.images.message}
          </p>
        )}
      </section>

      {/* ─── ตัวเลือกสินค้า (เฉพาะตอนสร้าง) ─── */}
      {mode === "create" && (
        <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg">ตัวเลือกสินค้า (สี / ไซซ์)</h2>
              <p className="mt-1 text-sm text-muted">
                จำนวนที่กรอกจะถูกบันทึกเป็น <strong>การรับเข้าคลังจริง</strong>{" "}
                พร้อมประวัติว่าใครรับเข้าเมื่อไร
              </p>
            </div>

            <button
              type="button"
              onClick={() => variants.append(emptyVariantRow())}
              disabled={disabled || variants.fields.length >= 50}
              className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-brand-soft hover:bg-lilac-50 disabled:opacity-50"
            >
              <Plus className="size-4" aria-hidden />
              เพิ่มตัวเลือก
            </button>
          </div>

          <ul className="mt-4 space-y-3">
            {variants.fields.map((field, index) => (
              <li key={field.id} className="rounded-[12px] border border-line p-3">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="SKU *" error={errors.variants?.[index]?.sku?.message}>
                    <input
                      {...form.register(`variants.${index}.sku`)}
                      placeholder="TS-TEE-001-BLA-M"
                      disabled={disabled}
                      className={inputClass}
                    />
                  </Field>

                  <Field label="สี">
                    <select
                      {...form.register(`variants.${index}.colorSlug`)}
                      disabled={disabled}
                      className={inputClass}
                    >
                      <option value="">— ไม่ระบุ —</option>
                      {options.colors.map((color) => (
                        <option key={color.slug} value={color.slug}>
                          {color.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="ไซซ์">
                    <select
                      {...form.register(`variants.${index}.sizeCode`)}
                      disabled={disabled}
                      className={inputClass}
                    >
                      <option value="">— ไม่ระบุ —</option>
                      {options.sizes.map((size) => (
                        <option key={size.code} value={size.code}>
                          {size.name}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field
                    label="ราคาเฉพาะตัวเลือกนี้"
                    error={errors.variants?.[index]?.price?.message}
                    hint="เว้นว่าง = ใช้ราคาของสินค้า"
                  >
                    <input
                      {...form.register(`variants.${index}.price`)}
                      inputMode="decimal"
                      disabled={disabled}
                      className={inputClass}
                    />
                  </Field>

                  <Field
                    label="ราคาลดของตัวเลือก"
                    error={errors.variants?.[index]?.salePrice?.message}
                  >
                    <input
                      {...form.register(`variants.${index}.salePrice`)}
                      inputMode="decimal"
                      disabled={disabled}
                      className={inputClass}
                    />
                  </Field>

                  <Field
                    label="จำนวนรับเข้าครั้งแรก"
                    error={errors.variants?.[index]?.initialStock?.message}
                    hint="เว้นว่าง = 0 ชิ้น"
                  >
                    <input
                      {...form.register(`variants.${index}.initialStock`)}
                      inputMode="numeric"
                      disabled={disabled}
                      className={inputClass}
                    />
                  </Field>
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      {...form.register(`variants.${index}.isActive`)}
                      disabled={disabled}
                      className="size-4 accent-[var(--color-brand)]"
                    />
                    เปิดขายตัวเลือกนี้
                  </label>

                  <button
                    type="button"
                    onClick={() => variants.remove(index)}
                    disabled={disabled || variants.fields.length <= 1}
                    className="flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold transition hover:border-danger hover:text-danger disabled:opacity-50"
                  >
                    <Trash2 className="size-4" aria-hidden />
                    ลบตัวเลือก
                  </button>
                </div>
              </li>
            ))}
          </ul>

          {typeof errors.variants?.message === "string" && (
            <p role="alert" className="mt-2 text-sm font-semibold text-danger">
              {errors.variants.message}
            </p>
          )}
        </section>
      )}

      {/* ─── บันทึก ─── */}
      <div className="sticky bottom-0 -mx-4 border-t border-line bg-white/95 px-4 py-4 backdrop-blur sm:mx-0 sm:rounded-[var(--radius-card)] sm:border sm:px-5">
        <div aria-live="polite">
          {submitError !== null && (
            <p
              role="alert"
              className="mb-3 flex items-start gap-2 rounded-[12px] border border-danger/25 bg-danger/5 p-3 text-sm font-semibold break-words text-danger"
            >
              <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
              {submitError}
            </p>
          )}

          {notice !== null && (
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-success">
              <Check className="size-4 shrink-0" aria-hidden />
              {notice}
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={disabled}
          className="btn-brand flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-sm font-bold transition disabled:opacity-60"
        >
          {disabled ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              กำลังบันทึก…
            </>
          ) : mode === "create" ? (
            "สร้างสินค้า"
          ) : (
            "บันทึกการแก้ไข"
          )}
        </button>

        <p className="mt-2 text-center text-xs text-muted">
          ทุกการสร้าง/แก้ไข/ลบ ถูกบันทึกในประวัติการแก้ไขของแอดมิน
        </p>
      </div>
    </form>
  );
}

function isHttpsUrl(value: string, allowedHosts: string[]): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "https:" && allowedHosts.includes(url.hostname);
  } catch {
    return false;
  }
}

function Field({
  label,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  error?: string | undefined;
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block text-sm", className)}>
      <span className="mb-1 block font-semibold">{label}</span>
      {children}
      {hint !== undefined && error === undefined && (
        <span className="mt-1 block text-xs text-muted">{hint}</span>
      )}
      {error !== undefined && (
        <span role="alert" className="mt-1 block text-xs font-semibold text-danger">
          {error}
        </span>
      )}
    </label>
  );
}

const inputClass =
  "min-h-11 w-full rounded-[12px] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft";
