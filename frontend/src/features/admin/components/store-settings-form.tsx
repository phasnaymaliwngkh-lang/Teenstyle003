"use client";

import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useId, useState } from "react";

import {
  buildSettingsChanges,
  formValuesOf,
  type StoreSettingsFormValues,
} from "@/features/admin/lib/store-settings-form";
import { describeApiError } from "@/lib/api-error-text";
import { cn } from "@/lib/utils";
import { updateStoreSettings } from "@/services/store.service";
import type { AdminStoreSettings, StoreSettings } from "@/types/store";

import { inputClass } from "./tracking-fields";

/**
 * ฟอร์มการตั้งค่าร้าน (STEP 49 · `settings:manage`)
 *
 * ⚠️ ส่งเฉพาะช่องที่เปลี่ยน · ช่องที่เว้นว่าง = ร้านไม่มีช่องทางนั้น (ส่ง null) → หายจากทุกหน้า
 * ⚠️ ลิงก์โซเชียลถูกตรวจที่ server (โดเมนของแพลตฟอร์ม · ต้องเป็นโปรไฟล์) — เหตุผลขึ้นใต้ปุ่มบันทึก
 * ⚠️ หลังบันทึกใช้ค่าที่ server ตอบกลับเป็นค่าตั้งต้นใหม่ — ไม่งั้นการแก้ครั้งถัดไปเทียบกับค่าเก่า
 *    แล้วส่งช่องที่ไม่ได้แก้ไปด้วย
 */
export function StoreSettingsForm({ data }: { data: AdminStoreSettings }) {
  const router = useRouter();
  const id = useId();
  const [current, setCurrent] = useState<StoreSettings>(data.settings);
  const [values, setValues] = useState<StoreSettingsFormValues>(() => formValuesOf(data.settings));
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const { limits } = data;

  const set =
    (field: keyof StoreSettingsFormValues) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const value = event.target.value;
      setValues((previous) => ({ ...previous, [field]: value }));
      setSaved(false);
    };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);

    const changes = buildSettingsChanges(values, current);

    if (typeof changes === "string") {
      setError(changes);
      return;
    }

    if (Object.keys(changes).length === 0) {
      setError("ยังไม่ได้แก้อะไร");
      return;
    }

    setPending(true);

    try {
      const result = await updateStoreSettings(changes);
      setCurrent(result.settings);
      setValues(formValuesOf(result.settings));
      setSaved(true);
      router.refresh();
    } catch (failure) {
      setError(describeApiError(failure, "บันทึกการตั้งค่าร้านไม่สำเร็จ"));
    } finally {
      setPending(false);
    }
  }

  const field = (
    name: keyof StoreSettingsFormValues,
    label: string,
    options: {
      hint?: string;
      type?: string;
      inputMode?: "decimal" | "numeric" | "email" | "tel" | "url";
      placeholder?: string;
      maxLength?: number;
      wide?: boolean;
    } = {},
  ) => (
    <div className={cn("text-sm", options.wide && "sm:col-span-2")}>
      <label htmlFor={`${id}-${name}`} className="mb-1 block font-semibold">
        {label}
      </label>
      <input
        id={`${id}-${name}`}
        type={options.type ?? "text"}
        inputMode={options.inputMode}
        placeholder={options.placeholder}
        maxLength={options.maxLength}
        value={values[name]}
        onChange={set(name)}
        aria-describedby={options.hint ? `${id}-${name}-hint` : undefined}
        className={inputClass}
      />
      {options.hint && (
        <p id={`${id}-${name}-hint`} className="mt-1 text-xs text-muted">
          {options.hint}
        </p>
      )}
    </div>
  );

  const sectionClass =
    "grid gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)] sm:grid-cols-2";
  const legendClass = "float-left mb-2 w-full text-lg font-extrabold sm:col-span-2";

  return (
    <form onSubmit={(event) => void submit(event)} className="mt-6 space-y-5">
      <fieldset disabled={pending} className={sectionClass}>
        <legend className={legendClass}>เกี่ยวกับร้าน</legend>
        <div className="text-sm sm:col-span-2">
          <label htmlFor={`${id}-description`} className="mb-1 block font-semibold">
            คำอธิบายร้าน
          </label>
          <textarea
            id={`${id}-description`}
            value={values.description}
            onChange={set("description")}
            maxLength={limits.description.max}
            rows={3}
            aria-describedby={`${id}-description-hint`}
            className={cn(inputClass, "py-2")}
          />
          <p id={`${id}-description-hint`} className="mt-1 text-xs text-muted">
            แสดงที่ footer ทุกหน้า หน้าเกี่ยวกับเรา และข้อมูลร้านที่ส่งให้ Google · ห้ามใส่จำนวนเงิน
            (ค่าส่งและโปรโมชันแสดงจากระบบของมันเอง)
          </p>
        </div>
      </fieldset>

      <fieldset disabled={pending} className={sectionClass}>
        <legend className={legendClass}>ช่องทางติดต่อ</legend>
        <p className="text-xs text-muted sm:col-span-2">
          เว้นว่าง = ร้านไม่มีช่องทางนี้ — ไม่แสดงที่ไหนเลย และ AI จะไม่พูดถึง ·
          แชตกับฝ่ายบริการลูกค้าบนเว็บมีเสมอ
        </p>
        {field("contactEmail", "อีเมล", { type: "email", inputMode: "email", maxLength: 120 })}
        {field("contactPhone", "เบอร์โทร", {
          type: "tel",
          inputMode: "tel",
          placeholder: "เช่น 02-123-4567",
          hint: "แสดงคู่กับเวลาทำการของเจ้าหน้าที่",
          maxLength: 20,
        })}
      </fieldset>

      <fieldset disabled={pending} className={sectionClass}>
        <legend className={legendClass}>โซเชียลมีเดีย</legend>
        <p className="text-xs text-muted sm:col-span-2">
          ใส่ลิงก์โปรไฟล์ของร้าน (ไม่ใช่หน้าแรกของแพลตฟอร์ม) · เว้นว่าง = ไม่แสดงปุ่มนั้น
        </p>
        {data.socialPlatforms.map((platform) => (
          <Fragment key={platform.field}>
            {field(platform.field, platform.label, {
              type: "url",
              inputMode: "url",
              placeholder: platform.example,
              maxLength: 300,
            })}
          </Fragment>
        ))}
      </fieldset>

      <fieldset disabled={pending} className={sectionClass}>
        <legend className={legendClass}>เวลาทำการและการจัดส่ง</legend>
        {field("agentHours", "เวลาทำการของเจ้าหน้าที่", {
          placeholder: "เช่น วันจันทร์ – เสาร์ เวลา 09:00 – 18:00 น.",
          maxLength: limits.agentHours.max,
          hint: "AI บอกลูกค้าตามนี้เมื่อถูกถามว่าคุยกับคนจริงได้เมื่อไร",
          wide: true,
        })}
        {field("shippingDays", "วันที่ร้านส่งของ", {
          placeholder: "เช่น จันทร์ – เสาร์",
          maxLength: limits.shippingDays.max,
        })}
        {field("cutoffTime", "เวลาตัดรอบส่งของ", { type: "time" })}
      </fieldset>

      <fieldset disabled={pending} className={sectionClass}>
        <legend className={legendClass}>นโยบาย</legend>
        {field("returnWindowDays", "แจ้งคืนสินค้าได้ภายใน (วัน)", {
          inputMode: "numeric",
          hint: `${limits.returnWindowDays.min}–${limits.returnWindowDays.max} วัน · มีผลกับคำสั่งซื้อใหม่ · ใบที่สั่งไปแล้วได้ค่าที่ยาวกว่าระหว่างค่าเดิมกับค่าใหม่ (ลดวันลงแล้วไม่มีใครเสียสิทธิ์)`,
        })}
        {field("codMaxTotal", "ยอดสูงสุดที่รับเก็บเงินปลายทาง (บาท)", {
          inputMode: "decimal",
          hint: "คำสั่งซื้อที่ยอดเกินนี้ต้องชำระเงินออนไลน์ · ใช้กับทุกใบที่ยังไม่ได้ชำระทันที",
        })}
        <p className="text-xs text-muted sm:col-span-2">
          บทความนโยบายในคลังความรู้และคำตอบของ AI ใช้ค่าในหน้านี้ทันทีที่บันทึก
        </p>
      </fieldset>

      <button
        type="submit"
        disabled={pending}
        className="btn-brand flex min-h-12 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] text-sm font-bold transition disabled:opacity-60"
      >
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        บันทึกการตั้งค่าร้าน
      </button>

      <div aria-live="polite">
        {error !== null && (
          <p
            role="alert"
            className="flex items-start gap-2 rounded-[12px] border border-danger/25 bg-danger/5 p-3 text-sm font-semibold break-words text-danger"
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        {saved && (
          <p className="flex items-center gap-2 text-sm font-semibold text-success">
            <Check className="size-4 shrink-0" aria-hidden />
            บันทึกแล้ว — หน้าร้านเห็นค่าใหม่ภายในไม่เกิน 1 นาที
          </p>
        )}
      </div>
    </form>
  );
}
