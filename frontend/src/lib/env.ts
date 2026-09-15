/**
 * Environment variable ฝั่ง frontend
 *
 * ⚠️ อ่านได้เฉพาะตัวแปรที่ขึ้นต้นด้วย NEXT_PUBLIC_ เท่านั้น
 *    เพราะค่าเหล่านี้ถูกฝังลง bundle ที่ส่งไปเบราว์เซอร์
 *    secret ทั้งหมด (OPENAI_API_KEY, DATABASE_URL, ...) อยู่ฝั่ง backend
 *    (SECURITY REQUIREMENT: Frontend ห้ามเข้าถึง Server Secret)
 *
 * Next แทนค่า process.env.NEXT_PUBLIC_* ตอน build แบบ static
 * จึงต้องเขียนชื่อตัวแปรเต็ม ๆ ห้ามใช้ process.env[key] แบบ dynamic
 */
export const publicEnv = {
  /**
   * ที่อยู่ backend แบบเต็ม — ใช้ตอนเรียกจากฝั่ง server (Server Component / Route Handler)
   * ฝั่ง server ต้องเป็น URL เต็มเสมอ เพราะ `fetch` ของ Node แปลง path สัมพัทธ์ไม่ได้
   */
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",

  /**
   * prefix ที่ **เบราว์เซอร์** ใช้เรียก backend ผ่านโดเมนของ frontend (เช่น `/backend`)
   *
   * ⚠️ นี่คือกุญแจของการ deploy: ถ้าเบราว์เซอร์ยิงไป backend คนละโดเมนตรง ๆ
   *    Chrome/Safari จะ **บล็อก cookie แบบ third-party** → ตะกร้า/สั่งซื้อ/จ่ายเงิน
   *    และทุกการแก้ข้อมูลในหลังบ้านจะพังทันที (ตอน dev ไม่พังเพราะ cookie ไม่แยกตาม port)
   *    เมื่อตั้งค่านี้ไว้ เบราว์เซอร์จะคุยกับโดเมนตัวเองแล้ว Next rewrite ต่อไป backend ให้
   *    cookie จึงเป็น first-party
   *
   * เว้นว่าง = ยิงตรงไป `apiUrl` (พฤติกรรมเดิม เหมาะกับ dev บนเครื่องเดียว)
   */
  apiProxyPath: process.env.NEXT_PUBLIC_API_PROXY_PATH ?? "",

  siteName: process.env.NEXT_PUBLIC_SITE_NAME ?? "TeenStyle",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
} as const;
