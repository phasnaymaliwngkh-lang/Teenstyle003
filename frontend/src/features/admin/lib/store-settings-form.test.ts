import { describe, expect, it } from "vitest";

import { buildSettingsChanges, formValuesOf } from "./store-settings-form";

import type { StoreSettings } from "@/types/store";

const CURRENT: StoreSettings = {
  description: "ร้านแฟชั่นวัยรุ่นสำหรับเทสต์",
  contactEmail: "hello@example.com",
  contactPhone: null,
  instagramUrl: null,
  tiktokUrl: null,
  facebookUrl: null,
  lineUrl: "https://lin.ee/abc123",
  agentHours: "จันทร์ – เสาร์ 09:00 – 18:00 น.",
  shippingDays: "จันทร์ – เสาร์",
  cutoffTime: "12:00",
  returnWindowDays: 7,
  codMaxTotal: 5000,
};

describe("buildSettingsChanges", () => {
  it("ไม่ได้แก้อะไร → ไม่มีช่องให้ส่ง (ช่องที่เป็น null แสดงเป็นช่องว่างแล้วกลับเป็น null)", () => {
    expect(buildSettingsChanges(formValuesOf(CURRENT), CURRENT)).toEqual({});
  });

  it("ส่งเฉพาะช่องที่เปลี่ยน · ตัดช่องว่างหัวท้าย · ตัวเลขเป็น number", () => {
    const values = {
      ...formValuesOf(CURRENT),
      agentHours: "  ทุกวัน 10:00 – 20:00 น.  ",
      returnWindowDays: "14",
      codMaxTotal: "3000.50",
    };

    expect(buildSettingsChanges(values, CURRENT)).toEqual({
      agentHours: "ทุกวัน 10:00 – 20:00 น.",
      returnWindowDays: 14,
      codMaxTotal: 3000.5,
    });
  });

  it("ล้างช่องทางติดต่อ/โซเชียล = ส่ง null (ร้านไม่มีช่องทางนั้น) ไม่ใช่สตริงว่าง", () => {
    const values = { ...formValuesOf(CURRENT), lineUrl: "   ", contactPhone: "02-123-4567" };

    expect(buildSettingsChanges(values, CURRENT)).toEqual({
      lineUrl: null,
      contactPhone: "02-123-4567",
    });
  });

  it.each([
    ["จำนวนวันพิมพ์ผิด", { returnWindowDays: "7วัน" }, "จำนวนเต็ม"],
    ["COD พิมพ์ผิด", { codMaxTotal: "ห้าพัน" }, "COD"],
    ["COD ทศนิยม 3 ตำแหน่ง", { codMaxTotal: "100.555" }, "COD"],
    ["เวลาตัดรอบผิด", { cutoffTime: "25:00" }, "24 ชั่วโมง"],
    ["ลบคำอธิบายร้านจนว่าง", { description: "  " }, "คำอธิบายร้าน"],
  ])("%s → บอกว่าผิดตรงไหน ไม่ส่งอะไรขึ้นไป", (_name, patch, message) => {
    const result = buildSettingsChanges({ ...formValuesOf(CURRENT), ...patch }, CURRENT);

    // ตัวเลขที่พิมพ์ผิดห้ามกลายเป็น NaN → null ซึ่ง API อ่านว่า "ล้างค่า" (บั๊กจริงของ STEP 37)
    expect(typeof result).toBe("string");
    expect(result).toContain(message);
  });
});
