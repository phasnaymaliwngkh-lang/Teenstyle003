/**
 * กฎราคา — **ที่เดียวของระบบ** (สร้างตอน STEP 9)
 *
 * ก่อนหน้านี้ตรรกะนี้ถูกเขียนซ้ำใน 4 ที่ (หน้าสินค้า · หน้าลุค · ตรวจสต็อก · ตรวจทั้งชุด)
 * ซึ่งเสี่ยงที่จะแก้ไม่ครบแล้วราคาที่แสดงกับราคาที่คิดเงินไม่ตรงกัน
 *
 * กฎ:
 *   - variant ที่ไม่ override ราคา (`price = null`) ใช้ราคาของสินค้าแม่ทั้งคู่ (ปกติ + ลด)
 *   - variant ที่ override ราคา ใช้ราคาของตัวเอง และใช้ราคาลดของตัวเองเท่านั้น
 *     (ห้ามหยิบ salePrice ของสินค้าแม่มาใช้กับราคาใหม่ เพราะจะได้ส่วนลดที่ไม่มีใครตั้งไว้)
 *   - ราคาที่ลูกค้าจ่ายจริง = salePrice ถ้ามี ไม่มีก็ price
 */

/** Prisma Decimal → number (แปลงผ่าน string เพื่อไม่ให้เสียความแม่นยำ) */
export function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(String(value));
}

export interface PriceSource {
  price: unknown;
  salePrice: unknown;
}

export interface ResolvedPrice {
  /** ราคาปกติ */
  price: number;
  /** ราคาลด (null = ไม่ลด) */
  salePrice: number | null;
  /** ราคาที่ลูกค้าจ่ายจริง */
  finalPrice: number;
  /** เปอร์เซ็นต์ส่วนลด ปัดเป็นจำนวนเต็ม (null = ไม่ลด) */
  discountPercent: number | null;
}

/** ราคาของสินค้าแม่ */
export function resolveProductPrice(product: PriceSource): ResolvedPrice {
  const price = toNumber(product.price);
  const salePrice = product.salePrice === null ? null : toNumber(product.salePrice);

  return {
    price,
    salePrice,
    finalPrice: salePrice ?? price,
    discountPercent:
      salePrice !== null && price > 0 ? Math.round(((price - salePrice) / price) * 100) : null,
  };
}

/** ราคาของ variant หนึ่งตัว โดยอ้างอิงราคาสินค้าแม่เมื่อ variant ไม่ override */
export function resolveVariantPrice(variant: PriceSource, product: PriceSource): ResolvedPrice {
  if (variant.price === null || variant.price === undefined) {
    return resolveProductPrice(product);
  }

  return resolveProductPrice({ price: variant.price, salePrice: variant.salePrice });
}
