/**
 * ข้อมูลร้านและการตั้งค่าร้าน (STEP 49) — รูปเดียวกับ backend
 * (services/store-settings.service.ts · models/store-settings.model.ts)
 */

export interface StoreSocialLink {
  label: string;
  url: string;
}

export interface StoreContactChannel {
  label: string;
  value: string;
  note?: string;
}

/** `GET /api/store` — ช่องที่ร้านไม่มีเป็น null หรือไม่อยู่ในรายการ (ไม่มีค่าสมมติ) */
export interface StoreInfo {
  description: string;
  contactEmail: string | null;
  contactPhone: string | null;
  socialLinks: StoreSocialLink[];
  contactChannels: StoreContactChannel[];
  agentHours: string;
  aiHours: string;
  shippingDays: string;
  /** "12:00 น." */
  cutoffTime: string;
  returnWindowDays: number;
  codMaxTotal: number;
}

export interface StoreSettings {
  description: string;
  contactEmail: string | null;
  contactPhone: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  facebookUrl: string | null;
  lineUrl: string | null;
  agentHours: string;
  shippingDays: string;
  /** "HH:MM" */
  cutoffTime: string;
  returnWindowDays: number;
  codMaxTotal: number;
}

export type SocialField = "instagramUrl" | "tiktokUrl" | "facebookUrl" | "lineUrl";

export interface StoreSettingLimits {
  returnWindowDays: { min: number; max: number };
  codMaxTotal: { min: number; max: number };
  description: { min: number; max: number };
  agentHours: { min: number; max: number };
  shippingDays: { min: number; max: number };
}

/** `GET /api/admin/settings` */
export interface AdminStoreSettings {
  settings: StoreSettings & { updatedAt: string };
  limits: StoreSettingLimits;
  socialPlatforms: { field: SocialField; label: string; example: string }[];
}

/** `PATCH /api/admin/settings` — เฉพาะช่องที่เปลี่ยน · null = ร้านไม่มีช่องทางนั้น */
export type UpdateStoreSettingsInput = Partial<StoreSettings>;
