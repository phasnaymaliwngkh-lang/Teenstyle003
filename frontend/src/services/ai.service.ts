import { apiFetch } from "@/lib/api";
import type {
  CsChatResponse,
  CsHistoryResponse,
  StylistChatResponse,
  StylistHistoryResponse,
  StylistPreferences,
} from "@/types/catalog";

/**
 * AI Service สำหรับเรียก API ฝั่ง Frontend (STEP 19: AI Stylist, STEP 20: AI Customer Service)
 */

// ─── AI Stylist (STEP 19) ───────────────────────────────────────────────────

export function fetchStylistHistory(): Promise<StylistHistoryResponse> {
  return apiFetch<StylistHistoryResponse>("/api/ai/stylist/history", {
    cache: "no-store",
  });
}

export function sendStylistChat(input: {
  message: string;
  conversationId?: string;
  preferences?: StylistPreferences;
}): Promise<StylistChatResponse> {
  return apiFetch<StylistChatResponse>("/api/ai/stylist/chat", {
    method: "POST",
    json: input,
    cache: "no-store",
  });
}

export function resetStylistChat(): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>("/api/ai/stylist/reset", {
    method: "POST",
    cache: "no-store",
  });
}

// ─── AI Customer Service & Human Handoff (STEP 20) ──────────────────────────

export function fetchCsHistory(): Promise<CsHistoryResponse> {
  return apiFetch<CsHistoryResponse>("/api/ai/cs/history", {
    cache: "no-store",
  });
}

export function sendCsChat(input: {
  message: string;
  conversationId?: string;
}): Promise<CsChatResponse> {
  return apiFetch<CsChatResponse>("/api/ai/cs/chat", {
    method: "POST",
    json: input,
    cache: "no-store",
  });
}

export function escalateCsChat(
  conversationId: string,
  reason?: string,
): Promise<{ success: boolean; message: string; conversationId: string }> {
  return apiFetch<{ success: boolean; message: string; conversationId: string }>(
    "/api/ai/cs/escalate",
    {
      method: "POST",
      json: { conversationId, reason },
      cache: "no-store",
    },
  );
}

export function resetCsChat(): Promise<{ success: boolean }> {
  return apiFetch<{ success: boolean }>("/api/ai/cs/reset", {
    method: "POST",
    cache: "no-store",
  });
}
