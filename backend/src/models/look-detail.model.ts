import { resolveProductPrice, resolveVariantPrice } from './pricing.ts';
import type { VariantDto } from './product-detail.model.ts';
import { resolveStockStatus, type StockStatus } from './product.model.ts';

/**
 * DTO ของหน้ารายละเอียดลุค (STEP 8)
 *
 * ส่ง variant ของสินค้าแต่ละชิ้นมาด้วย เพราะผู้ใช้ต้องเลือกสี/ไซซ์ให้ครบทุกชิ้น
 * ก่อนจะ "ซื้อทั้งชุด" ได้ — และ `available` ของแต่ละ variant คิดจาก
 * `quantity − reservedQuantity` ที่ server (ห้ามเชื่อค่าที่ client ส่งกลับมา)
 *
 * ⚠️ ค่าที่ส่งไปใช้เพื่อจำกัดตัวเลือกใน UI เท่านั้น
 *    ตอนกดซื้อจริงต้องเรียก POST /api/looks/:slug/availability ตรวจซ้ำทุกครั้ง
 */

export interface LookDetailItemDto {
  productId: string;
  name: string;
  slug: string;
  sku: string;
  image: { url: string; alt: string } | null;
  price: number;
  salePrice: number | null;
  finalPrice: number;
  discountPercent: number | null;
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string };
  /** สถานะรวมของสินค้าชิ้นนี้ */
  stockStatus: StockStatus;
  /** จำนวนที่ซื้อได้จริงรวมทุก variant */
  available: number;
  /** คำแนะนำที่ผู้จัดลุคเขียนไว้ */
  note: string | null;
  /** variant ที่ลุคระบุไว้ (null = ให้ผู้ใช้เลือกเอง) */
  suggestedVariantId: string | null;
  variants: VariantDto[];
  colors: { name: string; slug: string; hex: string }[];
  sizes: { name: string; code: string }[];
}

export interface LookDetailDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  style: string;
  imageUrl: string | null;
  imageAlt: string | null;
  isFeatured: boolean;
  viewCount: number;
  /** จำนวนชิ้นที่ลุคจัดไว้ทั้งหมด */
  itemCount: number;
  /** จำนวนชิ้นที่ยังขายอยู่ */
  availableItemCount: number;
  /** ราคารวมของชิ้นที่ยังขายอยู่ */
  totalPrice: number;
  allItemsAvailable: boolean;
  items: LookDetailItemDto[];
}

export interface LookDetailRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  style: string;
  imageUrl: string | null;
  imageAlt: string | null;
  isFeatured: boolean;
  viewCount: number;
  _count: { items: number };
  items: {
    note: string | null;
    variantId: string | null;
    product: {
      id: string;
      name: string;
      slug: string;
      sku: string;
      price: unknown;
      salePrice: unknown;
      minimumStock: number;
      brand: { name: string; slug: string } | null;
      category: { name: string; slug: string };
      images: { url: string; alt: string }[];
      variants: {
        id: string;
        sku: string;
        price: unknown;
        salePrice: unknown;
        color: { name: string; slug: string; hex: string } | null;
        size: { name: string; code: string; sortOrder: number } | null;
        inventory: { quantity: number; reservedQuantity: number } | null;
      }[];
    };
  }[];
}

export function toLookDetail(look: LookDetailRow): LookDetailDto {
  const items: LookDetailItemDto[] = look.items.map((item) => {
    const product = item.product;
    // กฎราคาเดียวกับทุกที่ในระบบ — pricing.ts
    const productPrice = resolveProductPrice(product);
    const mainImage = product.images[0] ?? null;

    const variants: VariantDto[] = product.variants.map((variant) => {
      const variantPrice = resolveVariantPrice(variant, product);

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
        stockStatus: resolveStockStatus(available, product.minimumStock),
      };
    });

    const productAvailable = variants.reduce((sum, variant) => sum + variant.available, 0);

    const colorMap = new Map<string, { name: string; slug: string; hex: string }>();
    const sizeMap = new Map<string, { name: string; code: string; sortOrder: number }>();

    for (const variant of product.variants) {
      if (variant.color && !colorMap.has(variant.color.slug)) {
        colorMap.set(variant.color.slug, variant.color);
      }
      if (variant.size && !sizeMap.has(variant.size.code)) {
        sizeMap.set(variant.size.code, variant.size);
      }
    }

    return {
      productId: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      image: mainImage ? { url: mainImage.url, alt: mainImage.alt } : null,
      price: productPrice.price,
      salePrice: productPrice.salePrice,
      finalPrice: productPrice.finalPrice,
      discountPercent: productPrice.discountPercent,
      brand: product.brand,
      category: product.category,
      stockStatus: resolveStockStatus(productAvailable, product.minimumStock),
      available: productAvailable,
      note: item.note,
      suggestedVariantId: item.variantId,
      variants,
      colors: [...colorMap.values()],
      sizes: [...sizeMap.values()]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((size) => ({ name: size.name, code: size.code })),
    };
  });

  const allInStock = items.every((item) => item.stockStatus !== 'OUT_OF_STOCK');

  return {
    id: look.id,
    name: look.name,
    slug: look.slug,
    description: look.description,
    style: look.style,
    imageUrl: look.imageUrl,
    imageAlt: look.imageAlt,
    isFeatured: look.isFeatured,
    viewCount: look.viewCount,
    itemCount: look._count.items,
    availableItemCount: items.length,
    totalPrice: items.reduce((sum, item) => sum + item.finalPrice, 0),
    // ครบชุด = ชิ้นไม่ขาด และทุกชิ้นยังมีของ (กฎเดียวกับ look.model.ts)
    allItemsAvailable: items.length > 0 && items.length === look._count.items && allInStock,
    items,
  };
}
