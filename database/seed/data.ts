/**
 * TEENSTYLE AI — ข้อมูลตั้งต้นของระบบ (STEP 2)
 *
 * แยกข้อมูลออกจาก logic ของ seed เพื่อให้แก้ข้อมูลได้โดยไม่ต้องแตะโค้ด
 * ทุกชุดข้อมูลมี "คีย์ที่ไม่ซ้ำ" (code / slug / sku / key) เพื่อให้ seed ใช้ upsert
 * แล้วรันซ้ำได้โดยไม่สร้างข้อมูลซ้ำ (idempotent)
 */
import type { DiscountType, LookStyle, RoleName } from '../src/index.ts';

// ─── Permissions (STEP 3 — RBAC) ─────────────────────────────────────────────

export const PERMISSIONS: ReadonlyArray<{ key: string; description: string }> = [
  { key: 'product:read', description: 'ดูข้อมูลสินค้าในระบบหลังบ้าน' },
  { key: 'product:create', description: 'เพิ่มสินค้าใหม่' },
  { key: 'product:update', description: 'แก้ไขสินค้า' },
  { key: 'product:delete', description: 'ลบสินค้า' },
  { key: 'catalog:manage', description: 'จัดการหมวดหมู่ แบรนด์ ไซซ์ และสี' },
  { key: 'inventory:read', description: 'ดูสต็อกและประวัติการเคลื่อนไหว' },
  { key: 'inventory:adjust', description: 'รับเข้า ตัดออก และปรับยอดสต็อก' },
  { key: 'order:read', description: 'ดูคำสั่งซื้อทั้งหมด' },
  { key: 'order:read:own', description: 'ดูคำสั่งซื้อของตัวเอง' },
  { key: 'order:update', description: 'อัปเดตสถานะคำสั่งซื้อ' },
  { key: 'order:cancel', description: 'ยกเลิกคำสั่งซื้อ' },
  { key: 'order:refund', description: 'คืนเงินคำสั่งซื้อ' },
  { key: 'payment:read', description: 'ดูรายการชำระเงิน' },
  { key: 'payment:refund', description: 'สั่งคืนเงินผ่าน provider' },
  { key: 'shipment:read', description: 'ดูข้อมูลการจัดส่ง' },
  { key: 'shipment:update', description: 'อัปเดตสถานะและเลขพัสดุ' },
  { key: 'customer:read', description: 'ดูข้อมูลลูกค้า' },
  { key: 'customer:update', description: 'แก้ไขสถานะลูกค้า' },
  { key: 'review:create', description: 'เขียนรีวิวสินค้าที่ซื้อแล้ว' },
  { key: 'review:moderate', description: 'อนุมัติ ซ่อน หรือลบรีวิว' },
  { key: 'wishlist:manage', description: 'จัดการรายการที่ถูกใจของตัวเอง' },
  { key: 'coupon:manage', description: 'จัดการคูปองและโปรโมชั่น' },
  { key: 'look:manage', description: 'จัดการ Look และสินค้าในลุค' },
  { key: 'ai:read', description: 'ดูบทสนทนากับ AI' },
  { key: 'ai:handoff', description: 'รับเรื่องต่อจาก AI เพื่อคุยกับลูกค้า' },
  { key: 'ai:knowledge:manage', description: 'จัดการคลังความรู้ที่ AI ใช้ตอบ' },
  { key: 'analytics:read', description: 'ดูรายงานและสถิติ' },
  { key: 'log:read', description: 'ดู Audit log ของระบบหลังบ้าน' },
  { key: 'settings:manage', description: 'แก้ไขการตั้งค่าร้าน' },
  { key: 'user:role:manage', description: 'เปลี่ยนบทบาทและสิทธิ์ของผู้ใช้' },
  { key: 'backup:manage', description: 'สั่ง backup และกู้คืนข้อมูล' },
];

const CUSTOMER_PERMISSIONS = ['order:read:own', 'review:create', 'wishlist:manage'];

const EMPLOYEE_PERMISSIONS = [
  ...CUSTOMER_PERMISSIONS,
  'product:read',
  'inventory:read',
  'inventory:adjust',
  'order:read',
  'order:update',
  'shipment:read',
  'shipment:update',
  'customer:read',
  'payment:read',
  'ai:read',
  'ai:handoff',
];

const ADMIN_PERMISSIONS = [
  ...EMPLOYEE_PERMISSIONS,
  'product:create',
  'product:update',
  'product:delete',
  'catalog:manage',
  'order:cancel',
  'order:refund',
  'payment:refund',
  'customer:update',
  'review:moderate',
  'coupon:manage',
  'look:manage',
  'ai:knowledge:manage',
  'analytics:read',
  'log:read',
  'settings:manage',
];

export const ROLES: ReadonlyArray<{
  name: RoleName;
  description: string;
  permissionKeys: readonly string[];
}> = [
  {
    name: 'CUSTOMER',
    description: 'ลูกค้าทั่วไป — ซื้อสินค้า รีวิว และดูคำสั่งซื้อของตัวเอง',
    permissionKeys: CUSTOMER_PERMISSIONS,
  },
  {
    name: 'EMPLOYEE',
    description: 'พนักงานร้าน — จัดการสต็อก คำสั่งซื้อ การจัดส่ง และรับเรื่องต่อจาก AI',
    permissionKeys: EMPLOYEE_PERMISSIONS,
  },
  {
    name: 'ADMIN',
    description: 'ผู้ดูแลร้าน — จัดการสินค้า โปรโมชั่น รายงาน และการตั้งค่า',
    permissionKeys: ADMIN_PERMISSIONS,
  },
  {
    name: 'SUPER_ADMIN',
    description: 'ผู้ดูแลระบบสูงสุด — มีสิทธิ์ทั้งหมดรวมถึงการจัดการสิทธิ์และ backup',
    permissionKeys: PERMISSIONS.map((p) => p.key),
  },
];

// ─── Sizes & Colors (STEP 48) ────────────────────────────────────────────────

export const SIZES: ReadonlyArray<{ name: string; code: string; sortOrder: number }> = [
  { name: 'XS', code: 'XS', sortOrder: 10 },
  { name: 'S', code: 'S', sortOrder: 20 },
  { name: 'M', code: 'M', sortOrder: 30 },
  { name: 'L', code: 'L', sortOrder: 40 },
  { name: 'XL', code: 'XL', sortOrder: 50 },
  { name: 'XXL', code: 'XXL', sortOrder: 60 },
  { name: 'Free Size', code: 'FREE', sortOrder: 70 },
  { name: '36', code: 'EU36', sortOrder: 80 },
  { name: '37', code: 'EU37', sortOrder: 90 },
  { name: '38', code: 'EU38', sortOrder: 100 },
  { name: '39', code: 'EU39', sortOrder: 110 },
  { name: '40', code: 'EU40', sortOrder: 120 },
];

export const COLORS: ReadonlyArray<{ name: string; slug: string; hex: string; sortOrder: number }> =
  [
    { name: 'ดำ', slug: 'black', hex: '#111114', sortOrder: 10 },
    { name: 'ขาว', slug: 'white', hex: '#FFFFFF', sortOrder: 20 },
    { name: 'ครีม', slug: 'cream', hex: '#E7D3C1', sortOrder: 30 },
    { name: 'เทา', slug: 'gray', hex: '#9CA3AF', sortOrder: 40 },
    { name: 'ม่วงลาเวนเดอร์', slug: 'lavender', hex: '#A78BFA', sortOrder: 50 },
    { name: 'ชมพูพาสเทล', slug: 'pastel-pink', hex: '#F5D0E0', sortOrder: 60 },
    { name: 'น้ำเงินยีนส์', slug: 'denim-blue', hex: '#6B7C93', sortOrder: 70 },
    { name: 'เขียวมิลิทารี', slug: 'military-green', hex: '#5B6650', sortOrder: 80 },
    { name: 'น้ำตาลโอ๊ค', slug: 'oak-brown', hex: '#7C6A52', sortOrder: 90 },
  ];

// ─── Categories (STEP 48 — parent / sub category) ────────────────────────────

export const CATEGORIES: ReadonlyArray<{
  name: string;
  slug: string;
  description: string;
  sortOrder: number;
  parentSlug?: string;
}> = [
  { name: 'เสื้อ', slug: 'tops', description: 'เสื้อยืด เสื้อครอป และเสื้อเชิ้ต', sortOrder: 10 },
  {
    name: 'เสื้อยืด',
    slug: 'tees',
    description: 'เสื้อยืดทุกทรง',
    sortOrder: 11,
    parentSlug: 'tops',
  },
  {
    name: 'เสื้อครอป',
    slug: 'crop-tops',
    description: 'เสื้อครอปสไตล์เกาหลีและ Y2K',
    sortOrder: 12,
    parentSlug: 'tops',
  },
  {
    name: 'กางเกงและกระโปรง',
    slug: 'bottoms',
    description: 'ยีนส์ คาร์โก้ และกระโปรง',
    sortOrder: 20,
  },
  {
    name: 'ยีนส์',
    slug: 'jeans',
    description: 'ยีนส์ทุกทรง',
    sortOrder: 21,
    parentSlug: 'bottoms',
  },
  {
    name: 'กระโปรง',
    slug: 'skirts',
    description: 'กระโปรงสั้นและกระโปรงจีบ',
    sortOrder: 22,
    parentSlug: 'bottoms',
  },
  { name: 'เดรส', slug: 'dresses', description: 'เดรสสำหรับทุกโอกาส', sortOrder: 30 },
  { name: 'เสื้อคลุม', slug: 'outerwear', description: 'ฮู้ดดี้ แจ็คเก็ต และโค้ท', sortOrder: 40 },
  {
    name: 'แอคเซสซอรี่',
    slug: 'accessories',
    description: 'หมวก กระเป๋า และเครื่องประดับ',
    sortOrder: 50,
  },
  { name: 'รองเท้า', slug: 'shoes', description: 'สนีกเกอร์และรองเท้าแฟชั่น', sortOrder: 60 },
];

// ─── Brands ──────────────────────────────────────────────────────────────────

export const BRANDS: ReadonlyArray<{ name: string; slug: string; description: string }> = [
  {
    name: 'TeenStyle Basic',
    slug: 'teenstyle-basic',
    description: 'เบสิกใส่ได้ทุกวัน คุณภาพคุ้มราคา',
  },
  { name: 'Urban Y2K', slug: 'urban-y2k', description: 'กลิ่นอาย Y2K แบบคนเมือง' },
  { name: 'Seoul Soft', slug: 'seoul-soft', description: 'สไตล์เกาหลี โทนละมุน' },
  { name: 'Street Lab', slug: 'street-lab', description: 'สตรีทแวร์ทรงโอเวอร์ไซซ์' },
];

// ─── Products (STEP 6) ───────────────────────────────────────────────────────

const IMG = 'https://images.unsplash.com/';
const IMG_Q = '?w=900&q=80&auto=format&fit=crop';

export interface SeedProduct {
  name: string;
  slug: string;
  sku: string;
  description: string;
  shortDescription: string;
  /** ราคาปกติ */
  price: number;
  /** ราคาลด — ต้องน้อยกว่า price */
  salePrice?: number;
  categorySlug: string;
  brandSlug: string;
  tags: string[];
  minimumStock: number;
  images: Array<{ url: string; alt: string }>;
  /** slug ของสีที่มี */
  colorSlugs: string[];
  /** code ของไซซ์ที่มี */
  sizeCodes: string[];
  /** จำนวนตั้งต้นต่อ 1 variant */
  stockPerVariant: number;
}

export const PRODUCTS: readonly SeedProduct[] = [
  {
    name: 'เสื้อยืด Oversize คอตตอน',
    slug: 'oversize-cotton-tee',
    sku: 'TS-TEE-001',
    description:
      'เสื้อยืดทรง Oversize ผ้าคอตตอน 100% เนื้อแน่นไม่บาง ไม่ต้องกลัวใส่แล้วโปร่ง ทรงตรงปล่อยสบาย ใส่เดี่ยว ๆ ก็เท่ หรือใส่ซ้อนกับเสื้อคลุมก็ได้ ซักแล้วไม่ย้วย',
    shortDescription: 'คอตตอน 100% ทรงโอเวอร์ไซซ์ ใส่ง่ายทุกวัน',
    price: 590,
    salePrice: 390,
    categorySlug: 'tees',
    brandSlug: 'teenstyle-basic',
    tags: ['oversize', 'basic', 'street', 'minimal', 'เรียน', 'ชิล'],
    minimumStock: 10,
    images: [
      {
        url: `${IMG}photo-1521572163474-6864f9cf17ab${IMG_Q}`,
        alt: 'เสื้อยืดโอเวอร์ไซซ์สีขาววางบนพื้นเรียบ',
      },
      { url: `${IMG}photo-1523381210434-271e8be1f52b${IMG_Q}`, alt: 'เสื้อยืดหลายสีวางเรียงกัน' },
    ],
    colorSlugs: ['black', 'white', 'lavender'],
    sizeCodes: ['S', 'M', 'L', 'XL'],
    stockPerVariant: 25,
  },
  {
    name: 'เสื้อครอปนิตติ้งแขนสั้น',
    slug: 'crop-knit-top',
    sku: 'TS-CRP-002',
    description:
      'เสื้อครอปนิตติ้งแขนสั้น เนื้อผ้ายืดหยุ่นเข้ารูปพอดี ไม่รัดจนอึดใจ ความยาวกำลังดีใส่กับกระโปรงหรือกางเกงเอวสูงได้ทั้งคู่ สไตล์เกาหลีละมุน',
    shortDescription: 'นิตติ้งเนื้อนุ่ม ทรงครอปสไตล์เกาหลี',
    price: 490,
    categorySlug: 'crop-tops',
    brandSlug: 'seoul-soft',
    tags: ['crop', 'korean', 'cute', 'เดท', 'เรียน'],
    minimumStock: 8,
    images: [
      {
        url: `${IMG}photo-1515886657613-9f3515b0c78f${IMG_Q}`,
        alt: 'ผู้หญิงใส่เสื้อนิตติ้งโทนอบอุ่น',
      },
    ],
    colorSlugs: ['pastel-pink', 'white', 'lavender'],
    sizeCodes: ['S', 'M', 'L'],
    stockPerVariant: 18,
  },
  {
    name: 'ยีนส์ทรงกระบอกใหญ่',
    slug: 'baggy-jeans',
    sku: 'TS-JNS-003',
    description:
      'ยีนส์ทรงกระบอกใหญ่ ผ้าเดนิมไม่ยืด ทรงอยู่ทั้งวัน เอวสูงพอดีช่วยให้ขาดูยาว มีกระเป๋าหลังใช้งานได้จริง ใส่กับเสื้อครอปหรือเสื้อยืดโอเวอร์ไซซ์ก็ลงตัว',
    shortDescription: 'เดนิมทรงกระบอกใหญ่ เอวสูง ขาดูยาว',
    price: 1190,
    salePrice: 890,
    categorySlug: 'jeans',
    brandSlug: 'street-lab',
    tags: ['baggy', 'denim', 'street', 'sporty', 'เรียน', 'ชิล'],
    minimumStock: 8,
    images: [
      { url: `${IMG}photo-1542272604-787c3835535d${IMG_Q}`, alt: 'กางเกงยีนส์พับขาวางบนพื้น' },
    ],
    colorSlugs: ['denim-blue', 'black'],
    sizeCodes: ['S', 'M', 'L', 'XL'],
    stockPerVariant: 20,
  },
  {
    name: 'กระโปรงจีบสั้นทรงเอ',
    slug: 'pleated-mini-skirt',
    sku: 'TS-SKT-004',
    description:
      'กระโปรงจีบสั้นทรงเอ มีกางเกงซับในให้ ไม่ต้องกังวลเวลานั่งหรือลมพัด จีบอยู่ทรงหลังซัก เอวยางยืดด้านหลังใส่สบายทั้งวัน',
    shortDescription: 'จีบอยู่ทรง มีกางเกงซับใน ใส่มั่นใจ',
    price: 590,
    categorySlug: 'skirts',
    brandSlug: 'seoul-soft',
    tags: ['skirt', 'korean', 'cute', 'เดท', 'เรียน'],
    minimumStock: 8,
    images: [
      {
        url: `${IMG}photo-1529139574466-a303027c1d8b${IMG_Q}`,
        alt: 'ลุคแฟชั่นสตรีทกับกระโปรงสั้น',
      },
    ],
    colorSlugs: ['black', 'lavender', 'white'],
    sizeCodes: ['S', 'M', 'L'],
    stockPerVariant: 15,
  },
  {
    name: 'ฮู้ดดี้ Oversize ผ้าสำลี',
    slug: 'oversize-hoodie',
    sku: 'TS-HOD-005',
    description:
      'ฮู้ดดี้ทรง Oversize ผ้าสำลีขนหนูด้านใน อุ่นแต่ไม่อึด ฮู้ดมีทรงไม่แบน เชือกปรับได้ กระเป๋าหน้าลึกใส่มือถือได้ ใส่คลุมทับชุดไหนก็เท่',
    shortDescription: 'สำลีขนหนู อุ่นสบาย ฮู้ดมีทรง',
    price: 990,
    salePrice: 790,
    categorySlug: 'outerwear',
    brandSlug: 'street-lab',
    tags: ['hoodie', 'oversize', 'street', 'sporty', 'เรียน', 'ชิล'],
    minimumStock: 10,
    images: [
      { url: `${IMG}photo-1556821840-3a63f95609a7${IMG_Q}`, alt: 'ฮู้ดดี้โอเวอร์ไซซ์วางพับ' },
    ],
    colorSlugs: ['lavender', 'black', 'gray'],
    sizeCodes: ['M', 'L', 'XL'],
    stockPerVariant: 22,
  },
  {
    name: 'เสื้อเมชซ้อนสไตล์ Y2K',
    slug: 'y2k-mesh-top',
    sku: 'TS-MSH-006',
    description:
      'เสื้อเมชแขนยาวสไตล์ Y2K ใส่ซ้อนกับเสื้อกล้ามหรือบราท็อปได้ เนื้อเมชยืดหยุ่นเข้ารูป เหมาะกับลุคปาร์ตี้และคอนเสิร์ต',
    shortDescription: 'เมชยืดหยุ่น ใส่ซ้อนได้ กลิ่นอาย Y2K',
    price: 450,
    categorySlug: 'tops',
    brandSlug: 'urban-y2k',
    tags: ['mesh', 'y2k', 'street', 'ปาร์ตี้', 'เดท'],
    minimumStock: 6,
    images: [
      {
        url: `${IMG}photo-1496747611176-843222e1e57c${IMG_Q}`,
        alt: 'ลุคแฟชั่นโทนเข้มสไตล์ปาร์ตี้',
      },
    ],
    colorSlugs: ['black', 'lavender'],
    sizeCodes: ['S', 'M', 'L'],
    stockPerVariant: 14,
  },
  {
    name: 'กางเกงคาร์โก้ขายาว',
    slug: 'cargo-pants',
    sku: 'TS-CRG-007',
    description:
      'กางเกงคาร์โก้ขายาว กระเป๋าข้าง 6 ใบใช้งานได้จริง ผ้าทวิลเนื้อแน่นทรงอยู่ ปลายขาปรับเก็บได้ ใส่ได้ทั้งลุคสตรีทและสปอร์ต',
    shortDescription: 'ผ้าทวิลทรงอยู่ กระเป๋าใช้งานได้จริง',
    price: 790,
    categorySlug: 'bottoms',
    brandSlug: 'street-lab',
    tags: ['cargo', 'street', 'sporty', 'เรียน', 'ชิล'],
    minimumStock: 8,
    images: [{ url: `${IMG}photo-1552374196-c4e7ffc6e126${IMG_Q}`, alt: 'ลุคสตรีทกับกางเกงขายาว' }],
    colorSlugs: ['oak-brown', 'black', 'military-green'],
    sizeCodes: ['S', 'M', 'L', 'XL'],
    stockPerVariant: 16,
  },
  {
    name: 'เดรสสายเดี่ยวผ้าซาติน',
    slug: 'satin-slip-dress',
    sku: 'TS-DRS-008',
    description:
      'เดรสสายเดี่ยวผ้าซาตินทิ้งตัวสวย สายปรับความยาวได้ ซับในเต็มตัวไม่โปร๊ง ใส่เดี่ยวไปงานกลางคืน หรือใส่ทับเสื้อยืดเป็นลุคเลเยอร์ก็ได้',
    shortDescription: 'ซาตินทิ้งตัว ซับในเต็มตัว สายปรับได้',
    price: 1290,
    salePrice: 990,
    categorySlug: 'dresses',
    brandSlug: 'urban-y2k',
    tags: ['dress', 'satin', 'y2k', 'minimal', 'เดท', 'ปาร์ตี้'],
    minimumStock: 6,
    images: [
      { url: `${IMG}photo-1539109136881-3be0616acf4b${IMG_Q}`, alt: 'ลุคเดรสสไตล์สตรีทแฟชั่น' },
    ],
    colorSlugs: ['black', 'lavender', 'cream'],
    sizeCodes: ['S', 'M', 'L'],
    stockPerVariant: 12,
  },
  {
    name: 'แจ็คเก็ตวาร์ซิตี้ปักอักษร',
    slug: 'varsity-jacket',
    sku: 'TS-JKT-009',
    description:
      'แจ็คเก็ตวาร์ซิตี้ตัวหนา ปักอักษรเย็บติดไม่ใช่สกรีน แขนหนังเทียมเนื้อนิ่ม กระดุมแป๊กแน่นหนา ซับในบุอุ่น ใส่ทับได้ทั้งเสื้อยืดและฮู้ดดี้',
    shortDescription: 'ปักอักษรเย็บติด แขนหนังเทียม ซับในบุอุ่น',
    price: 1290,
    categorySlug: 'outerwear',
    brandSlug: 'street-lab',
    tags: ['varsity', 'jacket', 'street', 'sporty', 'เรียน'],
    minimumStock: 5,
    images: [
      {
        url: `${IMG}photo-1492707892479-7bc8d5a4ee93${IMG_Q}`,
        alt: 'ผู้หญิงใส่แจ็คเก็ตสไตล์สตรีท',
      },
    ],
    colorSlugs: ['black', 'cream'],
    sizeCodes: ['M', 'L', 'XL'],
    stockPerVariant: 10,
  },
  {
    name: 'เดรสเชิ้ตมินิมอลสีพื้น',
    slug: 'minimal-shirt-dress',
    sku: 'TS-DRS-010',
    description:
      'เดรสเชิ้ตสีพื้นทรงมินิมอล มีเข็มขัดผ้าให้เข้าเอว ผ้าไม่ต้องรีดบ่อย ใส่ไปเรียน ไปทำงาน หรือใส่เปิดเป็นเสื้อคลุมทับเสื้อยืดก็ได้',
    shortDescription: 'ทรงมินิมอล มีเข็มขัดผ้า ผ้าไม่ยับง่าย',
    price: 890,
    categorySlug: 'dresses',
    brandSlug: 'teenstyle-basic',
    tags: ['dress', 'shirt', 'minimal', 'korean', 'เรียน', 'เดท', 'ชิล'],
    minimumStock: 6,
    images: [{ url: `${IMG}photo-1534528741775-53994a69daeb${IMG_Q}`, alt: 'ลุคมินิมอลโทนสว่าง' }],
    colorSlugs: ['white', 'black', 'cream'],
    sizeCodes: ['S', 'M', 'L'],
    stockPerVariant: 14,
  },
  {
    name: 'หมวกบักเก็ตผ้าแคนวาส',
    slug: 'canvas-bucket-hat',
    sku: 'TS-HAT-011',
    description:
      'หมวกบักเก็ตผ้าแคนวาสเนื้อหนา ปีกกว้างพอกันแดดแต่ไม่บังสายตา ด้านในมีแถบซับเหงื่อ พับใส่กระเป๋าได้ไม่เสียทรง',
    shortDescription: 'แคนวาสเนื้อหนา ปีกกว้างกันแดด พับได้',
    price: 390,
    salePrice: 290,
    categorySlug: 'accessories',
    brandSlug: 'street-lab',
    tags: ['hat', 'bucket', 'street', 'cute', 'ชิล', 'เรียน'],
    minimumStock: 10,
    images: [{ url: `${IMG}photo-1517841905240-472988babdf9${IMG_Q}`, alt: 'ลุคแฟชั่นพร้อมหมวก' }],
    colorSlugs: ['black', 'lavender', 'cream'],
    sizeCodes: ['FREE'],
    stockPerVariant: 30,
  },
  {
    name: 'สนีกเกอร์ชังกี้พื้นหนา',
    slug: 'chunky-sneakers',
    sku: 'TS-SNK-012',
    description:
      'สนีกเกอร์พื้นหนาทรงชังกี้ เสริมความสูงประมาณ 4 ซม. พื้นยางกันลื่น ด้านในบุนุ่มใส่เดินได้ทั้งวัน ใส่กับยีนส์ กระโปรง หรือเดรสก็เข้ากัน',
    shortDescription: 'พื้นหนาเสริมสูง 4 ซม. บุนุ่ม เดินสบาย',
    price: 1890,
    salePrice: 1490,
    categorySlug: 'shoes',
    brandSlug: 'urban-y2k',
    tags: ['sneakers', 'chunky', 'y2k', 'sporty', 'street', 'เรียน', 'เดท', 'ปาร์ตี้'],
    minimumStock: 5,
    images: [
      {
        url: `${IMG}photo-1483985988355-763728e1935b${IMG_Q}`,
        alt: 'ลุคแฟชั่นวัยรุ่นถือถุงช้อปปิ้ง',
      },
    ],
    colorSlugs: ['white', 'black'],
    sizeCodes: ['EU36', 'EU37', 'EU38', 'EU39', 'EU40'],
    stockPerVariant: 8,
  },
];

// ─── Looks (STEP 7, 8) ───────────────────────────────────────────────────────

export const LOOKS: ReadonlyArray<{
  name: string;
  slug: string;
  description: string;
  style: LookStyle;
  imageUrl: string;
  imageAlt: string;
  isFeatured: boolean;
  /** slug ของสินค้าในลุค เรียงตามลำดับที่จะแสดง */
  productSlugs: string[];
}> = [
  {
    name: 'Campus Day',
    slug: 'campus-day',
    description: 'ลุคไปเรียนที่ใส่สบายแต่ยังดูมีสไตล์ เน้นทรงโอเวอร์ไซซ์กับยีนส์ทรงกระบอก',
    style: 'STREET',
    imageUrl: `${IMG}photo-1529139574466-a303027c1d8b${IMG_Q}`,
    imageAlt: 'ลุคสตรีทแคชวลสำหรับไปเรียน',
    isFeatured: true,
    productSlugs: ['oversize-cotton-tee', 'baggy-jeans', 'canvas-bucket-hat'],
  },
  {
    name: 'Sweet Date',
    slug: 'sweet-date',
    description: 'ลุคไปเดทโทนละมุนสไตล์เกาหลี เสื้อครอปกับกระโปรงจีบที่ดูอ่อนโยนแต่ไม่เรียบไป',
    style: 'KOREAN',
    imageUrl: `${IMG}photo-1515886657613-9f3515b0c78f${IMG_Q}`,
    imageAlt: 'ลุคเกาหลีน่ารักสำหรับไปเดท',
    isFeatured: true,
    productSlugs: ['crop-knit-top', 'pleated-mini-skirt', 'chunky-sneakers'],
  },
  {
    name: 'Y2K Party',
    slug: 'y2k-party',
    description: 'ลุคปาร์ตี้กลางคืนกลิ่นอาย Y2K เสื้อเมชซ้อนกับเดรสซาตินและสนีกเกอร์พื้นหนา',
    style: 'PARTY',
    imageUrl: `${IMG}photo-1496747611176-843222e1e57c${IMG_Q}`,
    imageAlt: 'ลุค Y2K สำหรับไปปาร์ตี้กลางคืน',
    isFeatured: true,
    productSlugs: ['y2k-mesh-top', 'satin-slip-dress', 'chunky-sneakers'],
  },
  {
    name: 'Clean Minimal',
    slug: 'clean-minimal',
    description: 'ลุคมินิมอลโทนสะอาดตา ใส่ได้ทุกวันไม่ต้องคิดเยอะ เน้นทรงเรียบและสีพื้น',
    style: 'MINIMAL',
    imageUrl: `${IMG}photo-1534528741775-53994a69daeb${IMG_Q}`,
    imageAlt: 'ลุคมินิมอลเรียบหรูใส่ได้ทุกวัน',
    isFeatured: false,
    productSlugs: ['minimal-shirt-dress', 'oversize-cotton-tee', 'cargo-pants'],
  },
];

// ─── Coupons (STEP 41) ───────────────────────────────────────────────────────

export const COUPONS: ReadonlyArray<{
  code: string;
  name: string;
  description: string;
  type: DiscountType;
  value: number;
  minOrderAmount?: number;
  maxDiscountAmount?: number;
  usageLimit?: number;
  perUserLimit?: number;
  /** จำนวนวันนับจากวันที่ seed ที่คูปองจะหมดอายุ */
  validDays: number;
}> = [
  {
    code: 'TEEN15',
    name: 'ลด 15% เมื่อซื้อครบ 690.-',
    description: 'ส่วนลด 15% สำหรับคำสั่งซื้อตั้งแต่ 690 บาท ลดสูงสุด 300 บาท',
    type: 'PERCENTAGE',
    value: 15,
    minOrderAmount: 690,
    maxDiscountAmount: 300,
    perUserLimit: 3,
    validDays: 60,
  },
  {
    code: 'FREESHIP690',
    name: 'ส่งฟรีเมื่อครบ 690.-',
    description: 'ส่งฟรีสำหรับคำสั่งซื้อตั้งแต่ 690 บาท',
    type: 'FREE_SHIPPING',
    value: 0,
    minOrderAmount: 690,
    validDays: 365,
  },
  {
    code: 'NEWBIE100',
    name: 'ลูกค้าใหม่ลด 100.-',
    description: 'ส่วนลด 100 บาทสำหรับลูกค้าใหม่ ใช้ได้ 1 ครั้งต่อบัญชี',
    type: 'FIXED_AMOUNT',
    value: 100,
    minOrderAmount: 500,
    perUserLimit: 1,
    usageLimit: 1000,
    validDays: 90,
  },
];
