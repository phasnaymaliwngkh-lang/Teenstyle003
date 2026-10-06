import { describe, expect, it } from 'vitest';

import {
  hasUnavailableCondition,
  likePattern,
  MAX_SEARCH_TERMS,
  parseSearchQuery,
  type SearchVocabulary,
} from '../src/models/search.model.ts';

/**
 * ตัวตีความคำค้น (STEP 45) — กฎล้วน ไม่แตะฐานข้อมูล
 *
 * คำศัพท์ด้านล่างมีรูปแบบเดียวกับของจริงในร้าน (ชื่อสีแบบประกอบ · ไซซ์ตัวอักษร/ตัวเลข/ฟรีไซซ์ ·
 * หมวดภาษาไทย) — ส่วนที่ต้องพิสูจน์กับสินค้าจริงอยู่ใน search-api.test.ts
 */
const VOCABULARY: SearchVocabulary = {
  colors: [
    { slug: 'black', name: 'ดำ' },
    { slug: 'white', name: 'ขาว' },
    { slug: 'lavender', name: 'ม่วงลาเวนเดอร์' },
    { slug: 'pastel-pink', name: 'ชมพูพาสเทล' },
    { slug: 'denim-blue', name: 'น้ำเงินยีนส์' },
  ],
  sizes: [
    { code: 'S', name: 'S' },
    { code: 'M', name: 'M' },
    { code: 'XL', name: 'XL' },
    { code: 'FREE', name: 'Free Size' },
    { code: 'EU38', name: '38' },
  ],
  words: ['เสื้อ', 'เสื้อยืด', 'เสื้อคลุม', 'ยีนส์', 'กระโปรง', 'เดท', 'เรียน'],
};

const parse = (text: string, literal = false) => parseSearchQuery(text, VOCABULARY, literal);

describe('ราคา', () => {
  it('ไม่เกิน · ต่ำกว่า · under · 2k · 2 พัน → ราคาสูงสุด (และ "ไม่เกิน" ไม่ถูกอ่านเป็น "เกิน")', () => {
    expect(parse('เสื้อไม่เกิน 500 บาท').filters).toMatchObject({ maxPrice: 500 });
    expect(parse('เสื้อ ต่ำกว่า ๕๐๐').filters).toMatchObject({ maxPrice: 500 });
    expect(parse('tee under 1,200').filters).toMatchObject({ maxPrice: 1200 });
    expect(parse('ไม่เกิน 2k').filters).toMatchObject({ maxPrice: 2000 });
    expect(parse('ไม่เกิน 2 พัน').filters).toMatchObject({ maxPrice: 2000 });
    expect(parse('ไม่เกิน 500').filters.minPrice).toBeUndefined();
  });

  it('มากกว่า · ตั้งแต่ · ขึ้นไป → ราคาต่ำสุด · ช่วง 500-1,000 และช่วงกลับด้าน → เรียงให้ถูก', () => {
    expect(parse('มากกว่า 800').filters).toMatchObject({ minPrice: 800 });
    expect(parse('1000 บาทขึ้นไป').filters).toMatchObject({ minPrice: 1000 });
    expect(parse('500-1,000 บาท').filters).toMatchObject({ minPrice: 500, maxPrice: 1000 });
    expect(parse('ราคา 1000 ถึง 500').filters).toMatchObject({ minPrice: 500, maxPrice: 1000 });
  });

  it('บอกราคาเฉย ๆ = งบไม่เกินเท่านั้น และป้ายเขียนตามที่ใช้กรองจริง', () => {
    const parsed = parse('ราคา 500');

    expect(parsed.filters.maxPrice).toBe(500);
    expect(parsed.terms).toEqual([]);
    expect(parsed.understood).toEqual([
      { kind: 'price', label: 'ราคาไม่เกิน 500 บาท', available: true },
    ]);
    expect(parse('฿300').filters.maxPrice).toBe(300);
  });

  it('เลขที่ไม่ใช่ราคาไม่ถูกตีความ — y2k · "500 kids" ไม่ใช่ 500,000', () => {
    expect(parse('y2k').filters.maxPrice).toBeUndefined();
    expect(parse('y2k').terms).toEqual(['y2k']);
    expect(parse('ไม่เกิน 500 kids').filters.maxPrice).toBe(500);
  });

  it('ช่วงราคาที่ขัดกันเอง → บอกว่าไม่มีสินค้าไหนเข้าได้ (ไม่ใช่เงียบแล้วแสดงทุกอย่าง)', () => {
    const parsed = parse('มากกว่า 1000 ไม่เกิน 500');

    expect(hasUnavailableCondition(parsed)).toBe(true);
  });
});

describe('สี', () => {
  it('ชื่อเต็มของร้าน · คำเรียกสีพื้นฐาน (สีม่วง → ม่วงลาเวนเดอร์) · ภาษาอังกฤษ (pink → pastel-pink)', () => {
    expect(parse('เสื้อสีดำ').filters.colors).toEqual(['black']);
    expect(parse('สีม่วง').filters.colors).toEqual(['lavender']);
    expect(parse('pink skirt').filters.colors).toEqual(['pastel-pink']);
    expect(parse('ชมพูพาสเทล').filters.colors).toEqual(['pastel-pink']);
    expect(parse('ดำหรือขาว').filters.colors.sort()).toEqual(['black', 'white']);
  });

  /** "น้ำเงิน" ต้องไม่ถูกอ่านเป็น "เงิน" · "เงินสด" ไม่ใช่สี (ต้องมีคำว่า "สี" นำหน้า) */
  it('คำที่ซ้อนกันและคำที่มีความหมายอื่น', () => {
    const blue = parse('สีน้ำเงิน');

    expect(blue.filters.colors).toEqual(['denim-blue']);
    expect(blue.understood.map((part) => part.label)).toEqual(['สีน้ำเงิน']);

    expect(parse('เงินสด').understood).toEqual([]);
    expect(parse('เงินสด').terms).toEqual(['เงินสด']);
  });

  it('สีที่ร้านไม่มี → เข้าใจ แต่บอกว่าไม่มี (ผลค้นหาต้องว่าง ไม่ใช่แสดงสีอื่น)', () => {
    const parsed = parse('เดรสสีแดง');

    expect(parsed.filters.colors).toEqual([]);
    expect(parsed.understood).toEqual([{ kind: 'color', label: 'สีแดง', available: false }]);
    expect(hasUnavailableCondition(parsed)).toBe(true);
    expect(parsed.terms).toEqual(['เดรส']);
  });
});

describe('ไซซ์ · มีของ · ลดราคา', () => {
  it('ตัวอักษรอยู่โดด ๆ ได้ · ตัวเลขต้องมีคำว่าไซซ์/เบอร์นำหน้า (กันชนกับราคาและรุ่น)', () => {
    expect(parse('xl').filters.sizes).toEqual(['XL']);
    expect(parse('กระโปรง ไซซ์ m').filters.sizes).toEqual(['M']);
    expect(parse('รองเท้าเบอร์ 38').filters.sizes).toEqual(['EU38']);
    expect(parse('รองเท้า 38').filters.sizes).toEqual([]);
    expect(parse('ฟรีไซซ์').filters.sizes).toEqual(['FREE']);
    // "s" ที่เป็นส่วนของคำอังกฤษไม่ใช่ไซซ์
    expect(parse('shorts').filters.sizes).toEqual([]);
  });

  it('พร้อมส่ง → เฉพาะที่มีของ · ลดราคา/sale → เฉพาะที่ลดราคา', () => {
    expect(parse('เสื้อพร้อมส่ง').filters.inStock).toBe(true);
    expect(parse('y2k sale').filters.onSale).toBe(true);
    expect(parse('เสื้อ').filters).toMatchObject({ inStock: false, onSale: false });
  });
});

describe('คำค้นที่เหลือ', () => {
  it('ตัดคำไทยที่พิมพ์ติดกันด้วยคำที่รู้จัก · ทิ้งคำที่ไม่ได้บอกว่าหาอะไร (ที่หัว/ท้าย)', () => {
    expect(parse('อยากได้กระโปรงสีชมพู ไซซ์ M')).toMatchObject({
      terms: ['กระโปรง'],
      filters: { colors: ['pastel-pink'], sizes: ['M'] },
    });
    expect(parse('กางเกงยีนส์').terms).toEqual(['กางเกง', 'ยีนส์']);
    expect(parse('ชุดไปเดท').terms).toEqual(['เดท']);
  });

  /** "ที่" อยู่ใน "เที่ยว" — ตัดกลางคำแล้วเหลือเศษ "เ" กับ "ยว" ซึ่งไม่ตรงกับอะไรเลย */
  it('ไม่ตัดคำที่ซ้อนอยู่กลางคำอื่น · ไม่เล็มสระ/วรรณยุกต์ท้ายคำ', () => {
    expect(parse('เที่ยวทะเล').terms).toEqual(['เที่ยวทะเล']);
    expect(parse('ฮู้ดดี้').terms).toEqual(['ฮู้ดดี้']);
    expect(parse('ฮู้ดดี้oversize').terms).toEqual(['ฮู้ดดี้', 'oversize']);
  });

  it(`คำค้นไม่เกิน ${MAX_SEARCH_TERMS} คำ · ไม่ซ้ำ`, () => {
    const parsed = parse('a1 b2 c3 d4 e5 f6 g7 a1');

    expect(parsed.terms).toHaveLength(MAX_SEARCH_TERMS);
    expect(new Set(parsed.terms).size).toBe(MAX_SEARCH_TERMS);
  });

  it('ตีความแล้วไม่เหลืออะไรเลย → ค้นข้อความดิบ (ไม่ใช่ไม่มีเงื่อนไข = ทุกสินค้าในร้าน)', () => {
    expect(parse('%').terms).toEqual(['%']);
    expect(parse('อยากได้').terms).toEqual(['อยากได้']);
    expect(parse('สีดำ').terms).toEqual([]); // มีเงื่อนไขสีแล้ว ไม่ต้องถอย
  });

  it('ค้นแบบตรงตัว → ไม่ตีความอะไรเลย', () => {
    const parsed = parse('เสื้อสีดำ ไม่เกิน 500', true);

    expect(parsed.understood).toEqual([]);
    expect(parsed.filters).toEqual({ colors: [], sizes: [], inStock: false, onSale: false });
    expect(parsed.terms).toEqual(['เสื้อสีดำ', 'ไม่เกิน', '500']);
  });
});

describe('LIKE pattern', () => {
  it('escape % _ \\ — "50%" หาเครื่องหมาย % จริง ไม่ใช่ "50 ตามด้วยอะไรก็ได้"', () => {
    expect(likePattern('50%')).toBe('%50\\%%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
    expect(likePattern('c:\\x')).toBe('%c:\\\\x%');
  });
});
