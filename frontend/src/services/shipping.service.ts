import { apiFetch } from "@/lib/api";
import type {
  AdminShipmentDetail,
  CreateShipmentInput,
  PublicShippingOptions,
  ShippingMethodCode,
  ShippingRate,
  UpdateShipmentInput,
  UpdateShippingRateInput,
} from "@/types/shipping";

/**
 * การจัดส่ง (STEP 44)
 *
 * วิธีจัดส่งที่เปิดใช้เป็นข้อมูลสาธารณะ — แคช 60 วินาทีเท่ากับข้อมูลหน้าร้านอื่น
 * (ร้านแก้ค่าส่งแล้วหน้าแรกเห็นช้าได้ถึง 60 วินาที · **หน้า checkout ไม่ใช้ค่านี้** — อ่านสดจาก
 * `/api/checkout/summary` และ server ปฏิเสธถ้ายอดที่เห็นไม่ตรงกับที่คิดได้)
 */
export function fetchShippingOptions(): Promise<PublicShippingOptions> {
  return apiFetch<PublicShippingOptions>("/api/shipping/options", {
    next: { revalidate: 60, tags: ["shipping"] },
  });
}

export function updateShippingRate(
  method: ShippingMethodCode,
  input: UpdateShippingRateInput,
): Promise<ShippingRate> {
  return apiFetch<ShippingRate>(`/api/admin/shipping/rates/${encodeURIComponent(method)}`, {
    method: "PATCH",
    json: input,
    cache: "no-store",
  });
}

export function updateShipmentStatus(
  shipmentId: string,
  input: { status: "IN_TRANSIT" | "FAILED" | "RETURNED"; note?: string },
): Promise<AdminShipmentDetail> {
  return apiFetch<AdminShipmentDetail>(
    `/api/admin/shipments/${encodeURIComponent(shipmentId)}/status`,
    { method: "PATCH", json: input, cache: "no-store" },
  );
}

export function updateShipment(
  shipmentId: string,
  input: UpdateShipmentInput,
): Promise<AdminShipmentDetail> {
  return apiFetch<AdminShipmentDetail>(`/api/admin/shipments/${encodeURIComponent(shipmentId)}`, {
    method: "PATCH",
    json: input,
    cache: "no-store",
  });
}

export function createShipment(
  orderNumber: string,
  input: CreateShipmentInput,
): Promise<AdminShipmentDetail> {
  return apiFetch<AdminShipmentDetail>(
    `/api/admin/orders/${encodeURIComponent(orderNumber)}/shipments`,
    { method: "POST", json: input, cache: "no-store" },
  );
}
