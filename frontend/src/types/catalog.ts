/**
 * Type ของข้อมูลหน้าร้าน — ต้องตรงกับ DTO ฝั่ง backend
 *   backend/src/models/product.model.ts
 *   backend/src/services/catalog.service.ts
 *
 * ถ้าแก้ฝั่ง backend ต้องแก้ไฟล์นี้ด้วย
 */

export type StockStatus = "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK";

export type ProductSort = "newest" | "discount" | "bestselling" | "popular";

export interface ProductCard {
  id: string;
  name: string;
  slug: string;
  sku: string;
  shortDescription: string | null;
  price: number;
  salePrice: number | null;
  finalPrice: number;
  discountPercent: number | null;
  brand: { name: string; slug: string } | null;
  category: { name: string; slug: string };
  image: { url: string; alt: string } | null;
  stockStatus: StockStatus;
  wishlistCount: number;
  tags: string[];
}

export interface ProductListResult {
  items: ProductCard[];
  sort: ProductSort;
  total: number;
}

export interface CategoryCard {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  productCount: number;
  children: { name: string; slug: string }[];
}

export interface LookItemPreview {
  productId: string;
  name: string;
  slug: string;
  image: { url: string; alt: string } | null;
  price: number;
  salePrice: number | null;
  finalPrice: number;
  stockStatus: StockStatus;
  /** จำนวนที่ซื้อได้จริง (quantity − reserved ของทุก variant) */
  available: number;
  note: string | null;
  /** variant ที่ลุคแนะนำไว้ (null = เลือกเองได้) */
  suggested: { sku: string; color: string | null; size: string | null } | null;
}

export interface LookCard {
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
  /** ราคารวมของชิ้นที่ยังขายอยู่ — คำนวณที่ backend */
  totalPrice: number;
  /** ครบทุกชิ้นและทุกชิ้นมีของ */
  allItemsAvailable: boolean;
  items: LookItemPreview[];
}

export interface ListResult<TItem> {
  items: TItem[];
  total: number;
}

/* ─── STEP 6: Product System ──────────────────────────────────────────────── */

export const SHOP_SORTS = [
  "newest",
  "price-asc",
  "price-desc",
  "discount",
  "popular",
  "bestselling",
] as const;

export type ShopSort = (typeof SHOP_SORTS)[number];

export interface ShopResult {
  items: ProductCard[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  appliedSort: ShopSort;
}

export interface ShopFilters {
  categories: { name: string; slug: string; productCount: number }[];
  brands: { name: string; slug: string; productCount: number }[];
  sizes: { name: string; code: string }[];
  colors: { name: string; slug: string; hex: string }[];
  priceRange: { min: number; max: number };
}

export interface ProductVariant {
  id: string;
  sku: string;
  color: { name: string; slug: string; hex: string } | null;
  size: { name: string; code: string } | null;
  price: number;
  salePrice: number | null;
  finalPrice: number;
  /** จำนวนที่ซื้อได้จริง — ใช้จำกัด input เท่านั้น ความจริงอยู่ที่ backend */
  available: number;
  stockStatus: StockStatus;
}

export interface ProductDetail {
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
  totalAvailable: number;
  variants: ProductVariant[];
  colors: { name: string; slug: string; hex: string }[];
  sizes: { name: string; code: string }[];
  publishedAt: string | null;
}

/* ─── STEP 7: Look Ideas ──────────────────────────────────────────────────── */

export const LOOK_SORTS = ["featured", "newest", "popular", "price-asc", "price-desc"] as const;

export type LookSort = (typeof LOOK_SORTS)[number];

export interface LookResult {
  items: LookCard[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  appliedSort: LookSort;
}

export interface LookFilters {
  styles: { value: string; lookCount: number }[];
  priceRange: { min: number; max: number };
  total: number;
  availableCount: number;
}

/* ─── STEP 8: Look Detail ─────────────────────────────────────────────────── */

export interface LookDetailItem {
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
  stockStatus: StockStatus;
  available: number;
  note: string | null;
  /** variant ที่ลุคระบุไว้ (null = ผู้ใช้ต้องเลือกเอง) */
  suggestedVariantId: string | null;
  variants: ProductVariant[];
  colors: { name: string; slug: string; hex: string }[];
  sizes: { name: string; code: string }[];
}

export interface LookDetail {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  style: string;
  imageUrl: string | null;
  imageAlt: string | null;
  isFeatured: boolean;
  viewCount: number;
  itemCount: number;
  availableItemCount: number;
  totalPrice: number;
  allItemsAvailable: boolean;
  items: LookDetailItem[];
}

export type LookUnavailableReason =
  "OUT_OF_STOCK" | "INSUFFICIENT_STOCK" | "NOT_IN_LOOK" | "PRODUCT_UNAVAILABLE";

export interface LookAvailabilityItem {
  variantId: string;
  productId: string | null;
  productName: string | null;
  productSlug: string | null;
  sku: string | null;
  color: string | null;
  size: string | null;
  quantity: number;
  /** ราคาจาก server เท่านั้น */
  finalPrice: number | null;
  lineTotal: number | null;
  available: number;
  purchasable: boolean;
  reason?: LookUnavailableReason;
}

export interface LookAvailabilityResult {
  purchasable: boolean;
  totalPrice: number;
  items: LookAvailabilityItem[];
  missingProducts: { productId: string; name: string; slug: string }[];
  unavailableCount: number;
}

/* ─── STEP 9: Cart ────────────────────────────────────────────────────────── */

export type CartItemIssue = "OUT_OF_STOCK" | "INSUFFICIENT_STOCK" | "PRODUCT_UNAVAILABLE";

export interface CartItem {
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
  /** ราคาต่อชิ้นปัจจุบัน (ราคาที่จะคิดเงิน) — มาจาก server */
  unitPrice: number;
  listPrice: number;
  /** ราคาตอนหยิบใส่ตะกร้า — ใช้เตือนเมื่อราคาเปลี่ยนเท่านั้น */
  addedPrice: number;
  priceChanged: boolean;
  lineTotal: number;
  available: number;
  stockStatus: StockStatus;
  issue: CartItemIssue | null;
}

export interface CartSummary {
  itemCount: number;
  totalQuantity: number;
  selectedCount: number;
  subtotal: number;
  discountTotal: number;
  /** null = ยังคำนวณไม่ได้ (ต้องรู้ที่อยู่ก่อน — STEP 10/44) */
  shippingFee: number | null;
  total: number;
  hasIssues: boolean;
  checkoutReady: boolean;
}

export interface Cart {
  id: string;
  isGuest: boolean;
  items: CartItem[];
  summary: CartSummary;
  expiresAt: string | null;
}

export interface AddLookToCartResult {
  cart: Cart;
  skipped: { variantId: string; reason: string }[];
  addedCount: number;
}

export interface MergeCartResult {
  cart: Cart;
  mergedCount: number;
  clampedCount: number;
}

/* ─── STEP 10: Checkout / Order ───────────────────────────────────────────── */

export const SHIPPING_METHODS = ["STANDARD", "EXPRESS", "SAME_DAY", "PICKUP"] as const;

export type ShippingMethodCode = (typeof SHIPPING_METHODS)[number];

export interface CheckoutAddress {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
}

export interface ShippingOption {
  code: ShippingMethodCode;
  name: string;
  description: string;
  etaText: string;
  /** ค่าส่งจริงของยอดปัจจุบัน — มาจาก server */
  fee: number;
  baseFee: number;
  /** ยอดที่ทำให้ส่งฟรี (null = ไม่มีโปร) */
  freeOverSubtotal: number | null;
  /** จำกัดเฉพาะจังหวัดเหล่านี้ (null = ทั่วประเทศ) */
  onlyProvinces: string[] | null;
  available: boolean;
  unavailableReason: string | null;
}

export interface CheckoutSummary {
  items: CartItem[];
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  total: number;
  selectedShippingMethod: ShippingMethodCode;
  shippingOptions: ShippingOption[];
  addresses: CheckoutAddress[];
  blockers: string[];
  checkoutReady: boolean;
}

export interface OrderAddress {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  country: string;
}

export interface OrderItem {
  id: string;
  productSlug: string | null;
  productName: string;
  variantSku: string;
  colorName: string | null;
  sizeName: string | null;
  imageUrl: string | null;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderTimelineStep {
  status: string;
  label: string;
  /** null = ยังไม่ถึงขั้นนี้ (server ไม่เดาเวลา) */
  at: string | null;
  done: boolean;
  current: boolean;
}

export interface OrderShipment {
  id: string;
  carrier: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string;
  estimatedDelivery: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
}

export interface Order {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  subtotal: number;
  discountTotal: number;
  shippingFee: number;
  total: number;
  shippingMethod: ShippingMethodCode;
  shippingMethodName: string;
  shippingEtaText: string;
  address: OrderAddress;
  customerNote: string | null;
  items: OrderItem[];
  itemCount: number;
  totalQuantity: number;
  createdAt: string;
  paidAt: string | null;
  timeline: OrderTimelineStep[];
  trackingNumber: string | null;
  shipments: OrderShipment[];
}

export interface OrderListResult {
  items: Order[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: { status: string; count: number }[];
}

export interface NewAddressInput {
  label?: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  subDistrict: string;
  district: string;
  province: string;
  postalCode: string;
  saveForLater: boolean;
}

export interface CreateOrderInput {
  addressId?: string;
  newAddress?: NewAddressInput;
  shippingMethod: ShippingMethodCode;
  customerNote?: string;
  idempotencyKey: string;
}

/* ─── STEP 11: Payment ────────────────────────────────────────────────────── */

export const PAYMENT_PROVIDERS = ["COD", "STRIPE"] as const;

export type PaymentProviderCode = (typeof PAYMENT_PROVIDERS)[number];

export interface PaymentMethod {
  code: PaymentProviderCode;
  name: string;
  description: string;
  /** ใช้ได้จริงตอนนี้ไหม (server ตัดสิน) */
  available: boolean;
  /** เหตุผลที่ยังใช้ไม่ได้ — แสดงตรง ๆ ไม่ปิดบัง */
  unavailableReason: string | null;
  /** true = จ่ายออนไลน์ทันที · false = เก็บเงินภายหลัง */
  online: boolean;
}

export interface PaymentAttempt {
  provider: string;
  status: string;
  amount: number;
  createdAt: string;
  paidAt: string | null;
  failureReason: string | null;
}

export interface PaymentState {
  order: Order;
  methods: PaymentMethod[];
  deadline: string;
  expired: boolean;
  payable: boolean;
  attempts: PaymentAttempt[];
}

export type StartPaymentResult =
  | { kind: "confirmed"; provider: PaymentProviderCode; order: Order }
  | { kind: "redirect"; provider: PaymentProviderCode; url: string };

export type UnavailableReason = "OUT_OF_STOCK" | "INSUFFICIENT_STOCK";

export interface AvailabilityResult {
  purchasable: boolean;
  reason?: UnavailableReason;
  available: number;
  variant: {
    id: string;
    sku: string;
    productName: string;
    productSlug: string;
    color: string | null;
    size: string | null;
    finalPrice: number;
  };
}

// ============================================================================
// AI STYLIST (STEP 19)
// ============================================================================

export type AIMessageRole = "USER" | "ASSISTANT" | "SYSTEM" | "AGENT";

export interface StylistPreferences {
  style?: string;
  occasion?: string;
  color?: string;
  maxBudget?: number;
  size?: string;
}

export interface StylistMessage {
  id: string;
  role: AIMessageRole;
  content: string;
  referencedProducts: ProductCard[];
  createdAt: string;
}

export interface StylistChatResponse {
  conversationId: string;
  message: StylistMessage;
  suggestedPrompts: string[];
}

export interface StylistHistoryResponse {
  conversationId: string | null;
  messages: StylistMessage[];
}

// ============================================================================
// AI CUSTOMER SERVICE & SUPPORT (STEP 20)
// ============================================================================

export type AIConversationStatus = "ACTIVE" | "ESCALATED" | "CLOSED";

export interface CsMessage {
  id: string;
  role: AIMessageRole;
  content: string;
  referencedOrderNumber?: string | null;
  createdAt: string;
}

export interface CsChatResponse {
  conversationId: string;
  status: AIConversationStatus;
  message: CsMessage;
  suggestedPrompts: string[];
}

export interface CsHistoryResponse {
  conversationId: string | null;
  status: AIConversationStatus;
  messages: CsMessage[];
}

export interface SupportTicketItem {
  id: string;
  title: string | null;
  status: AIConversationStatus;
  escalatedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
  } | null;
  assignedTo: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  messageCount: number;
  lastMessage: {
    role: string;
    content: string;
    createdAt: string;
  } | null;
}

export interface SupportTicketListResult {
  items: SupportTicketItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: {
    all: number;
    escalated: number;
    active: number;
    closed: number;
  };
}

export interface SupportTicketDetail {
  id: string;
  title: string | null;
  summary: string | null;
  status: AIConversationStatus;
  escalatedAt: string | null;
  lastMessageAt: string | null;
  createdAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
  } | null;
  assignedTo: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  messages: Array<{
    id: string;
    role: AIMessageRole;
    content: string;
    referencedProductIds: string[];
    createdAt: string;
  }>;
}

/* ─── STEP 21: AI Knowledge Base ─────────────────────────────────────────── */

export type KnowledgeCategory =
  "SHIPPING" | "RETURNS" | "PAYMENTS" | "SIZING" | "CARE" | "ORDERS" | "GENERAL" | "STYLING";

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
}

export interface KnowledgeArticle {
  id: string;
  slug: string;
  title: string;
  category: KnowledgeCategory;
  summary: string;
  content: string;
  tags: string[];
  faqPairs: FaqItem[];
  isPublished: boolean;
  viewCount: number;
  helpfulCount: number;
  notHelpfulCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeCategoryMeta {
  key: KnowledgeCategory;
  label: string;
  description: string;
  iconName: string;
  articleCount?: number;
}

export interface KnowledgeSearchResult {
  items: KnowledgeArticle[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface KnowledgeAskResponse {
  answer: string;
  sourceArticles: Array<{
    id: string;
    slug: string;
    title: string;
    category: KnowledgeCategory;
    summary: string;
  }>;
  suggestedQuestions: string[];
  model: string;
}

// ─── Wishlist (STEP 22) ──────────────────────────────────────────────────────

export interface WishlistPriceDrop {
  /** ถูกลงกี่บาทเทียบกับตอนกดถูกใจ */
  amount: number;
  /** ถูกลงกี่เปอร์เซ็นต์ */
  percent: number;
}

export interface WishlistItem {
  id: string;
  addedAt: string;
  /** ราคาที่ต้องจ่ายจริง ณ ตอนที่กดถูกใจ — ใช้เทียบเท่านั้น ห้ามใช้คิดเงิน */
  priceWhenAdded: number;
  notifyOnPriceDrop: boolean;
  /** null = ราคายังไม่ถูกลงกว่าตอนกดถูกใจ */
  priceDrop: WishlistPriceDrop | null;
  product: ProductCard;
  /** null = ต้องไปเลือกสี/ไซซ์ที่หน้าสินค้าก่อน */
  quickAddVariantId: string | null;
  activeVariantCount: number;
}

export interface WishlistSummary {
  total: number;
  priceDropCount: number;
  outOfStockCount: number;
}

export interface WishlistListResult {
  items: WishlistItem[];
  summary: WishlistSummary;
  page: number;
  limit: number;
  totalPages: number;
}

export type WishlistSort = "newest" | "price-drop" | "price-asc" | "price-desc";
