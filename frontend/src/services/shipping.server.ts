import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type { AdminShipmentDetail, AdminShipmentList, AdminShippingRates } from "@/types/shipping";

/**
 * อ่านข้อมูลการจัดส่งของหลังบ้านจากฝั่ง server (STEP 44)
 *
 * `cache: "no-store"` ทุกเส้นทาง — อัตราค่าส่งคือเงินที่เก็บจากลูกค้า และสถานะพัสดุเปลี่ยนตลอด
 * แอดมินต้องเห็นค่าล่าสุดเสมอ
 */

export function fetchAdminShippingRatesOnServer(): Promise<AdminShippingRates> {
  return apiFetchAsUser<AdminShippingRates>("/api/admin/shipping/rates", { cache: "no-store" });
}

export function fetchAdminShipmentsOnServer(params: URLSearchParams): Promise<AdminShipmentList> {
  const qs = params.toString();

  return apiFetchAsUser<AdminShipmentList>(`/api/admin/shipments${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export function fetchAdminShipmentOnServer(shipmentId: string): Promise<AdminShipmentDetail> {
  return apiFetchAsUser<AdminShipmentDetail>(
    `/api/admin/shipments/${encodeURIComponent(shipmentId)}`,
    { cache: "no-store" },
  );
}
