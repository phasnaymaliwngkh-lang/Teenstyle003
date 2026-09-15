import { resolveProductPrice, resolveVariantPrice } from './pricing.ts';
import { resolveStockStatus, type StockStatus } from './product.model.ts';

/**
 * DTO ของหน้ารายละเอียดสินค้า (STEP 6)
 *
 * หลักการเดียวกับ product.model.ts: เลือกส่งเฉพาะที่ปลอดภัย และคำนวณทุกอย่างที่ฝั่ง server
 *
 * ⚠️ ส่ง `available` (จำนวนที่ซื้อได้จริง = quantity - reserved) ให้ client ใช้จำกัด input
 *    แต่ **ห้ามเชื่อค่าที่ client ส่งกลับมา** — ต้องตรวจซ้ำที่ POST /api/products/availability
 */

export interface VariantDto {
  id: string;
  sku: string;
  color: { name: string; slug: string; hex: string } | null;
  size: { name: string; code: string } | null;
  /** ราคาของ variant นี้ (ถ้าไม่ override จะเท่ากับราคาสินค้า) */
  price: number;
  salePrice: number | null;
  finalPrice: number;
  /** จำนวนที่ซื้อได้จริงตอนนี้ */
  available: number;
  stockStatus: StockStatus;
}

export interface ProductDetailDto {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription: string | null;
  price: number;
  salePrice: number | null;
  finalPrice: number;
  discountPercent: number | null;
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string; parent: { name: string; slug: string } | null };
  images: { url: string; alt: string; isMain: boolean }[];
  tags: string[];
  stockStatus: StockStatus;
  /** ผลรวมที่ซื้อได้ของทุก variant */
  totalAvailable: number;
  variants: VariantDto[];
  /** ตัวเลือกที่มีจริง — ใช้สร้างปุ่มเลือกสี/ไซซ์ */
  colors: { name: string; slug: string; hex: string }[];
  sizes: { name: string; code: string }[];
  publishedAt: string | null;
}

export interface ProductDetailRow {
  id: string;
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription: string | null;
  price: unknown;
  salePrice: unknown;
  totalStock: number;
  minimumStock: number;
  tags: string[];
  publishedAt: Date | null;
  brand: { name: string; slug: string } | null;
  category: {
    name: string;
    slug: string;
    parent: { name: string; slug: string } | null;
  };
  images: { url: string; alt: string; isMain: boolean; sortOrder: number }[];
  variants: {
    id: string;
    sku: string;
    price: unknown;
    salePrice: unknown;
    color: { name: string; slug: string; hex: string } | null;
    size: { name: string; code: string; sortOrder: number } | null;
    inventory: { quantity: number; reservedQuantity: number } | null;
  }[];
}

export function toProductDetail(product: ProductDetailRow): ProductDetailDto {
  // กฎราคาอยู่ที่ pricing.ts ที่เดียว (ใช้ร่วมกับตะกร้า/ลุค/ตรวจสต็อก)
  const productPrice = resolveProductPrice(product);

  const variants: VariantDto[] = product.variants.map((variant) => {
    const variantPrice = resolveVariantPrice(variant, product);

    // จำนวนที่ซื้อได้จริง = ของในคลัง - ที่ถูกจองไว้ (ห้ามติดลบ)
    const available = Math.max(
      0,
      (variant.inventory?.quantity ?? 0) - (variant.inventory?.reservedQuantity ?? 0),
    );

    return {
      id: variant.id,
      sku: variant.sku,
      color: variant.color,
      size: variant.size ? { name: variant.size.name, code: variant.size.code } : null,
      price: variantPrice.price,
      salePrice: variantPrice.salePrice,
      finalPrice: variantPrice.finalPrice,
      available,
      // ใช้ minimumStock ของสินค้าเป็นเกณฑ์เตือนของแต่ละ variant ด้วย
      stockStatus: resolveStockStatus(available, product.minimumStock),
    };
  });

  const totalAvailable = variants.reduce((sum, variant) => sum + variant.available, 0);

  // ตัวเลือกที่ไม่ซ้ำ เรียงตาม sortOrder ที่ตั้งไว้ในฐานข้อมูล
  const colorMap = new Map<string, { name: string; slug: string; hex: string }>();
  const sizeMap = new Map<string, { name: string; code: string; sortOrder: number }>();

  for (const variant of product.variants) {
    if (variant.color && !colorMap.has(variant.color.slug))
      colorMap.set(variant.color.slug, variant.color);
    if (variant.size && !sizeMap.has(variant.size.code))
      sizeMap.set(variant.size.code, variant.size);
  }

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    description: product.description,
    shortDescription: product.shortDescription,
    price: productPrice.price,
    salePrice: productPrice.salePrice,
    finalPrice: productPrice.finalPrice,
    discountPercent: productPrice.discountPercent,
    brand: product.brand,
    category: product.category,
    images: [...product.images]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((image) => ({ url: image.url, alt: image.alt, isMain: image.isMain })),
    tags: product.tags,
    stockStatus: resolveStockStatus(totalAvailable, product.minimumStock),
    totalAvailable,
    variants,
    colors: [...colorMap.values()],
    sizes: [...sizeMap.values()]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((size) => ({ name: size.name, code: size.code })),
    publishedAt: product.publishedAt?.toISOString() ?? null,
  };
}
