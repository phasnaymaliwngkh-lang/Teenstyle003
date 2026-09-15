import { apiFetch } from "@/lib/api";
import type { AddLookToCartResult, Cart } from "@/types/catalog";

/**
 * ชั้นเดียวที่เรียก API ตะกร้า (STEP 9)
 *
 * ⚠️ ตะกร้า **ห้าม cache** — สต็อกและราคาเปลี่ยนได้ทุกวินาที และเป็นข้อมูลของผู้ใช้แต่ละคน
 *    ทุกคำขอจึงใช้ `cache: "no-store"` (Next จะไม่เก็บผลลัพธ์ไว้ใช้ซ้ำ)
 *
 * ⚠️ ส่งไปได้แค่ "อะไร" กับ "กี่ชิ้น" — ราคา/ยอดรวมคำนวณที่ server ทั้งหมด
 *
 * ตัวระบุตะกร้า: cookie `cart-token` (guest) หรือ session ของผู้ใช้ที่ล็อกอิน
 * `apiFetch` แนบ `credentials: "include"` ให้แล้ว จึงเรียกจาก client ได้ตรง ๆ
 */

export function fetchCart(): Promise<Cart> {
  return apiFetch<Cart>("/api/cart", { cache: "no-store" });
}

export function addToCart(variantId: string, quantity: number): Promise<Cart> {
  return apiFetch<Cart>("/api/cart/items", {
    method: "POST",
    json: { variantId, quantity },
    cache: "no-store",
  });
}

export function updateCartItem(itemId: string, quantity: number): Promise<Cart> {
  return apiFetch<Cart>(`/api/cart/items/${encodeURIComponent(itemId)}`, {
    method: "PATCH",
    json: { quantity },
    cache: "no-store",
  });
}

export function selectCartItem(itemId: string, selected: boolean): Promise<Cart> {
  return apiFetch<Cart>(`/api/cart/items/${encodeURIComponent(itemId)}/select`, {
    method: "PATCH",
    json: { selected },
    cache: "no-store",
  });
}

export function removeCartItem(itemId: string): Promise<Cart> {
  return apiFetch<Cart>(`/api/cart/items/${encodeURIComponent(itemId)}`, {
    method: "DELETE",
    cache: "no-store",
  });
}

export function clearCart(): Promise<Cart> {
  return apiFetch<Cart>("/api/cart", { method: "DELETE", cache: "no-store" });
}

/** เพิ่มทั้งลุคลงตะกร้า — server ตรวจว่าทุก variant อยู่ในลุคนั้นจริง */
export function addLookToCart(
  slug: string,
  selections: { variantId: string; quantity: number }[],
): Promise<AddLookToCartResult> {
  return apiFetch<AddLookToCartResult>(`/api/cart/looks/${encodeURIComponent(slug)}`, {
    method: "POST",
    json: { selections },
    cache: "no-store",
  });
}
