import { describe, expect, it } from 'vitest';

import { COD_MAX_TOTAL, paymentMethods } from '../src/config/payment.ts';
import { SHIPPING_OPTIONS } from '../src/config/shipping.ts';
import {
  RETURN_WINDOW_DAYS,
  STORE_AGENT_HOURS,
  STORE_CONTACT_CHANNELS,
} from '../src/config/store.ts';
import { INITIAL_KNOWLEDGE_ARTICLES } from '../src/models/knowledge-base.model.ts';
import { getStorePolicyContent } from '../src/services/ai-cs.service.ts';
import {
  adminCreateArticle,
  adminDeleteArticle,
  adminListArticles,
  adminResetDefaults,
  adminUpdateArticle,
  askKnowledgeBase,
  getArticleBySlug,
  getCategoriesSummary,
  searchArticles,
  voteArticleHelpful,
} from '../src/services/knowledge-base.service.ts';

describe('STEP 21: AI Knowledge Base Service', () => {
  describe('Public Article Search and Retrieval', () => {
    it('ดึงรายการบทความที่เผยแพร่แล้ว (Published) ได้ครบถ้วน', async () => {
      const result = await searchArticles({ page: 1, limit: 10, publishedOnly: true });
      expect(result.items.length).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.page).toBe(1);
      for (const item of result.items) {
        expect(item.isPublished).toBe(true);
        expect(item.slug).toBeDefined();
        expect(item.title).toBeDefined();
        expect(item.category).toBeDefined();
      }
    });

    it('กรองบทความตามหมวดหมู่ (Category Filter) ได้อย่างถูกต้อง', async () => {
      const shippingArticles = await searchArticles({ category: 'SHIPPING' });
      expect(shippingArticles.items.length).toBeGreaterThanOrEqual(1);
      for (const item of shippingArticles.items) {
        expect(item.category).toBe('SHIPPING');
      }

      const sizingArticles = await searchArticles({ category: 'SIZING' });
      expect(sizingArticles.items.length).toBeGreaterThanOrEqual(1);
      for (const item of sizingArticles.items) {
        expect(item.category).toBe('SIZING');
      }
    });

    it('กรองบทความตามป้ายกำกับ (Tag Filter) ได้อย่างถูกต้อง', async () => {
      const res = await searchArticles({ tag: 'ส่งฟรี' });
      expect(res.items.length).toBeGreaterThanOrEqual(1);
      expect(res.items[0]?.tags).toContain('ส่งฟรี');
    });

    it('ค้นหาด้วยคีย์เวิร์ดภาษาไทย (Keyword Search Scoring) ได้ตรงประเด็น', async () => {
      const res = await searchArticles({ q: 'เปลี่ยนไซซ์ คืนของ' });
      expect(res.items.length).toBeGreaterThanOrEqual(1);
      expect(res.items[0]?.category).toBe('RETURNS');
      expect(res.items[0]?.title).toContain('เปลี่ยน');
    });

    it('แบ่งหน้าบทความ (Pagination) ได้ถูกต้องตาม limit และ page', async () => {
      const page1 = await searchArticles({ page: 1, limit: 2 });
      const page2 = await searchArticles({ page: 2, limit: 2 });

      expect(page1.items.length).toBe(2);
      expect(page2.items.length).toBe(2);
      expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
      expect(page1.totalPages).toBeGreaterThanOrEqual(2);
    });

    it('ดึงข้อมูลบทความด้วย Slug และเพิ่มจำนวนผู้เข้าชม (View count) อัตโนมัติ', async () => {
      const first = (await searchArticles({ limit: 1 })).items[0]!;
      const viewsBefore = first.viewCount;

      const article = await getArticleBySlug(first.slug);
      expect(article.id).toBe(first.id);
      expect(article.viewCount).toBe(viewsBefore + 1);
    });

    it('ดึงบทความด้วย Slug ที่ไม่มีอยู่จริง → throw 404', async () => {
      await expect(getArticleBySlug('non-existent-article-slug-xyz')).rejects.toThrow();
    });

    it('สรุปหมวดหมู่บทความพร้อมจำนวนในแต่ละหมวด (getCategoriesSummary)', async () => {
      const categories = await getCategoriesSummary();
      expect(categories.length).toBe(8);
      const shippingCat = categories.find((c) => c.key === 'SHIPPING');
      expect(shippingCat).toBeDefined();
      expect(shippingCat?.articleCount).toBeGreaterThanOrEqual(1);
    });

    it('โหวตว่าบทความมีประโยชน์ (Helpful vote) ได้ถูกต้อง', async () => {
      const first = (await searchArticles({ limit: 1 })).items[0]!;
      const helpfulBefore = first.helpfulCount;

      const result = await voteArticleHelpful(first.id, true);
      expect(result.helpfulCount).toBe(helpfulBefore + 1);
    });
  });

  describe('Grounded AI Knowledge Q&A (RAG / No Hallucination)', () => {
    it('ตอบคำถามเรื่องค่าจัดส่ง โดยอ้างอิงจากบทความและ FAQ จริง', async () => {
      const res = await askKnowledgeBase('ค่าจัดส่งกี่บาท มีส่งฟรีไหม');
      expect(res.answer).toBeDefined();
      expect(res.sourceArticles.length).toBeGreaterThanOrEqual(1);
      expect(res.sourceArticles.some((s) => s.category === 'SHIPPING')).toBe(true);
      expect(res.suggestedQuestions.length).toBeGreaterThanOrEqual(1);
    });

    it('ตอบคำถามเรื่องการเปลี่ยนไซซ์ โดยอ้างอิงเงื่อนไข 7 วันจริงจากนโยบาย', async () => {
      const res = await askKnowledgeBase('ซื้อแล้วใส่ไม่พอดีขอเปลี่ยนไซซ์ได้ไหม');
      expect(res.answer).toContain('7 วัน');
      expect(res.sourceArticles.some((s) => s.category === 'RETURNS')).toBe(true);
    });

    it('คำถามที่ไม่พบข้อมูลในคลังความรู้ คืนข้อความแนะนำอย่างสุภาพโดยไม่กุข้อมูลเอง', async () => {
      const res = await askKnowledgeBase('ขายตั๋วเครื่องบินไปญี่ปุ่นราคาเท่าไร');
      expect(res.sourceArticles.length).toBe(0);
      expect(res.answer).toContain('ไม่พบบทความหรือคำตอบ');
      expect(res.suggestedQuestions.length).toBeGreaterThanOrEqual(1);
    });
  });

  /**
   * ⚠️ เทสต์ชุดนี้คือด่านกันไม่ให้ "คลังความรู้" กับ "ระบบที่เก็บเงินจริง" หลุดจากกัน
   *
   * บทความในคลังความรู้คือสิ่งที่ AI หยิบไปตอบลูกค้าในฐานะนโยบายของร้าน
   * ถ้าบทความบอกส่งฟรี 999 แต่ระบบคิดเงินที่ 1,000 = AI โกหกลูกค้าเรื่องเงิน
   * (ตอนปิด STEP 21 บทความเคยระบุ ส่งฟรี 999 / EMS 70 / Same-day 120 /
   *  ค่าธรรมเนียม COD 20 บาท ซึ่งไม่ตรงกับระบบสักค่าเดียว และ COD ไม่มีค่าธรรมเนียมเลย)
   */
  describe('Knowledge Base ต้องตรงกับ config ที่ใช้คิดเงินจริง (No Hallucination)', () => {
    const findArticle = async (slug: string) => {
      const result = await searchArticles({ page: 1, limit: 50, publishedOnly: false });
      const found = result.items.find((a) => a.slug === slug);
      expect(found, `ไม่พบบทความ ${slug}`).toBeDefined();
      return found!;
    };

    it('บทความจัดส่งพูดถึงวิธีจัดส่งครบทุกแบบ พร้อมค่าส่งและ ETA ตรงกับ SHIPPING_OPTIONS', async () => {
      const article = await findArticle('shipping-rates-and-delivery-time');
      const text = `${article.summary}\n${article.content}\n${article.faqPairs
        .map((f) => `${f.question} ${f.answer}`)
        .join('\n')}`;

      for (const option of SHIPPING_OPTIONS) {
        expect(text, `ไม่พบวิธีจัดส่ง "${option.name}"`).toContain(option.name);
        expect(text, `ไม่พบระยะเวลาของ "${option.name}"`).toContain(option.etaText);

        if (option.baseFee > 0) {
          expect(text, `ค่าส่งของ "${option.name}" ไม่ตรงกับ config`).toContain(
            option.baseFee.toLocaleString('th-TH'),
          );
        }

        if (option.freeOverSubtotal !== null) {
          expect(text, 'ยอดส่งฟรีไม่ตรงกับ config').toContain(
            option.freeOverSubtotal.toLocaleString('th-TH'),
          );
        }
      }
    });

    it('ทุกจำนวนเงินที่ปรากฏในบทความจัดส่งต้องเป็นค่าที่มีอยู่จริงใน SHIPPING_OPTIONS', async () => {
      const article = await findArticle('shipping-rates-and-delivery-time');
      const text = `${article.summary}\n${article.content}\n${article.faqPairs
        .map((f) => f.answer)
        .join('\n')}`;

      /** ทุกจำนวนเงินที่ระบบยอมรับว่าเป็นความจริง (ค่าส่ง + ยอดส่งฟรี) */
      const allowed = new Set<number>();
      for (const option of SHIPPING_OPTIONS) {
        allowed.add(option.baseFee);
        if (option.freeOverSubtotal !== null) allowed.add(option.freeOverSubtotal);
      }

      // จับรูปแบบ "1,000 บาท" / "250 บาท" แล้วเทียบกับค่าที่อนุญาต
      const mentioned = [...text.matchAll(/([\d,]+)\s*บาท/g)].map((m) =>
        Number(m[1]!.replace(/,/g, '')),
      );

      expect(mentioned.length, 'บทความจัดส่งควรระบุจำนวนเงินอย่างน้อยหนึ่งค่า').toBeGreaterThan(0);

      for (const amount of mentioned) {
        expect(
          allowed.has(amount),
          `บทความระบุ ${amount.toLocaleString('th-TH')} บาท ซึ่งไม่มีอยู่ใน config/shipping.ts`,
        ).toBe(true);
      }
    });

    it('บทความชำระเงินสะท้อนสถานะจริงของทุกช่องทาง และไม่มีค่าธรรมเนียม COD ที่ระบบไม่เก็บ', async () => {
      const article = await findArticle('payment-methods-cod-guide');
      const text = `${article.summary}\n${article.content}\n${article.faqPairs
        .map((f) => f.answer)
        .join('\n')}`;

      for (const method of paymentMethods(0)) {
        expect(text, `ไม่พบช่องทาง "${method.name}"`).toContain(method.name);
      }

      expect(text, 'ยอดสูงสุดของ COD ไม่ตรงกับ config').toContain(
        COD_MAX_TOTAL.toLocaleString('th-TH'),
      );
      // ระบบไม่บวกค่าธรรมเนียม COD ที่ไหนเลย — บทความจึงห้ามสัญญาว่าเก็บ
      expect(text).not.toMatch(/ค่าธรรมเนียม(บริการ)?\s*(COD\s*)?\d+\s*บาท/);
    });

    it('เงื่อนไขเปลี่ยน/คืนสินค้าใช้จำนวนวันชุดเดียวกับ Policy Engine ของ AI Customer Service', async () => {
      const article = await findArticle('return-and-exchange-policy');
      const policy = getStorePolicyContent('return_exchange');

      expect(article.content).toContain(`${RETURN_WINDOW_DAYS} วัน`);
      expect(policy).toContain(`${RETURN_WINDOW_DAYS} วัน`);
    });

    it('ข้อมูลติดต่อและเวลาทำการตรงกันทั้งบทความและ Policy Engine · ไม่มีช่องทางที่ยังไม่เปิด', async () => {
      const article = await findArticle('contact-support-and-office-hours');
      const policy = getStorePolicyContent('store_info');

      expect(article.content).toContain(STORE_AGENT_HOURS);
      expect(policy).toContain(STORE_AGENT_HOURS);

      for (const channel of STORE_CONTACT_CHANNELS) {
        if (channel.value === null) {
          // ช่องทางที่ยังไม่เปิด ห้ามถูกพูดถึงเลย (เดิมมีเบอร์โทรสมมติ 02-999-8888)
          expect(article.content).not.toContain(channel.label);
          expect(policy).not.toContain(channel.label);
        } else {
          expect(article.content).toContain(channel.value);
        }
      }

      expect(article.content, 'ยังมีเบอร์โทรสมมติค้างอยู่').not.toMatch(
        /0\d[-\s]?\d{3}[-\s]?\d{4}/,
      );
    });

    it('ทุกบทความตั้งต้นเริ่มจากยอดวิว/โหวตเป็น 0 — ห้ามใส่สถิติปลอมให้หน้าหลังบ้านดูสวย', () => {
      for (const article of INITIAL_KNOWLEDGE_ARTICLES) {
        expect(article.viewCount, `${article.slug} มียอดวิวตั้งต้นที่ไม่ได้เกิดขึ้นจริง`).toBe(0);
        expect(article.helpfulCount, `${article.slug} มีโหวตตั้งต้นที่ไม่ได้เกิดขึ้นจริง`).toBe(0);
        expect(article.notHelpfulCount, `${article.slug} มีโหวตตั้งต้นที่ไม่ได้เกิดขึ้นจริง`).toBe(
          0,
        );
      }
    });
  });

  describe('Admin Knowledge Base CRUD Operations', () => {
    const testSlug = `test-article-${Date.now()}`;
    let createdArticleId = '';

    it('สร้างบทความใหม่สำหรับแอดมิน (Create Article) พร้อมตรวจสอบความถูกต้อง', async () => {
      const article = await adminCreateArticle({
        title: 'คู่มือการแต่งตัวไปสอบสัมภาษณ์งานสไตล์วัยรุ่น',
        slug: testSlug,
        category: 'STYLING',
        summary: 'แนะนำชุดกึ่งทางการแต่ยังคงความทะมัดทะแมงและทันสมัย',
        content: 'สวมเสื้อเชิ้ตโอเวอร์ไซซ์สีขาวติดกระดุมเรียบร้อย คู่กับกางเกงสแล็คสีดำ',
        tags: ['สัมภาษณ์งาน', 'สุภาพ', 'เสื้อเชิ้ต'],
        faqPairs: [
          {
            question: 'ใส่กางเกงยีนส์ไปสัมภาษณ์งานได้ไหม?',
            answer: 'แนะนำให้เป็นยีนส์สีเข้มไม่มีรอยขาดครับ',
          },
        ],
        isPublished: true,
      });

      expect(article.id).toBeDefined();
      expect(article.slug).toBe(testSlug);
      expect(article.category).toBe('STYLING');
      createdArticleId = article.id;
    });

    it('สร้างบทความที่มี Slug ซ้ำกับบทความเดิม → ปฏิเสธด้วย error conflict', async () => {
      await expect(
        adminCreateArticle({
          title: 'บทความซ้ำ',
          slug: testSlug,
          category: 'GENERAL',
          summary: 'ทดสอบ slug ซ้ำ',
          content: 'เนื้อหาทดสอบ',
          tags: [],
          faqPairs: [],
          isPublished: false,
        }),
      ).rejects.toThrow();
    });

    it('แก้ไขบทความ (Update Article) สำเร็จ', async () => {
      expect(createdArticleId).toBeTruthy();
      const updated = await adminUpdateArticle(createdArticleId, {
        title: 'คู่มือการแต่งตัวไปสัมภาษณ์งาน (ฉบับอัปเดต 2026)',
        summary: 'ปรับปรุงคำแนะนำให้ทันสมัยยิ่งขึ้น',
      });

      expect(updated.title).toBe('คู่มือการแต่งตัวไปสัมภาษณ์งาน (ฉบับอัปเดต 2026)');
      expect(updated.summary).toBe('ปรับปรุงคำแนะนำให้ทันสมัยยิ่งขึ้น');
    });

    it('ลบบทความ (Delete Article) สำเร็จ', async () => {
      expect(createdArticleId).toBeTruthy();
      const deleteRes = await adminDeleteArticle(createdArticleId);
      expect(deleteRes.success).toBe(true);

      // ค้นหาต้องไม่พบบทความที่ลบไปแล้ว
      const list = await adminListArticles({ q: testSlug });
      expect(list.items.some((a) => a.id === createdArticleId)).toBe(false);
    });

    it('รีเซ็ตบทความกลับเป็นค่าเริ่มต้น (Reset Defaults)', async () => {
      const res = await adminResetDefaults();
      expect(res.count).toBeGreaterThanOrEqual(10);
    });
  });
});
