import { getPrisma, type Prisma, type PrismaClient } from '@teenstyle/database';

import { STORE_AI_HOURS } from '../config/store.ts';
import { writeAdminLog, type AdminLogActor } from '../models/admin-log.model.ts';
import {
  SOCIAL_PLATFORMS,
  STORE_SETTING_LIMITS,
  STORE_SETTINGS_SELECT,
  contactChannelsOf,
  formatCutoffTime,
  socialLinksOf,
  toStoreSettings,
  type SocialLink,
  type StoreContactChannel,
  type StoreSettingRow,
  type StoreSettings,
} from '../models/store-settings.model.ts';
import type { UpdateStoreSettingsInput } from '../validators/store-settings.validator.ts';

/**
 * การตั้งค่าร้าน (STEP 49)
 *
 * ⚠️ **ทุกที่ที่ใช้ข้อมูลร้านต้องอ่านผ่าน `getStoreSettings()`** — หน้าร้าน · บทความคลังความรู้
 *    (ตัวแปร `{{store.*}}` `{{returns.*}}` `{{payment.*}}`) · AI Customer Service · ช่องทางชำระเงิน ·
 *    การสร้างคำสั่งซื้อ (snapshot จำนวนวันที่คืนได้) · สิทธิ์ขอคืนสินค้า
 *    อ่านใหม่ทุกคำขอ (แถวเดียว ~1ms) — ไม่มีสำเนาที่ค้างค่าเก่า (แพตเทิร์นเดียวกับค่าส่งของ STEP 44)
 */

type Db = PrismaClient | Prisma.TransactionClient;

async function loadRow(db: Db): Promise<StoreSettingRow> {
  const row = await db.storeSetting.findUnique({ where: { id: 1 }, select: STORE_SETTINGS_SELECT });

  if (row === null) {
    // แถวนี้มาจาก migration 20261008120000_add_store_settings — หายแปลว่า deploy ไม่ครบ ไม่ใช่ความผิดของผู้ใช้
    throw new Error(
      'ไม่พบแถวการตั้งค่าร้าน (StoreSetting id = 1) — ตรวจว่ารัน prisma migrate deploy แล้ว',
    );
  }

  return row;
}

export async function getStoreSettings(db: Db = getPrisma()): Promise<StoreSettings> {
  return toStoreSettings(await loadRow(db));
}

/* ═══════════════════════ หน้าร้าน ═══════════════════════ */

export interface StoreInfoDto {
  description: string;
  contactEmail: string | null;
  contactPhone: string | null;
  /** เฉพาะโซเชียลที่ร้านมีจริง */
  socialLinks: SocialLink[];
  /** ช่องทางติดต่อทั้งหมดที่เปิดอยู่ (แชตบนเว็บมีเสมอ) — รายการเดียวกับที่บทความและ AI ใช้ */
  contactChannels: StoreContactChannel[];
  agentHours: string;
  aiHours: string;
  shippingDays: string;
  /** "12:00 น." */
  cutoffTime: string;
  returnWindowDays: number;
  codMaxTotal: number;
}

export function toStoreInfo(settings: StoreSettings): StoreInfoDto {
  return {
    description: settings.description,
    contactEmail: settings.contactEmail,
    contactPhone: settings.contactPhone,
    socialLinks: socialLinksOf(settings),
    contactChannels: contactChannelsOf(settings),
    agentHours: settings.agentHours,
    aiHours: STORE_AI_HOURS,
    shippingDays: settings.shippingDays,
    cutoffTime: formatCutoffTime(settings.cutoffTime),
    returnWindowDays: settings.returnWindowDays,
    codMaxTotal: settings.codMaxTotal,
  };
}

export async function getStoreInfo(): Promise<StoreInfoDto> {
  return toStoreInfo(await getStoreSettings());
}

/* ═══════════════════════ หลังบ้าน ═══════════════════════ */

export interface AdminStoreSettingsDto {
  settings: StoreSettings & { updatedAt: string };
  /** ขอบเขตของค่า — ฟอร์มอ่านจากที่นี่ ไม่พิมพ์ตัวเลขเอง */
  limits: typeof STORE_SETTING_LIMITS;
  socialPlatforms: { field: string; label: string; example: string }[];
}

function toAdminDto(row: StoreSettingRow): AdminStoreSettingsDto {
  return {
    settings: { ...toStoreSettings(row), updatedAt: row.updatedAt.toISOString() },
    limits: STORE_SETTING_LIMITS,
    socialPlatforms: SOCIAL_PLATFORMS.map(({ field, label, example }) => ({
      field,
      label,
      example,
    })),
  };
}

export async function adminGetStoreSettings(): Promise<AdminStoreSettingsDto> {
  return toAdminDto(await loadRow(getPrisma()));
}

type SettingKey = keyof UpdateStoreSettingsInput;

/**
 * แก้การตั้งค่าร้าน (`settings:manage` = ADMIN ขึ้นไป)
 *
 * - บันทึกเฉพาะช่องที่ค่าเปลี่ยนจริง · ไม่มีอะไรเปลี่ยน = ไม่เขียนทั้งแถวและ log
 * - AdminLog ในทรานแซกชันเดียวกัน · `before` กับ `after` มีคีย์ชุดเดียวกัน (กฎ STEP 27)
 * - ล็อกแถวก่อนอ่านค่าเดิม — สองคนแก้พร้อมกัน log ต้องบอก "จาก X เป็น Y" ที่เกิดขึ้นจริง
 * - ⚠️ จำนวนวันที่คืนได้มีผลกับคำสั่งซื้อ **ใหม่** · ใบเดิมใช้ค่าที่ยาวกว่าระหว่างของมันกับค่าใหม่
 *   (`effectiveReturnWindowDays`) — ร้านลดวันลงแล้วไม่มีใครเสียสิทธิ์ย้อนหลัง
 */
export async function adminUpdateStoreSettings(
  actor: AdminLogActor,
  input: UpdateStoreSettingsInput,
): Promise<AdminStoreSettingsDto> {
  return getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "StoreSetting" WHERE "id" = 1 FOR UPDATE`;

    const currentRow = await loadRow(tx);
    const before = toStoreSettings(currentRow);
    const keys = (Object.keys(input) as SettingKey[]).filter(
      (key) => input[key] !== undefined && input[key] !== before[key],
    );

    if (keys.length === 0) return toAdminDto(currentRow);

    const data = Object.fromEntries(
      keys.map((key) => [key, input[key]]),
    ) as Prisma.StoreSettingUpdateInput;
    const updatedRow = await tx.storeSetting.update({
      where: { id: 1 },
      data,
      select: STORE_SETTINGS_SELECT,
    });
    const after = toStoreSettings(updatedRow);
    const pick = (settings: StoreSettings) =>
      Object.fromEntries(keys.map((key) => [key, settings[key]])) as Prisma.InputJsonObject;

    await writeAdminLog(tx, {
      actor,
      action: 'settings.store.update',
      targetType: 'StoreSetting',
      targetId: '1',
      before: pick(before),
      after: pick(after),
    });

    return toAdminDto(updatedRow);
  });
}
