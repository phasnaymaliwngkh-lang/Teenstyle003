import "server-only";

import { apiFetchAsUser } from "@/lib/api-server";
import type {
  CustomerRanking,
  ProductPerformance,
  SalesBreakdown,
  SalesSummary,
} from "@/types/analytics";

/**
 * อ่านรายงานยอดขายจากฝั่ง server (STEP 26)
 *
 * `cache: "no-store"` ทุกเส้นทาง — ตัวเลขยอดขายเปลี่ยนตลอดเวลา
 * และเป็นข้อมูลเชิงธุรกิจที่ไม่ควรถูกแคชร่วมกับคำขออื่น
 */

function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return `${path}${qs ? `?${qs}` : ""}`;
}

export function fetchSalesSummaryOnServer(params: URLSearchParams): Promise<SalesSummary> {
  return apiFetchAsUser<SalesSummary>(withQuery("/api/admin/analytics/summary", params), {
    cache: "no-store",
  });
}

export function fetchProductPerformanceOnServer(
  params: URLSearchParams,
): Promise<ProductPerformance> {
  return apiFetchAsUser<ProductPerformance>(withQuery("/api/admin/analytics/products", params), {
    cache: "no-store",
  });
}

export function fetchCustomerRankingOnServer(params: URLSearchParams): Promise<CustomerRanking> {
  return apiFetchAsUser<CustomerRanking>(withQuery("/api/admin/analytics/customers", params), {
    cache: "no-store",
  });
}

export function fetchSalesBreakdownOnServer(params: URLSearchParams): Promise<SalesBreakdown> {
  return apiFetchAsUser<SalesBreakdown>(withQuery("/api/admin/analytics/breakdown", params), {
    cache: "no-store",
  });
}
