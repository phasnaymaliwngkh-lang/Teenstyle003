import { apiFetch } from "@/lib/api";
import type { HealthReport } from "@/types/api";

/**
 * เรียก GET /health ของ backend
 *
 * ทุก resource จะมีไฟล์ service ของตัวเองในรูปแบบเดียวกันนี้
 * (STEP 6: product.service.ts, STEP 9: cart.service.ts, ...)
 * คอมโพเนนต์ห้ามเรียก fetch เอง ต้องผ่าน service เสมอ
 */
export function fetchHealth(signal?: AbortSignal): Promise<HealthReport> {
  return apiFetch<HealthReport>("/health", {
    cache: "no-store",
    ...(signal ? { signal } : {}),
  });
}
