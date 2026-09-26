"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  BookOpen,
  CheckCircle2,
  Edit,
  Eye,
  FilePlus,
  FileText,
  HelpCircle,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  X,
} from "lucide-react";
import Link from "next/link";

import {
  createAdminKnowledgeArticle,
  deleteAdminKnowledgeArticle,
  fetchAdminKnowledgeArticles,
  resetAdminKnowledgeDefaults,
  updateAdminKnowledgeArticle,
} from "@/services/knowledge.service";
import type { KnowledgeArticle, KnowledgeCategory } from "@/types/catalog";

const CATEGORIES: Array<{ key: KnowledgeCategory; label: string }> = [
  { key: "SHIPPING", label: "การจัดส่งพัสดุ (SHIPPING)" },
  { key: "RETURNS", label: "การเปลี่ยนและคืนสินค้า (RETURNS)" },
  { key: "PAYMENTS", label: "การชำระเงิน (PAYMENTS)" },
  { key: "SIZING", label: "ตารางไซซ์และขนาด (SIZING)" },
  { key: "CARE", label: "การดูแลรักษาผ้า (CARE)" },
  { key: "ORDERS", label: "การจัดการออเดอร์ (ORDERS)" },
  { key: "STYLING", label: "สไตล์และการแต่งตัว (STYLING)" },
  { key: "GENERAL", label: "ทั่วไปและบัญชี (GENERAL)" },
];

interface ArticleFormData {
  id?: string;
  title: string;
  slug: string;
  category: KnowledgeCategory;
  summary: string;
  content: string;
  tagsText: string;
  faqPairs: Array<{ id?: string; question: string; answer: string }>;
  isPublished: boolean;
}

const EMPTY_FORM: ArticleFormData = {
  title: "",
  slug: "",
  category: "GENERAL",
  summary: "",
  content: "",
  tagsText: "",
  faqPairs: [{ question: "", answer: "" }],
  isPublished: true,
};

export default function AdminKnowledgePage() {
  const [articles, setArticles] = useState<KnowledgeArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<KnowledgeCategory | "ALL">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PUBLISHED" | "DRAFT">("ALL");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);

  // Modal states
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [formData, setFormData] = useState<ArticleFormData>(EMPTY_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deletingArticle, setDeletingArticle] = useState<KnowledgeArticle | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  /**
   * ปิดหน้าต่างด้วย Esc และล็อก scroll ของหน้าเบื้องหลังตอนเปิด
   * (แพตเทิร์นเดียวกับ mobile-menu.tsx — ผู้ใช้คีย์บอร์ดต้องออกจาก modal ได้
   *  และหน้าเบื้องหลังต้องไม่เลื่อนทะลุ)
   * ระหว่างกำลังบันทึก/ลบ/รีเซ็ต ไม่ให้ปิด เพราะงานยังค้างอยู่
   */
  const anyModalOpen = isFormModalOpen || deletingArticle !== null || isResetModalOpen;
  const modalBusy = isSubmitting || isDeleting || isResetting;

  useEffect(() => {
    if (!anyModalOpen) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || modalBusy) return;
      setIsFormModalOpen(false);
      setDeletingArticle(null);
      setIsResetModalOpen(false);
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [anyModalOpen, modalBusy]);

  // Fetch articles from backend
  const loadArticles = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);
      const res = await fetchAdminKnowledgeArticles({
        category: selectedCategory === "ALL" ? undefined : selectedCategory,
        q: searchQuery.trim() || undefined,
        limit: 100,
      });
      setArticles(res.items);
    } catch (err) {
      console.error("Failed to load admin articles:", err);
      setErrorMessage("ไม่สามารถโหลดข้อมูลบทความคลังความรู้ได้");
    } finally {
      setLoading(false);
    }
  }, [selectedCategory, searchQuery]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        setErrorMessage(null);
        const res = await fetchAdminKnowledgeArticles({
          category: selectedCategory === "ALL" ? undefined : selectedCategory,
          q: searchQuery.trim() || undefined,
          limit: 100,
        });
        if (!cancelled) {
          setArticles(res.items);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load admin articles:", err);
          setErrorMessage("ไม่สามารถโหลดข้อมูลบทความคลังความรู้ได้");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedCategory, searchQuery]);

  // Filtered by status
  const filteredArticles = useMemo(() => {
    return articles.filter((art) => {
      if (statusFilter === "PUBLISHED") return art.isPublished;
      if (statusFilter === "DRAFT") return !art.isPublished;
      return true;
    });
  }, [articles, statusFilter]);

  // Statistics
  const stats = useMemo(() => {
    const total = articles.length;
    const published = articles.filter((a) => a.isPublished).length;
    const drafts = total - published;
    const totalViews = articles.reduce((sum, a) => sum + a.viewCount, 0);
    const totalHelpful = articles.reduce((sum, a) => sum + a.helpfulCount, 0);
    return { total, published, drafts, totalViews, totalHelpful };
  }, [articles]);

  // Open Create Modal
  const handleOpenCreate = () => {
    setFormData(EMPTY_FORM);
    setFormError(null);
    setIsFormModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (article: KnowledgeArticle) => {
    setFormData({
      id: article.id,
      title: article.title,
      slug: article.slug,
      category: article.category,
      summary: article.summary,
      content: article.content,
      tagsText: article.tags.join(", "),
      faqPairs:
        article.faqPairs.length > 0
          ? article.faqPairs.map((p) => ({ id: p.id, question: p.question, answer: p.answer }))
          : [{ question: "", answer: "" }],
      isPublished: article.isPublished,
    });
    setFormError(null);
    setIsFormModalOpen(true);
  };

  // Slug generator helper
  const handleTitleChange = (val: string) => {
    setFormData((prev) => {
      if (!prev.id) {
        // Auto generate slug if creating new article
        const generatedSlug = val
          .toLowerCase()
          .replace(/[^\w\u0E00-\u0E7F]+/g, "-")
          .replace(/^-+|-+$/g, "");
        return { ...prev, title: val, slug: generatedSlug };
      }
      return { ...prev, title: val };
    });
  };

  // Add FAQ pair in form
  const handleAddFaqPair = () => {
    setFormData((prev) => ({
      ...prev,
      faqPairs: [...prev.faqPairs, { question: "", answer: "" }],
    }));
  };

  // Remove FAQ pair in form
  const handleRemoveFaqPair = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      faqPairs: prev.faqPairs.filter((_, i) => i !== index),
    }));
  };

  // Update FAQ pair in form
  const handleFaqChange = (index: number, field: "question" | "answer", val: string) => {
    setFormData((prev) => {
      const updated = [...prev.faqPairs];
      const target = updated[index];
      if (target) {
        updated[index] = { ...target, [field]: val };
      }
      return { ...prev, faqPairs: updated };
    });
  };

  // Submit Create or Edit
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      setFormError("กรุณาระบุชื่อบทความ");
      return;
    }
    if (!formData.slug.trim()) {
      setFormError("กรุณาระบุ Slug URL");
      return;
    }
    if (!formData.summary.trim()) {
      setFormError("กรุณาระบุคำสรุปย่อ (Summary)");
      return;
    }
    if (!formData.content.trim()) {
      setFormError("กรุณาระบุเนื้อหาบทความ (Content)");
      return;
    }

    // Filter valid FAQ pairs
    const cleanedFaqs = formData.faqPairs
      .filter((p) => p.question.trim() && p.answer.trim())
      .map((p) => ({
        id: p.id,
        question: p.question.trim(),
        answer: p.answer.trim(),
      }));

    const tags = formData.tagsText
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    try {
      setIsSubmitting(true);
      setFormError(null);

      if (formData.id) {
        // Update
        const updated = await updateAdminKnowledgeArticle(formData.id, {
          title: formData.title.trim(),
          slug: formData.slug.trim(),
          category: formData.category,
          summary: formData.summary.trim(),
          content: formData.content.trim(),
          tags,
          faqPairs: cleanedFaqs,
          isPublished: formData.isPublished,
        });
        setArticles((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
        setSuccessNotice(`อัปเดตบทความ "${updated.title}" เรียบร้อยแล้ว`);
      } else {
        // Create
        const created = await createAdminKnowledgeArticle({
          title: formData.title.trim(),
          slug: formData.slug.trim(),
          category: formData.category,
          summary: formData.summary.trim(),
          content: formData.content.trim(),
          tags,
          faqPairs: cleanedFaqs,
          isPublished: formData.isPublished,
        });
        setArticles((prev) => [created, ...prev]);
        setSuccessNotice(`สร้างบทความ "${created.title}" เรียบร้อยแล้ว`);
      }

      setIsFormModalOpen(false);
    } catch (err: unknown) {
      console.error("Save article failed:", err);
      const msg = err instanceof Error ? err.message : "เกิดข้อผิดพลาดในการบันทึกข้อมูล";
      setFormError(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle publish status directly
  const handleTogglePublish = async (article: KnowledgeArticle) => {
    try {
      const updated = await updateAdminKnowledgeArticle(article.id, {
        isPublished: !article.isPublished,
      });
      setArticles((prev) => prev.map((a) => (a.id === updated.id ? updated : a)));
      setSuccessNotice(
        `เปลี่ยนสถานะเป็น ${updated.isPublished ? "เผยแพร่แล้ว" : "แบบร่าง"} เรียบร้อยแล้ว`,
      );
    } catch (err) {
      console.error("Toggle publish failed:", err);
      setErrorMessage("ไม่สามารถเปลี่ยนสถานะบทความได้");
    }
  };

  // Delete article
  const handleDeleteArticle = async () => {
    if (!deletingArticle) return;
    try {
      setIsDeleting(true);
      await deleteAdminKnowledgeArticle(deletingArticle.id);
      setArticles((prev) => prev.filter((a) => a.id !== deletingArticle.id));
      setSuccessNotice(`ลบบทความ "${deletingArticle.title}" สำเร็จ`);
      setDeletingArticle(null);
    } catch (err) {
      console.error("Delete article failed:", err);
      setErrorMessage("ไม่สามารถลบบทความได้");
    } finally {
      setIsDeleting(false);
    }
  };

  // Reset defaults
  const handleResetDefaults = async () => {
    try {
      setIsResetting(true);
      const res = await resetAdminKnowledgeDefaults();
      setIsResetModalOpen(false);
      await loadArticles();
      setSuccessNotice(`คืนค่าบทความเริ่มต้นสำเร็จ (${res.count} บทความ)`);
    } catch (err) {
      console.error("Reset defaults failed:", err);
      setErrorMessage("ไม่สามารถคืนค่าบทความเริ่มต้นได้");
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-[1200px] px-4 py-8 sm:px-6 space-y-8">
      {/* Header */}
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-lilac px-2.5 py-0.5 text-xs font-bold text-brand-dark">
              STEP 21
            </span>
            <h1 className="text-3xl font-black text-ink">จัดการคลังความรู้ AI</h1>
          </div>
          <p className="mt-1 text-sm text-muted">
            จัดการคู่มือ นโยบายร้าน และ FAQ สำหรับให้ระบบ AI Customer Service อ้างอิงตอบคำถามลูกค้า
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/faq"
            target="_blank"
            className="flex min-h-11 items-center gap-1.5 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold hover:border-brand hover:bg-lilac-50 transition"
          >
            <Eye className="size-4 text-brand" />
            ดูหน้า FAQ หน้าร้าน
          </Link>

          <button
            type="button"
            onClick={() => setIsResetModalOpen(true)}
            className="flex min-h-11 items-center gap-1.5 rounded-[var(--radius-pill)] border border-line px-4 text-sm font-semibold hover:bg-lilac-50 transition"
          >
            <RotateCcw className="size-4 text-muted" />
            คืนค่าเริ่มต้น 12 บทความ
          </button>

          <button
            type="button"
            onClick={handleOpenCreate}
            className="btn-brand flex min-h-11 items-center gap-2 rounded-[var(--radius-pill)] px-5 text-sm font-bold shadow-[var(--shadow-brand)]"
          >
            <FilePlus className="size-4" />
            สร้างบทความใหม่
          </button>
        </div>
      </header>

      {/* Notifications */}
      {successNotice && (
        <div className="flex items-center justify-between rounded-xl border border-success/30 bg-success/5 px-4 py-3 text-sm text-success">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-success shrink-0" />
            <span>{successNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessNotice(null)}
            className="text-xs font-bold text-success hover:underline"
          >
            ปิด
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="flex items-center justify-between rounded-xl border border-danger/25 bg-danger/5 px-4 py-3 text-sm text-danger"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="size-5 text-danger shrink-0" aria-hidden />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full px-2 text-xs font-bold text-danger hover:underline"
          >
            ปิด
          </button>
        </div>
      )}

      {/* Stats Cards */}
      <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
          <span className="text-xs font-bold uppercase text-muted">บทความทั้งหมด</span>
          <div className="mt-2 text-2xl font-black text-ink">{stats.total}</div>
          <span className="text-xs text-muted">ครอบคลุม 8 หมวดหมู่นโยบาย</span>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
          <span className="text-xs font-bold uppercase text-muted">เผยแพร่อยู่</span>
          <div className="mt-2 text-2xl font-black text-success">{stats.published}</div>
          <span className="text-xs text-muted">AI ใช้ตอบคำถามได้ทันที</span>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
          <span className="text-xs font-bold uppercase text-muted">แบบร่าง (Draft)</span>
          <div className="mt-2 text-2xl font-black text-warning">{stats.drafts}</div>
          <span className="text-xs text-muted">ซ่อนจากหน้าร้านและ AI</span>
        </div>

        <div className="rounded-[var(--radius-card)] border border-line bg-white p-5 shadow-[var(--shadow-soft)]">
          <span className="text-xs font-bold uppercase text-muted">ยอดเข้าชมและโหวต</span>
          <div className="mt-2 text-2xl font-black text-brand">{stats.totalViews}</div>
          <span className="text-xs text-muted">👍 {stats.totalHelpful} ครั้งที่มีประโยชน์</span>
        </div>
      </section>

      {/* Filter Toolbar */}
      <section className="rounded-[var(--radius-card)] border border-line bg-white p-4 shadow-[var(--shadow-soft)] flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-1 flex-wrap items-center gap-3 min-w-[280px]">
          {/* Search */}
          <div className="relative flex-1 min-w-[220px]">
            <Search
              className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-muted-light"
              aria-hidden
            />
            <label htmlFor="kb-filter-search" className="sr-only">
              ค้นหาบทความในคลังความรู้
            </label>
            <input
              id="kb-filter-search"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="ค้นหาชื่อบทความ, Slug, แท็ก..."
              className="h-11 w-full rounded-full border border-line bg-lilac-50 pl-10 pr-4 text-sm text-ink placeholder:text-muted focus:border-brand focus:bg-white focus:outline-none"
            />
          </div>

          {/* Category Filter */}
          <label htmlFor="kb-filter-category" className="sr-only">
            กรองตามหมวดหมู่
          </label>
          <select
            id="kb-filter-category"
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value as KnowledgeCategory | "ALL")}
            className="h-11 rounded-full border border-line bg-lilac-50 px-4 text-sm font-semibold text-ink focus:border-brand focus:bg-white focus:outline-none"
          >
            <option value="ALL">ทุกหมวดหมู่ ({articles.length})</option>
            {CATEGORIES.map((cat) => (
              <option key={cat.key} value={cat.key}>
                {cat.label}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <div className="flex rounded-full border border-line bg-lilac-50 p-1 text-xs font-bold">
            <button
              type="button"
              onClick={() => setStatusFilter("ALL")}
              className={`inline-flex min-h-11 items-center rounded-full px-3.5 transition ${
                statusFilter === "ALL" ? "bg-white shadow-xs text-ink" : "text-muted hover:text-ink"
              }`}
            >
              ทั้งหมด
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("PUBLISHED")}
              className={`inline-flex min-h-11 items-center rounded-full px-3.5 transition ${
                statusFilter === "PUBLISHED"
                  ? "bg-white shadow-xs text-success"
                  : "text-muted hover:text-ink"
              }`}
            >
              เผยแพร่แล้ว
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter("DRAFT")}
              className={`inline-flex min-h-11 items-center rounded-full px-3.5 transition ${
                statusFilter === "DRAFT"
                  ? "bg-white shadow-xs text-warning"
                  : "text-muted hover:text-ink"
              }`}
            >
              แบบร่าง
            </button>
          </div>
        </div>

        <button
          type="button"
          onClick={() => void loadArticles()}
          className="grid size-11 shrink-0 place-items-center rounded-full border border-line hover:bg-lilac-50 transition text-muted"
          title="รีเฟรชข้อมูล"
          aria-label="รีเฟรชรายการบทความ"
        >
          <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} aria-hidden />
        </button>
      </section>

      {/**
       * Articles Table
       * `aria-live` เพราะตารางเปลี่ยนเองเมื่อพิมพ์ค้นหาหรือสลับตัวกรอง โดยผู้ใช้ไม่ได้ย้าย focus
       */}
      <section
        aria-live="polite"
        aria-busy={loading}
        className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-white shadow-[var(--shadow-soft)]"
      >
        {loading ? (
          <div className="py-20 text-center space-y-3">
            <Loader2 className="size-8 animate-spin text-brand mx-auto" aria-hidden />
            <p className="text-sm text-muted">กำลังโหลดรายการบทความ...</p>
          </div>
        ) : filteredArticles.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <FileText className="size-12 text-muted-light mx-auto" />
            <h3 className="font-bold text-ink">ไม่พบบทความตามเงื่อนไข</h3>
            <p className="text-xs text-muted">ลองปรับเปลี่ยนคำค้นหา หรือสร้างบทความใหม่</p>
            <button
              type="button"
              onClick={handleOpenCreate}
              className="btn-brand inline-flex min-h-11 items-center rounded-[var(--radius-pill)] px-4 text-xs font-bold"
            >
              + สร้างบทความใหม่
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-line bg-lilac-50/70 text-[11px] font-bold uppercase tracking-wider text-muted">
                  <th className="py-3.5 px-4">ชื่อบทความ / Slug</th>
                  <th className="py-3.5 px-4">หมวดหมู่</th>
                  <th className="py-3.5 px-4">FAQ</th>
                  <th className="py-3.5 px-4">สถิติ</th>
                  <th className="py-3.5 px-4">สถานะ</th>
                  <th className="py-3.5 px-4 text-right">การจัดการ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-sm">
                {filteredArticles.map((article) => (
                  <tr key={article.id} className="hover:bg-lilac-50/30 transition">
                    {/* Title & Slug */}
                    <td className="py-4 px-4 max-w-sm">
                      <div className="font-bold text-ink hover:text-brand transition line-clamp-1">
                        {article.title}
                      </div>
                      <div className="text-xs text-muted font-mono mt-0.5">/{article.slug}</div>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {article.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag}
                            className="rounded bg-lilac-50 px-1.5 py-0.5 text-[10px] text-muted"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    </td>

                    {/* Category */}
                    <td className="py-4 px-4 whitespace-nowrap">
                      <span className="rounded-md bg-lilac px-2.5 py-1 text-xs font-bold text-brand-dark">
                        {article.category}
                      </span>
                    </td>

                    {/* FAQ Items */}
                    <td className="py-4 px-4 whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-ink">
                        <HelpCircle className="size-3.5 text-brand" />
                        {article.faqPairs.length} ข้อ
                      </span>
                    </td>

                    {/* Stats */}
                    <td className="py-4 px-4 whitespace-nowrap text-xs text-muted">
                      <div>👁 {article.viewCount} เข้าชม</div>
                      <div className="mt-0.5 text-success font-medium">
                        👍 {article.helpfulCount} / 👎 {article.notHelpfulCount}
                      </div>
                    </td>

                    {/* Status */}
                    <td className="py-4 px-4 whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => void handleTogglePublish(article)}
                        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold transition ${
                          article.isPublished
                            ? "bg-success/5 text-success border border-success/30 hover:bg-success/10"
                            : "bg-warning/5 text-warning border border-warning/30 hover:bg-warning/10"
                        }`}
                        title="คลิกเพื่อสลับสถานะ"
                      >
                        <span
                          className={`size-2 rounded-full ${
                            article.isPublished ? "bg-success" : "bg-warning"
                          }`}
                        />
                        {article.isPublished ? "เผยแพร่แล้ว" : "แบบร่าง"}
                      </button>
                    </td>

                    {/* Actions */}
                    <td className="py-4 px-4 whitespace-nowrap text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleOpenEdit(article)}
                          className="p-2 rounded-full hover:bg-lilac hover:text-brand transition text-muted"
                          title="แก้ไขบทความ"
                          aria-label={`แก้ไขบทความ ${article.title}`}
                        >
                          <Edit className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingArticle(article)}
                          className="p-2 rounded-full hover:bg-danger/5 hover:text-danger transition text-muted"
                          title="ลบบทความ"
                          aria-label={`ลบบทความ ${article.title}`}
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Create / Edit Modal */}
      {isFormModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* ฟอร์มแก้บทความไม่ปิดด้วยการคลิกพื้นหลัง — เผลอคลิกแล้วงานที่พิมพ์ไว้หายทั้งหมด */}
          <div className="absolute inset-0 bg-ink/50 backdrop-blur-xs" aria-hidden />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="kb-form-title"
            className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-[var(--radius-card)] bg-white p-6 sm:p-8 shadow-[var(--shadow-float)] space-y-6"
          >
            <div className="flex items-center justify-between border-b border-line pb-4">
              <h3 id="kb-form-title" className="text-xl font-bold text-ink flex items-center gap-2">
                <BookOpen className="size-5 text-brand" aria-hidden />
                {formData.id ? "แก้ไขบทความคลังความรู้" : "สร้างบทความใหม่"}
              </h3>
              <button
                type="button"
                onClick={() => setIsFormModalOpen(false)}
                aria-label="ปิดหน้าต่าง"
                className="p-1.5 rounded-full hover:bg-lilac-50 text-muted"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>

            {formError && (
              <div className="rounded-xl border border-danger/25 bg-danger/5 p-3 text-xs text-danger flex items-center gap-2">
                <AlertCircle className="size-4 shrink-0 text-danger" />
                <span>{formError}</span>
              </div>
            )}

            <form onSubmit={handleSubmitForm} className="space-y-4">
              {/* Title & Slug */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="kb-title"
                    className="block text-xs font-bold text-ink uppercase mb-1"
                  >
                    ชื่อบทความ (Title) *
                  </label>
                  <input
                    id="kb-title"
                    type="text"
                    required
                    value={formData.title}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    placeholder="เช่น นโยบายการจัดส่งสินค้าและค่าจัดส่ง"
                    className="w-full rounded-xl border border-line p-3 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="kb-slug"
                    className="block text-xs font-bold text-ink uppercase mb-1"
                  >
                    Slug URL *
                  </label>
                  <input
                    id="kb-slug"
                    type="text"
                    required
                    value={formData.slug}
                    onChange={(e) => setFormData((p) => ({ ...p, slug: e.target.value }))}
                    placeholder="shipping-policy"
                    className="w-full rounded-xl border border-line p-3 text-sm text-ink font-mono focus:border-brand focus:outline-none"
                  />
                </div>
              </div>

              {/* Category & Tags */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="kb-category"
                    className="block text-xs font-bold text-ink uppercase mb-1"
                  >
                    หมวดหมู่ (Category) *
                  </label>
                  <select
                    id="kb-category"
                    value={formData.category}
                    onChange={(e) =>
                      setFormData((p) => ({ ...p, category: e.target.value as KnowledgeCategory }))
                    }
                    className="w-full rounded-xl border border-line p-3 text-sm font-semibold text-ink focus:border-brand focus:outline-none"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat.key} value={cat.key}>
                        {cat.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="kb-tags"
                    className="block text-xs font-bold text-ink uppercase mb-1"
                  >
                    แท็กค้นหา (คั่นด้วยเครื่องหมายจุลภาค ,)
                  </label>
                  <input
                    id="kb-tags"
                    type="text"
                    value={formData.tagsText}
                    onChange={(e) => setFormData((p) => ({ ...p, tagsText: e.target.value }))}
                    placeholder="จัดส่ง, ค่าส่ง, ems, flash"
                    className="w-full rounded-xl border border-line p-3 text-sm text-ink focus:border-brand focus:outline-none"
                  />
                </div>
              </div>

              {/* Summary */}
              <div>
                <label
                  htmlFor="kb-summary"
                  className="block text-xs font-bold text-ink uppercase mb-1"
                >
                  คำสรุปย่อ (Summary - สำคัญสำหรับ AI ค้นคืน) *
                </label>
                <textarea
                  id="kb-summary"
                  rows={2}
                  required
                  value={formData.summary}
                  onChange={(e) => setFormData((p) => ({ ...p, summary: e.target.value }))}
                  placeholder="สรุปสาระสำคัญของบทความใน 1-2 ประโยค"
                  className="w-full rounded-xl border border-line p-3 text-sm text-ink focus:border-brand focus:outline-none"
                />
              </div>

              {/* Content */}
              <div>
                <label
                  htmlFor="kb-content"
                  className="block text-xs font-bold text-ink uppercase mb-1"
                >
                  เนื้อหาฉบับเต็ม (Content - รองรับ Markdown) *
                </label>
                <textarea
                  id="kb-content"
                  rows={6}
                  required
                  value={formData.content}
                  onChange={(e) => setFormData((p) => ({ ...p, content: e.target.value }))}
                  placeholder="ระบุข้อความ รายละเอียด เงื่อนไข และตารางอย่างชัดเจน..."
                  className="w-full rounded-xl border border-line p-3 text-sm text-ink font-sans focus:border-brand focus:outline-none"
                />
              </div>

              {/* FAQ Pairs Manager */}
              <div className="space-y-3 pt-2 border-t border-line">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-ink uppercase tracking-wider">
                      คำถาม-คำตอบที่พบบ่อย (FAQ Pairs - แหล่งคำตอบหลักของ AI)
                    </h4>
                    <p className="text-[11px] text-muted">
                      ใส่คำถามที่ลูกค้าถามบ่อย พร้อมคำตอบสั้นกระชับ ตรงประเด็น
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAddFaqPair}
                    className="inline-flex items-center gap-1 rounded-full border border-line px-3 py-1 text-xs font-bold text-ink hover:bg-lilac-50 hover:border-brand transition"
                  >
                    <Plus className="size-3.5" />
                    เพิ่มคำถาม
                  </button>
                </div>

                <div className="space-y-3 max-h-60 overflow-y-auto pr-1">
                  {formData.faqPairs.map((faq, idx) => (
                    <div
                      key={idx}
                      className="rounded-xl border border-line p-3 bg-lilac-50/70 space-y-2 relative"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-muted">ข้อที่ {idx + 1}</span>
                        {formData.faqPairs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveFaqPair(idx)}
                            className="text-xs text-danger hover:underline font-bold"
                          >
                            ลบข้อนี้
                          </button>
                        )}
                      </div>
                      <input
                        type="text"
                        aria-label={`คำถามข้อที่ ${idx + 1}`}
                        value={faq.question}
                        onChange={(e) => handleFaqChange(idx, "question", e.target.value)}
                        placeholder="คำถาม เช่น ส่งฟรีเมื่อไหร่?"
                        className="w-full rounded-lg border border-line bg-white p-2 text-xs font-bold text-ink focus:border-brand focus:outline-none"
                      />
                      <textarea
                        rows={2}
                        aria-label={`คำตอบข้อที่ ${idx + 1}`}
                        value={faq.answer}
                        onChange={(e) => handleFaqChange(idx, "answer", e.target.value)}
                        placeholder="คำตอบที่อ้างอิงนโยบายจริงของร้าน..."
                        className="w-full rounded-lg border border-line bg-white p-2 text-xs text-ink focus:border-brand focus:outline-none"
                      />
                    </div>
                  ))}
                </div>
              </div>

              {/* Publish Toggle */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="isPublished"
                  checked={formData.isPublished}
                  onChange={(e) => setFormData((p) => ({ ...p, isPublished: e.target.checked }))}
                  className="size-4 rounded accent-brand"
                />
                <label htmlFor="isPublished" className="text-xs font-bold text-ink cursor-pointer">
                  เผยแพร่ทันที (ให้แสดงที่หน้าร้านและ AI ดึงไปตอบได้)
                </label>
              </div>

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-line">
                <button
                  type="button"
                  onClick={() => setIsFormModalOpen(false)}
                  className="rounded-full border border-line px-5 py-2 text-xs font-bold text-ink hover:bg-lilac-50 transition"
                >
                  ยกเลิก
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="btn-brand flex items-center gap-2 rounded-full px-6 py-2 text-xs font-bold shadow-[var(--shadow-brand)] disabled:opacity-50"
                >
                  {isSubmitting ? <Loader2 className="size-4 animate-spin" /> : null}
                  บันทึกบทความ
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingArticle && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            onClick={() => !isDeleting && setDeletingArticle(null)}
            className="absolute inset-0 bg-ink/50 backdrop-blur-xs"
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="kb-delete-title"
            className="relative w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-float)] space-y-4"
          >
            <div className="flex items-center gap-3 text-danger">
              <div className="flex size-10 items-center justify-center rounded-full bg-danger/10">
                <Trash2 className="size-5" />
              </div>
              <h3 id="kb-delete-title" className="text-lg font-bold text-ink">
                ยืนยันการลบบทความ?
              </h3>
            </div>

            <p className="text-xs text-muted leading-relaxed">
              คุณแน่ใจหรือไม่ว่าต้องการลบบทความ{" "}
              <strong className="text-ink">&ldquo;{deletingArticle.title}&rdquo;</strong>{" "}
              ออกจากฐานความรู้? การกระทำนี้ไม่สามารถย้อนกลับได้
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setDeletingArticle(null)}
                className="rounded-full border border-line px-4 py-2 text-xs font-bold text-ink hover:bg-lilac-50 transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleDeleteArticle()}
                className="rounded-full bg-danger px-5 py-2 text-xs font-bold text-white hover:bg-danger transition disabled:opacity-50 flex items-center gap-1.5"
              >
                {isDeleting && <Loader2 className="size-3.5 animate-spin" />}
                ยืนยันลบ
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reset Defaults Confirmation Modal */}
      {isResetModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            onClick={() => !isResetting && setIsResetModalOpen(false)}
            className="absolute inset-0 bg-ink/50 backdrop-blur-xs"
            aria-hidden
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="kb-reset-title"
            className="relative w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-float)] space-y-4"
          >
            <div className="flex items-center gap-3 text-warning">
              <div className="flex size-10 items-center justify-center rounded-full bg-warning/10">
                <AlertTriangle className="size-5" />
              </div>
              <h3 id="kb-reset-title" className="text-lg font-bold text-ink">
                คืนค่าเริ่มต้นคลังความรู้?
              </h3>
            </div>

            <p className="text-xs text-muted leading-relaxed">
              ระบบจะรีเซ็ตบทความทั้งหมดกลับเป็น 12
              บทความมาตรฐานของร้านทันทีเพื่อใช้ทดสอบหรือเริ่มต้นใหม่
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                className="rounded-full border border-line px-4 py-2 text-xs font-bold text-ink hover:bg-lilac-50 transition"
              >
                ยกเลิก
              </button>
              <button
                type="button"
                disabled={isResetting}
                onClick={() => void handleResetDefaults()}
                className="btn-brand rounded-full px-5 py-2 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
              >
                {isResetting && <Loader2 className="size-3.5 animate-spin" />}
                ยืนยันคืนค่า 12 บทความ
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
