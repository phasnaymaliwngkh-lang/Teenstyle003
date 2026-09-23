import { getPrisma, type Prisma } from '@teenstyle/database';

import {
  ADDRESS_SELECT,
  MY_PROFILE_SELECT,
  toAddressDto,
  toMyProfileDto,
  type AddressDto,
  type MyProfileDto,
} from '../models/customer.model.ts';
import { ApiError } from '../utils/api-error.ts';
import type {
  CreateAddressInput,
  UpdateAddressInput,
  UpdateMyProfileInput,
} from '../validators/customer.validator.ts';

/**
 * ข้อมูลส่วนตัวและสมุดที่อยู่ของเจ้าของบัญชี (STEP 25)
 *
 * กฎที่ห้ามละเมิด
 *
 *   1. **ทุกคิวรีกรอง `userId` ของผู้เรียกเสมอ** — ไม่เจอคืน **404 ไม่ใช่ 403**
 *      (ไม่บอกใบ้ว่ามี id นั้นอยู่จริง · แพตเทิร์นเดียวกับตะกร้า STEP 9 ข้อ 4)
 *   2. **หนึ่งบัญชีมีที่อยู่เริ่มต้นได้ที่อยู่เดียว** — ตั้งอันใหม่ต้องปลดอันเดิม
 *      ในทรานแซกชันเดียวกัน ไม่งั้น checkout จะเลือกที่อยู่ไม่แน่นอน
 *   3. **ลบที่อยู่เป็น soft delete** เพราะ `Order.shippingAddressId` ยังอ้างถึงแถวนั้น
 *      ลบจริงจะทำให้ประวัติคำสั่งซื้อเสีย (หรือ FK พัง)
 *   4. **แก้ที่อยู่ไม่กระทบคำสั่งซื้อที่สั่งไปแล้ว** — ออเดอร์ใช้ `Order.addressSnapshot`
 *      ที่ถ่ายไว้ตอนสั่ง (STEP 10 ข้อ 5) → หน้าเว็บต้องบอกเรื่องนี้ตรง ๆ
 *      ไม่งั้นลูกค้าจะเข้าใจว่าแก้ที่อยู่แล้วของที่กำลังส่งจะเปลี่ยนปลายทางตาม
 *   5. **ลูกค้าแก้ได้แค่ข้อมูลที่ตัวเองกรอก** — บทบาท สถานะ แต้ม ระดับสมาชิก และอีเมล
 *      ไม่อยู่ในสคีมาของ PATCH เลย (ดู customer.validator.ts)
 */

/** กันสมุดที่อยู่บวมไม่จำกัด — ลูกค้าจริงไม่มีใครมีเกินนี้ */
const MAX_ADDRESSES_PER_USER = 20;

/** แปลง `YYYY-MM-DD` เป็นเที่ยงคืน UTC ให้ตรงกับคอลัมน์ `@db.Date` */
function toDateColumn(value: string | null): Date | null {
  return value === null ? null : new Date(`${value}T00:00:00.000Z`);
}

export async function getMyProfile(userId: string): Promise<MyProfileDto> {
  const prisma = getPrisma();

  const [user, addressCount] = await Promise.all([
    prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: MY_PROFILE_SELECT }),
    prisma.address.count({ where: { userId, deletedAt: null } }),
  ]);

  if (!user) {
    throw ApiError.notFound('ไม่พบบัญชีนี้');
  }

  return toMyProfileDto(user, addressCount);
}

/**
 * แก้ข้อมูลส่วนตัวของตัวเอง
 *
 * ส่งมาเฉพาะฟิลด์ที่เปลี่ยน · `null` = ล้างค่า · ไม่ส่ง = ไม่แตะ
 * ไม่เขียน `AdminLog` เพราะนี่คือเจ้าของบัญชีแก้ข้อมูลตัวเอง ไม่ใช่การกระทำของพนักงาน
 */
export async function updateMyProfile(
  userId: string,
  input: UpdateMyProfileInput,
): Promise<MyProfileDto> {
  const prisma = getPrisma();

  const data: Prisma.UserUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.birthDate !== undefined) data.birthDate = toDateColumn(input.birthDate);
  if (input.allowPersonalization !== undefined)
    data.allowPersonalization = input.allowPersonalization;

  const existing = await prisma.user.findFirst({
    where: { id: userId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) {
    throw ApiError.notFound('ไม่พบบัญชีนี้');
  }

  const [updated, addressCount] = await Promise.all([
    prisma.user.update({ where: { id: userId }, data, select: MY_PROFILE_SELECT }),
    prisma.address.count({ where: { userId, deletedAt: null } }),
  ]);

  return toMyProfileDto(updated, addressCount);
}

/** สมุดที่อยู่ — ที่อยู่เริ่มต้นมาก่อนเสมอ */
export async function listMyAddresses(userId: string): Promise<AddressDto[]> {
  const rows = await getPrisma().address.findMany({
    where: { userId, deletedAt: null },
    orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }],
    select: ADDRESS_SELECT,
  });

  return rows.map(toAddressDto);
}

/** หาที่อยู่ของผู้เรียกเอง — ไม่ใช่ของเราคืน 404 (ไม่บอกใบ้ว่ามี id นี้อยู่) */
async function findOwnedAddress(
  tx: Prisma.TransactionClient,
  userId: string,
  addressId: string,
): Promise<{ id: string; isDefault: boolean }> {
  const address = await tx.address.findFirst({
    where: { id: addressId, userId, deletedAt: null },
    select: { id: true, isDefault: true },
  });

  if (!address) {
    throw ApiError.notFound('ไม่พบที่อยู่นี้ในสมุดที่อยู่ของคุณ');
  }

  return address;
}

export async function createMyAddress(
  userId: string,
  input: CreateAddressInput,
): Promise<AddressDto> {
  const prisma = getPrisma();

  const created = await prisma.$transaction(async (tx) => {
    const existingCount = await tx.address.count({ where: { userId, deletedAt: null } });

    if (existingCount >= MAX_ADDRESSES_PER_USER) {
      throw ApiError.conflict(
        `เก็บที่อยู่ได้ไม่เกิน ${MAX_ADDRESSES_PER_USER} แห่ง — ลบที่ไม่ใช้แล้วออกก่อน`,
      );
    }

    // ที่อยู่แรกของบัญชีต้องเป็นค่าเริ่มต้น ไม่งั้น checkout จะไม่มีที่อยู่ให้เลือกล่วงหน้า
    const makeDefault = existingCount === 0 ? true : (input.isDefault ?? false);

    if (makeDefault && existingCount > 0) {
      await tx.address.updateMany({
        where: { userId, deletedAt: null, isDefault: true },
        data: { isDefault: false },
      });
    }

    return tx.address.create({
      data: {
        userId,
        label: input.label ?? null,
        recipientName: input.recipientName,
        phone: input.phone,
        line1: input.line1,
        line2: input.line2 ?? null,
        subDistrict: input.subDistrict,
        district: input.district,
        province: input.province,
        postalCode: input.postalCode,
        isDefault: makeDefault,
      },
      select: ADDRESS_SELECT,
    });
  });

  return toAddressDto(created);
}

export async function updateMyAddress(
  userId: string,
  addressId: string,
  input: UpdateAddressInput,
): Promise<AddressDto> {
  const prisma = getPrisma();

  const updated = await prisma.$transaction(async (tx) => {
    const current = await findOwnedAddress(tx, userId, addressId);

    /**
     * ปลดที่อยู่เริ่มต้นด้วยการส่ง `isDefault: false` ไม่ได้
     * เพราะบัญชีที่มีที่อยู่แต่ไม่มีอันไหนเป็นค่าเริ่มต้น จะทำให้ checkout เลือกไม่แน่นอน
     * วิธีเปลี่ยนคือ **ตั้งที่อยู่อื่นเป็นค่าเริ่มต้น** แล้วอันนี้จะถูกปลดให้เอง
     */
    if (input.isDefault === false && current.isDefault) {
      throw ApiError.badRequest(
        'ต้องมีที่อยู่เริ่มต้นหนึ่งแห่งเสมอ — เลือกที่อยู่อื่นเป็นค่าเริ่มต้นแทน',
      );
    }

    if (input.isDefault === true && !current.isDefault) {
      await tx.address.updateMany({
        where: { userId, deletedAt: null, isDefault: true },
        data: { isDefault: false },
      });
    }

    const data: Prisma.AddressUpdateInput = {};
    if (input.label !== undefined) data.label = input.label ?? null;
    if (input.recipientName !== undefined) data.recipientName = input.recipientName;
    if (input.phone !== undefined) data.phone = input.phone;
    if (input.line1 !== undefined) data.line1 = input.line1;
    if (input.line2 !== undefined) data.line2 = input.line2 ?? null;
    if (input.subDistrict !== undefined) data.subDistrict = input.subDistrict;
    if (input.district !== undefined) data.district = input.district;
    if (input.province !== undefined) data.province = input.province;
    if (input.postalCode !== undefined) data.postalCode = input.postalCode;
    if (input.isDefault === true) data.isDefault = true;

    return tx.address.update({ where: { id: addressId }, data, select: ADDRESS_SELECT });
  });

  return toAddressDto(updated);
}

/** ตั้งเป็นที่อยู่เริ่มต้น — ปลดอันเดิมในทรานแซกชันเดียวกัน */
export async function setMyDefaultAddress(userId: string, addressId: string): Promise<AddressDto> {
  const prisma = getPrisma();

  const updated = await prisma.$transaction(async (tx) => {
    const current = await findOwnedAddress(tx, userId, addressId);

    if (current.isDefault) {
      // เป็นค่าเริ่มต้นอยู่แล้ว — กดซ้ำไม่ถือว่าผิด (idempotent)
      return tx.address.findFirstOrThrow({ where: { id: addressId }, select: ADDRESS_SELECT });
    }

    await tx.address.updateMany({
      where: { userId, deletedAt: null, isDefault: true },
      data: { isDefault: false },
    });

    return tx.address.update({
      where: { id: addressId },
      data: { isDefault: true },
      select: ADDRESS_SELECT,
    });
  });

  return toAddressDto(updated);
}

/**
 * ลบที่อยู่ — **soft delete** เพราะคำสั่งซื้อเก่ายังอ้างถึงแถวนี้อยู่ (`Order.shippingAddressId`)
 *
 * ลบอันที่เป็นค่าเริ่มต้นแล้วต้องเลื่อนอันอื่นขึ้นมาแทนในทรานแซกชันเดียวกัน
 * ไม่งั้นบัญชีจะมีที่อยู่อยู่แต่ไม่มีค่าเริ่มต้น
 */
export async function deleteMyAddress(
  userId: string,
  addressId: string,
): Promise<{ deleted: true; newDefaultAddressId: string | null }> {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const current = await findOwnedAddress(tx, userId, addressId);

    await tx.address.update({
      where: { id: addressId },
      data: { deletedAt: new Date(), isDefault: false },
    });

    if (!current.isDefault) {
      return { deleted: true as const, newDefaultAddressId: null };
    }

    const next = await tx.address.findFirst({
      where: { userId, deletedAt: null },
      orderBy: { updatedAt: 'desc' },
      select: { id: true },
    });

    if (!next) {
      // ไม่มีที่อยู่เหลือแล้ว — ยอมได้ เพราะ checkout ยังกรอกที่อยู่ใหม่ได้
      return { deleted: true as const, newDefaultAddressId: null };
    }

    await tx.address.update({ where: { id: next.id }, data: { isDefault: true } });

    return { deleted: true as const, newDefaultAddressId: next.id };
  });
}
