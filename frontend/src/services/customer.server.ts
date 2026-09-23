import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type {
  AddressListResult,
  AdminCustomerDetail,
  AdminCustomerListResult,
  MyProfile,
} from "@/types/customer";

/**
 * อ่านข้อมูลลูกค้าจากฝั่ง server (STEP 25)
 *
 * `cache: "no-store"` ทุกเส้นทาง — เป็นข้อมูลส่วนบุคคล **ห้ามถูกแคชร่วมกับผู้ใช้คนอื่น**
 * (แคชของ Next แชร์ระหว่างคำขอ จึงเสี่ยงเอาชื่อ/ที่อยู่ของคนหนึ่งไปโชว์ให้อีกคน)
 */

export function fetchMyProfileOnServer(): Promise<MyProfile> {
  return apiFetchAsUser<MyProfile>("/api/users/me/profile", { cache: "no-store" });
}

export function fetchMyAddressesOnServer(): Promise<AddressListResult> {
  return apiFetchAsUser<AddressListResult>("/api/users/me/addresses", { cache: "no-store" });
}

export function fetchAdminCustomersOnServer(
  params: URLSearchParams,
): Promise<AdminCustomerListResult> {
  const qs = params.toString();

  return apiFetchAsUser<AdminCustomerListResult>(`/api/admin/customers${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export function fetchAdminCustomerOnServer(userId: string): Promise<AdminCustomerDetail> {
  return apiFetchAsUser<AdminCustomerDetail>(`/api/admin/customers/${encodeURIComponent(userId)}`, {
    cache: "no-store",
  });
}
