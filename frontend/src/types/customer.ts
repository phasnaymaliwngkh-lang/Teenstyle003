/**
 * Type ของข้อมูลลูกค้า (STEP 25) — ต้องตรงกับ DTO ฝั่ง backend
 *   backend/src/models/customer.model.ts
 *   backend/src/services/customer.service.ts
 *   backend/src/services/admin-customer.service.ts
 */

export const USER_STATUSES = ["ACTIVE", "SUSPENDED", "BANNED"] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

export const ROLE_NAMES = ["CUSTOMER", "EMPLOYEE", "ADMIN", "SUPER_ADMIN"] as const;
export type CustomerRoleName = (typeof ROLE_NAMES)[number];

export const LOYALTY_TIERS = ["MEMBER", "SILVER", "GOLD", "VIP"] as const;
export type LoyaltyTier = (typeof LOYALTY_TIERS)[number];

export interface Address {
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

export interface AddressListResult {
  items: Address[];
  total: number;
}

/** ข้อมูลส่วนตัวของเจ้าของบัญชี */
export interface MyProfile {
  id: string;
  /** อ่านได้ แก้ไม่ได้ — ผูกกับบัญชี Google ที่ใช้เข้าสู่ระบบ */
  email: string;
  emailVerified: boolean;
  name: string | null;
  /** รูปจาก Google — ยังอัปโหลดเองไม่ได้ (STEP 47) */
  image: string | null;
  phone: string | null;
  /** YYYY-MM-DD */
  birthDate: string | null;
  allowPersonalization: boolean;
  role: string;
  loyaltyTier: string;
  points: number;
  status: string;
  lastLoginAt: string | null;
  memberSince: string;
  addressCount: number;
}

/** ส่งมาเฉพาะฟิลด์ที่เปลี่ยน · null = ล้างค่า */
export interface UpdateProfileInput {
  name?: string;
  phone?: string | null;
  birthDate?: string | null;
  allowPersonalization?: boolean;
}

export interface AddressInput {
  label?: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string | null;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  isDefault?: boolean;
}

export type UpdateAddressInput = Partial<AddressInput>;

export interface DeleteAddressResult {
  deleted: true;
  /** ที่อยู่ที่ถูกเลื่อนขึ้นมาเป็นค่าเริ่มต้นแทน (null = ไม่มีการเลื่อน) */
  newDefaultAddressId: string | null;
}

/* ─────────────────────── มุมมองของพนักงาน ─────────────────────── */

/**
 * ยอดซื้อที่คิดจากตาราง `Order` จริง
 *
 * ⚠️ **ไม่ใช่คอลัมน์ `User.totalSpent`** ซึ่งยังไม่มีใครเขียน (จะมาพร้อม STEP 42)
 */
export interface CustomerOrderStats {
  totalOrders: number;
  paidOrders: number;
  /** ยอดที่ได้รับเงินจริง */
  totalPaid: number;
  /** COD ที่ยังไม่เก็บเงิน — ยังไม่ใช่รายได้ */
  pendingCodAmount: number;
  lastOrderAt: string | null;
}

export interface AdminCustomer {
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

export interface AdminCustomerListResult {
  items: AdminCustomer[];
  /** ตัวเลขของทั้งระบบ ไม่ใช่ของหน้าปัจจุบัน */
  counts: {
    customers: number;
    staff: number;
    suspended: number;
    newLast30Days: number;
  };
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface AdminCustomerOrderSummary {
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  createdAt: string;
}

export interface AdminCustomerDetail extends AdminCustomer {
  image: string | null;
  birthDate: string | null;
  allowPersonalization: boolean;
  addresses: Address[];
  recentOrders: AdminCustomerOrderSummary[];
  reviewCount: number;
  wishlistCount: number;
  /** จำนวนเครื่องที่ยังล็อกอินค้างอยู่ */
  activeSessions: number;
}

export interface UpdateCustomerStatusInput {
  status: UserStatus;
  /** บังคับกรอก — ถูกบันทึกลง AdminLog */
  reason: string;
}

export interface UpdateCustomerRoleInput {
  role: CustomerRoleName;
  reason: string;
}
