import { apiFetch } from "@/lib/api";
import type { AdminStoreSettings, StoreInfo, UpdateStoreSettingsInput } from "@/types/store";

/**
 * ข้อมูลร้าน (STEP 49)
 *
 * ข้อมูลสาธารณะ — แคช 60 วินาทีเท่ากับข้อมูลหน้าร้านอื่น (ร้านแก้แล้ว footer/หน้าเกี่ยวกับเราเห็นช้าได้ถึง
 * 60 วินาที) · **ด่านที่เกี่ยวกับเงินไม่ใช้ค่านี้**: COD และสิทธิ์คืนสินค้าตัดสินที่ backend จากค่าล่าสุดเสมอ
 */
export function fetchStoreInfo(): Promise<StoreInfo> {
  return apiFetch<StoreInfo>("/api/store", { next: { revalidate: 60, tags: ["store"] } });
}

export function updateStoreSettings(input: UpdateStoreSettingsInput): Promise<AdminStoreSettings> {
  return apiFetch<AdminStoreSettings>("/api/admin/settings", {
    method: "PATCH",
    json: input,
    cache: "no-store",
  });
}
