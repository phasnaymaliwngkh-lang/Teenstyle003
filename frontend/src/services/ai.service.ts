import { apiFetch } from "@/lib/api";
import type {
  StylistChatResponse,
  StylistHistoryResponse,
  StylistPreferences,
} from "@/types/catalog";

/**
 * AI Service สำหรับเรียก API ฝั่ง Frontend (STEP 19: AI Stylist)
 */

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
