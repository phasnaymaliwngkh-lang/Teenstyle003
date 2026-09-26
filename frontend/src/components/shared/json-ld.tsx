import type { JsonLdObject } from "@/lib/seo";

/**
 * ฝัง structured data (JSON-LD) ลงหน้า (STEP 33)
 *
 * ⚠️ **ทำไมไม่ใช้ `dangerouslySetInnerHTML` แม้เอกสารของ Next จะแนะนำแบบนั้น**
 *
 * กฎของโปรเจกต์ห้ามใช้ `dangerouslySetInnerHTML` (ดู STEP 28) และที่นี่ไม่จำเป็นต้องใช้จริง ๆ
 * เพราะ React 19 จัดการ `<script>` ให้ปลอดภัยอยู่แล้ว — ทดลองกับ `renderToStaticMarkup` ยืนยันว่า
 *
 *   - ข้อความใน `<script>` **ไม่ถูก escape เป็น HTML entity** (`"` ยังเป็น `"` ไม่ใช่ `&quot;`)
 *     → ผลลัพธ์ยังเป็น JSON ที่ `JSON.parse` ได้ ต่างจากการวางข้อความใน element ปกติ
 *   - ทุก `<script` / `</script` ที่อยู่ในข้อมูลถูกเขียนเป็น `script`
 *     → ปิด element ก่อนเวลาไม่ได้ จึงแทรกแท็กใหม่ไม่ได้ (ลองกับ `</script><img onerror=...>` แล้ว)
 *
 * ผลคือได้ทั้งความปลอดภัยและ JSON ที่ถูกต้อง โดยไม่ต้องเปิดประตูที่โปรเจกต์ปิดไว้
 * **ถ้าวันหนึ่งเปลี่ยนไปเรนเดอร์ด้วยเครื่องมืออื่นที่ไม่ใช่ React ต้องกลับมาทบทวนข้อนี้**
 * (มีเทสต์ใน frontend/tests/seo.test.ts ยืนยันพฤติกรรมนี้กันการถอยหลังของ React เอง)
 */
export function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  const payload = Array.isArray(data) ? data : [data];

  return (
    <>
      {payload.map((item, index) => (
        <script key={index} type="application/ld+json">
          {JSON.stringify(item)}
        </script>
      ))}
    </>
  );
}
