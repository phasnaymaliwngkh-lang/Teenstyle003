/**
 * Content-Security-Policy ของหน้าเว็บ (STEP 28)
 *
 * CSP เป็นด่านสุดท้ายของ XSS: แม้มีสคริปต์แปลกปลอมหลุดเข้าหน้าเว็บได้
 * เบราว์เซอร์จะไม่ยอมรันถ้าไม่มี nonce ที่ตรงกับ header ของคำขอนั้น
 *
 * ⚠️ **ใช้ nonce ไม่ใช่ `'unsafe-inline'`** — `'unsafe-inline'` สำหรับ script
 *    ทำให้ CSP แทบไม่มีความหมายเรื่อง XSS (ซึ่งเป็นเหตุผลเดียวที่ใส่ CSP)
 *    nonce ถูกสร้างใหม่ทุกคำขอใน proxy.ts แล้ว Next เอาไปแปะให้สคริปต์ของตัวเองอัตโนมัติ
 *
 * ⚠️ `'strict-dynamic'` จำเป็น เพราะ Next โหลด chunk เพิ่มหลังหน้าเริ่มทำงาน
 *    สคริปต์ที่ถูกโหลดโดยสคริปต์ที่มี nonce แล้วจะได้รับอนุญาตต่อ
 *    ถ้าไม่ใส่ การเปลี่ยนหน้าแบบ client-side จะพัง
 *
 * ⚠️ `style-src` ยังต้องมี `'unsafe-inline'` — `next/font` ฝัง `<style>` inline
 *    และ React ใส่ `style` attribute ให้คอมโพเนนต์บางตัว (เช่นแถบสัดส่วนในหน้ารายงาน)
 *    การใช้ nonce กับ style ทำให้ทั้งสองอย่างพัง และ CSS injection อันตรายน้อยกว่า
 *    script injection มาก จึงยอมแลก **แต่ห้ามผ่อนของ `script-src` ตามไปด้วย**
 *
 * ⚠️ dev ต้องมี `'unsafe-eval'` เพราะ HMR ของ Turbopack ใช้ eval
 *    production ห้ามมี — ไม่งั้นเสียประโยชน์ของ CSP ไปครึ่งหนึ่ง
 */

/** โฮสต์ของรูปภาพภายนอก — ต้องตรงกับ `images.remotePatterns` ใน next.config.ts */
const IMAGE_HOSTS = ["https://lh3.googleusercontent.com", "https://images.unsplash.com"];

export function buildCsp(nonce: string, options: { isDev: boolean; apiOrigin: string | null }) {
  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(options.isDev ? ["'unsafe-eval'"] : []),
  ];

  const connectSrc = ["'self'", ...(options.apiOrigin === null ? [] : [options.apiOrigin])];

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": scriptSrc,
    "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
    "font-src": ["'self'", "https://fonts.gstatic.com", "data:"],
    "img-src": ["'self'", "data:", "blob:", ...IMAGE_HOSTS],
    "connect-src": connectSrc,
    // ไม่มี <iframe>, <object> หรือ Flash ในเว็บนี้ — ปิดทิ้งทั้งหมด
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    // กันเว็บอื่นเอาหน้าเราไปใส่ iframe (clickjacking) — แทน X-Frame-Options แบบใหม่
    "frame-ancestors": ["'none'"],
    // กัน <base href> ที่ถูกแทรกเข้ามาเปลี่ยนปลายทางของทุกลิงก์ในหน้า
    "base-uri": ["'self'"],
    // ฟอร์มส่งออกนอกเว็บไม่ได้ — กันฟอร์มปลอมที่ดูดข้อมูลไปโดเมนอื่น
    "form-action": ["'self'"],
  };

  const policy = Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(" ")}`)
    .join("; ");

  // production บังคับให้ทุก request ที่หลงเป็น http ถูกยกเป็น https
  return options.isDev ? policy : `${policy}; upgrade-insecure-requests`;
}

/** origin ของ backend สำหรับ `connect-src` — ค่าที่ไม่ใช่ URL จะถูกข้ามไป ไม่ทำให้พัง */
export function apiOriginOf(rawUrl: string | undefined): string | null {
  if (!rawUrl) return null;

  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}
