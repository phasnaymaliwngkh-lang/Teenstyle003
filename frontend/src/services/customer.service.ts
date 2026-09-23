import { apiFetch } from "@/lib/api";
import type {
  Address,
  AddressInput,
  AdminCustomerDetail,
  DeleteAddressResult,
  MyProfile,
  UpdateAddressInput,
  UpdateCustomerRoleInput,
  UpdateCustomerStatusInput,
  UpdateProfileInput,
} from "@/types/customer";

/**
 * ชั้นเดียวที่เรียก API ข้อมูลลูกค้าจากฝั่ง client (STEP 25)
 *
 * ⚠️ ฝั่งลูกค้าแก้ได้แค่ชื่อ เบอร์โทร วันเกิด การตั้งค่าการแนะนำ และที่อยู่ของตัวเอง
 *    **อีเมล บทบาท สถานะ แต้ม และระดับสมาชิกส่งไปก็ถูก backend ตัดทิ้ง**
 *    เจ้าของข้อมูลมาจาก session ไม่มี endpoint ไหนรับ `userId` จาก client
 */

export function updateMyProfile(input: UpdateProfileInput): Promise<MyProfile> {
  return apiFetch<MyProfile>("/api/users/me/profile", {
    method: "PATCH",
    json: input,
    cache: "no-store",
  });
}

export function createMyAddress(input: AddressInput): Promise<Address> {
  return apiFetch<Address>("/api/users/me/addresses", {
    method: "POST",
    json: input,
    cache: "no-store",
  });
}

export function updateMyAddress(addressId: string, input: UpdateAddressInput): Promise<Address> {
  return apiFetch<Address>(`/api/users/me/addresses/${encodeURIComponent(addressId)}`, {
    method: "PATCH",
    json: input,
    cache: "no-store",
  });
}

/** ตั้งเป็นที่อยู่เริ่มต้น — อันเดิมถูกปลดที่ backend ในทรานแซกชันเดียวกัน */
export function setMyDefaultAddress(addressId: string): Promise<Address> {
  return apiFetch<Address>(`/api/users/me/addresses/${encodeURIComponent(addressId)}/default`, {
    method: "PATCH",
    cache: "no-store",
  });
}

/** ลบออกจากสมุดที่อยู่ — เป็น soft delete ที่ backend (คำสั่งซื้อเก่ายังอ้างอิงได้) */
export function deleteMyAddress(addressId: string): Promise<DeleteAddressResult> {
  return apiFetch<DeleteAddressResult>(`/api/users/me/addresses/${encodeURIComponent(addressId)}`, {
    method: "DELETE",
    cache: "no-store",
  });
}

/* ─────────────────────── ฝั่งพนักงาน ─────────────────────── */

/**
 * ระงับ / ปลดระงับบัญชี (ต้องมีสิทธิ์ `customer:update`)
 *
 * ⚠️ `reason` บังคับกรอก — ถูกบันทึกลง `AdminLog`
 *    และการระงับจะ **เพิกถอน session ที่ค้างอยู่ทั้งหมด** ของบัญชีนั้น
 */
export function updateCustomerStatus(
  userId: string,
  input: UpdateCustomerStatusInput,
): Promise<AdminCustomerDetail> {
  return apiFetch<AdminCustomerDetail>(
    `/api/admin/customers/${encodeURIComponent(userId)}/status`,
    { method: "PATCH", json: input, cache: "no-store", timeoutMs: 30_000 },
  );
}

/** เปลี่ยนบทบาท (ต้องมีสิทธิ์ `user:role:manage`) — สิทธิ์ใหม่มีผลทันทีทุกคำขอถัดไป */
export function updateCustomerRole(
  userId: string,
  input: UpdateCustomerRoleInput,
): Promise<AdminCustomerDetail> {
  return apiFetch<AdminCustomerDetail>(`/api/admin/customers/${encodeURIComponent(userId)}/role`, {
    method: "PATCH",
    json: input,
    cache: "no-store",
    timeoutMs: 30_000,
  });
}
