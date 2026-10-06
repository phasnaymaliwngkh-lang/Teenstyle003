/**
 * ตีความคำค้นที่พิมพ์เป็นภาษาคน (STEP 45) — ฟังก์ชันบริสุทธิ์ เทสต์ป้อนค่าได้ตรง ๆ
 *
 * "เสื้อสีดำราคาไม่เกิน 500 บาท" → คำค้น ["เสื้อ"] + สี ดำ + ราคาไม่เกิน 500
 *
 * **กฎที่ห้ามละเมิด**
 *
 * 1. **ตีความจากคำศัพท์ของร้านเท่านั้น** (สี ไซซ์ จากฐานข้อมูล) — ไม่เดา ไม่ใช้ AI แต่งเงื่อนไข
 *    สีที่ลูกค้าพูดถึงแต่ร้านไม่มี → บอกตรง ๆ ว่าไม่มี (`available: false`) ไม่ใช่ปล่อยไปค้นต่อแล้วแสดงสีอื่น
 * 2. **ทุกเงื่อนไขที่ตีความได้ต้องแสดงให้ลูกค้าเห็นและยกเลิกได้** (`understood`) — ตัวกรองที่ซ่อนอยู่
 *    คือผลค้นหาที่ลูกค้าอธิบายไม่ได้ว่าทำไมของที่หาไม่ขึ้น
 * 3. **หมวดหมู่และแบรนด์ไม่ถูกแปลงเป็นตัวกรองบังคับ** — "เสื้อแจ็คเก็ต" ถ้าบังคับหมวด "เสื้อ"
 *    แจ็คเก็ตที่อยู่หมวด "เสื้อคลุม" จะหายไป · ชื่อหมวด/tag ใช้แค่ **ตัดคำภาษาไทยที่พิมพ์ติดกัน**
 *    แล้วให้แต่ละคำไปจับชื่อสินค้า tag หมวด และแบรนด์เอง (ดู shop.service.ts)
 * 4. แปลงเป็นตัวกรองจริงเฉพาะสิ่งที่ค้นจากข้อความไม่ได้: **สี · ไซซ์** (อยู่ที่ระดับตัวเลือกสินค้า) ·
 *    **ราคา** (ตัวเลข) · **มีของ · ลดราคา** (สถานะ)
 */

export interface SearchVocabulary {
  colors: readonly { slug: string; name: string }[];
  sizes: readonly { code: string; name: string }[];
  /** คำภาษาไทยที่ใช้ตัดคำ — ชื่อหมวด · tag ภาษาไทยของสินค้า (ไม่ใช่ตัวกรอง) */
  words: readonly string[];
}

export type UnderstoodKind = 'color' | 'size' | 'price' | 'stock' | 'sale';

export interface UnderstoodPart {
  kind: UnderstoodKind;
  /** ข้อความที่แสดงให้ลูกค้าเห็น เช่น "สีดำ" · "ราคาไม่เกิน 500 บาท" */
  label: string;
  /** false = เข้าใจคำนี้ แต่ร้านไม่มีของแบบนี้เลย (เช่น สีที่ไม่มีในร้าน) */
  available: boolean;
}

export interface SearchFilters {
  colors: string[];
  sizes: string[];
  minPrice?: number;
  maxPrice?: number;
  inStock: boolean;
  onSale: boolean;
}

export interface ParsedSearch {
  /** คำค้นที่เหลือหลังตีความ — ทุกคำต้องตรง (AND) */
  terms: string[];
  filters: SearchFilters;
  understood: UnderstoodPart[];
}

/** คำค้นได้ไม่เกินกี่คำ — กันคิวรีที่มีเงื่อนไขซ้อนเป็นสิบชั้น */
export const MAX_SEARCH_TERMS = 6;

const THAI_DIGITS = '๐๑๒๓๔๕๖๗๘๙';

/** ตัวพิมพ์เล็ก · เลขไทย → อารบิก · ตัดลูกน้ำในตัวเลข (1,000 → 1000) · ช่องว่างเดียว */
export function normalizeSearchText(text: string): string {
  return text
    .normalize('NFC')
    .replace(/[๐-๙]/g, (digit) => String(THAI_DIGITS.indexOf(digit)))
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ───────────────────────── ราคา ───────────────────────── */

/** "2k" / "2 พัน" = 2,000 — k ต้องติดตัวเลขและไม่ใช่ต้นคำอื่น ("500 kids" ไม่ใช่ 500,000) */
const NUMBER = String.raw`(\d+(?:\.\d+)?)(k(?![a-z])|\s*พัน)?`;
const BAHT = String.raw`\s*(?:บาท|฿|baht|thb)?`;
const PRICE_WORD = String.raw`(?:ราคา\s*)?`;

function toBaht(value: string, unit: string | undefined): number {
  const amount = Number(value);

  return unit === undefined ? amount : amount * 1000;
}

interface PriceRule {
  pattern: RegExp;
  apply: (match: RegExpMatchArray) => { min?: number; max?: number };
}

/**
 * ลำดับมีผล — "ไม่เกิน" ต้องตรวจก่อน "เกิน" ไม่งั้น "ไม่เกิน 500" ถูกอ่านเป็น "มากกว่า 500"
 * "ต่ำกว่า/น้อยกว่า X" ถูกอ่านเป็น "ไม่เกิน X" และ **ป้ายที่แสดงก็เขียนว่า "ไม่เกิน"** ตามที่ใช้กรองจริง
 */
const PRICE_RULES: readonly PriceRule[] = [
  {
    pattern: new RegExp(
      `${PRICE_WORD}(?:ระหว่าง\\s*)?฿?\\s*${NUMBER}${BAHT}\\s*(?:-|–|ถึง|to)\\s*฿?\\s*${NUMBER}${BAHT}`,
    ),
    apply: (m) => {
      const a = toBaht(m[1]!, m[2]);
      const b = toBaht(m[3]!, m[4]);

      return { min: Math.min(a, b), max: Math.max(a, b) };
    },
  },
  {
    pattern: new RegExp(
      `${PRICE_WORD}(?:ไม่เกิน|ต่ำกว่า|น้อยกว่า|ถูกกว่า|ไม่ถึง|ไม่แพงกว่า|under|below|less than|<=?|≤)\\s*฿?\\s*${NUMBER}${BAHT}`,
    ),
    apply: (m) => ({ max: toBaht(m[1]!, m[2]) }),
  },
  {
    pattern: new RegExp(
      `${PRICE_WORD}(?:มากกว่า|เกิน|สูงกว่า|แพงกว่า|ตั้งแต่|over|above|more than|>=?|≥)\\s*฿?\\s*${NUMBER}${BAHT}`,
    ),
    apply: (m) => ({ min: toBaht(m[1]!, m[2]) }),
  },
  {
    pattern: new RegExp(`${PRICE_WORD}฿?\\s*${NUMBER}${BAHT}\\s*ขึ้นไป`),
    apply: (m) => ({ min: toBaht(m[1]!, m[2]) }),
  },
  /**
   * บอกราคาเฉย ๆ ("ราคา 500" · "500 บาท") = งบไม่เกินเท่านั้น — ตีความแบบนี้แล้ว **ป้ายเขียนว่า
   * "ราคาไม่เกิน 500 บาท"** ให้ลูกค้าเห็นและกดค้นแบบตรงตัวได้ ไม่ใช่ปล่อยเลข 500 ไปค้นในชื่อสินค้าจนผลว่าง
   * (ต้องมีคำว่า "ราคา" นำหน้า หรือหน่วยเงินตามหลัง — เลขโดด ๆ อาจเป็นไซซ์หรือรุ่น)
   */
  {
    pattern: new RegExp(
      `ราคา\\s*฿?\\s*${NUMBER}${BAHT}|฿\\s*${NUMBER}|${NUMBER}\\s*(?:บาท|baht|thb)`,
    ),
    apply: (m) => {
      const value = m[1] ?? m[3] ?? m[5];
      const unit = m[1] !== undefined ? m[2] : m[3] !== undefined ? m[4] : m[6];

      return { max: toBaht(value!, unit) };
    },
  },
];

const formatBaht = (amount: number): string => amount.toLocaleString('th-TH');

/* ───────────────────────── สถานะ ───────────────────────── */

const STOCK_PHRASES = ['มีของพร้อมส่ง', 'พร้อมส่ง', 'มีของ', 'in stock', 'instock'];
const SALE_PHRASES = ['กำลังลดราคา', 'ลดราคา', 'ราคาพิเศษ', 'โปรโมชั่น', 'on sale', 'sale'];

/* ───────────────────────── สี ───────────────────────── */

/**
 * คำเรียกสีพื้นฐาน → ใช้หาสีของร้านที่ **ชื่อขึ้นต้นด้วยคำนี้** หรือ slug มีคำภาษาอังกฤษนี้
 * ("สีม่วง" → "ม่วงลาเวนเดอร์" · "pink" → pastel-pink) — เป็นพจนานุกรมภาษา ไม่ใช่ข้อมูลสินค้า
 * สีที่ร้านมีจริงยังมาจากตาราง Color เท่านั้น
 *
 * `needsPrefix` = คำที่มีความหมายอื่นบ่อย ต้องมีคำว่า "สี" นำหน้าจึงนับเป็นสี ("เงินสด" ไม่ใช่สีเงิน)
 */
const BASE_COLORS: readonly { th: string; en: readonly string[]; needsPrefix?: boolean }[] = [
  { th: 'ดำ', en: ['black'] },
  { th: 'ขาว', en: ['white'] },
  { th: 'เทา', en: ['gray', 'grey'] },
  { th: 'ครีม', en: ['cream'] },
  { th: 'เบจ', en: ['beige'] },
  { th: 'น้ำตาล', en: ['brown'] },
  { th: 'แดง', en: ['red'] },
  { th: 'ชมพู', en: ['pink'] },
  { th: 'ส้ม', en: ['orange'] },
  { th: 'เหลือง', en: ['yellow'] },
  { th: 'เขียว', en: ['green'] },
  { th: 'ฟ้า', en: ['sky'] },
  { th: 'น้ำเงิน', en: ['blue'] },
  { th: 'กรมท่า', en: ['navy'] },
  { th: 'ม่วง', en: ['purple', 'violet'] },
  { th: 'ทอง', en: ['gold'], needsPrefix: true },
  { th: 'เงิน', en: ['silver'], needsPrefix: true },
];

/* ───────────────────────── ไซซ์ ───────────────────────── */

const SIZE_PREFIX = String.raw`(?:ไซซ์|ไซส์|ไซต์|size|เบอร์)\s*`;

/* ───────────────────────── คำที่ไม่ใช้ค้น ───────────────────────── */

/**
 * คำที่ช่วยให้ประโยคอ่านเป็นภาษาคน แต่ไม่ได้บอกว่าหาอะไร — ถ้าปล่อยไว้ทุกคำต้องตรง (AND)
 * แล้วไม่มีสินค้าไหนมีคำว่า "อยากได้" อยู่ในชื่อ ผลจะว่างทั้งที่ของมีจริง
 */
const STOP_WORDS = [
  'อยากได้',
  'อยาก',
  'ได้',
  'ต้องการ',
  'หา',
  'ขอ',
  'ค่ะ',
  'คะ',
  'ครับ',
  'หน่อย',
  'ด้วย',
  'ที่',
  'สำหรับ',
  'แบบ',
  'ชุด',
  'ไป',
  'ใส่',
  'ไว้',
  'ราคา',
  'บาท',
  'สี',
  'ไซซ์',
  'ไซส์',
  'หรือ',
  'และ',
  'กับ',
  'size',
  'for',
  'the',
  'and',
  'or',
  'a',
  'an',
  'with',
];

/* ───────────────────────── ตัวช่วย ───────────────────────── */

/** ช่วงอักขระไทยของ Unicode (U+0E00–U+0E7F) */
const THAI = /[฀-๿]/;
const THAI_THEN_LATIN = /([฀-๿])([a-z0-9])/g;
const LATIN_THEN_THAI = /([a-z0-9])([฀-๿])/g;

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** ภาษาอังกฤษต้องเป็นทั้งคำ ("red" ไม่นับใน "bored") · ภาษาไทยไม่มีช่องว่างระหว่างคำ จึงเทียบ substring */
function wordPattern(word: string): string {
  const escaped = escapeRegExp(word);

  return /^[a-z0-9 -]+$/.test(word) ? `(?<![a-z0-9])${escaped}(?![a-z0-9])` : escaped;
}

/** ตัดส่วนที่ตรงออกจากข้อความ (แทนด้วยช่องว่าง) แล้วคืนข้อความที่ตรง */
function take(state: { rest: string }, pattern: RegExp): RegExpMatchArray | null {
  const match = state.rest.match(pattern);

  if (match?.index === undefined) return null;

  state.rest = `${state.rest.slice(0, match.index)} ${state.rest.slice(match.index + match[0].length)}`;

  return match;
}

/**
 * ตัดคำภาษาไทยที่พิมพ์ติดกันด้วยคำที่รู้จัก (ยาวสุดก่อน) — ส่วนที่เหลือระหว่างคำที่รู้จักเป็นคำค้นของมันเอง
 * "กางเกงยีนส์" → ["กางเกง", "ยีนส์"] เมื่อรู้จัก "ยีนส์"
 *
 * ⚠️ ไม่ตัดถ้าจะเหลือเศษตัวเดียว — คำที่รู้จักซ้อนอยู่ในคำอื่นได้ ("ที่" อยู่ใน "เที่ยว")
 *    ตัดแล้วเหลือ "เ" กับ "ยว" ซึ่งไม่ตรงกับอะไรเลย ผลค้นหาจะว่างทั้งที่ของมีจริง
 */
function segment(chunk: string, known: readonly string[]): string[] {
  for (const word of known) {
    let index = chunk.indexOf(word);

    while (index !== -1) {
      const left = chunk.slice(0, index);
      const right = chunk.slice(index + word.length);

      if ((left === '' || left.length >= 2) && (right === '' || right.length >= 2)) {
        return [...segment(left, known), word, ...segment(right, known)];
      }

      index = chunk.indexOf(word, index + 1);
    }
  }

  return chunk === '' ? [] : [chunk];
}

/**
 * ตัดคำที่ไม่ได้บอกว่าหาอะไรออกจาก **หัวและท้าย** เท่านั้น — กลางคำอาจเป็นส่วนของคำอื่น
 * ("อยากได้เสื้อ" → "เสื้อ" · แต่ "เที่ยว" ไม่ถูกแตะแม้จะมี "ที่" อยู่ข้างใน)
 */
function stripStopWords(chunk: string, stopWords: readonly string[]): string {
  let current = chunk;
  let changed = true;

  while (changed) {
    changed = false;

    for (const word of stopWords) {
      if (current.length - word.length < 2) continue;

      if (current.startsWith(word)) {
        current = current.slice(word.length);
        changed = true;
      } else if (current.endsWith(word)) {
        current = current.slice(0, -word.length);
        changed = true;
      }
    }
  }

  return current;
}

/* ───────────────────────── ตัวตีความ ───────────────────────── */

/**
 * @param literal true = ไม่ตีความเลย ค้นตามตัวอักษรที่พิมพ์ (ลูกค้ากด "ค้นแบบตรงตัว")
 */
export function parseSearchQuery(
  text: string,
  vocabulary: SearchVocabulary,
  literal = false,
): ParsedSearch {
  const state = { rest: normalizeSearchText(text) };
  const filters: SearchFilters = { colors: [], sizes: [], inStock: false, onSale: false };
  const understood: UnderstoodPart[] = [];

  if (!literal) {
    // ── ราคา ──
    for (const rule of PRICE_RULES) {
      let match: RegExpMatchArray | null;

      while ((match = take(state, rule.pattern)) !== null) {
        const range = rule.apply(match);

        if (range.min !== undefined) filters.minPrice = Math.max(filters.minPrice ?? 0, range.min);
        if (range.max !== undefined) {
          filters.maxPrice = Math.min(filters.maxPrice ?? Number.POSITIVE_INFINITY, range.max);
        }
      }
    }

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      const { minPrice: min, maxPrice: max } = filters;

      understood.push({
        kind: 'price',
        label:
          min !== undefined && max !== undefined
            ? `ราคา ${formatBaht(min)}–${formatBaht(max)} บาท`
            : max !== undefined
              ? `ราคาไม่เกิน ${formatBaht(max)} บาท`
              : `ราคาตั้งแต่ ${formatBaht(min!)} บาท`,
        // ช่วงที่ขัดกันเอง (เช่น มากกว่า 1000 แต่ไม่เกิน 500) ไม่มีสินค้าไหนเข้าได้
        available: min === undefined || max === undefined || min <= max,
      });
    }

    // ── มีของ · ลดราคา ──
    for (const phrase of STOCK_PHRASES) {
      if (take(state, new RegExp(wordPattern(phrase))) !== null) filters.inStock = true;
    }
    if (filters.inStock) {
      understood.push({ kind: 'stock', label: 'เฉพาะที่มีของพร้อมส่ง', available: true });
    }

    for (const phrase of SALE_PHRASES) {
      if (take(state, new RegExp(wordPattern(phrase))) !== null) filters.onSale = true;
    }
    if (filters.onSale) {
      understood.push({ kind: 'sale', label: 'เฉพาะที่ลดราคา', available: true });
    }

    // ── ไซซ์ — ตัวอักษรอยู่โดด ๆ ได้ (XL) · ตัวเลขต้องมีคำว่า ไซซ์/เบอร์ นำหน้า (กันชนกับราคา) ──
    const sizes = [...vocabulary.sizes].sort((a, b) => b.name.length - a.name.length);

    for (const size of sizes) {
      const forms = new Set([size.name.toLowerCase(), size.code.toLowerCase()]);
      if (size.code === 'FREE')
        ['free size', 'freesize', 'ฟรีไซซ์', 'ฟรีไซส์'].forEach((form) => forms.add(form));

      for (const form of forms) {
        // มีตัวอักษรอังกฤษ (M · XL · EU36 · free size) อยู่โดด ๆ ได้ · ตัวเลขล้วน (36) ต้องมีคำว่า ไซซ์/เบอร์ นำหน้า
        const standalone = /[a-z]/.test(form) || /^ฟรี/.test(form);
        const pattern = new RegExp(
          standalone
            ? `(?:${SIZE_PREFIX})?${wordPattern(form)}`
            : `${SIZE_PREFIX}${wordPattern(form)}`,
        );

        if (take(state, pattern) !== null && !filters.sizes.includes(size.code)) {
          filters.sizes.push(size.code);
          understood.push({ kind: 'size', label: `ไซซ์ ${size.name}`, available: true });
        }
      }
    }

    // ── สี — ชื่อเต็มของร้านก่อน แล้วค่อยคำเรียกสีพื้นฐาน (ยาวสุดก่อน: "น้ำเงิน" ก่อน "เงิน") ──
    const addColor = (label: string, matches: string[]) => {
      const fresh = matches.filter((slug) => !filters.colors.includes(slug));

      filters.colors.push(...fresh);
      if (matches.length === 0 || fresh.length > 0) {
        understood.push({ kind: 'color', label, available: matches.length > 0 });
      }
    };

    for (const color of [...vocabulary.colors].sort((a, b) => b.name.length - a.name.length)) {
      for (const form of [color.name.toLowerCase(), color.slug.replace(/-/g, ' ')]) {
        if (take(state, new RegExp(`(?:สี\\s*)?${wordPattern(form)}`)) !== null) {
          addColor(`สี${color.name}`, [color.slug]);
        }
      }
    }

    for (const base of [...BASE_COLORS].sort((a, b) => b.th.length - a.th.length)) {
      const matchesFor = () =>
        vocabulary.colors
          .filter(
            (color) =>
              color.name.startsWith(base.th) ||
              base.en.some((word) => color.slug.split('-').includes(word)),
          )
          .map((color) => color.slug);

      const thai = new RegExp(base.needsPrefix ? `สี\\s*${base.th}` : `(?:สี\\s*)?${base.th}`);
      const english = new RegExp(base.en.map(wordPattern).join('|'));

      if (take(state, thai) !== null || take(state, english) !== null) {
        addColor(`สี${base.th}`, matchesFor());
      }
    }
  }

  // ── คำค้นที่เหลือ: แยกไทย/อังกฤษที่พิมพ์ติดกัน → ทิ้งคำที่ไม่ได้บอกว่าหาอะไร → ตัดคำไทยด้วยคำที่รู้จัก ──
  const thaiStopWords = STOP_WORDS.filter((word) => THAI.test(word)).sort(
    (a, b) => b.length - a.length,
  );
  const known = [...new Set(vocabulary.words.map((word) => word.toLowerCase()))]
    .filter((word) => THAI.test(word) && word.length >= 2)
    .sort((a, b) => b.length - a.length);
  const isThai = (chunk: string) => !literal && THAI.test(chunk);

  const terms = state.rest
    .replace(THAI_THEN_LATIN, '$1 $2')
    .replace(LATIN_THEN_THAI, '$1 $2')
    .split(' ')
    .map((chunk) => (isThai(chunk) ? stripStopWords(chunk, thaiStopWords) : chunk))
    .flatMap((chunk) => (isThai(chunk) ? segment(chunk, known) : [chunk]))
    // \p{M} = สระบน/ล่างและวรรณยุกต์ของไทย — ถ้าไม่นับเป็นส่วนของคำ ไม้โทท้าย "ฮู้ดดี้" จะถูกเล็มทิ้ง
    .map((term) => term.replace(/^[^\p{L}\p{N}\p{M}]+|[^\p{L}\p{N}\p{M}]+$/gu, ''))
    .filter(
      (term) =>
        term.length > 0 &&
        // อักษรไทยตัวเดียวไม่ใช่คำ — มักเป็นเศษจากการพิมพ์
        !(THAI.test(term) && term.length < 2) &&
        (literal || !STOP_WORDS.includes(term)),
    );

  /**
   * ตีความแล้วไม่เหลืออะไรเลย (พิมพ์แค่ "%" หรือ "อยากได้") → ค้นข้อความดิบที่พิมพ์มาแทน
   * ไม่งั้นการไม่มีเงื่อนไขคือ "ทุกสินค้าในร้าน" ซึ่งไม่ใช่สิ่งที่ลูกค้าถาม
   */
  const unique = [...new Set(terms)];
  const raw = normalizeSearchText(text);
  const nothingLeft = unique.length === 0 && understood.length === 0 && raw !== '';

  return {
    terms: (nothingLeft ? [raw] : unique).slice(0, MAX_SEARCH_TERMS),
    filters,
    understood,
  };
}

/** มีเงื่อนไขที่ร้านตอบไม่ได้ (เช่น สีที่ไม่มีในร้าน) → ผลค้นหาต้องว่าง พร้อมบอกเหตุผล */
export function hasUnavailableCondition(parsed: ParsedSearch): boolean {
  return parsed.understood.some((part) => !part.available);
}

/** escape อักขระพิเศษของ LIKE — "50%" ต้องหาเครื่องหมาย % จริง ไม่ใช่ "50 ตามด้วยอะไรก็ได้" */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
