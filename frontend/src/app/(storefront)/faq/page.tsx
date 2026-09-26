import { HelpCircle, Sparkles, BookOpen, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { JsonLd } from "@/components/shared/json-ld";
import { FaqViewer } from "@/features/knowledge/components/faq-viewer";
import { faqPageJsonLd, type FaqEntry } from "@/lib/seo";
import {
  fetchKnowledgeArticlesOnServer,
  fetchKnowledgeCategoriesOnServer,
} from "@/services/knowledge.service";
import type { KnowledgeArticle, KnowledgeCategoryMeta } from "@/types/catalog";

export const metadata: Metadata = {
  title: "คำถามที่พบบ่อย (FAQ) & ศูนย์ความรู้",
  alternates: { canonical: "/faq" },
  description:
    "ศูนย์รวมคำถามที่พบบ่อย นโยบายการจัดส่ง การเปลี่ยนไซซ์คืนสินค้า และการดูแลรักษาเนื้อผ้า พร้อมผู้ช่วย AI ตอบคำถามจากคลังความรู้จริง 100%",
};

/** จำนวนบทความที่ส่งไปกับ HTML ชุดแรก — ตรงกับ limit ที่ FaqViewer ใช้ตอนกรองเอง */
const INITIAL_LIMIT = 50;

/**
 * รวบรวมคำถาม/คำตอบจากบทความจริงเพื่อทำ FAQPage structured data
 *
 * ⚠️ ต้องเป็น **ชุดเดียวกับที่แสดงบนหน้า** — Google ถือว่า structured data ที่ไม่ตรงกับ
 *    เนื้อหาที่ผู้ใช้เห็นคือการหลอก และตัดสิทธิ์ rich result ของทั้งเว็บ
 *    จึงดึงจาก API ตัวเดียวกับที่ FaqViewer ใช้ ไม่ใช่พิมพ์คำถามไว้ในไฟล์นี้
 */
function toFaqEntries(articles: readonly KnowledgeArticle[]): FaqEntry[] {
  return articles.flatMap((article) =>
    article.faqPairs.map((faq) => ({ question: faq.question, answer: faq.answer })),
  );
}

export default async function FaqPage() {
  /*
   * ดึงข้อมูลที่ฝั่ง server แล้วส่งเป็นค่าเริ่มต้นให้ FaqViewer (STEP 33)
   *
   * เดิมหน้านี้เรนเดอร์แต่โครง — บทความทั้งหมดถูกดึงหลัง hydrate จึง **ไม่มีเนื้อหาอยู่ใน HTML เลย**
   * ทั้งที่คลังความรู้คือเนื้อหาที่ควรติดอันดับมากที่สุดของเว็บ (คำถามยาว ๆ ที่คนค้นหาจริง)
   * ตอนนี้คำถาม/คำตอบอยู่ใน HTML ชุดแรก และมี FAQPage structured data จากข้อมูลชุดเดียวกัน
   *
   * โหลดไม่สำเร็จ → ส่ง undefined ให้ FaqViewer ไปโหลดเองแบบเดิม (หน้าไม่พัง)
   */
  let articles: KnowledgeArticle[] | undefined;
  let categories: Array<KnowledgeCategoryMeta & { articleCount: number }> | undefined;

  try {
    const [articleResult, categoryResult] = await Promise.all([
      fetchKnowledgeArticlesOnServer(INITIAL_LIMIT),
      fetchKnowledgeCategoriesOnServer(),
    ]);
    articles = articleResult.items;
    categories = categoryResult;
  } catch {
    articles = undefined;
    categories = undefined;
  }

  const faqEntries = articles ? toFaqEntries(articles) : [];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:py-12">
      {/* ประกาศเฉพาะเมื่อมีคำถามจริง — FAQPage ที่ว่างเปล่าคือ structured data ที่ผิด */}
      {faqEntries.length > 0 && <JsonLd data={faqPageJsonLd(faqEntries)} />}

      {/* Top Banner Header */}
      <div className="mb-8 text-center">
        <div className="inline-flex items-center gap-1.5 rounded-full bg-lilac px-3.5 py-1 text-xs font-bold text-brand-dark uppercase tracking-wider">
          <BookOpen className="size-3.5" aria-hidden />
          STEP 21 · AI Knowledge Base & ศูนย์ความรู้
        </div>

        <h1 className="mt-3 text-3xl font-black text-ink sm:text-4xl">
          ศูนย์ช่วยเหลือ & คำถามที่พบบ่อย 📚
        </h1>

        <p className="mt-2 text-sm text-muted sm:text-base max-w-xl mx-auto">
          ค้นหาคำตอบอย่างรวดเร็ว ครอบคลุมเรื่องค่าส่ง การเปลี่ยนคืน การชำระเงิน และการดูแลเสื้อผ้า
          พร้อมผู้ช่วย AI ค้นคืนข้อมูลจากคลังความรู้อย่างแม่นยำ
        </p>

        {/* Feature Highlights */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-xs font-medium text-muted">
          <span className="flex items-center gap-1">
            <Sparkles className="size-4 text-brand" aria-hidden />
            ถาม AI สังเคราะห์คำตอบตรงจุด
          </span>
          <span className="flex items-center gap-1">
            <ShieldCheck className="size-4 text-success" aria-hidden />
            ข้อมูลอ้างอิงนโยบายร้านจริง 100%
          </span>
          <span className="flex items-center gap-1">
            <HelpCircle className="size-4 text-brand" aria-hidden />
            อัปเดตบทความและคู่มือสม่ำเสมอ
          </span>
        </div>
      </div>

      {/* Main Interactive FAQ & Knowledge Explorer */}
      <FaqViewer initialArticles={articles} initialCategories={categories} />
    </div>
  );
}
