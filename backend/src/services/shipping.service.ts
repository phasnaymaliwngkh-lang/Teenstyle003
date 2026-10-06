import { getPrisma, type Prisma, type PrismaClient } from '@teenstyle/database';

import type { ShippingMethodCode } from '../config/shipping.ts';
import { writeAdminLog, type AdminLogActor } from '../models/admin-log.model.ts';
import {
  SHIPPING_RATE_SELECT,
  THAI_PROVINCES,
  toShippingOption,
  type ShippingOption,
} from '../models/shipping.model.ts';
import { ApiError } from '../utils/api-error.ts';
import type { UpdateShippingRateInput } from '../validators/shipping.validator.ts';

/**
 * อัตราค่าจัดส่ง (STEP 44)
 *
 * ⚠️ **ทุกที่ที่คิดค่าส่งต้องอ่านผ่านไฟล์นี้** — หน้า checkout · การสร้างคำสั่งซื้อ · คูปองส่งฟรี ·
 *    บทความนโยบาย · AI Customer Service · หน้าแรก — ตัวเลขชุดเดียวกันจากตาราง `ShippingRate`
 *    (เดิมเป็นค่าคงที่ใน config/shipping.ts ซึ่งร้านแก้เองไม่ได้)
 */

type Db = PrismaClient | Prisma.TransactionClient;

/** ทุกวิธี เรียงตามลำดับที่ร้านตั้ง — รวมวิธีที่ปิดไว้ (ผู้เรียกกรองเอง) */
export async function loadShippingOptions(db: Db = getPrisma()): Promise<ShippingOption[]> {
  const rows = await db.shippingRate.findMany({
    select: SHIPPING_RATE_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { method: 'asc' }],
  });

  return rows.map(toShippingOption);
}

/** วิธีที่ลูกค้าเลือกได้ตอนนี้ */
export async function activeShippingOptions(db: Db = getPrisma()): Promise<ShippingOption[]> {
  return (await loadShippingOptions(db)).filter((option) => option.isActive);
}

/**
 * วิธีจัดส่งที่จะใช้คิดเงินจริง — ปิดอยู่ = ปฏิเสธพร้อมเหตุผล (409) ไม่ใช่คิดตามอัตราเดิมเงียบ ๆ
 * ใช้ในทรานแซกชันของการสร้างคำสั่งซื้อ จึงอ่านค่าชุดเดียวกับที่บันทึก
 */
export async function requireActiveShippingOption(
  db: Db,
  code: ShippingMethodCode,
): Promise<ShippingOption> {
  const row = await db.shippingRate.findUnique({
    where: { method: code },
    select: SHIPPING_RATE_SELECT,
  });

  if (row === null || !row.isActive) {
    throw ApiError.conflict('ร้านปิดวิธีจัดส่งนี้แล้ว — กรุณาเลือกวิธีอื่น');
  }

  return toShippingOption(row);
}

/* ═══════════════════════ หลังบ้าน ═══════════════════════ */

export interface AdminShippingRatesDto {
  rates: (ShippingOption & { updatedAt: string })[];
  /** ชื่อจังหวัดที่ใส่ใน "เฉพาะจังหวัด" ได้ — ฟอร์มอ่านจากที่นี่ ไม่พิมพ์รายการเอง */
  provinces: readonly string[];
}

export async function adminListShippingRates(): Promise<AdminShippingRatesDto> {
  const rows = await getPrisma().shippingRate.findMany({
    select: SHIPPING_RATE_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { method: 'asc' }],
  });

  return {
    rates: rows.map((row) => ({
      ...toShippingOption(row),
      updatedAt: row.updatedAt.toISOString(),
    })),
    provinces: THAI_PROVINCES,
  };
}

/** ค่าที่บันทึกลง AdminLog — `before` กับ `after` ต้องมีคีย์ชุดเดียวกัน (กฎ STEP 27) */
function snapshotOf(option: ShippingOption, keys: readonly (keyof UpdateShippingRateInput)[]) {
  const all = {
    description: option.description,
    baseFee: option.baseFee,
    freeOverSubtotal: option.freeOverSubtotal,
    etaText: option.etaText,
    onlyProvinces: option.onlyProvinces ?? [],
    isActive: option.isActive,
  };

  return Object.fromEntries(keys.map((key) => [key, all[key]])) as Prisma.InputJsonObject;
}

/**
 * แก้อัตราค่าจัดส่ง (`settings:manage` = ADMIN ขึ้นไป)
 *
 * ⚠️ **ปิดวิธีสุดท้ายที่เปิดอยู่ไม่ได้** — ไม่เหลือวิธีจัดส่ง = ทั้งร้านสั่งซื้อไม่ได้
 *    ล็อกทุกแถวก่อนนับ ไม่งั้นแอดมินสองคนปิดคนละวิธีพร้อมกันแล้วเหลือศูนย์ได้
 * ⚠️ มีผลกับคำสั่งซื้อ **ใหม่** เท่านั้น — ใบที่สั่งไปแล้วเก็บค่าส่งและระยะเวลาเป็น snapshot ไว้
 *    คนที่เปิดหน้า checkout ค้างไว้จะถูกปฏิเสธตอนกดสั่งถ้ายอดไม่ตรงกับที่เห็น (`expectedTotal`)
 */
export async function adminUpdateShippingRate(
  actor: AdminLogActor,
  method: ShippingMethodCode,
  input: UpdateShippingRateInput,
): Promise<ShippingOption> {
  const keys = (Object.keys(input) as (keyof UpdateShippingRateInput)[]).filter(
    (key) => input[key] !== undefined,
  );

  return getPrisma().$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "ShippingRate" ORDER BY "method" FOR UPDATE`;

    const row = await tx.shippingRate.findUnique({
      where: { method },
      select: SHIPPING_RATE_SELECT,
    });

    if (row === null) throw ApiError.notFound('ไม่พบวิธีจัดส่งนี้');

    const before = toShippingOption(row);

    if (input.isActive === false && before.isActive) {
      const othersActive = await tx.shippingRate.count({
        where: { isActive: true, method: { not: method } },
      });

      if (othersActive === 0) {
        throw ApiError.conflict(
          'ปิดวิธีนี้ไม่ได้ — เป็นวิธีจัดส่งเดียวที่เปิดอยู่ ถ้าปิดลูกค้าจะสั่งซื้อไม่ได้เลย',
        );
      }
    }

    const updated = await tx.shippingRate.update({
      where: { method },
      data: {
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.baseFee !== undefined ? { baseFee: input.baseFee } : {}),
        ...(input.freeOverSubtotal !== undefined
          ? { freeOverSubtotal: input.freeOverSubtotal }
          : {}),
        ...(input.etaText !== undefined ? { etaText: input.etaText } : {}),
        ...(input.onlyProvinces !== undefined ? { onlyProvinces: input.onlyProvinces } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: SHIPPING_RATE_SELECT,
    });

    const after = toShippingOption(updated);

    await writeAdminLog(tx, {
      actor,
      action: 'shipping.rate.update',
      targetType: 'ShippingRate',
      targetId: method,
      before: snapshotOf(before, keys),
      after: snapshotOf(after, keys),
    });

    return after;
  });
}
