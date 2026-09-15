/**
 * แปลง Prisma model → รูปร่างที่ส่งออก API (STEP 5)
 *
 * ทำไมต้องมีชั้นนี้
 *   1. Prisma model มีฟิลด์ที่ไม่ควรเปิดเผย (deletedAt, minimumStock ของคู่แข่ง ฯลฯ)
 *      จึงต้อง "เลือกส่ง" ไม่ใช่ส่งทั้งแถว
 *   2. `Decimal` ของ Prisma กลายเป็น string ตอน JSON.stringify — frontend คำนวณต่อไม่ได้
 *      จึงแปลงเป็น number ที่ชั้นนี้ที่เดียว
 *   3. สถานะสต็อกคำนวณจากกฎเดียวกันทุกที่ (ห้ามให้ frontend ตีความเอง)
 */

export type StockStatus = 'IN_STOCK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export interface ProductCardDto {
  id: string;
  name: string;
  slug: string;
  sku: string;
  shortDescription: string | null;
  /** ราคาปกติ */
  price: number;
  /** ราคาลด (null = ไม่ลด) */
  salePrice: number | null;
  /** ราคาที่ลูกค้าจ่ายจริง */
  finalPrice: number;
  /** เปอร์เซ็นต์ส่วนลด ปัดเป็นจำนวนเต็ม (null = ไม่ลด) */
  discountPercent: number | null;
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string };
  image: { url: string; alt: string } | null;
  stockStatus: StockStatus;
  /** จำนวนคนที่กดถูกใจ — ใช้จัดอันดับความนิยม */
  wishlistCount: number;
  tags: string[];
}

/** รูปร่างข้อมูลที่ service ต้อง select มาให้ mapper นี้ */
export interface ProductWithRelations {
  id: string;
  name: string;
  slug: string;
  sku: string;
  shortDescription: string | null;
  price: unknown;
  salePrice: unknown;
  minimumStock: number;
  tags: string[];
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string };
  images: { url: string; alt: string }[];
  _count?: { wishlist?: number };
}

/** Prisma Decimal → number (Decimal มีเมธอด toString ที่แม่นยำกว่าการ cast ตรง) */
function toNumber(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Number(String(value));
}

/**
 * กฎสถานะสต็อก — ใช้ที่เดียวทั้งระบบ (STEP 16 ใช้กฎเดียวกันสำหรับ Stock Alert)
 *   0                        → OUT_OF_STOCK
 *   <= minimumStock          → LOW_STOCK
 *   อื่น ๆ                    → IN_STOCK
 *
 * ⚠️ ค่าที่ส่งเข้ามาต้องเป็น **จำนวนที่ขายได้จริง** (หัก reservedQuantity แล้ว)
 *    ห้ามส่ง `Product.totalStock` เข้ามา — ดู [availability.ts](./availability.ts)
 */
export function resolveStockStatus(availableStock: number, minimumStock: number): StockStatus {
  if (availableStock <= 0) return 'OUT_OF_STOCK';
  if (availableStock <= minimumStock) return 'LOW_STOCK';
  return 'IN_STOCK';
}

/**
 * แปลงสินค้าเป็นการ์ดสำหรับหน้าร้าน
 *
 * `availableStock` เป็นพารามิเตอร์แยก **โดยเจตนา** (ไม่ยัดเป็นฟิลด์ที่มีค่าเริ่มต้น)
 * เพื่อให้ผู้เรียกทุกรายถูกบังคับให้ไปหาค่าที่ถูกต้องมา — ถ้าลืม จะ error ตอนคอมไพล์
 * ไม่ใช่เงียบ ๆ แล้วแสดงสถานะสต็อกผิดให้ลูกค้าเห็น (เคยเกิดจริงตั้งแต่ STEP 7)
 */
export function toProductCard(
  product: ProductWithRelations,
  availableStock: number,
): ProductCardDto {
  const price = toNumber(product.price);
  const salePrice = product.salePrice === null ? null : toNumber(product.salePrice);
  const finalPrice = salePrice ?? price;

  const discountPercent =
    salePrice !== null && price > 0 ? Math.round(((price - salePrice) / price) * 100) : null;

  const mainImage = product.images[0] ?? null;

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    shortDescription: product.shortDescription,
    price,
    salePrice,
    finalPrice,
    discountPercent,
    brand: product.brand,
    category: product.category,
    image: mainImage ? { url: mainImage.url, alt: mainImage.alt } : null,
    stockStatus: resolveStockStatus(availableStock, product.minimumStock),
    wishlistCount: product._count?.wishlist ?? 0,
    tags: product.tags,
  };
}
