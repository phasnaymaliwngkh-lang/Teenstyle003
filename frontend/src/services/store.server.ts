import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type { AdminStoreSettings } from "@/types/store";

/** การตั้งค่าร้านของหลังบ้าน (STEP 49) — `no-store` แอดมินต้องเห็นค่าล่าสุดก่อนแก้เสมอ */
export function fetchAdminStoreSettingsOnServer(): Promise<AdminStoreSettings> {
  return apiFetchAsUser<AdminStoreSettings>("/api/admin/settings", { cache: "no-store" });
}
