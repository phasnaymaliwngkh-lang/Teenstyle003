import type { LookSort } from "@/types/catalog";

/**
 * ป้ายข้อความของ Look (STEP 7)
 *
 * ค่าจริงในฐานข้อมูลเป็น enum ภาษาอังกฤษ (`LookStyle`) — การแปลเป็นไทยเป็นเรื่องของ UI
 * จึงเก็บไว้ที่ frontend ที่เดียว ไม่ปนกับข้อมูล
 */

export const STYLE_LABEL: Record<string, string> = {
  CASUAL: "Casual — ลำลอง",
  STREET: "Street — สตรีท",
  MINIMAL: "Minimal — มินิมอล",
  KOREAN: "Korean — เกาหลี",
  VINTAGE: "Vintage — วินเทจ",
  SPORT: "Sport — สปอร์ต",
  DAILY: "Daily — ใส่ทุกวัน",
  PARTY: "Party — ปาร์ตี้",
};

/** ชื่อสั้นสำหรับป้ายบนรูป */
export const STYLE_SHORT: Record<string, string> = {
  CASUAL: "Casual",
  STREET: "Street",
  MINIMAL: "Minimal",
  KOREAN: "Korean",
  VINTAGE: "Vintage",
  SPORT: "Sport",
  DAILY: "Daily",
  PARTY: "Party",
};

export const LOOK_SORT_LABEL: Record<LookSort, string> = {
  featured: "แนะนำ",
  newest: "ใหม่สุด",
  popular: "นิยมสุด",
  "price-asc": "ราคารวมต่ำ → สูง",
  "price-desc": "ราคารวมสูง → ต่ำ",
};

export function styleLabel(style: string): string {
  return STYLE_LABEL[style] ?? style;
}

export function styleShort(style: string): string {
  return STYLE_SHORT[style] ?? style;
}
