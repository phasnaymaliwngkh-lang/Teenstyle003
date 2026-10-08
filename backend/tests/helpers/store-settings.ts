import type { StoreSettings } from '../../src/models/store-settings.model.ts';

/**
 * การตั้งค่าร้านสำหรับเทสต์ฟังก์ชันล้วน (STEP 49)
 *
 * ค่าตั้งใจให้ **ไม่ตรงกับค่าตั้งต้นของร้าน** (9 วัน · 4,321 บาท · 16:30) — เทสต์ที่ผ่านได้เพราะ
 * โค้ดพิมพ์ค่าเดิมไว้เองจะล้มทันที แทนที่จะผ่านเพราะบังเอิญเท่ากัน
 */
export function storeSettingsFixture(overrides: Partial<StoreSettings> = {}): StoreSettings {
  return {
    description: 'ร้านทดสอบสำหรับเทสต์การตั้งค่าร้าน',
    contactEmail: 'shop@example.com',
    contactPhone: null,
    instagramUrl: null,
    tiktokUrl: null,
    facebookUrl: null,
    lineUrl: null,
    agentHours: 'ทุกวัน 10:00 – 19:00 น.',
    shippingDays: 'ทุกวัน',
    cutoffTime: '16:30',
    returnWindowDays: 9,
    codMaxTotal: 4321,
    ...overrides,
  };
}
