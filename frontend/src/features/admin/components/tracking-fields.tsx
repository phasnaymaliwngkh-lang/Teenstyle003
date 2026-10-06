"use client";

import { useId } from "react";

/**
 * ช่องข้อมูลพัสดุ (STEP 44) — ใช้ร่วมกันตอน "ส่งของออก" และ "ส่งพัสดุใหม่หลังถูกตีกลับ"
 *
 * ⚠️ เลขพัสดุต้องเป็นของจริงที่ขนส่งออกให้ — ระบบไม่สร้างเลขสมมติ (กฎ STEP 13 ข้อ 2)
 * ⚠️ ลิงก์ติดตามรับเฉพาะ https:// (server ตรวจซ้ำ) เพราะลูกค้ากดลิงก์นี้จากหน้าคำสั่งซื้อ
 */
export interface TrackingValue {
  carrier: string;
  trackingNumber: string;
  trackingUrl: string;
  /** วันที่จาก `<input type="date">` (YYYY-MM-DD) — ว่าง = ไม่ระบุกำหนดส่ง */
  estimatedDate: string;
}

export const EMPTY_TRACKING: TrackingValue = {
  carrier: "",
  trackingNumber: "",
  trackingUrl: "",
  estimatedDate: "",
};

export function trackingReady(value: TrackingValue): boolean {
  return value.carrier.trim() !== "" && value.trackingNumber.trim() !== "";
}

/**
 * แปลงเป็นข้อมูลที่ส่งขึ้น API — ส่งเฉพาะช่องที่กรอก
 * กำหนดส่ง = สิ้นวันนั้นตามเวลาเครื่องของคนกรอก (ร้านกรอกจากไทย) — เลยวันนั้นไปแล้วจึงนับว่าเลยกำหนด
 */
export function toTrackingInput(value: TrackingValue): {
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
} {
  return {
    carrier: value.carrier.trim(),
    trackingNumber: value.trackingNumber.trim(),
    ...(value.trackingUrl.trim() !== "" ? { trackingUrl: value.trackingUrl.trim() } : {}),
    ...(value.estimatedDate !== ""
      ? { estimatedDelivery: new Date(`${value.estimatedDate}T23:59:59`).toISOString() }
      : {}),
  };
}

export function TrackingFields({
  value,
  onChange,
  disabled,
}: {
  value: TrackingValue;
  onChange: (next: TrackingValue) => void;
  disabled: boolean;
}) {
  const id = useId();
  const set = (key: keyof TrackingValue) => (event: React.ChangeEvent<HTMLInputElement>) =>
    onChange({ ...value, [key]: event.target.value });

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="text-sm">
        <label htmlFor={`${id}-carrier`} className="mb-1 block font-semibold">
          ผู้ให้บริการขนส่ง *
        </label>
        <input
          id={`${id}-carrier`}
          value={value.carrier}
          onChange={set("carrier")}
          placeholder="Flash Express / Thailand Post"
          disabled={disabled}
          className={inputClass}
        />
      </div>

      <div className="text-sm">
        <label htmlFor={`${id}-tracking`} className="mb-1 block font-semibold">
          เลขพัสดุจริง *
        </label>
        <input
          id={`${id}-tracking`}
          value={value.trackingNumber}
          onChange={set("trackingNumber")}
          placeholder="TH1234567890"
          disabled={disabled}
          className={inputClass}
        />
      </div>

      <div className="text-sm">
        <label htmlFor={`${id}-url`} className="mb-1 block font-semibold">
          ลิงก์ติดตาม (ไม่บังคับ · https://)
        </label>
        <input
          id={`${id}-url`}
          type="url"
          value={value.trackingUrl}
          onChange={set("trackingUrl")}
          placeholder="https://..."
          disabled={disabled}
          className={inputClass}
        />
      </div>

      <div className="text-sm">
        <label htmlFor={`${id}-eta`} className="mb-1 block font-semibold">
          กำหนดส่งถึง (ไม่บังคับ)
        </label>
        <input
          id={`${id}-eta`}
          type="date"
          value={value.estimatedDate}
          onChange={set("estimatedDate")}
          disabled={disabled}
          className={inputClass}
        />
      </div>
    </div>
  );
}

export const inputClass =
  "min-h-11 w-full rounded-[12px] border border-line bg-white px-3 text-sm outline-none focus:border-brand-soft";
