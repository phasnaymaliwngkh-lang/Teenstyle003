import { apiFetch } from "@/lib/api";
import type { SearchResult, SearchSuggestions } from "@/types/search";

/**
 * ค้นหาทั้งร้าน (STEP 45)
 *
 * ผลค้นหาเป็นข้อมูลสาธารณะ — แคช 60 วินาทีเท่ากับหน้า /shop (cache key คือคำค้น + หน้า + การเรียง)
 * คำแนะนำระหว่างพิมพ์ยิงจากเบราว์เซอร์ จึงไม่ใช้ cache ของ Next
 */
export function fetchSearchResults(params: URLSearchParams): Promise<SearchResult> {
  return apiFetch<SearchResult>(`/api/search?${params.toString()}`, {
    next: { revalidate: 60, tags: ["products"] },
  });
}

export function fetchSearchSuggestions(q: string, signal: AbortSignal): Promise<SearchSuggestions> {
  return apiFetch<SearchSuggestions>(`/api/search/suggest?q=${encodeURIComponent(q)}`, {
    cache: "no-store",
    signal,
    timeoutMs: 8_000,
  });
}
