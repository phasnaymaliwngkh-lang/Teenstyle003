"use client";

import { Loader2 } from "lucide-react";
import { useId, useState } from "react";

import { ApiClientError } from "@/lib/api";
import type { Address, AddressInput } from "@/types/customer";

/**
 * ฟอร์มที่อยู่ — ใช้ทั้งตอนเพิ่มใหม่และตอนแก้ไข (STEP 25)
 *
 * ⚠️ ฟอร์มนี้เป็น **inline ไม่ใช่ modal** โดยเจตนา
 *    กฎ accessibility ของโปรเจกต์ห้ามให้ฟอร์มที่พิมพ์ข้อมูลยาว ๆ ปิดด้วยการคลิกพื้นหลัง
 *    (เผลอคลิกแล้วงานหายหมด) — ทำเป็น inline จึงไม่มีปัญหานั้นตั้งแต่ต้น
 *
 * ⚠️ การตรวจที่นี่เป็นเพียงความสะดวก — `customer.validator.ts` ที่ backend ตรวจซ้ำทุกครั้ง
 */

const EMPTY: AddressInput = {
  label: "",
  recipientName: "",
  phone: "",
  line1: "",
  line2: "",
  subDistrict: "",
  district: "",
  province: "",
  postalCode: "",
};

const inputClass =
  "mt-1 min-h-11 w-full rounded-[var(--radius-card)] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft focus:ring-2 focus:ring-brand/20";

export function AddressForm({
  address,
  /**
   * ซ่อนช่อง "ตั้งเป็นที่อยู่เริ่มต้น" — จริงเมื่อ
   *   (ก) เป็นที่อยู่แรกของบัญชี ซึ่งระบบตั้งเป็นค่าเริ่มต้นให้เองอยู่แล้ว
   *   (ข) กำลังแก้ที่อยู่ที่เป็นค่าเริ่มต้นอยู่ ซึ่งปลดจากฟอร์มนี้ไม่ได้ (ต้องตั้งอันอื่นแทน)
   */
  hideDefaultToggle,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  address?: Address;
  hideDefaultToggle: boolean;
  submitLabel: string;
  onSubmit: (values: AddressInput) => Promise<void>;
  onCancel: () => void;
}) {
  const formId = useId();
  const [values, setValues] = useState<AddressInput>(
    address
      ? {
          label: address.label ?? "",
          recipientName: address.recipientName,
          phone: address.phone,
          line1: address.line1,
          line2: address.line2 ?? "",
          subDistrict: address.subDistrict,
          district: address.district,
          province: address.province,
          postalCode: address.postalCode,
        }
      : EMPTY,
  );
  const [makeDefault, setMakeDefault] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = (key: keyof AddressInput) => `${formId}-${key}`;

  const set = (key: keyof AddressInput, value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pending) return;

    setPending(true);
    setError(null);

    try {
      await onSubmit({
        ...values,
        label: (values.label ?? "").trim() === "" ? null : (values.label ?? "").trim(),
        line2: (values.line2 ?? "").trim() === "" ? null : (values.line2 ?? "").trim(),
        // ที่อยู่ที่เป็นค่าเริ่มต้นอยู่แล้วไม่ต้องส่งค่านี้ (ปลดจากที่นี่ไม่ได้)
        ...(makeDefault ? { isDefault: true } : {}),
      });
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "บันทึกที่อยู่ไม่สำเร็จ");
    } finally {
      setPending(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[var(--radius-card)] border border-brand-soft bg-lilac-50 p-4 sm:p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor={field("label")} className="text-xs font-bold">
            ชื่อเรียกที่อยู่นี้ <span className="font-normal text-muted">(ไม่บังคับ)</span>
          </label>
          <input
            id={field("label")}
            type="text"
            value={values.label ?? ""}
            maxLength={60}
            onChange={(event) => set("label", event.target.value)}
            placeholder="เช่น บ้าน · หอพัก · ที่ทำงาน"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={field("recipientName")} className="text-xs font-bold">
            ชื่อผู้รับ
          </label>
          <input
            id={field("recipientName")}
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={values.recipientName}
            onChange={(event) => set("recipientName", event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={field("phone")} className="text-xs font-bold">
            เบอร์โทรผู้รับ
          </label>
          <input
            id={field("phone")}
            type="tel"
            required
            inputMode="tel"
            value={values.phone}
            onChange={(event) => set("phone", event.target.value)}
            placeholder="08x-xxx-xxxx"
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={field("line1")} className="text-xs font-bold">
            บ้านเลขที่ ถนน ซอย
          </label>
          <input
            id={field("line1")}
            type="text"
            required
            minLength={5}
            maxLength={200}
            value={values.line1}
            onChange={(event) => set("line1", event.target.value)}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor={field("line2")} className="text-xs font-bold">
            อาคาร / หมู่บ้าน / จุดสังเกต <span className="font-normal text-muted">(ไม่บังคับ)</span>
          </label>
          <input
            id={field("line2")}
            type="text"
            maxLength={200}
            value={values.line2 ?? ""}
            onChange={(event) => set("line2", event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={field("subDistrict")} className="text-xs font-bold">
            แขวง / ตำบล
          </label>
          <input
            id={field("subDistrict")}
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={values.subDistrict}
            onChange={(event) => set("subDistrict", event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={field("district")} className="text-xs font-bold">
            เขต / อำเภอ
          </label>
          <input
            id={field("district")}
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={values.district}
            onChange={(event) => set("district", event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={field("province")} className="text-xs font-bold">
            จังหวัด
          </label>
          <input
            id={field("province")}
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={values.province}
            onChange={(event) => set("province", event.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor={field("postalCode")} className="text-xs font-bold">
            รหัสไปรษณีย์
          </label>
          <input
            id={field("postalCode")}
            type="text"
            required
            inputMode="numeric"
            pattern="\d{5}"
            maxLength={5}
            value={values.postalCode}
            onChange={(event) => set("postalCode", event.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {!hideDefaultToggle && (
        <label className="mt-4 flex items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={makeDefault}
            onChange={(event) => setMakeDefault(event.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--color-brand)]"
          />
          <span>
            <span className="font-semibold">ตั้งเป็นที่อยู่เริ่มต้น</span>
            <span className="block text-xs text-muted">
              ที่อยู่เริ่มต้นจะถูกเลือกไว้ให้ตอนสั่งซื้อ — มีได้ที่อยู่เดียวต่อบัญชี
            </span>
          </span>
        </label>
      )}

      {error !== null && (
        <p role="alert" className="mt-3 text-sm font-semibold text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          className="btn-brand flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold transition disabled:opacity-50"
        >
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {submitLabel}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="flex min-h-11 items-center rounded-[var(--radius-pill)] border border-line bg-white px-5 text-sm font-semibold transition hover:border-brand-soft disabled:opacity-50"
        >
          ยกเลิก
        </button>
      </div>
    </form>
  );
}
