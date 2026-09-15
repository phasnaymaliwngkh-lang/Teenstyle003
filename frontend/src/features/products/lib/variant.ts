import type { ProductVariant } from "@/types/catalog";

/**
 * ตัวช่วยเลือก variant จากสี/ไซซ์ (STEP 6 — หน้าสินค้า · STEP 8 — ซื้อทั้งชุด)
 *
 * pure function ทั้งหมด ไม่ผูกกับ React จึงใช้ได้ทั้งฝั่ง server และ client
 * และทดสอบง่าย — หน้าไหนที่ให้ผู้ใช้เลือกสี/ไซซ์ต้องใช้ชุดนี้ ห้ามเขียนตรรกะซ้ำ
 *
 * ⚠️ `available` ที่ใช้ที่นี่มาจาก backend และใช้เพื่อจำกัดตัวเลือกใน UI เท่านั้น
 *    ความจริงเรื่องสต็อกต้องถาม backend ก่อนเพิ่มลงตะกร้าทุกครั้ง
 */

export function findVariant(
  variants: ProductVariant[],
  colorSlug: string | null,
  sizeCode: string | null,
): ProductVariant | null {
  return (
    variants.find(
      (variant) =>
        (variant.color?.slug ?? null) === colorSlug && (variant.size?.code ?? null) === sizeCode,
    ) ?? null
  );
}

/** ตัวเลือกเริ่มต้น: ตัวแรกที่มีของ ถ้าไม่มีเลยก็ตัวแรกสุด */
export function pickInitialVariant(variants: ProductVariant[]): ProductVariant | null {
  return variants.find((variant) => variant.available > 0) ?? variants[0] ?? null;
}

/** ตัวเลือกเริ่มต้นที่เคารพ variant ที่ถูกแนะนำไว้ (ลุคเป็นผู้ระบุ) ถ้ายังมีของ */
export function pickPreferredVariant(
  variants: ProductVariant[],
  preferredId: string | null,
): ProductVariant | null {
  if (preferredId !== null) {
    const preferred = variants.find((variant) => variant.id === preferredId);
    if (preferred && preferred.available > 0) return preferred;
  }

  return pickInitialVariant(variants);
}

export function firstSizeFor(variants: ProductVariant[], colorSlug: string | null): string | null {
  const sameColor = variants.filter((variant) => (variant.color?.slug ?? null) === colorSlug);
  const inStock = sameColor.find((variant) => variant.available > 0);

  return (inStock ?? sameColor[0])?.size?.code ?? null;
}

export function firstColorFor(variants: ProductVariant[], sizeCode: string | null): string | null {
  const sameSize = variants.filter((variant) => (variant.size?.code ?? null) === sizeCode);
  const inStock = sameSize.find((variant) => variant.available > 0);

  return (inStock ?? sameSize[0])?.color?.slug ?? null;
}

export function hasStockForColor(variants: ProductVariant[], colorSlug: string): boolean {
  return variants.some((variant) => variant.color?.slug === colorSlug && variant.available > 0);
}
