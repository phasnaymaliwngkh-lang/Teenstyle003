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
  apiUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
  siteName: process.env.NEXT_PUBLIC_SITE_NAME ?? "TeenStyle",
  siteUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
} as const;
