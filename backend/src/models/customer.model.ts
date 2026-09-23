import type { Prisma } from '@teenstyle/database';

import { toNumber } from './pricing.ts';

/**
 * DTO ของข้อมูลลูกค้า (STEP 25)
 *
 * มีสองมุมมองที่ **ห้ามปนกัน**
 *
 *   1. `MyProfileDto` / `AddressDto` — สิ่งที่เจ้าของบัญชีเห็นและแก้ได้เอง
 *   2. `AdminCustomerListItemDto` / `AdminCustomerDetailDto` — สิ่งที่พนักงานเห็น
 *
 * ฝั่งลูกค้า **ไม่มีทาง** เห็นหรือแก้ `role` · `status` · `points` · `loyaltyTier` · `totalSpent`
 * เพราะเป็นค่าที่ร้านเป็นคนกำหนด ไม่ใช่ข้อมูลที่เจ้าของบัญชีกรอกเอง
 *
 * ⚠️ **ยอดซื้อในมุมมองพนักงานนับจากตาราง `Order` จริงทุกครั้ง ห้ามอ่านคอลัมน์ `User.totalSpent`**
 *    คอลัมน์นั้นเป็น cache ที่ยังไม่มีใครเขียน (จะมาพร้อมระบบแต้ม STEP 42)
 *    ค่าปัจจุบันคือ 0 ทุกคน — เอามาแสดงคือบอกร้านว่าลูกค้าทุกคนไม่เคยซื้ออะไรเลย
 *    (ปัญหาชนิดเดียวกับ `Product.totalStock` ที่ไม่ใช่ "จำนวนที่ขายได้จริง" — ดู STEP 15)
 */

export const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'BANNED'] as const;
export type UserStatusCode = (typeof USER_STATUSES)[number];

export const ROLE_NAMES = ['CUSTOMER', 'EMPLOYEE', 'ADMIN', 'SUPER_ADMIN'] as const;
export type RoleNameCode = (typeof ROLE_NAMES)[number];

export const LOYALTY_TIERS = ['MEMBER', 'SILVER', 'GOLD', 'VIP'] as const;
export type LoyaltyTierCode = (typeof LOYALTY_TIERS)[number];

/** บทบาทของพนักงาน — เรียงจากสิทธิ์น้อยไปมาก ใช้เทียบว่าใครแตะบัญชีใครได้ */
export const ROLE_RANK: Readonly<Record<RoleNameCode, number>> = {
  CUSTOMER: 0,
  EMPLOYEE: 1,
  ADMIN: 2,
  SUPER_ADMIN: 3,
};

/* ─────────────────────────── ที่อยู่ ─────────────────────────── */

export const ADDRESS_SELECT = {
  id: true,
  label: true,
  recipientName: true,
  phone: true,
  line1: true,
  line2: true,
  subDistrict: true,
  district: true,
  province: true,
  postalCode: true,
  country: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AddressSelect;

type AddressRow = Prisma.AddressGetPayload<{ select: typeof ADDRESS_SELECT }>;

export interface AddressDto {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export function toAddressDto(row: AddressRow): AddressDto {
  return {
    id: row.id,
    label: row.label,
    recipientName: row.recipientName,
    phone: row.phone,
    line1: row.line1,
    line2: row.line2,
    subDistrict: row.subDistrict,
    district: row.district,
    province: row.province,
    postalCode: row.postalCode,
    country: row.country,
    isDefault: row.isDefault,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** ที่อยู่แบบบรรทัดเดียว — ใช้แสดงในรายการและหน้าหลังบ้าน */
export function formatAddressLine(address: AddressDto): string {
  return [
    address.line1,
    address.line2,
    address.subDistrict,
    address.district,
    address.province,
    address.postalCode,
  ]
    .filter((part): part is string => part !== null && part.trim().length > 0)
    .join(' ');
}

/* ─────────────────────── โปรไฟล์ของตัวเอง ─────────────────────── */

export const MY_PROFILE_SELECT = {
  id: true,
  email: true,
  emailVerified: true,
  name: true,
  image: true,
  phone: true,
  birthDate: true,
  allowPersonalization: true,
  loyaltyTier: true,
  points: true,
  status: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { name: true } },
} satisfies Prisma.UserSelect;

type MyProfileRow = Prisma.UserGetPayload<{ select: typeof MY_PROFILE_SELECT }>;

export interface MyProfileDto {
  id: string;
  /** อ่านได้ แก้ไม่ได้ — เป็นตัวระบุตัวตนที่ผูกกับบัญชี Google */
  email: string;
  emailVerified: boolean;
  name: string | null;
  /** รูปจาก Google — ยังอัปโหลดเองไม่ได้ (STEP 47) */
  image: string | null;
  phone: string | null;
  /** รูปแบบ YYYY-MM-DD (คอลัมน์เป็น DATE ไม่มีเวลา) */
  birthDate: string | null;
  allowPersonalization: boolean;
  /** อ่านได้เพื่อแสดงบนหน้าบัญชี แต่แก้จากฝั่งลูกค้าไม่ได้ */
  role: string;
  loyaltyTier: string;
  points: number;
  status: string;
  lastLoginAt: string | null;
  memberSince: string;
  addressCount: number;
}

/**
 * แปลงคอลัมน์ DATE เป็น `YYYY-MM-DD`
 *
 * ⚠️ ห้ามใช้ `toLocaleDateString` หรือ getDate() ที่นี่ — Prisma คืนค่าของคอลัมน์ `@db.Date`
 *    เป็นเวลาเที่ยงคืน **UTC** เครื่องที่อยู่โซนเวลา +07:00 จะได้วันที่เลื่อนไปหนึ่งวัน
 */
export function toDateOnly(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

export function toMyProfileDto(row: MyProfileRow, addressCount: number): MyProfileDto {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified !== null,
    name: row.name,
    image: row.image,
    phone: row.phone,
    birthDate: toDateOnly(row.birthDate),
    allowPersonalization: row.allowPersonalization,
    role: row.role.name,
    loyaltyTier: row.loyaltyTier,
    points: row.points,
    status: row.status,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    memberSince: row.createdAt.toISOString(),
    addressCount,
  };
}

/* ────────────────────── มุมมองของพนักงาน ────────────────────── */

export const ADMIN_CUSTOMER_SELECT = {
  id: true,
  email: true,
  emailVerified: true,
  name: true,
  image: true,
  phone: true,
  birthDate: true,
  status: true,
  loyaltyTier: true,
  points: true,
  allowPersonalization: true,
  lastLoginAt: true,
  createdAt: true,
  role: { select: { name: true } },
} satisfies Prisma.UserSelect;

type AdminCustomerRow = Prisma.UserGetPayload<{ select: typeof ADMIN_CUSTOMER_SELECT }>;

/** ยอดที่คิดจากตาราง Order จริง — ไม่ใช่คอลัมน์ cache ของ User */
export interface CustomerOrderStats {
  /** จำนวนคำสั่งซื้อทั้งหมด (ทุกสถานะ ไม่นับที่ถูกลบ) */
  totalOrders: number;
  /** จำนวนคำสั่งซื้อที่ได้รับเงินแล้ว */
  paidOrders: number;
  /** ยอดเงินที่ได้รับจริง — เกณฑ์เดียวกับ dashboard STEP 13 */
  totalPaid: number;
  /** ยอดของออเดอร์ COD ที่ยังไม่ได้เก็บเงิน (ยังไม่ใช่รายได้) */
  pendingCodAmount: number;
  lastOrderAt: string | null;
}

export const EMPTY_ORDER_STATS: CustomerOrderStats = {
  totalOrders: 0,
  paidOrders: 0,
  totalPaid: 0,
  pendingCodAmount: 0,
  lastOrderAt: null,
};

export interface AdminCustomerListItemDto {
  id: string;
  email: string;
  emailVerified: boolean;
  name: string | null;
  phone: string | null;
  role: string;
  status: string;
  loyaltyTier: string;
  points: number;
  lastLoginAt: string | null;
  createdAt: string;
  stats: CustomerOrderStats;
}

export function toAdminCustomerListItem(
  row: AdminCustomerRow,
  stats: CustomerOrderStats,
): AdminCustomerListItemDto {
  return {
    id: row.id,
    email: row.email,
    emailVerified: row.emailVerified !== null,
    name: row.name,
    phone: row.phone,
    role: row.role.name,
    status: row.status,
    loyaltyTier: row.loyaltyTier,
    points: row.points,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    stats,
  };
}

export interface AdminCustomerOrderSummaryDto {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
}

export interface AdminCustomerDetailDto extends AdminCustomerListItemDto {
  image: string | null;
  birthDate: string | null;
  allowPersonalization: boolean;
  addresses: AddressDto[];
  /** คำสั่งซื้อล่าสุด (ไม่เกิน 10 ใบ) — ลิงก์ไปหน้าจัดการคำสั่งซื้อได้ */
  recentOrders: AdminCustomerOrderSummaryDto[];
  reviewCount: number;
  wishlistCount: number;
  /** จำนวน session ที่ยังใช้ได้อยู่ — บอกว่าบัญชีนี้ยังล็อกอินค้างอยู่กี่เครื่อง */
  activeSessions: number;
}

export function toAdminCustomerDetail(
  row: AdminCustomerRow,
  parts: {
    stats: CustomerOrderStats;
    addresses: AddressRow[];
    recentOrders: {
      orderNumber: string;
      status: string;
      paymentStatus: string;
      total: Prisma.Decimal | number | string;
      createdAt: Date;
    }[];
    reviewCount: number;
    wishlistCount: number;
    activeSessions: number;
  },
): AdminCustomerDetailDto {
  return {
    ...toAdminCustomerListItem(row, parts.stats),
    image: row.image,
    birthDate: toDateOnly(row.birthDate),
    allowPersonalization: row.allowPersonalization,
    addresses: parts.addresses.map(toAddressDto),
    recentOrders: parts.recentOrders.map((order) => ({
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      total: toNumber(order.total),
      createdAt: order.createdAt.toISOString(),
    })),
    reviewCount: parts.reviewCount,
    wishlistCount: parts.wishlistCount,
    activeSessions: parts.activeSessions,
  };
}
