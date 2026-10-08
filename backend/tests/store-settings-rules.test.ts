import { describe, expect, it } from 'vitest';

import { paymentMethods } from '../src/config/payment.ts';
import { INITIAL_KNOWLEDGE_ARTICLES } from '../src/models/knowledge-base.model.ts';
import { renderPolicyTokens } from '../src/models/policy-tokens.ts';
import {
  SOCIAL_PLATFORMS,
  contactChannelsOf,
  socialLinksOf,
  socialUrlProblem,
  telHref,
} from '../src/models/store-settings.model.ts';

import { storeSettingsFixture } from './helpers/store-settings.ts';

/**
 * กฎล้วนของการตั้งค่าร้าน (STEP 49) — ไม่แตะฐานข้อมูล
 * ส่วนที่ต้องพิสูจน์กับของจริง (สิทธิ์ · ทุกที่ใช้ค่าชุดเดียว · สิทธิ์คืนสินค้า) อยู่ใน store-settings.test.ts
 */

const instagram = SOCIAL_PLATFORMS.find((platform) => platform.field === 'instagramUrl')!;
const line = SOCIAL_PLATFORMS.find((platform) => platform.field === 'lineUrl')!;

describe('ลิงก์โซเชียลต้องเป็นโปรไฟล์ของร้านบนโดเมนของแพลตฟอร์ม', () => {
  it.each([
    ['https://www.instagram.com/teenstyle.th', null],
    ['https://instagram.com/teenstyle.th/', null],
    // หน้าแรกของแพลตฟอร์ม — footer เคยใส่ลิงก์แบบนี้ไว้ทั้ง 4 ช่อง
    ['https://instagram.com', 'โปรไฟล์'],
    ['https://www.instagram.com/', 'โปรไฟล์'],
    ['http://www.instagram.com/teenstyle.th', 'https://'],
    // โดเมนอื่นที่หน้าตาคล้าย / ใส่ชื่อแพลตฟอร์มไว้ใน path
    ['https://instagram.com.evil.example/teenstyle', 'instagram.com'],
    ['https://evil.example/instagram.com/teenstyle', 'instagram.com'],
    ['javascript:alert(1)', 'https://'],
    ['ไม่ใช่ลิงก์', 'ไม่ถูกต้อง'],
  ])('%s', (url, problem) => {
    const result = socialUrlProblem(instagram, url);

    if (problem === null) expect(result).toBeNull();
    else expect(result).toContain(problem);
  });

  it('LINE รับลิงก์ lin.ee และ line.me', () => {
    expect(socialUrlProblem(line, 'https://lin.ee/abc123')).toBeNull();
    expect(socialUrlProblem(line, 'https://page.line.me/teenstyle')).toBeNull();
  });

  it('หน้าร้านเห็นเฉพาะโซเชียลที่ร้านมีจริง', () => {
    expect(socialLinksOf(storeSettingsFixture())).toEqual([]);
    expect(
      socialLinksOf(storeSettingsFixture({ tiktokUrl: 'https://www.tiktok.com/@teenstyle' })),
    ).toEqual([{ label: 'TikTok', url: 'https://www.tiktok.com/@teenstyle' }]);
  });
});

describe('ช่องทางติดต่อ', () => {
  it('แชตบนเว็บมีเสมอ · ช่องอื่นมีเฉพาะที่ร้านกรอก · ไม่มีเบอร์สมมติ', () => {
    const channels = contactChannelsOf(storeSettingsFixture({ contactEmail: null }));
    expect(channels.map((channel) => channel.value)).toEqual(['/customer-service']);

    const full = contactChannelsOf(
      storeSettingsFixture({ contactPhone: '02-123-4567', lineUrl: 'https://lin.ee/abc123' }),
    );
    expect(full.map((channel) => channel.label)).toEqual([
      'แชตกับฝ่ายบริการลูกค้าบนเว็บ',
      'LINE',
      'อีเมล',
      'โทรศัพท์',
    ]);
    // โทรได้เฉพาะเวลาที่มีเจ้าหน้าที่ — บอกเวลาไว้กับเบอร์เลย
    expect(full.at(-1)!.note).toBe(storeSettingsFixture().agentHours);
  });

  it('ลิงก์ tel: เก็บแค่ตัวเลขกับ +', () => {
    expect(telHref('+66 2-123-4567')).toBe('tel:+6621234567');
  });
});

describe('ตัวแปรของการตั้งค่าร้านในบทความ', () => {
  const store = storeSettingsFixture({ contactPhone: null });
  const context = {
    shippingOptions: [],
    store,
    paymentMethods: paymentMethods(0, store.codMaxTotal),
  };

  it('แทนค่าจากการตั้งค่าร้าน — ไม่ใช่ตัวเลขที่ฝังไว้ในโค้ด', () => {
    const rendered = renderPolicyTokens(
      'คืนได้ {{returns.window_days}} วัน · COD ไม่เกิน {{payment.cod_max}} บาท · ตัดรอบ {{store.cutoff_time}} · ส่ง{{store.shipping_days}} · {{store.agent_hours}}\n{{store.contact}}\n{{payment.methods}}',
      context,
    );

    expect(rendered).toContain('คืนได้ 9 วัน');
    expect(rendered).toContain('COD ไม่เกิน 4,321 บาท');
    expect(rendered).toContain('ตัดรอบ 16:30 น.');
    expect(rendered).toContain('ส่งทุกวัน');
    expect(rendered).toContain(store.agentHours);
    expect(rendered).toContain('shop@example.com');
    expect(rendered).not.toContain('โทรศัพท์');
    expect(rendered).toContain('เก็บเงินปลายทาง (COD)');
    expect(rendered).not.toContain('{{');
  });

  /**
   * บทความตั้งต้นต้องเก็บตัวแปร — ถ้ามีใครประกอบค่าลงข้อความกลับมา (`${...}` ตอน seed)
   * ค่าที่ร้านแก้ที่ /admin/settings จะไม่ถึงบทความที่ AI ใช้ตอบลูกค้า
   */
  it('บทความตั้งต้นของนโยบายร้านเก็บตัวแปร ไม่ใช่ค่าที่ร้านแก้ได้', () => {
    const raw = (slug: string) => {
      const article = INITIAL_KNOWLEDGE_ARTICLES.find((item) => item.slug === slug)!;
      return [article.summary, article.content, ...article.faqPairs.map((faq) => faq.answer)].join(
        '\n',
      );
    };

    const returns = raw('return-and-exchange-policy');
    expect(returns).toContain('{{returns.window_days}}');
    expect(returns).not.toMatch(/ภายใน \**\d+ วัน/);

    const payment = raw('payment-methods-cod-guide');
    expect(payment).toContain('{{payment.cod_max}}');
    expect(payment).toContain('{{payment.methods}}');
    expect(payment).not.toMatch(/\d[\d,]*\s*บาท/);
    // สถานะของช่องทางต้องไม่ถูกแช่ไว้ตอน seed
    expect(payment).not.toContain('สถานะ:');

    const contact = raw('contact-support-and-office-hours');
    expect(contact).toContain('{{store.contact}}');
    expect(contact).toContain('{{store.agent_hours}}');
    expect(contact).not.toContain('@');
  });
});
