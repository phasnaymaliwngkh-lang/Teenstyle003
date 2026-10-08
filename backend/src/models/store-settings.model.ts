import type { Prisma } from '@teenstyle/database';

import { WEB_CHAT_CHANNEL } from '../config/store.ts';

import { toNumber } from './pricing.ts';

/**
 * การตั้งค่าร้าน (STEP 49) — กฎล้วน ไม่แตะฐานข้อมูล
 *
 * ค่าทั้งหมดอยู่ในตาราง `StoreSetting` (แถวเดียว) · อ่านผ่าน services/store-settings.service.ts
 * ทุกที่ที่ลูกค้าเห็นข้อมูลร้าน — footer · หน้าเกี่ยวกับเรา · หน้าแรก · บทความคลังความรู้ (ผ่านตัวแปร) ·
 * คำตอบของ AI · การคิดว่าใช้ COD ได้ไหม · สิทธิ์ขอคืนสินค้า — ใช้ค่าชุดเดียวกันนี้
 *
 * ⚠️ ช่องที่เป็น null = **ร้านยังไม่มีช่องทางนั้น** → ไม่แสดงที่ไหนเลย
 *    ห้ามเติมค่าสมมติให้หน้าดูครบ (footer เคยโชว์เบอร์ 02-000-0000 และลิงก์ instagram.com เฉย ๆ)
 */

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

export const STORE_SETTINGS_SELECT = {
  description: true,
  contactEmail: true,
  contactPhone: true,
  instagramUrl: true,
  tiktokUrl: true,
  facebookUrl: true,
  lineUrl: true,
  agentHours: true,
  shippingDays: true,
  cutoffTime: true,
  returnWindowDays: true,
  codMaxTotal: true,
  updatedAt: true,
} satisfies Prisma.StoreSettingSelect;

export type StoreSettingRow = Prisma.StoreSettingGetPayload<{
  select: typeof STORE_SETTINGS_SELECT;
}>;

export function toStoreSettings(row: StoreSettingRow): StoreSettings {
  return {
    description: row.description,
    contactEmail: row.contactEmail,
    contactPhone: row.contactPhone,
    instagramUrl: row.instagramUrl,
    tiktokUrl: row.tiktokUrl,
    facebookUrl: row.facebookUrl,
    lineUrl: row.lineUrl,
    agentHours: row.agentHours,
    shippingDays: row.shippingDays,
    cutoffTime: row.cutoffTime,
    returnWindowDays: row.returnWindowDays,
    codMaxTotal: toNumber(row.codMaxTotal),
  };
}

/* ─────────────────────────── ขอบเขตของค่า ─────────────────────────── */

/** ขอบเขตที่ validator และหน้าแก้ใช้ร่วมกัน (CHECK ในฐานข้อมูลเป็นด่านสุดท้ายของสองค่าแรก) */
export const STORE_SETTING_LIMITS = {
  returnWindowDays: { min: 1, max: 90 },
  codMaxTotal: { min: 1, max: 100_000 },
  description: { min: 10, max: 600 },
  agentHours: { min: 3, max: 120 },
  shippingDays: { min: 3, max: 60 },
} as const;

/** เวลาตัดรอบ "HH:MM" แบบ 24 ชั่วโมง — รูปแบบเดียวกับ CHECK `StoreSetting_cutoff_time` */
export const CUTOFF_TIME_PATTERN = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

/** เบอร์โทร: ตัวเลข ช่องว่าง ขีด และ + นำหน้าได้ · 9–15 หลัก */
export const PHONE_PATTERN = /^\+?[0-9][0-9 -]{7,18}[0-9]$/;

/** "12:00" → "12:00 น." — ข้อความที่ลูกค้าเห็น */
export function formatCutoffTime(time: string): string {
  return `${time} น.`;
}

/** เบอร์สำหรับลิงก์ `tel:` — เก็บแค่ตัวเลขกับ + */
export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^0-9+]/g, '')}`;
}

/* ─────────────────────────── โซเชียลมีเดีย ─────────────────────────── */

export type SocialField = 'instagramUrl' | 'tiktokUrl' | 'facebookUrl' | 'lineUrl';

export interface SocialPlatform {
  field: SocialField;
  label: string;
  /** โดเมนของแพลตฟอร์มนั้นจริง ๆ — ลิงก์ที่ออกไปโดเมนอื่นถูกปฏิเสธ */
  hosts: readonly string[];
  example: string;
}

export const SOCIAL_PLATFORMS: readonly SocialPlatform[] = [
  {
    field: 'instagramUrl',
    label: 'Instagram',
    hosts: ['instagram.com', 'www.instagram.com'],
    example: 'https://www.instagram.com/ชื่อร้าน',
  },
  {
    field: 'tiktokUrl',
    label: 'TikTok',
    hosts: ['tiktok.com', 'www.tiktok.com'],
    example: 'https://www.tiktok.com/@ชื่อร้าน',
  },
  {
    field: 'facebookUrl',
    label: 'Facebook',
    hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'fb.com'],
    example: 'https://www.facebook.com/ชื่อเพจ',
  },
  {
    field: 'lineUrl',
    label: 'LINE',
    hosts: ['line.me', 'page.line.me', 'lin.ee'],
    example: 'https://lin.ee/รหัสบัญชี',
  },
];

/**
 * ลิงก์โปรไฟล์ของร้านใช้ได้ไหม — คืนเหตุผลที่ใช้ไม่ได้ หรือ null = ใช้ได้
 *
 * ⚠️ **ต้องมี path** — `https://instagram.com` เฉย ๆ คือหน้าแรกของ Instagram ไม่ใช่ร้าน
 *    (footer เคยใส่ลิงก์แบบนี้ไว้ทั้ง 4 ช่อง และ structured data เกือบประกาศมันเป็น `sameAs` ของร้าน)
 * ⚠️ https เท่านั้น และโดเมนต้องเป็นของแพลตฟอร์มนั้น — ลิงก์นี้ถูกแสดงเป็นปุ่มในทุกหน้าของหน้าร้าน
 */
export function socialUrlProblem(platform: SocialPlatform, value: string): string | null {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    return `ลิงก์ ${platform.label} ไม่ถูกต้อง — ตัวอย่าง ${platform.example}`;
  }

  if (url.protocol !== 'https:') return `ลิงก์ ${platform.label} ต้องขึ้นต้นด้วย https://`;

  if (!platform.hosts.includes(url.hostname.toLowerCase())) {
    return `ลิงก์ ${platform.label} ต้องอยู่บน ${platform.hosts[0]} — ตัวอย่าง ${platform.example}`;
  }

  if (url.pathname.replace(/\/+$/, '') === '') {
    return `ลิงก์ ${platform.label} ต้องชี้ไปที่โปรไฟล์ของร้าน ไม่ใช่หน้าแรกของ ${platform.label}`;
  }

  return null;
}

export interface SocialLink {
  label: string;
  url: string;
}

/** โซเชียลที่ร้านมีจริง (ช่องที่ว่างไม่ถูกนับ) เรียงตามลำดับคงที่ */
export function socialLinksOf(settings: StoreSettings): SocialLink[] {
  return SOCIAL_PLATFORMS.flatMap((platform) => {
    const url = settings[platform.field];
    return url === null ? [] : [{ label: platform.label, url }];
  });
}

/* ─────────────────────────── ช่องทางติดต่อ ─────────────────────────── */

export interface StoreContactChannel {
  label: string;
  value: string;
  note?: string;
}

/**
 * ช่องทางติดต่อที่ร้านเปิดอยู่จริง — แชตบนเว็บมีเสมอ · ที่เหลือมีเฉพาะช่องที่ร้านกรอก
 * บทความ (`{{store.contact}}`) · AI · หน้าเกี่ยวกับเรา ใช้รายการเดียวกันนี้
 */
export function contactChannelsOf(settings: StoreSettings): StoreContactChannel[] {
  const channels: StoreContactChannel[] = [{ ...WEB_CHAT_CHANNEL }];

  if (settings.lineUrl !== null) channels.push({ label: 'LINE', value: settings.lineUrl });
  if (settings.contactEmail !== null)
    channels.push({ label: 'อีเมล', value: settings.contactEmail });
  if (settings.contactPhone !== null) {
    channels.push({ label: 'โทรศัพท์', value: settings.contactPhone, note: settings.agentHours });
  }

  return channels;
}

/** รายการช่องทางติดต่อแบบ markdown — รูปเดียวกับที่บทความเคยพิมพ์ไว้ */
export function describeContactChannels(channels: readonly StoreContactChannel[]): string {
  return channels
    .map(
      (channel) =>
        `- **${channel.label}:** ${channel.value}${channel.note ? ` — ${channel.note}` : ''}`,
    )
    .join('\n');
}

/* ─────────────────────────── สิทธิ์คืนสินค้า ─────────────────────────── */

/**
 * จำนวนวันที่แจ้งคืนได้ของคำสั่งซื้อหนึ่ง = **ค่าที่ยาวกว่า** ระหว่างนโยบายตอนสั่งกับนโยบายปัจจุบัน
 *
 * - ร้านลดวันลง → ใบที่สั่งไปแล้วยังได้ตามที่ตกลงตอนซื้อ (ไม่ถูกตัดสิทธิ์ย้อนหลัง)
 * - ร้านขยายวัน → ใช้กับทุกใบทันที (บทความประกาศค่าใหม่ ลูกค้าเก่าต้องไม่ถูกปฏิเสธด้วยค่าเก่า)
 */
export function effectiveReturnWindowDays(orderDays: number, currentDays: number): number {
  return Math.max(orderDays, currentDays);
}
