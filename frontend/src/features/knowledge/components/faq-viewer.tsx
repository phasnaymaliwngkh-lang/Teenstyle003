"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  FileText,
  Headphones,
  HelpCircle,
  Loader2,
  MessageSquare,
  Package,
  RotateCcw,
  Search,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Truck,
  X,
} from "lucide-react";
import Link from "next/link";

import {
  askKnowledgeQuestion,
  fetchKnowledgeArticles,
  fetchKnowledgeCategories,
  voteKnowledgeHelpful,
} from "@/services/knowledge.service";
import type {
  KnowledgeArticle,
  KnowledgeAskResponse,
  KnowledgeCategory,
  KnowledgeCategoryMeta,
} from "@/types/catalog";

const CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  SHIPPING: "การจัดส่งพัสดุ",
  RETURNS: "การเปลี่ยนและคืนสินค้า",
  PAYMENTS: "การชำระเงิน",
  SIZING: "ตารางไซซ์และการวัดขนาด",
  CARE: "การดูแลรักษาและถนอมผ้า",
  ORDERS: "การติดตามและจัดการออเดอร์",
  STYLING: "สไตล์และการแต่งตัว",
  GENERAL: "ข้อมูลทั่วไปและบัญชีผู้ใช้",
};

const CATEGORY_ICONS: Record<KnowledgeCategory, typeof Truck> = {
  SHIPPING: Truck,
  RETURNS: RotateCcw,
  PAYMENTS: CheckCircle2,
  SIZING: FileText,
  CARE: Sparkles,
  ORDERS: Package,
  STYLING: Sparkles,
  GENERAL: HelpCircle,
};

const SUGGESTED_QUESTIONS = [
  "ค่าส่งฟรีเมื่อซื้อครบกี่บาท?",
  "เปลี่ยนไซซ์เสื้อได้ภายในกี่วัน?",
  "มีบริการเก็บเงินปลายทาง (COD) ไหม?",
  "วิธีซักเสื้อผ้าให้สีสดและไม่หด?",
  "ติดตามสถานะพัสดุได้อย่างไร?",
];

export function FaqViewer() {
  const [categories, setCategories] = useState<
    Array<KnowledgeCategoryMeta & { articleCount: number }>
  >([]);
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<KnowledgeCategory | "ALL">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearch, setActiveSearch] = useState("");

  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // AI Ask state
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<KnowledgeAskResponse | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Accordion state: articleId -> open/close
  const [openFaqIds, setOpenFaqIds] = useState<Record<string, boolean>>({});

  // Full article modal
  const [readingArticle, setReadingArticle] = useState<KnowledgeArticle | null>(null);

  // User voting tracking: articleId -> true (helpful) / false (not helpful)
  const [userVotes, setUserVotes] = useState<Record<string, boolean>>({});
  const [votingLoading, setVotingLoading] = useState<Record<string, boolean>>({});

  // Load Categories on mount
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const cats = await fetchKnowledgeCategories();
        if (!cancelled) {
          setCategories(cats);
        }
      } catch (err) {
        console.error("Failed to load categories:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Load Articles when category or activeSearch changes
  const loadArticles = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const res = await fetchKnowledgeArticles({
        category: selectedCategory === "ALL" ? undefined : selectedCategory,
        q: activeSearch.trim() || undefined,
        limit: 50,
      });
      setArticles(res.items);
    } catch (err) {
      console.error("Failed to load articles:", err);
      setErrorMessage("ไม่สามารถโหลดข้อมูลคำถามที่พบบ่อยได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, activeSearch]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setErrorMessage(null);
        const res = await fetchKnowledgeArticles({
          category: selectedCategory === "ALL" ? undefined : selectedCategory,
          q: activeSearch.trim() || undefined,
          limit: 50,
        });
        if (!cancelled) {
          setArticles(res.items);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load articles:", err);
          setErrorMessage("ไม่สามารถโหลดข้อมูลคำถามที่พบบ่อยได้ กรุณาลองใหม่อีกครั้ง");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCategory, activeSearch]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setActiveSearch(searchQuery.trim());
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setActiveSearch("");
  };

  const handleAskAI = async (queryToAsk?: string) => {
    const query = (queryToAsk || searchQuery).trim();
    if (!query) return;

    try {
      setAiLoading(true);
      setAiError(null);
      const cat = selectedCategory === "ALL" ? undefined : selectedCategory;
      const res = await askKnowledgeQuestion(query, cat);
      setAiResult(res);
    } catch (err) {
      console.error("AI Ask failed:", err);
      setAiError("ระบบ AI ไม่สามารถตอบคำถามในขณะนี้ได้ กรุณาลองใหม่อีกครั้ง");
    } finally {
      setAiLoading(false);
    }
  };

  const toggleFaq = (faqId: string) => {
    setOpenFaqIds((prev) => ({
      ...prev,
      [faqId]: !prev[faqId],
    }));
  };

  const handleVote = async (articleId: string, helpful: boolean) => {
    if (userVotes[articleId] !== undefined || votingLoading[articleId]) return;

    try {
      setVotingLoading((prev) => ({ ...prev, [articleId]: true }));
      const res = await voteKnowledgeHelpful(articleId, helpful);
      setUserVotes((prev) => ({ ...prev, [articleId]: helpful }));

      // Update in article state
      setArticles((prev) =>
        prev.map((art) =>
          art.id === articleId
            ? {
                ...art,
                helpfulCount: res.helpfulCount,
                notHelpfulCount: res.notHelpfulCount,
              }
            : art,
        ),
      );

      if (readingArticle && readingArticle.id === articleId) {
        setReadingArticle((prev) =>
          prev
            ? {
                ...prev,
                helpfulCount: res.helpfulCount,
                notHelpfulCount: res.notHelpfulCount,
              }
            : null,
        );
      }
    } catch (err) {
      console.error("Failed to vote helpful:", err);
    } finally {
      setVotingLoading((prev) => ({ ...prev, [articleId]: false }));
    }
  };

  // Total FAQs count
  const totalFaqsCount = useMemo(() => {
    return articles.reduce((acc, curr) => acc + curr.faqPairs.length, 0);
  }, [articles]);

  return (
    <div className="space-y-8">
      {/* Search and AI Query Bar */}
      <div className="relative overflow-hidden rounded-[var(--radius-card)] border border-line bg-gradient-to-b from-lilac-50/70 to-white p-5 sm:p-8 shadow-[var(--shadow-soft)]">
        <div className="max-w-2xl mx-auto text-center space-y-3">
          <div className="inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1 text-xs font-bold text-brand shadow-sm border border-line">
            <Sparkles className="size-3.5" aria-hidden />
            Grounded AI Knowledge Base · อ้างอิงข้อมูลจริง 100%
          </div>
          <h2 className="text-2xl font-black text-ink sm:text-3xl">
            ค้นหาคำตอบหรือถาม AI Knowledge Assistant
          </h2>
          <p className="text-sm text-muted">
            พิมพ์คำถามที่คุณสงสัย เช่น เรื่องการจัดส่ง การเปลี่ยนไซซ์เสื้อ หรือการดูแลเนื้อผ้า
          </p>

          {/* Search Box */}
          <form onSubmit={handleSearchSubmit} className="mt-4 flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 size-5 text-muted-light"
                aria-hidden
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="ค้นหา เช่น ค่าส่งฟรี, นโยบายคืนของ, ขนาดเสื้อ..."
                className="w-full rounded-[var(--radius-pill)] border border-line bg-white py-3.5 pl-12 pr-10 text-sm font-medium text-ink placeholder:text-muted shadow-sm transition focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/20"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 p-1 text-muted hover:text-ink transition"
                  aria-label="ล้างคำค้นหา"
                >
                  <X className="size-4" />
                </button>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="submit"
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-[var(--radius-pill)] border border-line bg-white px-5 py-3.5 text-sm font-bold text-ink hover:border-brand-soft hover:bg-lilac-50 transition shadow-sm"
              >
                <Search className="size-4 text-brand" aria-hidden />
                ค้นหา
              </button>

              <button
                type="button"
                onClick={() => handleAskAI()}
                disabled={aiLoading || !searchQuery.trim()}
                className="flex-1 sm:flex-none flex items-center justify-center gap-2 rounded-[var(--radius-pill)] bg-brand px-6 py-3.5 text-sm font-bold text-white hover:bg-brand-dark transition shadow-[var(--shadow-brand)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {aiLoading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                    AI กำลังค้นหา...
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" aria-hidden />
                    ถาม AI ทันที
                  </>
                )}
              </button>
            </div>
          </form>

          {/* Quick suggestions */}
          <div className="pt-2 flex flex-wrap items-center justify-center gap-2 text-xs">
            <span className="text-muted font-medium">คำถามยอดนิยม:</span>
            {SUGGESTED_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => {
                  setSearchQuery(q);
                  setActiveSearch(q);
                  void handleAskAI(q);
                }}
                className="rounded-full bg-white px-3 py-1 text-muted hover:text-brand hover:border-brand-soft border border-line transition shadow-2xs font-medium"
              >
                {q}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* AI Grounded Answer Box */}
      {aiLoading && (
        <div className="rounded-[var(--radius-card)] border border-brand/20 bg-lilac-50/50 p-6 text-center animate-pulse">
          <div className="flex items-center justify-center gap-2 text-brand font-bold text-sm">
            <Loader2 className="size-5 animate-spin" />
            AI กำลังวิเคราะห์และสังเคราะห์คำตอบจากฐานข้อมูลทางการ...
          </div>
        </div>
      )}

      {aiError && (
        <div className="rounded-[var(--radius-card)] border border-danger/20 bg-danger/5 p-4 text-sm text-danger flex items-center gap-3">
          <AlertCircle className="size-5 shrink-0" />
          <span>{aiError}</span>
          <button
            type="button"
            onClick={() => setAiError(null)}
            className="ml-auto text-xs font-bold hover:underline"
          >
            ปิด
          </button>
        </div>
      )}

      {aiResult && !aiLoading && (
        <div className="rounded-[var(--radius-card)] border-2 border-brand/30 bg-white p-6 shadow-[var(--shadow-lift)] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-4">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-lilac text-brand">
                <Bot className="size-5" />
              </div>
              <div>
                <h3 className="font-bold text-ink text-base flex items-center gap-2">
                  คำตอบจาก AI Knowledge Assistant
                  <span className="rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-bold px-2 py-0.5">
                    Grounded 100%
                  </span>
                </h3>
                <p className="text-xs text-muted">
                  โมเดล {aiResult.model} · สังเคราะห์คำตอบจากคลังความรู้จริงของร้าน TEENSTYLE
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setAiResult(null)}
              className="text-xs font-semibold text-muted hover:text-ink px-2.5 py-1 rounded-md hover:bg-gray-100 transition"
            >
              ล้างคำตอบ
            </button>
          </div>

          {/* Answer content */}
          <div className="prose prose-sm max-w-none text-ink-soft leading-relaxed whitespace-pre-line bg-lilac-50/40 p-4 rounded-xl border border-lilac">
            {aiResult.answer}
          </div>

          {/* Source Articles */}
          {aiResult.sourceArticles.length > 0 && (
            <div className="pt-2">
              <div className="text-xs font-bold uppercase tracking-wider text-muted mb-2 flex items-center gap-1.5">
                <FileText className="size-3.5 text-brand" />
                เอกสารอ้างอิงจากคลังความรู้ ({aiResult.sourceArticles.length} บทความ):
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {aiResult.sourceArticles.map((src) => (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => {
                      const found = articles.find((a) => a.id === src.id);
                      if (found) {
                        setReadingArticle(found);
                      }
                    }}
                    className="flex items-start gap-2.5 p-3 rounded-xl border border-line bg-white hover:border-brand-soft hover:bg-lilac-50/30 text-left transition group"
                  >
                    <div className="mt-0.5 rounded bg-lilac px-1.5 py-0.5 text-[10px] font-bold text-brand-dark uppercase shrink-0">
                      {CATEGORY_LABELS[src.category] || src.category}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-ink group-hover:text-brand transition truncate">
                        {src.title}
                      </div>
                      <p className="text-[11px] text-muted line-clamp-1 mt-0.5">{src.summary}</p>
                    </div>
                    <ChevronRight className="size-4 text-muted-light group-hover:text-brand shrink-0" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Follow-up suggestions */}
          {aiResult.suggestedQuestions.length > 0 && (
            <div className="pt-2 border-t border-line flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-muted">คำถามที่เกี่ยวข้อง:</span>
              {aiResult.suggestedQuestions.map((sug) => (
                <button
                  key={sug}
                  type="button"
                  onClick={() => {
                    setSearchQuery(sug);
                    void handleAskAI(sug);
                  }}
                  className="text-xs rounded-full border border-line bg-gray-50 px-3 py-1 text-ink-soft hover:border-brand hover:text-brand transition font-medium"
                >
                  {sug}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Category Tabs */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-bold text-ink flex items-center gap-2">
            หมวดหมู่คำถามและบทความ
            <span className="text-xs font-normal text-muted">
              ({categories.length} หมวดหมู่ · {totalFaqsCount} คำถามที่พบบ่อย)
            </span>
          </h3>
          {activeSearch && (
            <div className="text-xs text-muted flex items-center gap-1">
              ผลการค้นหาสำหรับ: <strong className="text-ink">&ldquo;{activeSearch}&rdquo;</strong>
              <button
                type="button"
                onClick={handleClearSearch}
                className="text-brand hover:underline font-bold ml-1"
              >
                (ล้างตัวกรอง)
              </button>
            </div>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedCategory("ALL")}
            className={`flex items-center gap-1.5 rounded-[var(--radius-pill)] px-4 py-2 text-xs font-bold transition ${
              selectedCategory === "ALL"
                ? "bg-brand text-white shadow-[var(--shadow-brand)]"
                : "border border-line bg-white text-muted hover:border-brand-soft hover:text-ink"
            }`}
          >
            ทั้งหมด
          </button>

          {categories.map((cat) => {
            const Icon = CATEGORY_ICONS[cat.key] || HelpCircle;
            const isSelected = selectedCategory === cat.key;
            return (
              <button
                key={cat.key}
                type="button"
                onClick={() => setSelectedCategory(cat.key)}
                className={`flex items-center gap-2 rounded-[var(--radius-pill)] px-4 py-2 text-xs font-bold transition ${
                  isSelected
                    ? "bg-brand text-white shadow-[var(--shadow-brand)]"
                    : "border border-line bg-white text-muted hover:border-brand-soft hover:text-ink"
                }`}
              >
                <Icon className="size-3.5" />
                <span>{cat.label}</span>
                <span
                  className={`rounded-full px-1.5 py-0.2 text-[10px] ${
                    isSelected ? "bg-white/20 text-white" : "bg-gray-100 text-muted"
                  }`}
                >
                  {cat.articleCount}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Articles & FAQ Listing */}
      {loading ? (
        <div className="py-16 text-center space-y-3">
          <Loader2 className="size-8 animate-spin text-brand mx-auto" />
          <p className="text-sm text-muted">กำลังค้นหาข้อมูลในคลังความรู้...</p>
        </div>
      ) : errorMessage ? (
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-8 text-center space-y-3">
          <AlertCircle className="size-10 text-danger mx-auto" />
          <h4 className="font-bold text-ink">{errorMessage}</h4>
          <button
            type="button"
            onClick={() => void loadArticles()}
            className="btn-brand px-4 py-2 text-xs font-bold"
          >
            ลองใหม่
          </button>
        </div>
      ) : articles.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-line bg-gray-50/50 p-12 text-center space-y-4">
          <HelpCircle className="size-12 text-muted-light mx-auto" />
          <div>
            <h4 className="font-bold text-ink text-base">ไม่พบคู่มือหรือคำถามที่ตรงกับเงื่อนไข</h4>
            <p className="text-xs text-muted mt-1 max-w-md mx-auto">
              ลองเปลี่ยนคำค้นหา หรือกดคุยกับฝ่ายบริการลูกค้า เพื่อสอบถามเจ้าหน้าที่ได้โดยตรง
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => {
                setSelectedCategory("ALL");
                handleClearSearch();
              }}
              className="rounded-full border border-line bg-white px-4 py-2 text-xs font-bold text-ink hover:bg-gray-50 transition"
            >
              ดูบทความทั้งหมด
            </button>
            <Link
              href="/customer-service"
              className="rounded-full bg-brand px-4 py-2 text-xs font-bold text-white hover:bg-brand-dark transition"
            >
              ติดต่อฝ่ายบริการลูกค้า
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {articles.map((article) => {
            const Icon = CATEGORY_ICONS[article.category] || HelpCircle;
            const hasVoted = userVotes[article.id] !== undefined;
            const isVotedHelpful = userVotes[article.id] === true;
            const isVotedNotHelpful = userVotes[article.id] === false;

            return (
              <div
                key={article.id}
                className="rounded-[var(--radius-card)] border border-line bg-white p-5 sm:p-6 shadow-[var(--shadow-soft)] hover:border-brand-soft/60 transition"
              >
                {/* Article Header */}
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
                  <div className="space-y-1.5 max-w-2xl">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-md bg-lilac px-2.5 py-0.5 text-xs font-bold text-brand-dark">
                        <Icon className="size-3" />
                        {CATEGORY_LABELS[article.category] || article.category}
                      </span>
                      {article.tags.slice(0, 3).map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-muted"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                    <h3 className="text-xl font-bold text-ink">{article.title}</h3>
                    <p className="text-sm text-muted leading-relaxed">{article.summary}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setReadingArticle(article)}
                      className="inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] border border-line px-3.5 py-1.5 text-xs font-bold text-ink hover:border-brand hover:bg-lilac-50 hover:text-brand transition shadow-2xs"
                    >
                      <FileText className="size-3.5" />
                      อ่านคู่มือฉบับเต็ม
                    </button>
                    <span className="text-[11px] text-muted flex items-center gap-1">
                      <Clock className="size-3" />
                      เข้าชม {article.viewCount} ครั้ง
                    </span>
                  </div>
                </div>

                {/* FAQ Pairs Accordion */}
                {article.faqPairs.length > 0 && (
                  <div className="pt-4 space-y-2.5">
                    <div className="text-xs font-bold text-ink-soft uppercase tracking-wider mb-2">
                      คำถามที่เกี่ยวข้อง ({article.faqPairs.length}):
                    </div>
                    {article.faqPairs.map((faq) => {
                      const isOpen = !!openFaqIds[faq.id];
                      return (
                        <div
                          key={faq.id}
                          className="rounded-xl border border-line overflow-hidden transition"
                        >
                          <button
                            type="button"
                            onClick={() => toggleFaq(faq.id)}
                            className="w-full flex items-center justify-between gap-3 p-3.5 text-left bg-gray-50/50 hover:bg-lilac-50/40 transition"
                          >
                            <span className="text-sm font-bold text-ink flex items-center gap-2">
                              <HelpCircle className="size-4 text-brand shrink-0" />
                              {faq.question}
                            </span>
                            <ChevronDown
                              className={`size-4 text-muted transition-transform duration-200 shrink-0 ${
                                isOpen ? "rotate-180 text-brand" : ""
                              }`}
                            />
                          </button>

                          {isOpen && (
                            <div className="p-4 bg-white border-t border-line text-xs sm:text-sm text-ink-soft leading-relaxed whitespace-pre-line">
                              {faq.answer}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Article Footer: Helpful voting */}
                <div className="mt-5 pt-3 border-t border-line/60 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
                  <div className="flex items-center gap-2">
                    <span>ข้อมูลนี้มีประโยชน์กับคุณหรือไม่?</span>
                    <button
                      type="button"
                      disabled={hasVoted || votingLoading[article.id]}
                      onClick={() => void handleVote(article.id, true)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold border transition ${
                        isVotedHelpful
                          ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                          : "bg-white border-line hover:border-emerald-500 hover:text-emerald-700"
                      } disabled:opacity-75`}
                    >
                      <ThumbsUp className="size-3.5" />
                      <span>ใช่ ({article.helpfulCount})</span>
                    </button>

                    <button
                      type="button"
                      disabled={hasVoted || votingLoading[article.id]}
                      onClick={() => void handleVote(article.id, false)}
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-semibold border transition ${
                        isVotedNotHelpful
                          ? "bg-rose-50 text-rose-700 border-rose-300"
                          : "bg-white border-line hover:border-rose-500 hover:text-rose-700"
                      } disabled:opacity-75`}
                    >
                      <ThumbsDown className="size-3.5" />
                      <span>ยังไม่ตรง ({article.notHelpfulCount})</span>
                    </button>

                    {hasVoted && (
                      <span className="text-[11px] text-emerald-600 font-bold ml-1">
                        ✓ บันทึกคำติชมแล้ว ขอบคุณครับ!
                      </span>
                    )}
                  </div>

                  <div className="text-[11px] text-muted-light">
                    อัปเดตล่าสุด:{" "}
                    {new Date(article.updatedAt).toLocaleDateString("th-TH", {
                      year: "numeric",
                      month: "short",
                      day: "numeric",
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Full Article Reader Modal */}
      {readingArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
          <div className="relative w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-[var(--radius-card)] bg-white p-6 sm:p-8 shadow-2xl space-y-6">
            {/* Modal Header */}
            <div className="flex items-start justify-between gap-4 border-b border-line pb-4">
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="rounded-md bg-lilac px-2.5 py-0.5 text-xs font-bold text-brand-dark">
                    {CATEGORY_LABELS[readingArticle.category] || readingArticle.category}
                  </span>
                  {readingArticle.tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-muted"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
                <h2 className="text-2xl font-black text-ink">{readingArticle.title}</h2>
                <p className="text-sm text-muted">{readingArticle.summary}</p>
              </div>

              <button
                type="button"
                onClick={() => setReadingArticle(null)}
                className="rounded-full p-2 text-muted hover:text-ink hover:bg-gray-100 transition"
                aria-label="ปิดหน้าต่าง"
              >
                <X className="size-5" />
              </button>
            </div>

            {/* Markdown Body Rendering */}
            <div className="prose prose-sm max-w-none text-ink leading-relaxed whitespace-pre-line border-b border-line pb-6">
              {readingArticle.content}
            </div>

            {/* Embedded FAQs */}
            {readingArticle.faqPairs.length > 0 && (
              <div className="space-y-3">
                <h4 className="font-bold text-base text-ink">
                  คำถามที่พบบ่อยเพิ่มเติม ({readingArticle.faqPairs.length})
                </h4>
                <div className="space-y-2">
                  {readingArticle.faqPairs.map((faq) => (
                    <div key={faq.id} className="rounded-xl border border-line p-4 bg-gray-50/50">
                      <div className="font-bold text-sm text-ink mb-1 flex items-center gap-2">
                        <HelpCircle className="size-4 text-brand" />
                        {faq.question}
                      </div>
                      <p className="text-xs sm:text-sm text-muted-dark whitespace-pre-line">
                        {faq.answer}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Footer Modal */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
              <div className="flex items-center gap-2 text-xs">
                <span>มีประโยชน์ไหม:</span>
                <button
                  type="button"
                  disabled={userVotes[readingArticle.id] !== undefined}
                  onClick={() => void handleVote(readingArticle.id, true)}
                  className="rounded-full border border-line px-3 py-1 font-bold hover:border-emerald-500 hover:text-emerald-700 transition"
                >
                  👍 ใช่ ({readingArticle.helpfulCount})
                </button>
                <button
                  type="button"
                  disabled={userVotes[readingArticle.id] !== undefined}
                  onClick={() => void handleVote(readingArticle.id, false)}
                  className="rounded-full border border-line px-3 py-1 font-bold hover:border-rose-500 hover:text-rose-700 transition"
                >
                  👎 ไม่ ({readingArticle.notHelpfulCount})
                </button>
              </div>

              <button
                type="button"
                onClick={() => setReadingArticle(null)}
                className="rounded-full bg-gray-100 hover:bg-gray-200 px-5 py-2 text-xs font-bold text-ink transition"
              >
                ปิดหน้าต่าง
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Customer Service Bridge Banner */}
      <div className="rounded-[var(--radius-card)] border border-line bg-gradient-to-r from-lilac-50 via-white to-purple-50 p-6 sm:p-8 flex flex-col sm:flex-row items-center justify-between gap-6 shadow-[var(--shadow-soft)]">
        <div className="flex items-center gap-4">
          <div className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-lilac text-brand shadow-sm">
            <Headphones className="size-7" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-ink">ยังไม่พบคำตอบที่คุณต้องการ?</h3>
            <p className="text-xs sm:text-sm text-muted mt-1 max-w-lg">
              สามารถคุยกับ AI Customer Service ได้ตลอด 24 ชม.
              หรือขอส่งต่อเรื่องให้ทีมงานคนจริงดูแลและตอบกลับอย่างรวดเร็ว
            </p>
          </div>
        </div>

        <Link
          href="/customer-service"
          className="shrink-0 inline-flex items-center gap-2 rounded-[var(--radius-pill)] bg-brand px-6 py-3.5 text-sm font-bold text-white hover:bg-brand-dark transition shadow-[var(--shadow-brand)]"
        >
          <MessageSquare className="size-4" />
          คุยกับฝ่ายบริการลูกค้า
        </Link>
      </div>
    </div>
  );
}
