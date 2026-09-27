import { ApiClientError } from "@/lib/api";

/**
 * แปลง error จาก backend เป็นข้อความเดียวที่อ่านรู้เรื่อง
 *
 * backend ส่ง `details` เป็น `{ field, message }[]` เมื่อ validation ล้ม (STEP 30)
 * ถ้ามีรายละเอียดก็ต่อท้ายไว้ด้วย เพื่อให้ผู้ใช้รู้ว่าช่องไหนผิด ไม่ใช่แค่
 * "ข้อมูลที่ส่งมาไม่ถูกต้อง" ซึ่งบอกไม่ได้ว่าต้องไปแก้อะไร (กฎ STEP 26 ข้อ 10)
 *
 * ⚠️ **ทุกฟอร์มที่ส่งข้อมูลขึ้น backend ต้องใช้ตัวนี้ ห้ามอ่าน `error.message` ตรง ๆ**
 *    เดิมอยู่ใน `features/admin/lib/` จึงมีแต่หลังบ้านที่ใช้ — ย้ายมาเป็นของกลาง
 *    ตอน STEP 37 เพราะพบว่าฟอร์มฝั่งลูกค้า (ที่อยู่ · ข้อมูลส่วนตัว · รีวิว) ทิ้ง
 *    เหตุผลระดับช่องไปหมด แล้วลูกค้าเห็นแค่ข้อความรวมที่ทำตามไม่ได้
 *    (การอ่าน error ของ **การโหลดหน้า** ยังใช้ `.message` ได้ตามเดิม — GET ไม่มี `details`)
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
