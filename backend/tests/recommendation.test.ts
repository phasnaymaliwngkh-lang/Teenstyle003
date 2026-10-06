import { describe, expect, it } from 'vitest';

import {
  buildProfile,
  priceCloseness,
  scoreCandidates,
  scoreSimilar,
  SIGNAL_WEIGHT,
  type RecommendableProduct,
  type Signal,
} from '../src/models/recommendation.model.ts';

/**
 * กฎการให้คะแนนการแนะนำ (STEP 46) — ไม่แตะฐานข้อมูล
 * ส่วนที่ต้องพิสูจน์กับของจริง (ประวัติจริง · ซื้อด้วยกันจริง · สวิตช์ปิดการแนะนำ) อยู่ใน recommendation-api.test.ts
 */
const product = (
  id: string,
  overrides: Partial<RecommendableProduct> = {},
): RecommendableProduct => ({
  id,
  name: `สินค้า ${id}`,
  categoryId: 'tees',
  parentCategoryId: 'tops',
  brandId: null,
  tags: [],
  finalPrice: 500,
  ...overrides,
});

const HOODIE = product('hoodie', {
  name: 'ฮู้ดดี้',
  tags: ['street', 'oversize'],
  categoryId: 'outer',
  parentCategoryId: null,
});
const TEE = product('tee', { name: 'เสื้อยืด', tags: ['street', 'basic'] });

describe('ความชอบจากสิ่งที่ลูกค้าทำ', () => {
  it('ซื้อจริงมีน้ำหนักมากกว่ารีวิว > ถูกใจ > ใส่ตะกร้า', () => {
    expect(SIGNAL_WEIGHT.PURCHASE).toBeGreaterThan(SIGNAL_WEIGHT.REVIEW);
    expect(SIGNAL_WEIGHT.REVIEW).toBeGreaterThan(SIGNAL_WEIGHT.WISHLIST);
    expect(SIGNAL_WEIGHT.WISHLIST).toBeGreaterThan(SIGNAL_WEIGHT.CART);
  });

  it('รวมน้ำหนักตามหมวด/tag และราคากลางถ่วงน้ำหนัก (ไม่สนตัวพิมพ์ของ tag)', () => {
    const profile = buildProfile([
      { source: 'PURCHASE', product: product('a', { tags: ['Street'], finalPrice: 400 }) },
      { source: 'CART', product: product('b', { tags: ['street'], finalPrice: 1000 }) },
    ]);

    expect(profile.categories.get('tees')).toBe(SIGNAL_WEIGHT.PURCHASE + SIGNAL_WEIGHT.CART);
    expect(profile.tags.get('street')).toBe(SIGNAL_WEIGHT.PURCHASE + SIGNAL_WEIGHT.CART);
    expect(profile.priceCenter).toBeCloseTo((400 * 3 + 1000 * 1.5) / 4.5, 6);
  });

  it('ความใกล้ของราคา: เท่ากัน = 1 · ห่างเท่าตัว = 0 · ไม่มีข้อมูล = 0', () => {
    expect(priceCloseness(500, 500)).toBe(1);
    expect(priceCloseness(1000, 500)).toBe(0);
    expect(priceCloseness(750, 500)).toBeCloseTo(0.5, 6);
    expect(priceCloseness(500, null)).toBe(0);
  });
});

describe('แนะนำสำหรับคุณ', () => {
  const signals: Signal[] = [{ source: 'WISHLIST', product: HOODIE }];

  it('ไม่มีสัญญาณ → ไม่มีรายการเฉพาะบุคคล (ผู้เรียกต้องใช้ยอดนิยมและบอกว่าเป็นยอดนิยม)', () => {
    expect(scoreCandidates([TEE], [], [])).toEqual([]);
  });

  it('ไม่แนะนำสิ่งที่ลูกค้ารู้จักแล้ว · ไม่แนะนำของที่ไม่เชื่อมกับสิ่งที่ลูกค้าทำ (ราคาใกล้อย่างเดียวไม่นับ)', () => {
    const stranger = product('stranger', {
      categoryId: 'shoes',
      parentCategoryId: null,
      finalPrice: 500,
    });
    const result = scoreCandidates([HOODIE, TEE, stranger], signals, []);

    expect(result.map((row) => row.productId)).toEqual(['tee']);
  });

  it('ของที่ลูกค้ารีวิวว่าไม่ชอบไม่ถูกแนะนำกลับ แม้จะคล้ายสิ่งที่ชอบมาก', () => {
    const disliked = product('disliked', {
      tags: ['street', 'oversize'],
      categoryId: 'outer',
      parentCategoryId: null,
    });
    const result = scoreCandidates([disliked, TEE], signals, [], new Set(['disliked']));

    expect(result.map((row) => row.productId)).toEqual(['tee']);
  });

  it('เหตุผลอ้างสินค้าจริงที่ใกล้ที่สุด และบอกว่าลูกค้าทำอะไรกับมัน', () => {
    const [row] = scoreCandidates([TEE], signals, []);

    expect(row!.reason).toEqual({ kind: 'SIMILAR', text: 'คล้าย “ฮู้ดดี้” ที่คุณถูกใจ' });
  });

  /** ตรงแค่แบรนด์ก็ต้องมีสินค้าอ้างอิง — เคยตกไปเป็นเหตุผลเรื่อง "หมวดที่คุณสนใจ" ซึ่งไม่จริง */
  it('ตรงแค่แบรนด์ → ยังอ้างสินค้าจริงที่แบรนด์เดียวกัน', () => {
    const cap = product('cap', {
      categoryId: 'hats',
      parentCategoryId: null,
      brandId: 'street-lab',
    });
    const bought: Signal[] = [
      {
        source: 'PURCHASE',
        product: product('jacket', {
          name: 'แจ็คเก็ต',
          categoryId: 'outer',
          parentCategoryId: null,
          brandId: 'street-lab',
        }),
      },
    ];
    const [row] = scoreCandidates([cap], bought, []);

    expect(row!.reason.text).toBe('คล้าย “แจ็คเก็ต” ที่คุณสั่งซื้อ');
  });

  it('ซื้อด้วยกันจริงชนะการเดาจากหมวด และเหตุผลบอกว่าลูกค้าคนอื่นซื้อคู่กับอะไร', () => {
    const sneaker = product('sneaker', { categoryId: 'shoes', parentCategoryId: null });
    const result = scoreCandidates([TEE, sneaker], signals, [
      { productId: 'sneaker', orders: 3, anchorName: 'ฮู้ดดี้' },
    ]);

    expect(result[0]).toMatchObject({
      productId: 'sneaker',
      reason: { kind: 'BOUGHT_TOGETHER', text: 'ลูกค้าที่ซื้อ “ฮู้ดดี้” ซื้อชิ้นนี้ด้วย' },
    });
  });

  it('คะแนนเท่ากัน → ลำดับคงที่ (เปิดหน้าซ้ำแล้วรายการไม่สลับไปมา)', () => {
    const a = product('a', { tags: ['street'] });
    const b = product('b', { tags: ['street'] });

    expect(scoreCandidates([b, a], signals, []).map((row) => row.productId)).toEqual(['a', 'b']);
    expect(scoreCandidates([a, b], signals, []).map((row) => row.productId)).toEqual(['a', 'b']);
  });
});

describe('สินค้าคล้ายกัน (หน้าสินค้า)', () => {
  it('ไม่รวมตัวเอง · ต้องหมวดแม่เดียวกันหรือมี tag ร่วม · หมวดเดียวกันมาก่อน', () => {
    const sameCategory = product('same', { tags: [] });
    const sharedTag = product('tagged', {
      categoryId: 'outer',
      parentCategoryId: null,
      tags: ['basic'],
    });
    const unrelated = product('far', {
      categoryId: 'shoes',
      parentCategoryId: null,
      tags: ['sporty'],
    });

    const result = scoreSimilar(TEE, [TEE, unrelated, sharedTag, sameCategory]);

    expect(result.map((row) => row.productId)).toEqual(['same', 'tagged']);
    expect(result[1]!.text).toBe('สไตล์ร่วม: basic');
  });
});
