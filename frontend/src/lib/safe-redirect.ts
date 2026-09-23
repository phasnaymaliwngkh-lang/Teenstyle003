/**
 * ตรวจปลายทางของการ redirect ให้อยู่ในเว็บเราเท่านั้น (STEP 28)
 *
 * ⚠️⚠️ **ด่านเดิมที่เช็คแค่ `startsWith("/")` และ `!startsWith("//")` มีช่องโหว่จริง**
 *    ทดลองยืนยันแล้วตอน STEP 28:
 *
 *      new URL("/\\evil.com", "https://teenstyle.example")
 *        → "https://evil.com/"        ← ออกนอกเว็บ ทั้งที่ผ่านด่านเดิมทั้งสองข้อ
 *
 *    เพราะมาตรฐาน WHATWG URL ถือว่า `\` เท่ากับ `/` สำหรับ scheme แบบ http/https
 *    `"/\evil.com"` จึงถูกอ่านเป็น `"//evil.com"` ซึ่งเป็น protocol-relative URL
 *
 *    ผลของช่องโหว่นี้: ส่งลิงก์ `/signin?callbackUrl=/\evil.com` ให้เหยื่อ
 *    เหยื่อล็อกอินกับเว็บเราจริง (โดเมนถูก ทุกอย่างดูปกติ) แล้วถูกพาไปเว็บปลอมทันที
 *    ซึ่งเป็นรูปแบบฟิชชิงที่เนียนที่สุด เพราะจุดเริ่มต้นคือเว็บจริง
 *
 * วิธีตรวจที่ใช้ — กันสองชั้น ไม่พึ่งการอ่านสตริงอย่างเดียว
 *   1. ตัดทิ้งตั้งแต่รูปแบบ: ต้องขึ้นต้นด้วย `/` · ห้ามมี `\` อยู่ที่ใดเลย
 *   2. **ลอง resolve จริง** กับโดเมนสมมติ แล้วบังคับว่า origin ต้องไม่เปลี่ยน
 *      ข้อนี้คือด่านที่เชื่อถือได้ เพราะใช้ตัวแปลง URL ตัวเดียวกับที่เบราว์เซอร์ใช้
 *      ถ้ามีรูปแบบแปลก ๆ ที่เรายังไม่รู้จัก ข้อนี้จะจับได้เอง
 */

/** โดเมนสมมติที่ใช้ทดสอบ resolve — `.invalid` เป็น TLD ที่สงวนไว้ ไม่มีวันมีอยู่จริง */
const PROBE_ORIGIN = "http://internal.invalid";

/**
 * คืน path ภายในเว็บที่ปลอดภัยจะ redirect ไป — ไม่ผ่านเกณฑ์คืน `fallback`
 *
 * รับเป็น `unknown` เพราะต้นทางมักมาจาก `FormData` หรือ query string
 * ซึ่งไม่รับประกันว่าเป็นสตริง
 */
export function safeInternalPath(value: unknown, fallback = "/"): string {
  if (typeof value !== "string" || value === "") return fallback;

  // ต้องเป็น path ภายใน ไม่ใช่ URL เต็ม (`https://evil.com`) หรือ protocol-relative (`//evil.com`)
  if (!value.startsWith("/")) return fallback;

  // `\` ถูกแปลงเป็น `/` ตอน resolve — ตัดทิ้งทุกตำแหน่ง ไม่ใช่แค่ตัวที่สอง
  if (value.includes("\\")) return fallback;

  let resolved: URL;
  try {
    resolved = new URL(value, PROBE_ORIGIN);
  } catch {
    return fallback;
  }

  // ด่านจริง: resolve แล้วต้องยังอยู่โดเมนเดิม
  if (resolved.origin !== PROBE_ORIGIN) return fallback;

  const normalized = `${resolved.pathname}${resolved.search}${resolved.hash}`;

  /**
   * ⚠️ ต้องตรวจ **ผลลัพธ์** อีกครั้ง ไม่ใช่เชื่อว่าผ่านด่านบนแล้วจบ
   *
   *    `"/..//evil.com"` ผ่านทุกด่านข้างบน (ขึ้นต้นด้วย `/` · ไม่มี `\` ·
   *    resolve แล้ว origin ไม่เปลี่ยน) แต่ `..` ทำให้ pathname ที่ normalize ออกมา
   *    กลายเป็น `"//evil.com"` ซึ่งเป็น protocol-relative URL เสียเอง
   *    → พอผู้เรียกเอาค่านี้ไป resolve กับโดเมนจริงอีกที ก็ออกนอกเว็บ
   *
   *    (เจอตอนเขียนเทสต์แบบไล่ทุกรูปแบบใน STEP 28 — ไม่ได้เจอจากการอ่านโค้ด)
   */
  if (!normalized.startsWith("/") || normalized.startsWith("//")) return fallback;

  return normalized;
}
