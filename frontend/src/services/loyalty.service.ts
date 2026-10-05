import { apiFetch } from "@/lib/api";
import type { AdjustPointsResult } from "@/types/loyalty";

/**
 * ร้านปรับแต้มให้ลูกค้า (STEP 42 · ต้องมีสิทธิ์ `loyalty:adjust`)
 *
 * ส่งได้แค่ "เพิ่ม/หักเท่าไร เพราะอะไร" — ไม่มีทางตั้งยอดคงเหลือตรง ๆ
 * `idempotencyKey` สร้างครั้งเดียวต่อการเปิดฟอร์ม กดซ้ำจึงไม่ปรับสองครั้ง
 * ⚠️ ลูกค้าเห็นเหตุผลนี้ในประวัติแต้มของตัวเอง และถูกบันทึกลง AdminLog
 */
export function adjustCustomerPoints(
  userId: string,
  input: { delta: number; reason: string; idempotencyKey: string },
): Promise<AdjustPointsResult> {
  return apiFetch<AdjustPointsResult>(`/api/admin/customers/${encodeURIComponent(userId)}/points`, {
    method: "POST",
    json: input,
    cache: "no-store",
    timeoutMs: 30_000,
  });
}
