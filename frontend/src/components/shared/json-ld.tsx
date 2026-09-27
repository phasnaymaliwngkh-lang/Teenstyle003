import { headers } from "next/headers";

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
export function JsonLdScripts({
  data,
  nonce,
}: {
  data: JsonLdObject | JsonLdObject[];
  nonce?: string;
}) {
  const payload = Array.isArray(data) ? data : [data];

  return (
    <>
      {payload.map((item, index) => (
        <script key={index} type="application/ld+json" nonce={nonce}>
          {JSON.stringify(item)}
        </script>
      ))}
    </>
  );
}

/**
 * แปะ nonce ของคำขอนั้นให้ JSON-LD ด้วย (STEP 38)
 *
 * `type="application/ld+json"` เป็น **data block** ไม่ใช่สคริปต์ที่ถูกรัน
 * เบราว์เซอร์จึงหยุดก่อนถึงขั้นตรวจ CSP แล้ว structured data ทำงานได้แม้ไม่มี nonce
 *
 * ⚠️ แต่ต้องใส่อยู่ดี เพราะวิธีตรวจว่า CSP ไม่ทำให้หน้าพังที่ STEP 28 กำหนดไว้คือ
 *    **"จำนวน `<script>` ต้องเท่ากับจำนวนที่มี nonce"** ซึ่งเป็นการตรวจที่คนรันมือตอน deploy
 *    ถ้ามี `<script>` ที่ไม่มี nonce ปนอยู่ การตรวจนั้นจะเตือนผิดทุกครั้ง
 *    แล้วสุดท้ายคนจะเลิกเชื่อผลตรวจ (บทเรียนเดียวกับ STEP 30: เครื่องมือที่เตือนผิด = เสียงรบกวน)
 *    เจอตอน STEP 38 ตอนตรวจ production build จริง: 25 จาก 27 script มี nonce
 *
 * `headers()` ทำให้คอมโพเนนต์นี้เป็น dynamic ซึ่งไม่เสียอะไร เพราะทุกหน้าในหน้าร้าน
 * เป็น dynamic อยู่แล้วจาก nonce ที่ proxy.ts ออกใหม่ทุกคำขอ (ดู docs/10-performance.md)
 */
export async function JsonLd({ data }: { data: JsonLdObject | JsonLdObject[] }) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;

  return <JsonLdScripts data={data} nonce={nonce} />;
}
