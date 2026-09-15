import { resolveVariantPrice } from './pricing.ts';
import { resolveStockStatus, type StockStatus } from './product.model.ts';

/**
 * DTO ของตะกร้าสินค้า (STEP 9)
 *
 * ⚠️ ทุกยอดเงินในนี้ **คำนวณใหม่ที่ server ทุกครั้ง** จากราคาปัจจุบันในฐานข้อมูล
 *    `CartItem.addedPrice` ใช้เพียงเพื่อบอกผู้ใช้ว่า "ราคาเปลี่ยนไปจากตอนที่หยิบใส่ตะกร้า"
 *    ห้ามนำมาคิดเงินเด็ดขาด (SECURITY REQUIREMENT: ห้าม Trust Client-side Price)
 */

/** ปัญหาที่ต้องแก้ก่อนสั่งซื้อ */
export type CartItemIssue = 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'PRODUCT_UNAVAILABLE';

export interface CartItemDto {
  id: string;
  variantId: string;
  productId: string;
  name: string;
  slug: string;
  sku: string;
  image: { url: string; alt: string } | null;
  color: string | null;
  size: string | null;
  quantity: number;
  selected: boolean;
  /** ราคาต่อชิ้นปัจจุบัน (ราคาที่จะคิดเงิน) */
  unitPrice: number;
  /** ราคาตั้งก่อนลด — ใช้ขีดฆ่าโชว์ */
  listPrice: number;
  /** ราคาต่อชิ้นตอนหยิบใส่ตะกร้า */
  addedPrice: number;
  /** ราคาเปลี่ยนไปจากตอนหยิบไหม */
  priceChanged: boolean;
  /** unitPrice × quantity */
  lineTotal: number;
  /** จำนวนที่ซื้อได้จริงตอนนี้ */
  available: number;
  stockStatus: StockStatus;
  issue: CartItemIssue | null;
}

export interface CartSummaryDto {
  /** จำนวนรายการในตะกร้า */
  itemCount: number;
  /** จำนวนชิ้นรวมทุกรายการ */
  totalQuantity: number;
  /** จำนวนรายการที่ติ๊กเลือกไว้ */
  selectedCount: number;
  /** ยอดรวมของรายการที่เลือกและซื้อได้จริง */
  subtotal: number;
  /** ส่วนลดจากคูปอง — ยังเป็น 0 จนกว่าจะทำ STEP 41 */
  discountTotal: number;
  /**
   * ค่าจัดส่ง — `null` หมายถึง "ยังคำนวณไม่ได้ในขั้นนี้"
   * (ต้องรู้ที่อยู่ + วิธีส่งก่อน จึงคำนวณที่ STEP 10/44)
   * ⚠️ ห้ามใส่เลขสมมติ
   */
  shippingFee: number | null;
  /** ยอดที่ต้องจ่ายเท่าที่รู้ตอนนี้ (subtotal − discount) ยังไม่รวมค่าจัดส่ง */
  total: number;
  /** มีรายการที่ต้องแก้ก่อนสั่งซื้อไหม */
  hasIssues: boolean;
  /** พร้อมไป checkout ไหม (มีของที่เลือก และไม่มีปัญหาในรายการที่เลือก) */
  checkoutReady: boolean;
}

export interface CartDto {
  id: string;
  /** true = ตะกร้าของผู้ใช้ที่ยังไม่ล็อกอิน */
  isGuest: boolean;
  items: CartItemDto[];
  summary: CartSummaryDto;
  /** วันหมดอายุของตะกร้า guest (null = ตะกร้าของผู้ใช้ที่ล็อกอิน) */
  expiresAt: string | null;
}

export interface CartItemRow {
  id: string;
  quantity: number;
  selected: boolean;
  addedPrice: unknown;
  variant: {
    id: string;
    sku: string;
    price: unknown;
    salePrice: unknown;
    isActive: boolean;
    deletedAt: Date | null;
    color: { name: string } | null;
    size: { name: string } | null;
    inventory: { quantity: number; reservedQuantity: number } | null;
    product: {
      id: string;
      name: string;
      slug: string;
      price: unknown;
      salePrice: unknown;
      minimumStock: number;
      status: string;
      deletedAt: Date | null;
      images: { url: string; alt: string }[];
    };
  };
}

export interface CartRow {
  id: string;
  userId: string | null;
  expiresAt: Date | null;
  items: CartItemRow[];
}

export function toCartItem(item: CartItemRow): CartItemDto {
  const variant = item.variant;
  const product = variant.product;
  const price = resolveVariantPrice(variant, product);
  const mainImage = product.images[0] ?? null;

  const available = Math.max(
    0,
    (variant.inventory?.quantity ?? 0) - (variant.inventory?.reservedQuantity ?? 0),
  );

  const unavailable =
    product.deletedAt !== null ||
    product.status !== 'ACTIVE' ||
    variant.deletedAt !== null ||
    !variant.isActive;

  const issue: CartItemIssue | null = unavailable
    ? 'PRODUCT_UNAVAILABLE'
    : available === 0
      ? 'OUT_OF_STOCK'
      : item.quantity > available
        ? 'INSUFFICIENT_STOCK'
        : null;

  const addedPrice = Number(String(item.addedPrice ?? 0));

  return {
    id: item.id,
    variantId: variant.id,
    productId: product.id,
    name: product.name,
    slug: product.slug,
    sku: variant.sku,
    image: mainImage ? { url: mainImage.url, alt: mainImage.alt } : null,
    color: variant.color?.name ?? null,
    size: variant.size?.name ?? null,
    quantity: item.quantity,
    selected: item.selected,
    unitPrice: price.finalPrice,
    listPrice: price.price,
    addedPrice,
    priceChanged: addedPrice !== price.finalPrice,
    lineTotal: price.finalPrice * item.quantity,
    available,
    stockStatus: resolveStockStatus(available, product.minimumStock),
    issue,
  };
}

export function toCart(cart: CartRow): CartDto {
  const items = cart.items.map(toCartItem);

  // นับยอดจากรายการที่ผู้ใช้เลือกและไม่มีปัญหาเท่านั้น — ไม่โชว์ยอดที่เก็บเงินจริงไม่ได้
  const payable = items.filter((item) => item.selected && item.issue === null);
  const subtotal = payable.reduce((sum, item) => sum + item.lineTotal, 0);
  const discountTotal = 0;

  return {
    id: cart.id,
    isGuest: cart.userId === null,
    items,
    summary: {
      itemCount: items.length,
      totalQuantity: items.reduce((sum, item) => sum + item.quantity, 0),
      selectedCount: items.filter((item) => item.selected).length,
      subtotal,
      discountTotal,
      shippingFee: null,
      total: subtotal - discountTotal,
      hasIssues: items.some((item) => item.issue !== null),
      checkoutReady: payable.length > 0 && !items.some((item) => item.selected && item.issue),
    },
    expiresAt: cart.expiresAt?.toISOString() ?? null,
  };
}

/** ตะกร้าเปล่าสำหรับผู้ใช้ที่ยังไม่มีตะกร้าเลย — ไม่ต้องสร้างแถวในฐานข้อมูล */
export function emptyCart(isGuest: boolean): CartDto {
  return {
    id: '',
    isGuest,
    items: [],
    summary: {
      itemCount: 0,
      totalQuantity: 0,
      selectedCount: 0,
      subtotal: 0,
      discountTotal: 0,
      shippingFee: null,
      total: 0,
      hasIssues: false,
      checkoutReady: false,
    },
    expiresAt: null,
  };
}
