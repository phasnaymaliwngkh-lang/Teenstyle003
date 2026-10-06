/**
 * การจัดส่ง (STEP 44) — ตรงกับ DTO ของ backend
 * (services/shipping.service.ts · services/shipment.service.ts · controllers/shipping.controller.ts)
 */

import type { ShippingMethodCode } from "./catalog";

// รายชื่อวิธีจัดส่งมีที่เดียวที่ types/catalog.ts (SHIPPING_METHODS) — ไม่ประกาศซ้ำ
export type { ShippingMethodCode };

/** อัตราค่าส่งหนึ่งวิธี — ตัวเลขชุดเดียวกับที่หน้า checkout คิดเงิน */
export interface ShippingRate {
  code: ShippingMethodCode;
  /** ชื่อคงที่ตามวิธี — ร้านแก้ไม่ได้ (ประวัติคำสั่งซื้ออ้างถึง) */
  name: string;
  description: string;
  baseFee: number;
  /** null = ไม่มีโปรส่งฟรี */
  freeOverSubtotal: number | null;
  etaText: string;
  /** null = ทั่วประเทศ */
  onlyProvinces: string[] | null;
  isActive: boolean;
  sortOrder: number;
  updatedAt: string;
}

export interface AdminShippingRates {
  rates: ShippingRate[];
  /** ชื่อจังหวัดที่ใส่ใน "เฉพาะจังหวัด" ได้ — อ่านจาก server ไม่พิมพ์รายการเอง */
  provinces: string[];
}

/** ส่งเฉพาะช่องที่เปลี่ยน · `freeOverSubtotal: null` = ยกเลิกโปรส่งฟรี */
export interface UpdateShippingRateInput {
  description?: string;
  baseFee?: number;
  freeOverSubtotal?: number | null;
  etaText?: string;
  onlyProvinces?: string[];
  isActive?: boolean;
}

/** GET /api/shipping/options (สาธารณะ) */
export interface PublicShippingOptions {
  options: Omit<ShippingRate, "isActive" | "sortOrder" | "updatedAt">[];
  /** ยอดส่งฟรีต่ำสุดของวิธีที่ส่งได้ทั่วประเทศ — null = ไม่มีโปร */
  freeShippingFrom: number | null;
  freeShippingText: string;
}

export type ShipmentStatus =
  "PENDING" | "PREPARING" | "SHIPPED" | "IN_TRANSIT" | "DELIVERED" | "FAILED" | "RETURNED";

export interface AdminShipmentListItem {
  id: string;
  carrier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: ShipmentStatus;
  statusLabel: string;
  estimatedDelivery: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  returnedAt: string | null;
  /** เลยกำหนดส่งที่ร้านกรอกไว้แล้วยังอยู่กับขนส่ง */
  overdue: boolean;
  latestNote: string | null;
  order: {
    orderNumber: string;
    status: string;
    shippingMethodName: string;
    customerName: string | null;
    customerEmail: string;
  };
}

export interface AdminShipmentList {
  items: AdminShipmentListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: { status: ShipmentStatus; label: string; count: number }[];
  overdueCount: number;
}

export interface AdminShipmentDetail extends AdminShipmentListItem {
  events: {
    status: ShipmentStatus;
    statusLabel: string;
    note: string | null;
    at: string;
    /** null = บันทึกก่อนมีประวัติ หรือบัญชีถูกลบแล้ว */
    recordedBy: string | null;
  }[];
  isLatest: boolean;
  allowedNextStatuses: { status: ShipmentStatus; label: string; needsNote: boolean }[];
  canEdit: boolean;
  destination: Record<string, string | null>;
  orderActions: { canDeliver: boolean; canCancel: boolean; canReship: boolean };
  paymentStatus: string;
}

export interface CreateShipmentInput {
  carrier: string;
  trackingNumber: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
}

export interface UpdateShipmentInput {
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string | null;
  estimatedDelivery?: string | null;
  reason: string;
}

/** สีของป้ายสถานะพัสดุ — ใช้ token เท่านั้น */
export const SHIPMENT_STATUS_TONE: Record<ShipmentStatus, string> = {
  PENDING: "border-line bg-lilac-50 text-muted",
  PREPARING: "border-line bg-lilac-50 text-muted",
  SHIPPED: "border-brand-soft bg-lilac-50 text-brand-dark",
  IN_TRANSIT: "border-brand-soft bg-lilac-50 text-brand-dark",
  DELIVERED: "border-success/30 bg-success/5 text-success",
  FAILED: "border-warning/30 bg-warning/5 text-warning",
  RETURNED: "border-danger/30 bg-danger/5 text-danger",
};
