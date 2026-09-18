import { describe, expect, it } from 'vitest';

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
    it('ดึงรายการบทความที่เผยแพร่แล้ว (Published) ได้ครบถ้วน', () => {
      const result = searchArticles({ page: 1, limit: 10, publishedOnly: true });
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

    it('กรองบทความตามหมวดหมู่ (Category Filter) ได้อย่างถูกต้อง', () => {
      const shippingArticles = searchArticles({ category: 'SHIPPING' });
      expect(shippingArticles.items.length).toBeGreaterThanOrEqual(1);
      for (const item of shippingArticles.items) {
        expect(item.category).toBe('SHIPPING');
      }

      const sizingArticles = searchArticles({ category: 'SIZING' });
      expect(sizingArticles.items.length).toBeGreaterThanOrEqual(1);
      for (const item of sizingArticles.items) {
        expect(item.category).toBe('SIZING');
      }
    });

    it('กรองบทความตามป้ายกำกับ (Tag Filter) ได้อย่างถูกต้อง', () => {
      const res = searchArticles({ tag: 'ส่งฟรี' });
      expect(res.items.length).toBeGreaterThanOrEqual(1);
      expect(res.items[0]?.tags).toContain('ส่งฟรี');
    });

    it('ค้นหาด้วยคีย์เวิร์ดภาษาไทย (Keyword Search Scoring) ได้ตรงประเด็น', () => {
      const res = searchArticles({ q: 'เปลี่ยนไซซ์ คืนของ' });
      expect(res.items.length).toBeGreaterThanOrEqual(1);
      expect(res.items[0]?.category).toBe('RETURNS');
      expect(res.items[0]?.title).toContain('เปลี่ยน');
    });

    it('แบ่งหน้าบทความ (Pagination) ได้ถูกต้องตาม limit และ page', () => {
      const page1 = searchArticles({ page: 1, limit: 2 });
      const page2 = searchArticles({ page: 2, limit: 2 });

      expect(page1.items.length).toBe(2);
      expect(page2.items.length).toBe(2);
      expect(page1.items[0]?.id).not.toBe(page2.items[0]?.id);
      expect(page1.totalPages).toBeGreaterThanOrEqual(2);
    });

    it('ดึงข้อมูลบทความด้วย Slug และเพิ่มจำนวนผู้เข้าชม (View count) อัตโนมัติ', () => {
      const first = searchArticles({ limit: 1 }).items[0]!;
      const viewsBefore = first.viewCount;

      const article = getArticleBySlug(first.slug);
      expect(article.id).toBe(first.id);
      expect(article.viewCount).toBe(viewsBefore + 1);
    });

    it('ดึงบทความด้วย Slug ที่ไม่มีอยู่จริง → throw 404', () => {
      expect(() => getArticleBySlug('non-existent-article-slug-xyz')).toThrow();
    });

    it('สรุปหมวดหมู่บทความพร้อมจำนวนในแต่ละหมวด (getCategoriesSummary)', () => {
      const categories = getCategoriesSummary();
      expect(categories.length).toBe(8);
      const shippingCat = categories.find((c) => c.key === 'SHIPPING');
      expect(shippingCat).toBeDefined();
      expect(shippingCat?.articleCount).toBeGreaterThanOrEqual(1);
    });

    it('โหวตว่าบทความมีประโยชน์ (Helpful vote) ได้ถูกต้อง', () => {
      const first = searchArticles({ limit: 1 }).items[0]!;
      const helpfulBefore = first.helpfulCount;

      const result = voteArticleHelpful(first.id, true);
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
      const list = adminListArticles({ q: testSlug });
      expect(list.items.some((a) => a.id === createdArticleId)).toBe(false);
    });

    it('รีเซ็ตบทความกลับเป็นค่าเริ่มต้น (Reset Defaults)', () => {
      const res = adminResetDefaults();
      expect(res.count).toBeGreaterThanOrEqual(10);
    });
  });
});
