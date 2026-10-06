/**
 * คำที่ค้นล่าสุด (STEP 45) — เก็บใน `localStorage` ของเครื่องนี้เท่านั้น
 *
 * ⚠️ ไม่ส่งขึ้นเซิร์ฟเวอร์และไม่เก็บในฐานข้อมูลโดยเจตนา — ประวัติการค้นหาคือข้อมูลส่วนบุคคล
 *    (การเก็บต้องมีนโยบายระยะเวลาและการลบตาม PDPA ของ STEP 53) · หน้าเว็บบอกเรื่องนี้ไว้
 * ⚠️ `localStorage` ใช้ไม่ได้ในหน้าต่างส่วนตัวบางแบบ/เมื่อบล็อกข้อมูลเว็บ — ทุกการอ่านเขียนจึงครอบ try/catch
 *    และหน้าค้นหาต้องทำงานได้ปกติแม้อ่านไม่ได้
 */
const KEY = "teenstyle:recent-searches";
const MAX_ITEMS = 6;

export function readRecentSearches(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed: unknown = raw === null ? [] : JSON.parse(raw);

    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string").slice(0, MAX_ITEMS)
      : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query: string): void {
  const value = query.trim();

  if (value === "") return;

  try {
    const next = [value, ...readRecentSearches().filter((item) => item !== value)].slice(
      0,
      MAX_ITEMS,
    );
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // เก็บไม่ได้ก็ไม่เป็นไร — ประวัติเป็นความสะดวก ไม่ใช่ส่วนที่การค้นหาต้องพึ่ง
  }
}

export function clearRecentSearches(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // เหมือนด้านบน
  }
}
