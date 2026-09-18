import { apiFetch } from "@/lib/api";
import type {
  KnowledgeArticle,
  KnowledgeAskResponse,
  KnowledgeCategory,
  KnowledgeCategoryMeta,
  KnowledgeSearchResult,
} from "@/types/catalog";

export interface KnowledgeQueryParams {
  q?: string;
  category?: KnowledgeCategory;
  tag?: string;
  page?: number;
  limit?: number;
}

export interface CreateKnowledgeArticlePayload {
  title: string;
  slug: string;
  category: KnowledgeCategory;
  summary: string;
  content: string;
  tags: string[];
  faqPairs: Array<{ question: string; answer: string }>;
  isPublished: boolean;
}

export interface UpdateKnowledgeArticlePayload {
  title?: string;
  slug?: string;
  category?: KnowledgeCategory;
  summary?: string;
  content?: string;
  tags?: string[];
  faqPairs?: Array<{ id?: string; question: string; answer: string }>;
  isPublished?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public APIs
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchKnowledgeArticles(
  params?: KnowledgeQueryParams,
): Promise<KnowledgeSearchResult> {
  const query = new URLSearchParams();
  if (params?.q) query.set("q", params.q);
  if (params?.category) query.set("category", params.category);
  if (params?.tag) query.set("tag", params.tag);
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));

  const qs = query.toString();
  return apiFetch<KnowledgeSearchResult>(`/api/ai/knowledge/articles${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export async function fetchKnowledgeArticle(slug: string): Promise<KnowledgeArticle> {
  return apiFetch<KnowledgeArticle>(`/api/ai/knowledge/articles/${encodeURIComponent(slug)}`, {
    cache: "no-store",
  });
}

export async function fetchKnowledgeCategories(): Promise<
  Array<KnowledgeCategoryMeta & { articleCount: number }>
> {
  return apiFetch<Array<KnowledgeCategoryMeta & { articleCount: number }>>(
    "/api/ai/knowledge/categories",
    {
      cache: "no-store",
    },
  );
}

export async function askKnowledgeQuestion(
  query: string,
  category?: KnowledgeCategory,
): Promise<KnowledgeAskResponse> {
  return apiFetch<KnowledgeAskResponse>("/api/ai/knowledge/ask", {
    method: "POST",
    json: { query, category },
  });
}

export async function voteKnowledgeHelpful(
  articleId: string,
  helpful: boolean,
): Promise<{ helpfulCount: number; notHelpfulCount: number }> {
  return apiFetch<{ helpfulCount: number; notHelpfulCount: number }>(
    `/api/ai/knowledge/articles/${articleId}/helpful`,
    {
      method: "POST",
      json: { helpful },
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin APIs
// ─────────────────────────────────────────────────────────────────────────────

export async function fetchAdminKnowledgeArticles(
  params?: KnowledgeQueryParams,
): Promise<KnowledgeSearchResult> {
  const query = new URLSearchParams();
  if (params?.q) query.set("q", params.q);
  if (params?.category) query.set("category", params.category);
  if (params?.tag) query.set("tag", params.tag);
  if (params?.page) query.set("page", String(params.page));
  if (params?.limit) query.set("limit", String(params.limit));

  const qs = query.toString();
  return apiFetch<KnowledgeSearchResult>(`/api/admin/knowledge/articles${qs ? `?${qs}` : ""}`, {
    cache: "no-store",
  });
}

export async function createAdminKnowledgeArticle(
  payload: CreateKnowledgeArticlePayload,
): Promise<KnowledgeArticle> {
  return apiFetch<KnowledgeArticle>("/api/admin/knowledge/articles", {
    method: "POST",
    json: payload,
  });
}

export async function updateAdminKnowledgeArticle(
  id: string,
  payload: UpdateKnowledgeArticlePayload,
): Promise<KnowledgeArticle> {
  return apiFetch<KnowledgeArticle>(`/api/admin/knowledge/articles/${id}`, {
    method: "PUT",
    json: payload,
  });
}

export async function deleteAdminKnowledgeArticle(id: string): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>(`/api/admin/knowledge/articles/${id}`, {
    method: "DELETE",
  });
}

export async function resetAdminKnowledgeDefaults(): Promise<{ count: number }> {
  return apiFetch<{ count: number }>("/api/admin/knowledge/articles/reset-defaults", {
    method: "POST",
  });
}
