import type { LookCard, ProductCard, ShopResult } from "./catalog";

/**
 * การค้นหา (STEP 45) — ตรงกับ DTO ของ backend (services/search.service.ts · models/search.model.ts)
 */

/** เงื่อนไขที่ backend ตีความได้จากคำค้น — ต้องแสดงให้ลูกค้าเห็นทุกข้อ */
export interface UnderstoodPart {
  kind: "color" | "size" | "price" | "stock" | "sale";
  label: string;
  /** false = เข้าใจคำนี้ แต่ร้านไม่มีของแบบนี้ (เช่น สีที่ไม่มีในร้าน) */
  available: boolean;
}

export interface SearchArticle {
  slug: string;
  title: string;
  summary: string;
  faq: { question: string; answer: string } | null;
}

export interface SearchResult {
  query: string;
  literal: boolean;
  terms: string[];
  understood: UnderstoodPart[];
  /** เงื่อนไขชุดเดียวกันในรูป query ของ /shop */
  shopQuery: Record<string, string>;
  products: ShopResult;
  looks: LookCard[];
  articles: SearchArticle[];
  /** "คุณหมายถึง…" — มาจากชื่อสินค้า/tag/หมวดที่มีจริงเท่านั้น */
  suggestions: string[];
}

export interface SearchSuggestions {
  query: string;
  understood: UnderstoodPart[];
  products: Pick<
    ProductCard,
    "id" | "slug" | "name" | "image" | "price" | "finalPrice" | "stockStatus"
  >[];
  categories: { slug: string; name: string }[];
}
