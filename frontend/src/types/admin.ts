import type { Order } from "./catalog";

/**
 * Type ของหลังบ้าน (STEP 13–14) — ต้องตรงกับ DTO ฝั่ง backend
 *   backend/src/services/admin.service.ts
 *   backend/src/services/admin-order.service.ts
 *   backend/src/services/product-admin.service.ts
 */

export interface AdminOverview {
  revenue: {
    /** ยอดที่ได้รับเงินจริงแล้วเท่านั้น */
    total: number;
    last7Days: number;
    last30Days: number;
    paidOrders: number;
    /** COD ที่ยืนยันแล้วแต่ยังไม่เก็บเงิน — ยังไม่ใช่รายได้ */
    pendingCodAmount: number;
    averageOrderValue: number;
  };
  orders: {
    total: number;
    byStatus: { status: string; count: number }[];
    awaitingPayment: number;
    toProcess: number;
    toShip: number;
    last30Days: number;
  };
  products: { total: number; active: number; variants: number; outOfStock: number };
  inventory: { lowStock: number; totalUnits: number; reservedUnits: number };
  customers: { total: number; newLast30Days: number };
  topProducts: {
    productId: string;
    name: string;
    slug: string;
    quantity: number;
    revenue: number;
  }[];
  generatedAt: string;
}

export interface AdminOrder extends Order {
  adminNote: string | null;
  customer: { id: string; name: string | null; email: string } | null;
  payments: {
    provider: string;
    status: string;
    amount: number;
    paidAt: string | null;
    failureReason: string | null;
  }[];
  /** สถานะที่เปลี่ยนต่อได้จริงจากสถานะปัจจุบัน (server ตัดสิน) */
  allowedNextStatuses: string[];
}

export interface AdminOrderListResult {
  items: AdminOrder[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: { status: string; count: number }[];
}

export interface UpdateOrderStatusInput {
  status: string;
  carrier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  estimatedDelivery?: string;
  adminNote?: string;
}

/* ─────────────── จัดการสินค้า (STEP 14) ─────────────── */

export type ProductStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface AdminProductVariant {
  id: string;
  sku: string;
  price: number;
  salePrice: number | null;
  finalPrice: number;
  /** true = ตัวเลือกนี้กำหนดราคาของตัวเองไว้ (false = ใช้ราคาของสินค้าแม่) */
  overridesPrice: boolean;
  isActive: boolean;
  color: { name: string; slug: string; hex: string } | null;
  size: { name: string; code: string } | null;
  /** จำนวนในคลัง — แก้ได้ที่ระบบคลังสินค้า (`/admin/inventory`) เท่านั้น */
  quantity: number;
  reserved: number;
  available: number;
}

export interface AdminProduct {
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
  status: ProductStatus;
  minimumStock: number;
  totalStock: number;
  availableStock: number;
  reservedStock: number;
  stockStatus: string;
  tags: string[];
  viewCount: number;
  category: { id: string; name: string; slug: string };
  brand: { id: string; name: string; slug: string } | null;
  images: { id: string; url: string; alt: string; isMain: boolean; sortOrder: number }[];
  variants: AdminProductVariant[];
  orderItemCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface AdminProductListResult {
  items: AdminProduct[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: { status: string; count: number }[];
  lowStockCount: number;
}

export interface ProductFormOptions {
  categories: { id: string; name: string; slug: string; parentName: string | null }[];
  brands: { id: string; name: string; slug: string }[];
  colors: { name: string; slug: string; hex: string }[];
  sizes: { name: string; code: string }[];
  /** โฮสต์รูปที่ระบบอนุญาต — ตรงกับ `images.remotePatterns` ของ next.config */
  allowedImageHosts: string[];
}

export interface ProductImageInput {
  url: string;
  alt: string;
  isMain: boolean;
  sortOrder: number;
}

export interface ProductVariantInput {
  sku: string;
  /** null = ใช้ราคาของสินค้าแม่ (ตั้งราคาลดของตัวเลือกได้เฉพาะเมื่อกำหนดราคานี้ด้วย) */
  price?: number | null;
  salePrice?: number | null;
  colorSlug?: string;
  sizeCode?: string;
  /** จำนวนรับเข้าครั้งแรก — backend บันทึกเป็น InventoryMovement (STOCK_IN) */
  initialStock?: number;
  isActive?: boolean;
}

export interface CreateProductInput {
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription?: string;
  price: number;
  salePrice?: number;
  categorySlug: string;
  brandSlug?: string;
  status: ProductStatus;
  minimumStock: number;
  tags: string[];
  images: ProductImageInput[];
  variants: ProductVariantInput[];
}

/**
 * ส่งเฉพาะฟิลด์ที่ต้องการเปลี่ยน — ฟิลด์ที่ไม่ส่งจะไม่ถูกแตะ
 * `salePrice: null` = เลิกโปรโมชัน (ต่างจากไม่ส่งมาเลย)
 */
export type UpdateProductInput = Partial<Omit<CreateProductInput, "variants" | "salePrice">> & {
  salePrice?: number | null;
};

export interface UpdateVariantInput {
  price?: number | null;
  salePrice?: number | null;
  isActive?: boolean;
}

export interface DeleteProductResult {
  id: string;
  orderItemCount: number;
}

/* ─────────────── คลังสินค้า (STEP 15) ─────────────── */

export interface InventoryRow {
  variantId: string;
  sku: string;
  isActive: boolean;
  /** ของที่มีอยู่ในคลัง */
  quantity: number;
  /** ของที่ลูกค้าจองไว้ในออเดอร์ที่ยังไม่จบ — แตะไม่ได้ */
  reserved: number;
  /** ของที่ขายได้จริง */
  available: number;
  minimumStock: number;
  stockStatus: string;
  location: string | null;
  color: { name: string; slug: string; hex: string } | null;
  size: { name: string; code: string } | null;
  product: {
    id: string;
    name: string;
    slug: string;
    sku: string;
    status: string;
    category: { name: string; slug: string };
  };
  updatedAt: string;
}

export interface InventoryMovement {
  id: string;
  type: string;
  /** จำนวนเป็นบวกเสมอ — ทิศทางอ่านจาก delta */
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  delta: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  variant: { id: string; sku: string; productName: string; productId: string | null };
  /** null = ระบบทำเอง (เช่น ตัดสต็อกตอนชำระเงินสำเร็จ) */
  actor: { id: string; name: string | null; email: string } | null;
  createdAt: string;
}

export interface InventorySummary {
  variants: number;
  totalUnits: number;
  reservedUnits: number;
  availableUnits: number;
  outOfStock: number;
  lowStock: number;
}

export interface InventoryListResult {
  items: InventoryRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: InventorySummary;
}

export interface MovementListResult {
  items: InventoryMovement[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface VariantInventory {
  inventory: InventoryRow;
  movements: InventoryMovement[];
  movementCount: number;
}

/** ปรับสต็อก — `ADJUSTMENT` ส่งยอดที่นับได้จริง ระบบคำนวณผลต่างเอง */
export type AdjustStockInput =
  | { type: "STOCK_IN" | "STOCK_OUT"; quantity: number; reason: string; idempotencyKey?: string }
  | { type: "ADJUSTMENT"; countedQuantity: number; reason: string; idempotencyKey?: string };

/* ─────────────── แจ้งเตือนสต็อก (STEP 16) ─────────────── */

export type AlertSeverity = "OUT_OF_STOCK" | "LOW_STOCK";

export interface StockAlert {
  variantId: string;
  sku: string;
  severity: AlertSeverity;
  quantity: number;
  reserved: number;
  available: number;
  minimumStock: number;
  color: string | null;
  size: string | null;
  product: { id: string; name: string; slug: string };
  /** null = ยังไม่ได้แจ้ง หรือมีคนรับทราบไปแล้ว */
  notification: { id: string; createdAt: string } | null;
}

export interface NotificationChannelInfo {
  code: string;
  name: string;
  available: boolean;
  unavailableReason: string | null;
}

export interface StockAlertListResult {
  items: StockAlert[];
  summary: { outOfStock: number; lowStock: number; unacknowledged: number };
  channels: NotificationChannelInfo[];
  emailConfigured: boolean;
  generatedAt: string;
}

export interface StockAlertScanResult {
  created: number;
  escalated: number;
  resolved: number;
  alerts: number;
  scannedAt: string;
}
