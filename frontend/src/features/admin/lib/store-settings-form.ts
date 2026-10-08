import type { StoreSettings, UpdateStoreSettingsInput } from "@/types/store";

import { INTEGER_PATTERN, MONEY_FORMAT_MESSAGE, MONEY_PATTERN } from "./product-form";

/**
 * กฎของฟอร์มการตั้งค่าร้าน (STEP 49) — **เพื่อ UX เท่านั้น**
 * backend ตรวจซ้ำทุกข้อ (validators/store-settings.validator.ts) และเป็นคนตัดสินลิงก์โซเชียล
 * (โดเมนของแพลตฟอร์ม · ต้องเป็นโปรไฟล์ไม่ใช่หน้าแรก) — ข้อความเหตุผลมาจาก server
 */

/** ค่าที่อยู่ในช่องกรอก — ทุกช่องเป็นข้อความ ("" = ร้านไม่มีช่องทางนั้น สำหรับช่องที่ว่างได้) */
export interface StoreSettingsFormValues {
  description: string;
  contactEmail: string;
  contactPhone: string;
  instagramUrl: string;
  tiktokUrl: string;
  facebookUrl: string;
  lineUrl: string;
  agentHours: string;
  shippingDays: string;
  cutoffTime: string;
  returnWindowDays: string;
  codMaxTotal: string;
}

/** ช่องที่เว้นว่างได้ — ว่าง = ส่ง null (ร้านไม่มีช่องทางนั้น) ไม่ใช่ส่งสตริงว่าง */
export const OPTIONAL_FIELDS = [
  "contactEmail",
  "contactPhone",
  "instagramUrl",
  "tiktokUrl",
  "facebookUrl",
  "lineUrl",
] as const;

const REQUIRED_TEXT_FIELDS = ["description", "agentHours", "shippingDays"] as const;

const REQUIRED_LABEL: Record<(typeof REQUIRED_TEXT_FIELDS)[number], string> = {
  description: "คำอธิบายร้าน",
  agentHours: "เวลาทำการของเจ้าหน้าที่",
  shippingDays: "วันที่ส่งของ",
};

const CUTOFF_TIME = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function formValuesOf(settings: StoreSettings): StoreSettingsFormValues {
  return {
    description: settings.description,
    contactEmail: settings.contactEmail ?? "",
    contactPhone: settings.contactPhone ?? "",
    instagramUrl: settings.instagramUrl ?? "",
    tiktokUrl: settings.tiktokUrl ?? "",
    facebookUrl: settings.facebookUrl ?? "",
    lineUrl: settings.lineUrl ?? "",
    agentHours: settings.agentHours,
    shippingDays: settings.shippingDays,
    cutoffTime: settings.cutoffTime,
    returnWindowDays: String(settings.returnWindowDays),
    codMaxTotal: String(settings.codMaxTotal),
  };
}

/**
 * ค่าที่จะส่ง — **เฉพาะช่องที่เปลี่ยนจริง** (กฎ STEP 14 ข้อ 6) หรือข้อความบอกว่าผิดตรงไหน
 *
 * ⚠️ ตัวเลขผ่าน pattern ก่อนแปลงเสมอ — `Number("abc")` เป็น NaN แล้วกลายเป็น `null` ตอนส่ง
 *    ซึ่ง API อ่านว่า "ล้างค่า" (บั๊กจริงของ STEP 37)
 */
export function buildSettingsChanges(
  values: StoreSettingsFormValues,
  current: StoreSettings,
): UpdateStoreSettingsInput | string {
  for (const field of REQUIRED_TEXT_FIELDS) {
    if (values[field].trim() === "") return `กรุณากรอก${REQUIRED_LABEL[field]}`;
  }

  if (!CUTOFF_TIME.test(values.cutoffTime.trim())) {
    return "เวลาตัดรอบต้องเป็นรูปแบบ 24 ชั่วโมง เช่น 12:00";
  }

  if (!INTEGER_PATTERN.test(values.returnWindowDays.trim())) {
    return "จำนวนวันที่คืนได้ต้องเป็นจำนวนเต็ม";
  }

  if (!MONEY_PATTERN.test(values.codMaxTotal.trim())) {
    return `ยอดสูงสุดของ COD: ${MONEY_FORMAT_MESSAGE}`;
  }

  const next: StoreSettings = {
    description: values.description.trim(),
    agentHours: values.agentHours.trim(),
    shippingDays: values.shippingDays.trim(),
    cutoffTime: values.cutoffTime.trim(),
    returnWindowDays: Number(values.returnWindowDays.trim()),
    codMaxTotal: Number(values.codMaxTotal.trim()),
    contactEmail: null,
    contactPhone: null,
    instagramUrl: null,
    tiktokUrl: null,
    facebookUrl: null,
    lineUrl: null,
  };

  for (const field of OPTIONAL_FIELDS) {
    const value = values[field].trim();
    next[field] = value === "" ? null : value;
  }

  const changes: UpdateStoreSettingsInput = {};

  for (const key of Object.keys(next) as (keyof StoreSettings)[]) {
    if (next[key] !== current[key]) Object.assign(changes, { [key]: next[key] });
  }

  return changes;
}
