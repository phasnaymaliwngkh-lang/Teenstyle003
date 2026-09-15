"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Check, Loader2, Lock, MapPin, Truck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";

import { checkoutFormSchema, type CheckoutFormValues } from "../lib/schema";

import { ApiClientError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { createOrder } from "@/services/order.service";
import type { CheckoutSummary, CreateOrderInput, ShippingOption } from "@/types/catalog";
import { formatBaht } from "@/utils/format";

/**
 * ฟอร์ม checkout (STEP 10)
 *
 * ⚠️ ฟอร์มนี้ **ไม่เคยส่งราคาหรือรายการสินค้า** ไปที่ server
 *    ส่งแค่ที่อยู่ + วิธีจัดส่ง + ข้อความ + idempotencyKey
 *    ยอดที่เห็นบนหน้าจอเป็นค่าที่ server คำนวณมาให้ (จาก `summary`)
 *    และยอดที่บันทึกในคำสั่งซื้อคือยอดที่ server คำนวณอีกครั้งตอนสร้างออเดอร์
 *
 * `idempotencyKey` สร้างครั้งเดียวต่อการเปิดหน้า — กดปุ่มซ้ำ/เน็ตหลุดแล้วลองใหม่
 * จะได้คำสั่งซื้อเดิม ไม่เกิดออเดอร์ซ้ำ
 */
export function CheckoutForm({ summary }: { summary: CheckoutSummary }) {
  const router = useRouter();
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [submitError, setSubmitError] = useState<{ message: string; stockIssue: boolean } | null>(
    null,
  );

  const defaultAddress =
    summary.addresses.find((address) => address.isDefault) ?? summary.addresses[0];

  const form = useForm<CheckoutFormValues>({
    resolver: zodResolver(checkoutFormSchema),
    defaultValues: {
      addressChoice: defaultAddress?.id ?? "new",
      saveForLater: true,
      shippingMethod: summary.selectedShippingMethod,
      province: defaultAddress?.province ?? "",
      label: "",
      recipientName: "",
      phone: "",
      line1: "",
      line2: "",
      subDistrict: "",
      district: "",
      postalCode: "",
      customerNote: "",
    },
  });

  /**
   * ใช้ `useWatch` ไม่ใช่ `form.watch()` — `watch()` คืนฟังก์ชันที่ React Compiler
   * memoize ไม่ได้ (lint เตือน `react-hooks/incompatible-library`) ส่วน useWatch เป็น hook ปกติ
   */
  const addressChoice = useWatch({ control: form.control, name: "addressChoice" });
  const shippingMethod = useWatch({ control: form.control, name: "shippingMethod" });
  const typedProvince = useWatch({ control: form.control, name: "province" }) ?? "";

  const usingNewAddress = addressChoice === "new";
  const selectedSaved = summary.addresses.find((address) => address.id === addressChoice);
  const province = usingNewAddress ? typedProvince.trim() : (selectedSaved?.province ?? "");

  /** ตัวเลือกจัดส่งใช้กับจังหวัดที่กรอกอยู่ได้ไหม (กฎมาจาก server) */
  function isAvailable(option: ShippingOption): boolean {
    if (option.onlyProvinces === null) return true;
    if (province === "") return true;

    return option.onlyProvinces.includes(province);
  }

  const chosenOption =
    summary.shippingOptions.find((option) => option.code === shippingMethod) ??
    summary.shippingOptions[0]!;
  const shippingFee = chosenOption.fee;
  const total = summary.subtotal - summary.discountTotal + shippingFee;

  async function onSubmit(values: CheckoutFormValues) {
    setSubmitError(null);

    const input: CreateOrderInput = {
      shippingMethod: values.shippingMethod,
      idempotencyKey,
      ...(values.customerNote ? { customerNote: values.customerNote } : {}),
      ...(values.addressChoice === "new"
        ? {
            newAddress: {
              recipientName: values.recipientName!,
              phone: values.phone!,
              line1: values.line1!,
              subDistrict: values.subDistrict!,
              district: values.district!,
              province: values.province!,
              postalCode: values.postalCode!,
              saveForLater: values.saveForLater,
              ...(values.label ? { label: values.label } : {}),
              ...(values.line2 ? { line2: values.line2 } : {}),
            },
          }
        : { addressId: values.addressChoice }),
    };

    try {
      const order = await createOrder(input);

      router.push(`/checkout/success?order=${encodeURIComponent(order.orderNumber)}`);
    } catch (error) {
      const apiError = error instanceof ApiClientError ? error : null;

      setSubmitError({
        message: apiError?.message ?? "สั่งซื้อไม่สำเร็จ กรุณาลองอีกครั้ง",
        // 409 = ของหมด/ไม่พอ ระหว่างที่กำลังสั่ง → ต้องกลับไปแก้ตะกร้า
        stockIssue: apiError?.status === 409,
      });
    }
  }

  const submitting = form.formState.isSubmitting;

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="grid gap-8 lg:grid-cols-[1fr_340px]">
      <div className="space-y-6">
        {/* ─── ที่อยู่จัดส่ง ─── */}
        <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <MapPin className="size-5 text-brand" aria-hidden />
            ที่อยู่จัดส่ง
          </h2>

          <div className="mt-4 space-y-2">
            {summary.addresses.map((address) => (
              <label
                key={address.id}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-[12px] border p-3 transition",
                  addressChoice === address.id
                    ? "border-brand bg-lilac-50"
                    : "border-line hover:border-brand-soft",
                )}
              >
                <input
                  type="radio"
                  value={address.id}
                  {...form.register("addressChoice")}
                  className="mt-1 size-4 accent-[var(--color-brand)]"
                />
                <span className="min-w-0 text-sm">
                  <span className="block font-bold">
                    {address.recipientName}
                    {address.label && (
                      <span className="ml-2 rounded-[var(--radius-pill)] bg-lilac px-2 py-0.5 text-[11px] text-brand-dark">
                        {address.label}
                      </span>
                    )}
                    {address.isDefault && (
                      <span className="ml-2 text-[11px] font-semibold text-success">
                        ค่าเริ่มต้น
                      </span>
                    )}
                  </span>
                  <span className="block text-muted">
                    {address.line1}
                    {address.line2 ? ` ${address.line2}` : ""} · {address.subDistrict}{" "}
                    {address.district} {address.province} {address.postalCode}
                  </span>
                  <span className="block text-muted">โทร {address.phone}</span>
                </span>
              </label>
            ))}

            <label
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-[12px] border p-3 text-sm font-semibold transition",
                usingNewAddress
                  ? "border-brand bg-lilac-50"
                  : "border-line hover:border-brand-soft",
              )}
            >
              <input
                type="radio"
                value="new"
                {...form.register("addressChoice")}
                className="size-4 accent-[var(--color-brand)]"
              />
              กรอกที่อยู่ใหม่
            </label>
          </div>

          {usingNewAddress && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field label="ชื่อผู้รับ" error={form.formState.errors.recipientName?.message}>
                <input {...form.register("recipientName")} className={inputClass} />
              </Field>

              <Field label="เบอร์โทร" error={form.formState.errors.phone?.message}>
                <input {...form.register("phone")} inputMode="tel" className={inputClass} />
              </Field>

              <Field
                label="ที่อยู่ (บ้านเลขที่ ถนน)"
                error={form.formState.errors.line1?.message}
                full
              >
                <input {...form.register("line1")} className={inputClass} />
              </Field>

              <Field label="รายละเอียดเพิ่มเติม (ไม่บังคับ)" full>
                <input {...form.register("line2")} className={inputClass} />
              </Field>

              <Field label="แขวง/ตำบล" error={form.formState.errors.subDistrict?.message}>
                <input {...form.register("subDistrict")} className={inputClass} />
              </Field>

              <Field label="เขต/อำเภอ" error={form.formState.errors.district?.message}>
                <input {...form.register("district")} className={inputClass} />
              </Field>

              <Field label="จังหวัด" error={form.formState.errors.province?.message}>
                <input {...form.register("province")} className={inputClass} />
              </Field>

              <Field label="รหัสไปรษณีย์" error={form.formState.errors.postalCode?.message}>
                <input
                  {...form.register("postalCode")}
                  inputMode="numeric"
                  maxLength={5}
                  className={inputClass}
                />
              </Field>

              <Field label="ชื่อเรียกที่อยู่นี้ (ไม่บังคับ)" full>
                <input
                  {...form.register("label")}
                  placeholder="บ้าน / ที่ทำงาน"
                  className={inputClass}
                />
              </Field>

              <label className="flex min-h-11 items-center gap-2 text-sm sm:col-span-2">
                <input
                  type="checkbox"
                  {...form.register("saveForLater")}
                  className="size-4 accent-[var(--color-brand)]"
                />
                บันทึกที่อยู่นี้ไว้ใช้ครั้งต่อไป
              </label>
            </div>
          )}
        </section>

        {/* ─── วิธีจัดส่ง ─── */}
        <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <h2 className="flex items-center gap-2 text-lg">
            <Truck className="size-5 text-brand" aria-hidden />
            วิธีจัดส่ง
          </h2>

          <div className="mt-4 space-y-2">
            {summary.shippingOptions.map((option) => {
              const available = isAvailable(option);
              const active = shippingMethod === option.code;

              return (
                <label
                  key={option.code}
                  className={cn(
                    "flex gap-3 rounded-[12px] border p-3 transition",
                    active ? "border-brand bg-lilac-50" : "border-line",
                    available ? "cursor-pointer hover:border-brand-soft" : "opacity-50",
                  )}
                >
                  <input
                    type="radio"
                    value={option.code}
                    disabled={!available}
                    {...form.register("shippingMethod")}
                    className="mt-1 size-4 accent-[var(--color-brand)]"
                  />
                  <span className="min-w-0 flex-1 text-sm">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="font-bold">{option.name}</span>
                      <span className="font-extrabold text-brand-dark">
                        {option.fee === 0 ? "ฟรี" : formatBaht(option.fee)}
                      </span>
                    </span>
                    <span className="block text-muted">{option.description}</span>
                    <span className="block text-xs text-muted-light">{option.etaText}</span>
                    {!available && (
                      <span className="block text-xs font-semibold text-warning">
                        ใช้กับจังหวัด{province}ไม่ได้ — รองรับ {option.onlyProvinces?.join(" · ")}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        </section>

        {/* ─── ข้อความถึงร้าน ─── */}
        <section className="rounded-[var(--radius-card)] border border-line bg-white p-5">
          <h2 className="text-lg">ข้อความถึงร้าน (ไม่บังคับ)</h2>
          <textarea
            {...form.register("customerNote")}
            rows={3}
            maxLength={500}
            placeholder="เช่น ฝากไว้กับ รปภ. ได้เลย"
            className="mt-3 w-full rounded-[12px] border border-line bg-white p-3 text-sm"
          />
          {form.formState.errors.customerNote && (
            <p className="mt-1 text-xs font-semibold text-danger">
              {form.formState.errors.customerNote.message}
            </p>
          )}
        </section>
      </div>

      {/* ─── สรุปยอด + ปุ่มยืนยัน ─── */}
      <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
          <h2 className="text-lg">สรุปคำสั่งซื้อ</h2>

          <ul className="mt-4 space-y-3 border-b border-line pb-4">
            {summary.items.map((item) => (
              <li key={item.id} className="flex gap-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{item.name}</span>
                  <span className="block text-xs text-muted">
                    {[item.color, item.size].filter(Boolean).join(" · ")} × {item.quantity}
                  </span>
                </span>
                <span className="shrink-0 font-semibold">{formatBaht(item.lineTotal)}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 space-y-2 text-sm">
            <Row label="ยอดสินค้า" value={formatBaht(summary.subtotal)} />
            <Row
              label="ส่วนลด"
              value={summary.discountTotal > 0 ? `-${formatBaht(summary.discountTotal)}` : "—"}
            />
            <Row
              label={`ค่าจัดส่ง (${chosenOption.name})`}
              value={shippingFee === 0 ? "ฟรี" : formatBaht(shippingFee)}
            />
            <div className="flex items-baseline justify-between gap-3 border-t border-line pt-3">
              <dt className="font-extrabold">ยอดที่ต้องชำระ</dt>
              <dd className="text-xl font-extrabold text-brand-dark">{formatBaht(total)}</dd>
            </div>
          </dl>

          <button
            type="submit"
            disabled={submitting || !summary.checkoutReady}
            className={cn(
              "mt-5 flex min-h-13 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-base font-bold transition",
              summary.checkoutReady
                ? "btn-brand"
                : "cursor-not-allowed border border-line bg-lilac-50 text-muted-light",
            )}
          >
            {submitting ? (
              <>
                <Loader2 className="size-5 animate-spin" aria-hidden />
                กำลังสร้างคำสั่งซื้อ…
              </>
            ) : (
              <>
                <Lock className="size-4" aria-hidden />
                ยืนยันคำสั่งซื้อ
              </>
            )}
          </button>

          <p className="mt-3 text-xs text-muted">
            กดยืนยันแล้วระบบจะ <strong>จองสินค้า</strong> ไว้ให้ และสร้างคำสั่งซื้อสถานะ
            &ldquo;รอชำระเงิน&rdquo; · ยังไม่มีการตัดเงินในขั้นนี้ — ระบบชำระเงินจริงจะเชื่อมต่อใน
            STEP 11
          </p>
        </div>

        <div aria-live="polite">
          {submitError !== null && (
            <div
              role="alert"
              className="rounded-[var(--radius-card)] border border-danger/25 bg-danger/5 p-4"
            >
              <p className="flex items-center gap-2 text-sm font-bold text-danger">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                สั่งซื้อไม่สำเร็จ
              </p>
              <p className="mt-1.5 text-sm break-words text-ink-soft">{submitError.message}</p>

              {submitError.stockIssue && (
                <Link
                  href="/cart"
                  className="mt-3 inline-flex min-h-11 items-center rounded-[var(--radius-pill)] border border-danger/30 px-5 text-sm font-bold text-danger transition hover:bg-danger/10"
                >
                  กลับไปแก้ตะกร้า
                </Link>
              )}
            </div>
          )}

          {summary.checkoutReady && submitError === null && (
            <p className="flex items-start gap-2 text-xs text-muted">
              <Check className="mt-0.5 size-3.5 shrink-0 text-success" aria-hidden />
              ราคาและสต็อกถูกตรวจใหม่จากเซิร์ฟเวอร์อีกครั้งตอนกดยืนยัน
            </p>
          )}
        </div>
      </aside>
    </form>
  );
}

const inputClass =
  "min-h-11 w-full rounded-[12px] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft";

function Field({
  label,
  error,
  full = false,
  children,
}: {
  label: string;
  error?: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block text-sm", full && "sm:col-span-2")}>
      <span className="mb-1 block font-semibold">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs font-semibold text-danger">{error}</span>}
    </label>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted">{label}</dt>
      <dd className="shrink-0 font-semibold">{value}</dd>
    </div>
  );
}
