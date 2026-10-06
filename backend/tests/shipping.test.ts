import { describe, expect, it } from 'vitest';

import { INITIAL_KNOWLEDGE_ARTICLES } from '../src/models/knowledge-base.model.ts';
import {
  POLICY_TOKENS,
  renderPolicyTokens,
  unknownPolicyTokens,
} from '../src/models/policy-tokens.ts';
import {
  calculateShippingFee,
  describeFreeShipping,
  describeShippingEta,
  describeShippingRates,
  isShippingAvailable,
  SHIPMENT_TRANSITIONS,
  shippingOrderActions,
  THAI_PROVINCES,
  type ShipmentStatusCode,
  type ShippingOption,
} from '../src/models/shipping.model.ts';
import {
  trackingUrlSchema,
  updateShipmentStatusSchema,
  updateShippingRateSchema,
} from '../src/validators/shipping.validator.ts';

/**
 * กฎล้วนของการจัดส่ง (STEP 44) — ไม่แตะฐานข้อมูล
 * ส่วนที่ต้องพิสูจน์กับของจริง (แก้อัตราแล้วทุกที่เปลี่ยนตาม · พัสดุตีกลับ · ส่งใหม่) อยู่ใน shipping-order.test.ts
 */

const option = (overrides: Partial<ShippingOption> = {}): ShippingOption => ({
  code: 'STANDARD',
  name: 'ส่งธรรมดา',
  description: 'ไปรษณีย์ไทย / Flash',
  baseFee: 50,
  freeOverSubtotal: 1000,
  etaText: '2–4 วันทำการ',
  onlyProvinces: null,
  isActive: true,
  sortOrder: 1,
  ...overrides,
});

describe('ค่าส่ง', () => {
  it('ต่ำกว่ายอดส่งฟรีเก็บค่าส่ง · ครบพอดีส่งฟรี · ไม่มีโปรเก็บทุกครั้ง', () => {
    expect(calculateShippingFee(option(), 999.99)).toBe(50);
    expect(calculateShippingFee(option(), 1000)).toBe(0);
    expect(calculateShippingFee(option({ freeOverSubtotal: null }), 50_000)).toBe(50);
  });

  /** กับดักเดียวกับแต้มของ STEP 42 — เทียบตรง ๆ ลูกค้าที่ซื้อครบพอดีจะเสียค่าส่ง */
  it('เทียบเป็นสตางค์ — ยอดที่เกิดจากการบวกทศนิยมของ JS ไม่ทำให้ลูกค้าเสียสิทธิ์ส่งฟรี', () => {
    const subtotal = 0.7 + 0.1;

    expect(subtotal < 0.8).toBe(true); // กับดักยังอยู่จริง
    expect(calculateShippingFee(option({ freeOverSubtotal: 0.8 }), subtotal)).toBe(0);
  });

  it('จำกัดจังหวัด: เทียบชื่อตรงตัว (ตัดช่องว่างหัวท้าย) · ไม่จำกัด = ทุกจังหวัด', () => {
    const sameDay = option({ onlyProvinces: ['กรุงเทพมหานคร', 'นนทบุรี'] });

    expect(isShippingAvailable(sameDay, ' นนทบุรี ')).toBe(true);
    expect(isShippingAvailable(sameDay, 'เชียงใหม่')).toBe(false);
    // ชื่อย่อไม่ match — เหตุผลที่ฟอร์มของร้านรับเฉพาะชื่อจากรายการจังหวัด
    expect(isShippingAvailable(sameDay, 'กรุงเทพฯ')).toBe(false);
    expect(isShippingAvailable(option(), 'เชียงใหม่')).toBe(true);
  });

  it('รายชื่อจังหวัดมี 77 จังหวัด ไม่ซ้ำ และครอบคลุมจังหวัดของส่งวันเดียวกันที่ตั้งไว้เดิม', () => {
    expect(THAI_PROVINCES).toHaveLength(77);
    expect(new Set(THAI_PROVINCES).size).toBe(77);
    for (const province of ['กรุงเทพมหานคร', 'นนทบุรี', 'ปทุมธานี', 'สมุทรปราการ']) {
      expect(THAI_PROVINCES).toContain(province);
    }
  });
});

describe('ข้อความนโยบายจากอัตราจริง', () => {
  it('ไม่มีโปรส่งฟรีต้องบอกว่าไม่มี — ห้ามเหลือ "ครบ 0 บาท"', () => {
    const text = describeFreeShipping([option({ freeOverSubtotal: null })]);

    expect(text).toContain('ไม่มีโปรส่งฟรี');
    expect(text).not.toMatch(/ครบ\s*0/);
  });

  it('ส่งฟรีบอกยอดและวิธีจริง · วิธีที่ปิดไว้ไม่ถูกโฆษณา', () => {
    const text = describeFreeShipping([
      option({ freeOverSubtotal: 1500 }),
      option({ code: 'EXPRESS', name: 'ส่งด่วน', freeOverSubtotal: 3000, isActive: false }),
    ]);

    expect(text).toContain('1,500');
    expect(text).toContain('ส่งธรรมดา');
    expect(text).not.toContain('3,000');
    expect(text).not.toContain('ส่งด่วน');
  });

  it('ตารางค่าส่งและระยะเวลามีเฉพาะวิธีที่เปิดใช้ เรียงตามลำดับที่ร้านตั้ง', () => {
    const options = [
      option({
        code: 'EXPRESS',
        name: 'ส่งด่วน',
        baseFee: 120,
        freeOverSubtotal: null,
        sortOrder: 2,
      }),
      option({ sortOrder: 1 }),
      option({ code: 'PICKUP', name: 'รับที่ร้าน', baseFee: 0, isActive: false, sortOrder: 3 }),
    ];
    const rates = describeShippingRates(options);

    expect(rates.indexOf('ส่งธรรมดา')).toBeLessThan(rates.indexOf('ส่งด่วน'));
    expect(rates).toContain('120 บาท');
    expect(rates).not.toContain('รับที่ร้าน');
    expect(describeShippingEta(options)).toBe('ส่งธรรมดา 2–4 วันทำการ · ส่งด่วน 2–4 วันทำการ');
    expect(describeShippingRates([])).toContain('ยังไม่เปิดให้เลือกวิธีจัดส่ง');
  });
});

describe('ตัวแปรนโยบายในบทความ', () => {
  const context = { shippingOptions: [option({ baseFee: 65, freeOverSubtotal: 2500 })] };

  it('แทนค่าจากข้อมูลจริง (รับช่องว่างในวงเล็บ) · ตัวที่ไม่รู้จักคงไว้ตามเดิม', () => {
    const rendered = renderPolicyTokens(
      'ค่าส่ง:\n{{shipping.rates}}\n{{ shipping.free }} · {{shiping.rate}}',
      context,
    );

    expect(rendered).toContain('65 บาท');
    expect(rendered).toContain('2,500');
    expect(rendered).not.toContain('{{shipping.');
    expect(rendered).toContain('{{shiping.rate}}');
    expect(unknownPolicyTokens('{{shipping.eta}} {{shiping.rate}} {{shiping.rate}}')).toEqual([
      '{{shiping.rate}}',
    ]);
  });

  /**
   * บทความตั้งต้นเก็บตัวแปร ไม่ใช่ตัวเลข — ถ้ามีใครประกอบค่าส่งลงข้อความกลับมา
   * ค่าส่งที่ร้านแก้จะไม่ถึงบทความที่ AI ใช้ตอบลูกค้า (เหตุผลของ STEP 44)
   */
  it('บทความตั้งต้นใช้เฉพาะตัวแปรที่รู้จัก และบทความจัดส่งไม่มีจำนวนเงินที่พิมพ์ไว้เอง', () => {
    for (const article of INITIAL_KNOWLEDGE_ARTICLES) {
      const texts = [
        article.title,
        article.summary,
        article.content,
        ...article.faqPairs.flatMap((faq) => [faq.question, faq.answer]),
      ];

      for (const text of texts) expect(unknownPolicyTokens(text)).toEqual([]);
    }

    const shipping = INITIAL_KNOWLEDGE_ARTICLES.find(
      (article) => article.slug === 'shipping-rates-and-delivery-time',
    )!;
    const raw = [
      shipping.summary,
      shipping.content,
      ...shipping.faqPairs.map((f) => f.answer),
    ].join('\n');

    expect(raw).toContain('{{shipping.rates}}');
    expect(raw).not.toMatch(/\d[\d,]*\s*บาท/);
    expect(Object.keys(POLICY_TOKENS)).toEqual(
      expect.arrayContaining([
        'shipping.rates',
        'shipping.free',
        'shipping.eta',
        'shipping.methods',
      ]),
    );
  });
});

describe('สถานะพัสดุ', () => {
  it('"ส่งถึงแล้ว" ไปถึงจากหน้าพัสดุไม่ได้ (มีทางเดียวคือสถานะคำสั่งซื้อ) · ตีกลับแล้วจบ', () => {
    const reachable = Object.values(SHIPMENT_TRANSITIONS).flat();

    expect(reachable).not.toContain('DELIVERED');
    expect(SHIPMENT_TRANSITIONS.RETURNED).toEqual([]);
    expect(SHIPMENT_TRANSITIONS.FAILED).toContain('IN_TRANSIT');
  });

  it('ใบที่จัดส่งแล้ว: ยังอยู่กับขนส่ง → ส่งถึงได้ ยกเลิกไม่ได้ · ตีกลับแล้ว → ยกเลิกหรือส่งใหม่', () => {
    const cases: [ShipmentStatusCode | null, boolean, boolean][] = [
      ['SHIPPED', true, false],
      ['IN_TRANSIT', true, false],
      ['FAILED', true, false],
      ['RETURNED', false, true],
      [null, true, false],
    ];

    for (const [status, deliver, cancel] of cases) {
      expect(shippingOrderActions(status)).toEqual({
        canDeliver: deliver,
        canCancel: cancel,
        canReship: cancel,
      });
    }
  });
});

describe('ข้อมูลที่ร้านกรอก', () => {
  it('ลิงก์ติดตามรับเฉพาะ https — javascript: และ http: ถูกปฏิเสธ', () => {
    expect(trackingUrlSchema.safeParse('https://track.example.co.th/?n=TH123').success).toBe(true);
    expect(trackingUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(trackingUrlSchema.safeParse('http://track.example.co.th').success).toBe(false);
    expect(trackingUrlSchema.safeParse('ไม่ใช่ลิงก์').success).toBe(false);
  });

  it('อัตราค่าส่ง: คำอธิบายห้ามมีจำนวนเงิน · จังหวัดต้องตรงรายชื่อ · ทศนิยมไม่เกิน 2 · ต้องมีอะไรให้แก้', () => {
    const accepts = (body: unknown) => updateShippingRateSchema.safeParse(body).success;

    expect(accepts({ description: 'ส่งฟรีเมื่อซื้อครบ 1,000 บาท' })).toBe(false);
    expect(accepts({ description: 'ค่าส่ง ฿50' })).toBe(false);
    expect(accepts({ onlyProvinces: ['กรุงเทพฯ'] })).toBe(false);
    expect(accepts({ onlyProvinces: ['นนทบุรี', 'นนทบุรี'] })).toBe(false);
    expect(accepts({ baseFee: 10.005 })).toBe(false);
    expect(accepts({ baseFee: -1 })).toBe(false);
    expect(accepts({ freeOverSubtotal: 0 })).toBe(false);
    expect(accepts({})).toBe(false);

    expect(accepts({ baseFee: 0.1 + 0.2 })).toBe(true); // 0.30000000000000004 ยังเป็น 30 สตางค์
    expect(accepts({ freeOverSubtotal: null, onlyProvinces: [] })).toBe(true);
    expect(accepts({ description: 'ไปรษณีย์ไทย ส่ง 2 รอบต่อวัน' })).toBe(true);
  });

  it('ส่งไม่สำเร็จ/ตีกลับต้องมีข้อความถึงลูกค้า · อยู่ระหว่างขนส่งไม่ต้องมี', () => {
    expect(updateShipmentStatusSchema.safeParse({ status: 'FAILED' }).success).toBe(false);
    expect(updateShipmentStatusSchema.safeParse({ status: 'RETURNED' }).success).toBe(false);
    expect(
      updateShipmentStatusSchema.safeParse({ status: 'FAILED', note: 'ไม่มีผู้รับที่บ้าน' })
        .success,
    ).toBe(true);
    expect(updateShipmentStatusSchema.safeParse({ status: 'IN_TRANSIT' }).success).toBe(true);
    expect(updateShipmentStatusSchema.safeParse({ status: 'DELIVERED' }).success).toBe(false);
  });
});
