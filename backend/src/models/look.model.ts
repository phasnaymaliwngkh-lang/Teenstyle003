import { resolveProductPrice } from './pricing.ts';
import { resolveStockStatus, type StockStatus } from './product.model.ts';

/**
 * DTO ของ Look (STEP 7)
 *
 * หลักการเดียวกับ product.model.ts — เลือกส่งเฉพาะที่ต้องใช้ และคำนวณทุกอย่างที่ server:
 *   - `totalPrice` รวมจากราคาที่ลูกค้าจ่ายจริงของสินค้าในลุค (ห้ามให้ frontend บวกเอง)
 *   - `allItemsAvailable` บอกตรง ๆ ว่าซื้อครบชุดได้ไหม (STEP 8 จะใช้กับปุ่ม "ซื้อทั้งชุด")
 *
 * ⚠️ สินค้าที่ถูกปิดขายหรือ soft delete จะไม่อยู่ใน `items`
 *    แต่ยังถูกนับใน `itemCount` (จำนวนชิ้นที่ลุคนี้จัดไว้) จึงรู้ได้ว่าลุคไม่ครบ
 */

export interface LookItemDto {
  productId: string;
  name: string;
  slug: string;
  image: { url: string; alt: string } | null;
  price: number;
  salePrice: number | null;
  finalPrice: number;
  stockStatus: StockStatus;
  /** จำนวนที่ซื้อได้จริงของสินค้าชิ้นนี้ (รวมทุก variant) */
  available: number;
  /** คำแนะนำของลุค เช่น "เลือกไซซ์ใหญ่ขึ้น 1 ไซซ์" */
  note: string | null;
  /** variant ที่ลุคแนะนำไว้ (null = ให้ผู้ใช้เลือกเอง) */
  suggested: { sku: string; color: string | null; size: string | null } | null;
}

export interface LookCardDto {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  style: string;
  imageUrl: string | null;
  imageAlt: string | null;
  isFeatured: boolean;
  /** จำนวนชิ้นที่ลุคนี้จัดไว้ทั้งหมด */
  itemCount: number;
  /** จำนวนชิ้นที่ยังขายอยู่จริง */
  availableItemCount: number;
  /** ราคารวมของชิ้นที่ยังขายอยู่ (ราคาที่จ่ายจริง) */
  totalPrice: number;
  /** ครบทุกชิ้นและทุกชิ้นมีของ */
  allItemsAvailable: boolean;
  items: LookItemDto[];
}

export interface LookRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  style: string;
  imageUrl: string | null;
  imageAlt: string | null;
  isFeatured: boolean;
  _count: { items: number };
  items: {
    note: string | null;
    product: {
      id: string;
      name: string;
      slug: string;
      price: unknown;
      salePrice: unknown;
      minimumStock: number;
      images: { url: string; alt: string }[];
      variants: { inventory: { quantity: number; reservedQuantity: number } | null }[];
    };
    variant: {
      sku: string;
      color: { name: string } | null;
      size: { name: string } | null;
    } | null;
  }[];
}

export function toLookCard(look: LookRow): LookCardDto {
  const items: LookItemDto[] = look.items.map((item) => {
    // กฎราคาเดียวกับทุกที่ในระบบ — pricing.ts
    const productPrice = resolveProductPrice(item.product);
    const mainImage = item.product.images[0] ?? null;

    // จำนวนที่ซื้อได้จริง = ผลรวมของ (ในคลัง − ที่ถูกจองไว้) ของทุก variant (ห้ามติดลบ)
    const available = item.product.variants.reduce(
      (sum, variant) =>
        sum +
        Math.max(
          0,
          (variant.inventory?.quantity ?? 0) - (variant.inventory?.reservedQuantity ?? 0),
        ),
      0,
    );

    return {
      productId: item.product.id,
      name: item.product.name,
      slug: item.product.slug,
      image: mainImage ? { url: mainImage.url, alt: mainImage.alt } : null,
      price: productPrice.price,
      salePrice: productPrice.salePrice,
      finalPrice: productPrice.finalPrice,
      available,
      stockStatus: resolveStockStatus(available, item.product.minimumStock),
      note: item.note,
      suggested: item.variant
        ? {
            sku: item.variant.sku,
            color: item.variant.color?.name ?? null,
            size: item.variant.size?.name ?? null,
          }
        : null,
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
    itemCount: look._count.items,
    availableItemCount: items.length,
    totalPrice: items.reduce((sum, item) => sum + item.finalPrice, 0),
    // ครบชุด = ไม่มีชิ้นไหนถูกปิดขาย และทุกชิ้นยังมีของ
    allItemsAvailable: items.length > 0 && items.length === look._count.items && allInStock,
    items,
  };
}
