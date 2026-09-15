import { ApiClientError } from "@/lib/api";

/**
 * แปลง error จาก backend เป็นข้อความเดียวที่อ่านรู้เรื่อง
 *
 * backend ส่ง `details` เป็น `{ field, message }[]` เมื่อ validation ล้ม (STEP 30)
 * ถ้ามีรายละเอียดก็ต่อท้ายไว้ด้วย เพื่อให้แอดมินรู้ว่าช่องไหนผิด ไม่ใช่แค่
 * "ข้อมูลที่ส่งมาไม่ถูกต้อง"
 */
export function describeApiError(error: unknown, fallback: string): string {
  if (!(error instanceof ApiClientError)) {
    return fallback;
  }

  const details = Array.isArray(error.details) ? error.details : [];
  const messages = details
    .map((detail) =>
      typeof detail === "object" && detail !== null && "message" in detail
        ? String((detail as { message: unknown }).message)
        : null,
    )
    .filter((message): message is string => message !== null);

  return messages.length > 0 ? `${error.message} — ${messages.join(" · ")}` : error.message;
}
