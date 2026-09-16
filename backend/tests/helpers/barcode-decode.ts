/**
 * ตัวถอดรหัสบาร์โค้ดสำหรับเทสต์ (STEP 17)
 *
 * ทำไมต้องมี: การยืนยันว่า "ป้ายที่พิมพ์ออกมาสแกนได้ค่าที่ถูกต้อง" ด้วยการดูภาพ SVG
 * ไม่ได้พิสูจน์อะไรเลย — ต้องถอดเส้นกลับมาเป็นตัวเลข/ตัวอักษรแล้วเทียบกับค่าที่ตั้งใจ
 *
 * ตารางของ EAN-13 ที่นี่มาจาก **มาตรฐาน** (ไม่ได้ลอกจาก bwip-js) จึงเป็นการตรวจแบบอิสระจริง
 * ตรวจสอบตัวเองได้ด้วย: L-code ทุกตัวยาว 7 โมดูล เริ่มด้วยช่องว่าง ลงท้ายด้วยแถบ
 * และมีจำนวนแถบเป็นเลขคี่ (odd parity) — มีเทสต์ยืนยันคุณสมบัตินี้อยู่ด้วย
 */

/** L-code (ซีกซ้าย, odd parity) ของเลข 0–9 · 1 = แถบดำ, 0 = ช่องว่าง */
export const EAN13_L_CODES = [
  '0001101',
  '0011001',
  '0010011',
  '0111101',
  '0100011',
  '0110001',
  '0101111',
  '0111011',
  '0110111',
  '0001011',
] as const;

const invert = (pattern: string): string =>
  [...pattern].map((bit) => (bit === '0' ? '1' : '0')).join('');

/** R-code (ซีกขวา) = สลับดำ/ขาวของ L-code */
export const EAN13_R_CODES = EAN13_L_CODES.map(invert);

/** G-code (ซีกซ้าย, even parity) = R-code อ่านกลับหลัง */
export const EAN13_G_CODES = EAN13_R_CODES.map((pattern) => [...pattern].reverse().join(''));

/**
 * เลขหลักแรกของ EAN-13 ไม่ได้ถูกวาดเป็นแถบ — มันซ่อนอยู่ใน "ลำดับ L/G" ของ 6 หลักซีกซ้าย
 * (นี่คือเหตุผลที่ EAN-13 เก็บได้ 13 หลักในพื้นที่ของ 12 หลัก)
 */
export const EAN13_FIRST_DIGIT_PARITY = [
  'LLLLLL',
  'LLGLGG',
  'LLGGLG',
  'LLGGGL',
  'LGLLGG',
  'LGGLLG',
  'LGGGLL',
  'LGLGLG',
  'LGLGGL',
  'LGGLGL',
] as const;

/**
 * Code 128: pattern ของ start code และ stop ตามมาตรฐาน (ใช้เป็นหลักยึดอิสระจากไลบรารี)
 *
 * subset B = ตัวอักษร+ตัวเลข · subset C = ตัวเลขคู่ (บีบ 2 หลักเป็น 1 สัญลักษณ์)
 * ตัวเข้ารหัสจะสลับไป C เองเมื่อเจอตัวเลขติดกันตั้งแต่ 4 หลัก
 */
export const CODE128_START_B = '211214';
export const CODE128_START_C = '211232';
export const CODE128_STOP = '2331112';

/**
 * แปลงลำดับความกว้างแถบ/ช่องว่าง (`sbs` ของ bwip-js) เป็นสตริงโมดูล
 * องค์ประกอบแรกเป็น **แถบดำ** เสมอ แล้วสลับไปเรื่อย ๆ
 */
export function sbsToModules(sbs: number[]): string {
  return sbs.map((width, index) => (index % 2 === 0 ? '1' : '0').repeat(width)).join('');
}

/** ตัดลำดับความกว้างออกเป็นสัญลักษณ์ละ 6 องค์ประกอบ (Code 128) โดยแยก stop ออกมา */
export function code128Symbols(sbs: number[]): {
  start: string;
  data: string[];
  checksum: string;
  stop: string;
} {
  if ((sbs.length - 7) % 6 !== 0) {
    throw new Error(`sbs ของ Code 128 ต้องเป็น 6n + 7 องค์ประกอบ (ได้ ${sbs.length})`);
  }

  const widths = sbs.map(String);
  const stop = widths.slice(-7).join('');
  const symbols: string[] = [];

  for (let index = 0; index + 6 <= sbs.length - 7; index += 6) {
    symbols.push(widths.slice(index, index + 6).join(''));
  }

  const start = symbols[0];
  const checksum = symbols[symbols.length - 1];

  if (start === undefined || checksum === undefined || symbols.length < 3) {
    throw new Error('Code 128 ต้องมีอย่างน้อย start + data + checksum');
  }

  return { start, data: symbols.slice(1, -1), checksum, stop };
}

/**
 * ถอด EAN-13 จาก `sbs` กลับเป็นเลข 13 หลัก
 *
 * โครงสร้าง 95 โมดูล: guard 101 · 6 หลักซ้าย (L/G) · guard 01010 · 6 หลักขวา (R) · guard 101
 * ผิดโครงสร้างตรงไหนก็ throw ทันที เพื่อให้เทสต์ชี้จุดผิดได้ ไม่ใช่คืนค่าที่เพี้ยนไปเงียบ ๆ
 */
export function decodeEan13(sbs: number[]): string {
  const modules = sbsToModules(sbs);

  if (modules.length !== 95) {
    throw new Error(`EAN-13 ต้องมี 95 โมดูล (ได้ ${modules.length})`);
  }
  if (modules.slice(0, 3) !== '101') throw new Error('guard ต้นไม่ใช่ 101');
  if (modules.slice(45, 50) !== '01010') throw new Error('guard กลางไม่ใช่ 01010');
  if (modules.slice(92, 95) !== '101') throw new Error('guard ท้ายไม่ใช่ 101');

  let parity = '';
  let left = '';
  for (let index = 0; index < 6; index += 1) {
    const chunk = modules.slice(3 + index * 7, 10 + index * 7);
    const asL = EAN13_L_CODES.indexOf(chunk as (typeof EAN13_L_CODES)[number]);
    const asG = EAN13_G_CODES.indexOf(chunk);

    if (asL >= 0) {
      parity += 'L';
      left += String(asL);
    } else if (asG >= 0) {
      parity += 'G';
      left += String(asG);
    } else {
      throw new Error(`หลักซีกซ้ายที่ ${index + 1} ไม่ตรงกับ L-code หรือ G-code (${chunk})`);
    }
  }

  let right = '';
  for (let index = 0; index < 6; index += 1) {
    const chunk = modules.slice(50 + index * 7, 57 + index * 7);
    const digit = EAN13_R_CODES.indexOf(chunk);

    if (digit < 0) {
      throw new Error(`หลักซีกขวาที่ ${index + 1} ไม่ตรงกับ R-code (${chunk})`);
    }
    right += String(digit);
  }

  const firstDigit = EAN13_FIRST_DIGIT_PARITY.indexOf(
    parity as (typeof EAN13_FIRST_DIGIT_PARITY)[number],
  );

  if (firstDigit < 0) {
    throw new Error(`ลำดับ parity ของซีกซ้าย (${parity}) ไม่ตรงกับตารางหลักแรก`);
  }

  return `${firstDigit}${left}${right}`;
}
