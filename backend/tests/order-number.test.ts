import { describe, expect, it } from 'vitest';

import {
  buildOrderNumber,
  findOrderNumberIn,
  ORDER_NUMBER_EXAMPLE,
  ORDER_NUMBER_PREFIX,
  orderNumberPrefixFor,
} from '../src/models/order.model.ts';
import { DEFAULT_CS_PROMPTS, runFallbackCs } from '../src/services/ai-cs.service.ts';
import { INITIAL_KNOWLEDGE_ARTICLES } from '../src/models/knowledge-base.model.ts';

/**
 * รูปแบบเลขคำสั่งซื้อต้องเป็นเรื่องเดียวกันทั้งระบบ (STEP 40)
 *
 * บั๊กที่เทสต์ชุดนี้ล็อกไว้ (เจอตอนตรวจรอบสุดท้ายของ STEP 40):
 * ตัวสร้างเลขใช้ `TS-` แต่ฝั่ง AI Customer Service เขียนรูปแบบไว้เองเป็น `ORD-` ทั้ง 5 ที่
 * — รวมถึง **regex ที่ใช้จับเลขจากข้อความลูกค้า** ผลคือลูกค้าพิมพ์เลขจริงแล้ว AI จับไม่ได้
 * จึงตอบว่า "รบกวนแจ้งหมายเลขคำสั่งซื้อ (เช่น ORD-…)" แล้ววนถามซ้ำไปเรื่อย ๆ
 * → **การเช็คสถานะคำสั่งซื้อผ่านแชตไม่เคยทำงานเลย** และยังชี้ให้ลูกค้าไปหาเลขที่ไม่มีอยู่จริง
 *
 * ไม่มีอะไรฟ้องเลย เพราะทุกชั้นตอบ 200 และข้อความที่ AI ตอบก็อ่านดูสุภาพปกติ
 */
describe('รูปแบบเลขคำสั่งซื้อ (STEP 40)', () => {
  it('เลขที่ระบบสร้างต้องถูกตัวที่อ่านเลขจับได้ — นี่คือบั๊กที่เคยเกิดจริง', () => {
    const generated = buildOrderNumber(new Date(2026, 8, 18), 1);

    expect(generated).toBe('TS-20260918-0001');
    expect(findOrderNumberIn(generated)).toBe(generated);
  });

  it('prefix ของวันต้องตรงกับเลขที่สร้างในวันเดียวกัน (ใช้หาลำดับล่าสุด)', () => {
    const day = new Date(2026, 11, 1);

    expect(buildOrderNumber(day, 42).startsWith(orderNumberPrefixFor(day))).toBe(true);
    expect(orderNumberPrefixFor(day)).toBe(`${ORDER_NUMBER_PREFIX}-20261201-`);
  });

  it('ตัวอย่างที่เอาไปโชว์ผู้ใช้ต้องเป็นเลขที่ระบบยอมรับจริง', () => {
    expect(findOrderNumberIn(ORDER_NUMBER_EXAMPLE)).toBe(ORDER_NUMBER_EXAMPLE);
  });

  it('อ่านเลขจากประโยคที่ลูกค้าพิมพ์ได้ และยอมให้พิมพ์เล็ก/มีช่องว่างรอบขีด', () => {
    expect(findOrderNumberIn('ขอเช็คสถานะ TS-20260918-0001 ด้วยครับ')).toBe('TS-20260918-0001');
    expect(findOrderNumberIn('ts-20260918-0001')).toBe('TS-20260918-0001');
    expect(findOrderNumberIn('TS - 20260918 - 0001')).toBe('TS-20260918-0001');
  });

  it('รูปแบบที่ไม่ตรงต้องคืน null — ห้ามเดาเลขออเดอร์ให้', () => {
    for (const text of [
      'ORD-20260918-0001',
      'TS-2026-0001',
      'TS-20260918-001',
      'เช็คของให้ด้วย',
      '20260918',
    ]) {
      expect(findOrderNumberIn(text)).toBeNull();
    }
  });
});

describe('ทุกที่ที่พูดถึงเลขคำสั่งซื้อต้องใช้รูปแบบจริง (STEP 40)', () => {
  /** ข้อความที่โชว์ตัวอย่างผิดรูปแบบ = พาลูกค้าไปหาเลขที่ไม่มีอยู่ในระบบ (ผิดกฎข้อ 3) */
  it('prompt ของ AI ไม่มีรูปแบบเลขออเดอร์ที่ไม่ใช่ของจริง', () => {
    const allPrompts = Object.values(DEFAULT_CS_PROMPTS).join('\n');

    expect(allPrompts).not.toMatch(/ORD-\d/);
  });

  it('บทความคลังความรู้ไม่มีรูปแบบเลขออเดอร์ที่ไม่ใช่ของจริง', () => {
    const allContent = INITIAL_KNOWLEDGE_ARTICLES.map(
      (article) => `${article.title}\n${article.summary}\n${article.content}`,
    ).join('\n');

    expect(allContent).not.toMatch(/ORD-\d/);
    // และบทความที่ยกตัวอย่างเลขออเดอร์ ต้องยกตัวอย่างที่ระบบอ่านได้จริง
    const examples = allContent.match(/[A-Z]{2,4}-\d{8}-\d{4}/g) ?? [];

    for (const example of examples) expect(findOrderNumberIn(example)).toBe(example);
  });

  /**
   * หัวใจของบั๊ก: เดิมลูกค้าพิมพ์เลขจริงแล้ว regex จับไม่ได้ → ตกไปทาง "ขอเลขอีกครั้ง"
   * แล้ววนซ้ำไม่จบ · ตอนนี้ต้องเข้าทาง **ค้นหาคำสั่งซื้อ** ซึ่งปลายทางมีได้ 2 แบบเท่านั้น:
   * guest → บอกว่าต้องล็อกอิน (กฎ STEP 20 ข้อ 4 — guest ไม่มีทางเป็นเจ้าของออเดอร์)
   * ล็อกอินแล้ว → บอกรายละเอียด หรือบอกว่าไม่พบเลขนั้น
   * สิ่งที่ต้องไม่เกิดคือการกลับไปขอเลขใหม่
   */
  it('ลูกค้าพิมพ์เลขจริงแล้ว AI ต้องเข้าทางค้นหาคำสั่งซื้อ ไม่ใช่วนถามเลขซ้ำ', async () => {
    const result = await runFallbackCs(`เช็คสถานะ ${ORDER_NUMBER_EXAMPLE} ให้ด้วยครับ`, {
      sessionId: 'test-order-number',
    });

    expect(result.replyText).not.toContain('รบกวนแจ้ง');
    expect(result.replyText).toMatch(/บัญชี|ล็อกอิน|เข้าสู่ระบบ|ไม่พบคำสั่งซื้อ/);
  });

  it('ถามสถานะโดยไม่ให้เลข ต้องขอเลขพร้อมตัวอย่างที่ถูกรูปแบบ', async () => {
    const result = await runFallbackCs('ขอเช็คสถานะคำสั่งซื้อครับ', {
      sessionId: 'test-order-number',
    });

    expect(result.replyText).toContain('รบกวนแจ้ง');
    expect(result.replyText).toContain(ORDER_NUMBER_EXAMPLE);
  });
});
