/**
 * GTIN (บาร์โค้ดสินค้ามาตรฐาน) — กฎตัวเลขที่ใช้ร่วมกันทั้งระบบ (STEP 17)
 *
 * ทำไมอยู่ใน workspace `database` ไม่ใช่ `backend`
 *   seed (workspace นี้) และ backend ต้องใช้กฎ **ชุดเดียวกัน** ถ้าเขียนแยกกัน
 *   seed จะสร้างบาร์โค้ดที่ backend ปฏิเสธ (หรือแย่กว่า: สร้างเลขที่สแกนไม่ได้จริง)
 *   → โมดูลนี้ถูก re-export ผ่าน `@teenstyle/database` ให้ backend เรียกใช้
 *
 * ⚠️ **ห้ามสร้างเลขบาร์โค้ดโดยไม่คำนวณ check digit** — เครื่องสแกนที่หน้าร้าน/POS
 *    ตรวจ check digit ทุกครั้ง เลขที่ไม่ผ่านจะสแกนไม่ติด การเก็บเลขแบบนั้นไว้
 *    คือการโชว์บาร์โค้ดปลอมให้ร้านเข้าใจผิดว่าใช้งานได้
 */

/** ความยาวที่ระบบรองรับ: EAN-8 · UPC-A (12) · EAN-13 */
export const GTIN_LENGTHS = [8, 12, 13] as const;

/**
 * Prefix ของบาร์โค้ดที่ร้านสร้างเอง
 *
 * GS1 สงวนช่วง 20–29 ไว้ให้ "restricted circulation within a company"
 * คือใช้ภายในร้าน/ในเครือเท่านั้น ไม่ได้ลงทะเบียนเป็นเลขระดับโลก
 * → เลือก `20` เพราะเป็นช่วงที่ตั้งใจให้ใช้แบบนี้ **ห้ามไปใช้ prefix ของประเทศอื่น**
 *   (เช่น 88x ของ GS1 Taiwan, 885 ของไทย) เพราะเป็นการสวมเลขที่ไม่ใช่ของร้าน
 */
export const INTERNAL_GTIN_PREFIX = '20';

/**
 * check digit ของ GTIN (mod-10 / Luhn แบบ GS1)
 *
 * ถ่วงน้ำหนัก 3,1,3,1,… จาก **หลักขวาสุดของตัวเลขฐาน** (ยังไม่รวม check digit)
 * สูตรเดียวกันใช้ได้กับ GTIN-8/12/13/14 จึงไม่ต้องแยกฟังก์ชันตามความยาว
 *
 * @param body ตัวเลขฐาน (ไม่รวม check digit)
 */
export function gtinCheckDigit(body: string): string {
  if (!/^[0-9]+$/.test(body)) {
    throw new Error(`gtinCheckDigit ต้องรับตัวเลขล้วน (ได้ "${body}")`);
  }

  let sum = 0;
  for (let offset = 0; offset < body.length; offset += 1) {
    // offset 0 = หลักขวาสุด → น้ำหนัก 3 แล้วสลับเป็น 1
    const digit = Number(body[body.length - 1 - offset]);
    sum += digit * (offset % 2 === 0 ? 3 : 1);
  }

  return String((10 - (sum % 10)) % 10);
}

/** true = เป็น GTIN ที่ความยาวถูกต้องและ check digit ถูกต้อง (สแกนได้จริง) */
export function isValidGtin(value: string): boolean {
  if (!/^[0-9]+$/.test(value)) return false;
  if (!(GTIN_LENGTHS as readonly number[]).includes(value.length)) return false;

  const body = value.slice(0, -1);

  return gtinCheckDigit(body) === value.slice(-1);
}

/**
 * ล้างรูปแบบที่คนพิมพ์เข้ามา (ช่องว่าง/ขีดกลาง) ให้เหลือแต่ตัวเลข
 * ไม่ตัดสินว่าถูกหรือผิด — การตรวจเป็นหน้าที่ของ `isValidGtin`
 */
export function normalizeGtin(value: string): string {
  return value.replace(/[\s-]/g, '');
}

/** ชื่อมาตรฐานตามความยาว — ใช้เลือก symbology ที่ถูกต้องตอนพิมพ์ป้าย */
export function gtinKind(value: string): 'EAN-8' | 'UPC-A' | 'EAN-13' | null {
  if (!isValidGtin(value)) return null;

  switch (value.length) {
    case 8:
      return 'EAN-8';
    case 12:
      return 'UPC-A';
    default:
      return 'EAN-13';
  }
}

/**
 * ประกอบ GTIN-13 ของร้านจากตัวเลข 10 หลัก (prefix 20 + 10 หลัก + check digit)
 *
 * @param body10 ตัวเลข 10 หลักที่จะอยู่หลัง prefix
 */
export function internalGtin13(body10: string): string {
  if (!/^[0-9]{10}$/.test(body10)) {
    throw new Error(`internalGtin13 ต้องรับตัวเลข 10 หลัก (ได้ "${body10}")`);
  }

  const body = `${INTERNAL_GTIN_PREFIX}${body10}`;

  return `${body}${gtinCheckDigit(body)}`;
}

/**
 * GTIN-13 ของร้านที่คงที่ต่อ seed หนึ่งค่า (ใช้ใน seed เพื่อให้รันซ้ำได้ค่าเดิม)
 *
 * ⚠️ ไม่ใช่ตัวสร้างสำหรับของจริงในร้าน — การออกเลขให้สินค้าจริงต้องสุ่มแล้วตรวจว่าไม่ซ้ำ
 *    ในฐานข้อมูล (ดู `assignInternalBarcode` ของ backend)
 */
export function internalGtin13FromSeed(seed: string): string {
  // FNV-1a 32 บิต — พอสำหรับความคงที่ของ seed และไม่ต้องพึ่ง crypto
  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }

  // 32 บิตให้เลขได้ไม่เกิน 10 หลัก จึงเติม 0 ข้างหน้าให้ครบ
  return internalGtin13(String(hash).padStart(10, '0'));
}
