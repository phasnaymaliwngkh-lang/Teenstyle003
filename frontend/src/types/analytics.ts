/**
 * Type ของรายงานยอดขาย (STEP 26) — ต้องตรงกับ DTO ฝั่ง backend
 *   backend/src/models/analytics.model.ts
 *   backend/src/services/analytics.service.ts
 */

export const GRANULARITIES = ["day", "week", "month"] as const;
export type Granularity = (typeof GRANULARITIES)[number];

export interface AnalyticsRange {
  from: string;
  to: string;
  granularity: Granularity;
  /** โซนเวลาที่ใช้ตัดวัน — แสดงให้ผู้ใช้รู้ว่ายอดรายวันยึดเวลาอะไร */
  timeZone: string;
  days: number;
  comparedTo: { from: string; to: string };
}

export interface SalesPoint {
  bucket: string;
  revenue: number;
  orders: number;
}

export interface Metric {
  value: number;
  previous: number;
  /** null = ช่วงก่อนหน้าเป็น 0 จึงเทียบไม่ได้ — **ห้ามแสดงเป็น 0% หรือ +100%** */
  changePercent: number | null;
}

export interface SalesSummary {
  range: AnalyticsRange;
  revenue: Metric;
  paidOrders: Metric;
  averageOrderValue: Metric;
  payingCustomers: Metric;
  /** ยอดคงค้าง ณ วันนี้ ไม่ใช่ยอดของช่วงที่เลือก และยังไม่ใช่รายได้ */
  pendingCodAmount: number;
  series: SalesPoint[];
  generatedAt: string;
}

export interface ProductPerformanceRow {
  productId: string | null;
  productName: string;
  slug: string | null;
  quantity: number;
  revenue: number;
  orders: number;
}

export interface ProductPerformance {
  range: AnalyticsRange;
  items: ProductPerformanceRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** ผลรวมของทั้งช่วง ไม่ใช่แค่หน้าปัจจุบัน */
  totals: { quantity: number; revenue: number };
}

export interface CustomerRankingRow {
  userId: string;
  name: string | null;
  email: string;
  orders: number;
  revenue: number;
  averageOrderValue: number;
  firstOrderAt: string;
  lastOrderAt: string;
}

export interface CustomerRanking {
  range: AnalyticsRange;
  items: CustomerRankingRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  repeatCustomers: number;
}

export interface BreakdownRow {
  key: string;
  label: string;
  orders: number;
  revenue: number;
  share: number;
}

export interface SalesBreakdown {
  range: AnalyticsRange;
  byCategory: BreakdownRow[];
  byPaymentProvider: BreakdownRow[];
  byShippingMethod: BreakdownRow[];
  /** นับ "ใบที่สร้าง" ในช่วงนี้ — คนละเกณฑ์กับยอดขายด้านบน */
  ordersByStatus: BreakdownRow[];
  reconciliation: {
    orderRevenue: number;
    productRevenue: number;
    shippingFees: number;
    discounts: number;
  };
}
