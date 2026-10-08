import { describe, expect, it } from 'vitest';

import { RETURN_REASONS, refundMethodsFor } from '../src/config/returns.ts';
import { buildOrderNumber, findOrderNumberIn } from '../src/models/order.model.ts';
import {
  CUSTOMER_CANCELLABLE,
  STAFF_DECISIONS,
  buildReturnNumber,
  computePointsShare,
  computeRefundAmount,
  evaluateEligibility,
  isFinalReturn,
  returnDeadline,
  returnableLines,
} from '../src/models/return.model.ts';
import { effectiveReturnWindowDays } from '../src/models/store-settings.model.ts';

/**
 * กฎของการคืนสินค้าและคืนเงิน (STEP 43) — ฟังก์ชันบริสุทธิ์
 *
 * ⚠️ ค่าที่คาดไว้อ้างจาก config/returns.ts และสูตรใน return.model.ts (กฎ STEP 40 ข้อ 2)
 */

const DAY = 24 * 60 * 60 * 1000;
/** จำนวนวันของคำสั่งซื้อในเทสต์ — ค่าใดก็ได้ ฟังก์ชันต้องใช้ค่าที่ส่งเข้าไป ไม่ใช่ค่าคงที่ของตัวเอง */
const WINDOW_DAYS = 9;
const delivered = new Date('2026-10-01T03:00:00.000Z');
const twoLines = [
  { id: 'a', quantity: 2 },
  { id: 'b', quantity: 1 },
];

describe('เลขคำขอคืน', () => {
  it('ต่อท้ายเลขคำสั่งซื้อ — และตัวอ่านเลขคำสั่งซื้อของ AI ยังจับเลขคำสั่งซื้อจากมันได้', () => {
    const orderNumber = buildOrderNumber(delivered, 7);
    const returnNumber = buildReturnNumber(orderNumber, 2);

    expect(returnNumber).toBe(`${orderNumber}-R2`);
    // ลูกค้าก๊อปเลขคำขอไปถามแชต → AI ต้องยังหาคำสั่งซื้อเจอ (บทเรียนรูปแบบเลขของ STEP 40)
    expect(findOrderNumberIn(`ถามเรื่อง ${returnNumber} ค่ะ`)).toBe(orderNumber);
  });
});

describe('evaluateEligibility — ขอคืนได้ไหม', () => {
  const base = {
    status: 'DELIVERED',
    paymentStatus: 'PAID',
    deliveredAt: delivered,
    hasOpenRequest: false,
    lines: returnableLines(twoLines, []),
    windowDays: WINDOW_DAYS,
    now: new Date(delivered.getTime() + DAY),
  };

  it('ได้รับของแล้ว จ่ายแล้ว อยู่ในกำหนด → ขอได้ และบอกวันสุดท้าย', () => {
    const result = evaluateEligibility(base);

    expect(result.eligible).toBe(true);
    expect(result.deadline?.getTime()).toBe(delivered.getTime() + WINDOW_DAYS * DAY);
  });

  it('เลยกำหนดแล้วบอกจำนวนวันของใบนั้น ไม่ใช่ตัวเลขที่พิมพ์ไว้ในโค้ด (STEP 49)', () => {
    const late = evaluateEligibility({ ...base, now: new Date(delivered.getTime() + 30 * DAY) });

    expect(late.reason).toBe('WINDOW_CLOSED');
    expect(late.message).toContain(`ภายใน ${WINDOW_DAYS} วัน`);
  });

  it('จำนวนวันของใบ = ค่าที่ยาวกว่าระหว่างตอนสั่งกับตอนนี้ — ร้านลดวันลงแล้วไม่มีใครเสียสิทธิ์ย้อนหลัง', () => {
    // สั่งตอนนโยบาย 7 วัน แล้วร้านลดเหลือ 3 → ยังได้ 7
    expect(effectiveReturnWindowDays(7, 3)).toBe(7);
    // ร้านขยายเป็น 14 → ใบเก่าได้ 14 ด้วย (บทความประกาศ 14 ให้ทุกคนอ่าน)
    expect(effectiveReturnWindowDays(7, 14)).toBe(14);

    // วันที่ 5 หลังได้รับของ: ใบที่สั่งตอน 7 วันยังขอได้แม้ตอนนี้ร้านตั้งไว้ 3 วัน
    const day5 = new Date(delivered.getTime() + 5 * DAY);
    const kept = evaluateEligibility({
      ...base,
      windowDays: effectiveReturnWindowDays(7, 3),
      now: day5,
    });
    const shortened = evaluateEligibility({ ...base, windowDays: 3, now: day5 });

    expect(kept.eligible).toBe(true);
    expect(shortened.reason).toBe('WINDOW_CLOSED');
  });

  it('ขอบเวลา: วันสุดท้ายพอดียังได้ · เลยไป 1 มิลลิวินาทีไม่ได้', () => {
    const deadline = returnDeadline(delivered, WINDOW_DAYS);

    expect(evaluateEligibility({ ...base, now: deadline }).eligible).toBe(true);
    expect(evaluateEligibility({ ...base, now: new Date(deadline.getTime() + 1) }).reason).toBe(
      'WINDOW_CLOSED',
    );
  });

  it('ยังไม่ได้รับของ / ยังไม่ได้เงิน / มีคำขอค้าง / คืนครบแล้ว → ไม่ได้พร้อมเหตุผล', () => {
    expect(evaluateEligibility({ ...base, status: 'SHIPPING' }).reason).toBe('NOT_DELIVERED');
    expect(evaluateEligibility({ ...base, deliveredAt: null }).reason).toBe('NOT_DELIVERED');
    expect(evaluateEligibility({ ...base, paymentStatus: 'PENDING' }).reason).toBe('NOT_PAID');
    expect(evaluateEligibility({ ...base, hasOpenRequest: true }).reason).toBe(
      'OPEN_REQUEST_EXISTS',
    );

    const allHeld = returnableLines(twoLines, [
      { orderItemId: 'a', quantity: 2 },
      { orderItemId: 'b', quantity: 1 },
    ]);
    const result = evaluateEligibility({ ...base, lines: allHeld });

    expect(result.reason).toBe('NOTHING_LEFT');
    expect(result.message).not.toBeNull();
  });

  it('returnableLines หักชิ้นที่อยู่ในคำขออื่นแล้ว และไม่ติดลบ', () => {
    const lines = returnableLines(twoLines, [
      { orderItemId: 'a', quantity: 1 },
      { orderItemId: 'a', quantity: 5 },
    ]);

    expect(lines.find((line) => line.orderItemId === 'a')).toMatchObject({
      held: 6,
      returnable: 0,
    });
    expect(lines.find((line) => line.orderItemId === 'b')?.returnable).toBe(1);
  });
});

describe('computeRefundAmount — เงินคืนตามสัดส่วนของที่จ่ายจริง', () => {
  // ยอดสินค้า 1,000 · ส่วนลด 100 · ค่าส่ง 50 → จ่ายจริง 950
  const order = { total: 950, subtotal: 1000, refundedTotal: 0 };

  it('คืนบางชิ้น: ส่วนลดและค่าส่งถูกเฉลี่ยตามมูลค่าชิ้นนั้น', () => {
    expect(computeRefundAmount({ ...order, goods: 400, final: false })).toBe(380);
  });

  it('ปัดลงถึงสตางค์ — ไม่มีทางคืนเกินที่จ่ายไป', () => {
    // 950 × 333.33 / 1000 = 316.6635 → 316.66
    expect(computeRefundAmount({ ...order, goods: 333.33, final: false })).toBe(316.66);
  });

  it('คืนครบทุกชิ้นแล้ว: คืนเงินที่เหลือทั้งหมด (รวมเศษจากครั้งก่อน และค่าส่ง)', () => {
    expect(
      computeRefundAmount({ ...order, refundedTotal: 316.66, goods: 666.67, final: true }),
    ).toBe(633.34);
  });

  it('คืนไปแล้วครบ → 0 · ยอดสินค้า 0 → 0 (ไม่หารด้วยศูนย์)', () => {
    expect(computeRefundAmount({ ...order, refundedTotal: 950, goods: 10, final: true })).toBe(0);
    expect(
      computeRefundAmount({ total: 0, subtotal: 0, refundedTotal: 0, goods: 0, final: false }),
    ).toBe(0);
  });

  it('คุณสมบัติที่ต้องจริงทุกกรณี: แบ่งคืนกี่ครั้งก็ได้ ผลรวมเท่ายอดที่จ่ายพอดี (สุ่ม 1,000 บิล)', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
      return seed / 2 ** 31;
    };

    for (let round = 0; round < 1_000; round += 1) {
      const prices = Array.from(
        { length: 1 + Math.floor(random() * 4) },
        () => Math.round((50 + random() * 2_000) * 100) / 100,
      );
      const subtotal = Math.round(prices.reduce((sum, price) => sum + price, 0) * 100) / 100;
      const discount = Math.round(random() * subtotal * 0.5 * 100) / 100;
      const total = Math.round((subtotal - discount + random() * 120) * 100) / 100;

      let refunded = 0;

      prices.forEach((price, index) => {
        const amount = computeRefundAmount({
          total,
          subtotal,
          refundedTotal: refunded,
          goods: price,
          final: index === prices.length - 1,
        });

        expect(amount).toBeGreaterThanOrEqual(0);
        refunded = Math.round((refunded + amount) * 100) / 100;
        expect(refunded).toBeLessThanOrEqual(total);
      });

      expect(refunded).toBe(total);
    }
  });
});

describe('computePointsShare — แต้มตามสัดส่วนเดียวกับเงิน', () => {
  it('บางชิ้นได้ตามสัดส่วน (ปัดลง) · ครั้งสุดท้ายได้ส่วนที่เหลือ · รวมแล้วเท่าแต้มทั้งบิลพอดี', () => {
    const first = computePointsShare({
      totalPoints: 95,
      alreadyMoved: 0,
      goods: 400,
      subtotal: 1000,
      final: false,
    });
    const last = computePointsShare({
      totalPoints: 95,
      alreadyMoved: first,
      goods: 600,
      subtotal: 1000,
      final: true,
    });

    expect(first).toBe(38);
    expect(first + last).toBe(95);
  });

  it('ย้ายไปครบแล้ว → 0 (เรียกซ้ำไม่คืน/หักซ้ำ)', () => {
    expect(
      computePointsShare({
        totalPoints: 95,
        alreadyMoved: 95,
        goods: 1000,
        subtotal: 1000,
        final: true,
      }),
    ).toBe(0);
  });
});

describe('isFinalReturn', () => {
  it('ครบทุกชิ้นทุกรายการเท่านั้นจึงนับเป็นครั้งสุดท้าย', () => {
    expect(isFinalReturn(twoLines, [{ orderItemId: 'a', quantity: 2 }])).toBe(false);
    expect(
      isFinalReturn(twoLines, [
        { orderItemId: 'a', quantity: 1 },
        { orderItemId: 'a', quantity: 1 },
        { orderItemId: 'b', quantity: 1 },
      ]),
    ).toBe(true);
  });
});

describe('เส้นทางสถานะและนโยบาย', () => {
  it('สถานะที่จบแล้วเปลี่ยนต่อไม่ได้ · ลูกค้ายกเลิกได้จนกว่าร้านจะรับของ', () => {
    for (const done of ['REFUNDED', 'REJECTED', 'CANCELLED'] as const) {
      expect(STAFF_DECISIONS[done]).toEqual([]);
      expect(CUSTOMER_CANCELLABLE).not.toContain(done);
    }
    expect(CUSTOMER_CANCELLABLE).not.toContain('RECEIVED');
  });

  it('เหตุผลที่คืนเงินได้มีแต่ความผิดของร้าน (ตามนโยบายในบทความ) — ไม่มี "เปลี่ยนใจ"', () => {
    expect(RETURN_REASONS.map((reason) => reason.code)).toEqual(['DEFECTIVE', 'WRONG_ITEM']);
  });

  it('COD คืนได้ทางเดียวคือโอน · จ่ายผ่าน Stripe คืนผ่าน Stripe หรือโอนได้', () => {
    expect(refundMethodsFor('COD')).toEqual(['BANK_TRANSFER']);
    expect(refundMethodsFor('STRIPE')).toContain('STRIPE_DASHBOARD');
  });
});
