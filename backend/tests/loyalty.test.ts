import { describe, expect, it } from 'vitest';

import {
  EARN_BAHT_PER_POINT,
  LOYALTY_TIERS,
  REDEEM_MAX_PERCENT_OF_SUBTOTAL,
  REDEEM_MINIMUM_POINTS,
  REDEEM_POINTS_PER_BAHT,
  REDEEM_STEP_POINTS,
} from '../src/config/loyalty.ts';
import {
  evaluateRedemption,
  isHigherTier,
  maxRedeemablePoints,
  nextTierFor,
  pointsEarnedFor,
  tierForSpend,
  toStanding,
} from '../src/models/loyalty.model.ts';

/**
 * กฎของแต้มสะสม (STEP 42) — ฟังก์ชันบริสุทธิ์ ไม่แตะฐานข้อมูล
 *
 * ⚠️ ตัวเลขที่คาดไว้ทุกตัว **อ้างจาก config** ไม่ได้พิมพ์ซ้ำในเทสต์
 *    (กฎ STEP 40 ข้อ 2: เทสต์ที่ล็อกค่าที่ผิดไว้ แย่กว่าไม่มีเทสต์)
 *    แก้กติกาใน config/loyalty.ts แล้วเทสต์ชุดนี้ยังต้องผ่าน — ถ้าไม่ผ่านแปลว่ากฎพังจริง
 */

const MEMBER = LOYALTY_TIERS[0]!;
const TOP = LOYALTY_TIERS[LOYALTY_TIERS.length - 1]!;

describe('config ของระดับสมาชิก', () => {
  it('ระดับแรกเริ่มที่ยอด 0 — ไม่งั้นลูกค้าใหม่จะไม่อยู่ระดับใดเลย', () => {
    expect(MEMBER.minSpend).toBe(0);
  });

  it('เกณฑ์เรียงจากน้อยไปมากและไม่ซ้ำ · ตัวคูณไม่ลดลงเมื่อระดับสูงขึ้น', () => {
    for (let index = 1; index < LOYALTY_TIERS.length; index += 1) {
      const previous = LOYALTY_TIERS[index - 1]!;
      const current = LOYALTY_TIERS[index]!;

      expect(current.minSpend).toBeGreaterThan(previous.minSpend);
      expect(current.earnMultiplierPercent).toBeGreaterThanOrEqual(previous.earnMultiplierPercent);
    }
  });

  it('ขั้นต่ำของการแลกเป็นทวีคูณของ step — ไม่งั้นค่าขั้นต่ำเองจะแลกไม่ได้', () => {
    expect(REDEEM_MINIMUM_POINTS % REDEEM_STEP_POINTS).toBe(0);
    // step ต้องได้ส่วนลดเป็นจำนวนเต็มบาท (ไม่มีเศษสตางค์ที่ต้องทอนตอนเก็บเงินปลายทาง)
    expect(REDEEM_STEP_POINTS % REDEEM_POINTS_PER_BAHT).toBe(0);
  });
});

describe('tierForSpend — ระดับจากยอดที่จ่ายจริง', () => {
  it('ยอดเท่าเกณฑ์พอดีได้ระดับนั้น · ขาดไป 1 สตางค์ยังอยู่ระดับก่อนหน้า', () => {
    for (let index = 1; index < LOYALTY_TIERS.length; index += 1) {
      const tier = LOYALTY_TIERS[index]!;

      expect(tierForSpend(tier.minSpend).code).toBe(tier.code);
      expect(tierForSpend(tier.minSpend - 0.01).code).toBe(LOYALTY_TIERS[index - 1]!.code);
    }
  });

  it('ยอด 0 = ระดับแรก · ยอดมหาศาล = ระดับสูงสุด', () => {
    expect(tierForSpend(0).code).toBe(MEMBER.code);
    expect(tierForSpend(TOP.minSpend * 100).code).toBe(TOP.code);
  });

  it('nextTierFor บอกยอดที่ขาดถึงระดับถัดไปตรงถึงสตางค์ · ระดับสูงสุดคืน null', () => {
    const second = LOYALTY_TIERS[1]!;
    const next = nextTierFor(second.minSpend - 0.01);

    expect(next?.tier.code).toBe(second.code);
    expect(next?.remaining).toBe(0.01);
    expect(nextTierFor(TOP.minSpend)).toBeNull();
  });

  it('isHigherTier ใช้ลำดับใน config ไม่ใช่ลำดับตัวอักษร', () => {
    expect(isHigherTier(TOP.code, MEMBER.code)).toBe(true);
    expect(isHigherTier(MEMBER.code, TOP.code)).toBe(false);
    expect(isHigherTier(MEMBER.code, MEMBER.code)).toBe(false);
  });
});

describe('pointsEarnedFor — แต้มจากยอดที่จ่ายจริง', () => {
  it('ทุก EARN_BAHT_PER_POINT บาท = 1 แต้มที่ระดับแรก (ปัดลง)', () => {
    expect(pointsEarnedFor(EARN_BAHT_PER_POINT * 37, MEMBER)).toBe(37);
    expect(pointsEarnedFor(EARN_BAHT_PER_POINT * 37 + EARN_BAHT_PER_POINT - 0.01, MEMBER)).toBe(37);
    expect(pointsEarnedFor(EARN_BAHT_PER_POINT - 0.01, MEMBER)).toBe(0);
  });

  it('คูณตามระดับ **ก่อน** ปัดลง ไม่ใช่ปัดลงก่อนแล้วค่อยคูณ', () => {
    for (const tier of LOYALTY_TIERS) {
      // 1,000 แต้มฐาน × ตัวคูณ → ต้องได้ผลคูณตรง ๆ ไม่มีแต้มหาย
      expect(pointsEarnedFor(EARN_BAHT_PER_POINT * 1000, tier)).toBe(
        (1000 * tier.earnMultiplierPercent) / 100,
      );
    }
  });

  it('ไม่มีแต้มหายเพราะทศนิยมลอยของ JS (คิดเป็นสตางค์จำนวนเต็ม)', () => {
    // ราคาสามชิ้นรวมกันได้ 200 บาทพอดี แต่ JS บวกได้ 199.99999999999997
    // ถ้าหารแล้วปัดลงตรง ๆ ลูกค้าจะเสียไปหนึ่งแต้มโดยไม่มีใครตั้งใจ
    const summed = [199.7, 0.1, 0.2].reduce((sum, value) => sum + value, 0);

    expect(summed).toBeLessThan(200); // ยืนยันว่ากับดักยังอยู่จริง ไม่ใช่เทสต์ที่ผ่านเพราะโชคดี
    expect(pointsEarnedFor(summed, MEMBER)).toBe(Math.floor(200 / EARN_BAHT_PER_POINT));
  });

  it('ยอด 0 หรือติดลบไม่ได้แต้ม (ไม่มีทางได้แต้มติดลบ)', () => {
    expect(pointsEarnedFor(0, TOP)).toBe(0);
    expect(pointsEarnedFor(-500, TOP)).toBe(0);
  });
});

describe('maxRedeemablePoints — เพดานแต้มที่ใช้ได้กับบิล', () => {
  it('ไม่เกินแต้มที่มี', () => {
    expect(maxRedeemablePoints({ balance: 250, subtotal: 100_000, otherDiscount: 0 })).toBe(250);
  });

  it(`ไม่เกิน ${REDEEM_MAX_PERCENT_OF_SUBTOTAL}% ของยอดสินค้า`, () => {
    const subtotal = 1_000;
    const capBaht = (subtotal * REDEEM_MAX_PERCENT_OF_SUBTOTAL) / 100;

    expect(maxRedeemablePoints({ balance: 1_000_000, subtotal, otherDiscount: 0 })).toBe(
      capBaht * REDEEM_POINTS_PER_BAHT,
    );
  });

  it('ส่วนลดคูปอง + แต้ม ต้องไม่เกินยอดสินค้า (CHECK ของฐานข้อมูล)', () => {
    const subtotal = 1_000;
    // คูปองลดไป 900 เหลือ 100 บาท → แต้มจ่ายได้ไม่เกิน 100 บาท แม้เพดาน % จะสูงกว่า
    const max = maxRedeemablePoints({ balance: 1_000_000, subtotal, otherDiscount: 900 });

    expect(max / REDEEM_POINTS_PER_BAHT).toBeLessThanOrEqual(100);
  });

  it('ได้น้อยกว่าขั้นต่ำ = ใช้ไม่ได้เลย (0) ไม่ใช่ปัดขึ้นให้ถึงขั้นต่ำ', () => {
    expect(
      maxRedeemablePoints({
        balance: REDEEM_MINIMUM_POINTS - REDEEM_STEP_POINTS,
        subtotal: 100_000,
        otherDiscount: 0,
      }),
    ).toBe(0);
  });

  it('คุณสมบัติที่ต้องจริงทุกกรณี (สุ่ม 2,000 ชุด)', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };

    for (let round = 0; round < 2_000; round += 1) {
      const subtotal = Math.round(random() * 5_000_00) / 100;
      const otherDiscount = Math.round(random() * subtotal * 100) / 100;
      const balance = Math.floor(random() * 20_000);
      const max = maxRedeemablePoints({ balance, subtotal, otherDiscount });
      const discount = max / REDEEM_POINTS_PER_BAHT;

      expect(max % REDEEM_STEP_POINTS).toBe(0);
      expect(max).toBeLessThanOrEqual(balance);
      expect(max === 0 || max >= REDEEM_MINIMUM_POINTS).toBe(true);
      expect(discount).toBeLessThanOrEqual((subtotal * REDEEM_MAX_PERCENT_OF_SUBTOTAL) / 100);
      expect(Math.round((otherDiscount + discount) * 100)).toBeLessThanOrEqual(
        Math.round(subtotal * 100),
      );
    }
  });
});

describe('evaluateRedemption — ปฏิเสธพร้อมเหตุผล ไม่ปรับลดให้เงียบ ๆ', () => {
  const plenty = { balance: 100_000, subtotal: 100_000, otherDiscount: 0 };

  it('ขอ 0 แต้ม = ไม่ใช้แต้ม (ผ่าน · ส่วนลด 0)', () => {
    const result = evaluateRedemption({ ...plenty, requested: 0 });

    expect(result).toMatchObject({ ok: true, points: 0, discount: 0 });
  });

  it('ใช้ได้ → ส่วนลด = แต้ม ÷ อัตราแลก', () => {
    const requested = REDEEM_MINIMUM_POINTS * 3;
    const result = evaluateRedemption({ ...plenty, requested });

    expect(result.ok).toBe(true);
    expect(result.points).toBe(requested);
    expect(result.discount).toBe(requested / REDEEM_POINTS_PER_BAHT);
  });

  it('ไม่ใช่ทวีคูณของ step → NOT_A_STEP', () => {
    const result = evaluateRedemption({ ...plenty, requested: REDEEM_MINIMUM_POINTS + 1 });

    expect(result).toMatchObject({ ok: false, rejection: 'NOT_A_STEP', discount: 0 });
    expect(result.message).toContain(String(REDEEM_STEP_POINTS));
  });

  it('ต่ำกว่าขั้นต่ำ → BELOW_MINIMUM', () => {
    const result = evaluateRedemption({
      ...plenty,
      requested: REDEEM_MINIMUM_POINTS - REDEEM_STEP_POINTS,
    });

    expect(result.rejection).toBe('BELOW_MINIMUM');
  });

  it('แต้มไม่พอ → NOT_ENOUGH_POINTS พร้อมบอกยอดที่มี', () => {
    const result = evaluateRedemption({
      ...plenty,
      balance: REDEEM_MINIMUM_POINTS,
      requested: REDEEM_MINIMUM_POINTS * 2,
    });

    expect(result.rejection).toBe('NOT_ENOUGH_POINTS');
    expect(result.message).toContain(REDEEM_MINIMUM_POINTS.toLocaleString('th-TH'));
  });

  it('บิลเล็กเกินจะใช้แต้มได้ → NOT_ALLOWED_FOR_ORDER', () => {
    const result = evaluateRedemption({
      balance: 100_000,
      subtotal: 1,
      otherDiscount: 0,
      requested: REDEEM_MINIMUM_POINTS,
    });

    expect(result.rejection).toBe('NOT_ALLOWED_FOR_ORDER');
  });

  it('เกินเพดานของบิล → OVER_LIMIT และบอกจำนวนสูงสุดที่ใช้ได้', () => {
    const subtotal = 1_000;
    const max = maxRedeemablePoints({ balance: 100_000, subtotal, otherDiscount: 0 });
    const result = evaluateRedemption({
      balance: 100_000,
      subtotal,
      otherDiscount: 0,
      requested: max + REDEEM_STEP_POINTS,
    });

    expect(result.rejection).toBe('OVER_LIMIT');
    expect(result.maxPoints).toBe(max);
    expect(result.message).toContain(max.toLocaleString('th-TH'));
  });
});

describe('toStanding', () => {
  it('ระดับและยอดที่ขาดมาจากยอดที่จ่ายจริงชุดเดียวกัน', () => {
    const second = LOYALTY_TIERS[1]!;
    const standing = toStanding(120, second.minSpend - 500);

    expect(standing.points).toBe(120);
    expect(standing.tier.code).toBe(MEMBER.code);
    expect(standing.nextTier).toMatchObject({ code: second.code, remaining: 500 });
  });
});
