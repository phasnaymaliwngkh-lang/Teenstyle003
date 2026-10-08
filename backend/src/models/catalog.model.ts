/**
 * กฎล้วนของหมวดหมู่ · แบรนด์ · ไซซ์ · สี (STEP 48) — ไม่แตะฐานข้อมูล
 *
 * **ข้อตกลงหลักข้อเดียว: สินค้าที่เปิดขายทุกชิ้นใช้หมวด/แบรนด์/สี/ไซซ์ที่เปิดใช้อยู่เท่านั้น**
 * ทุกกฎด้านล่างคือการรักษาข้อนี้ — ถ้าหลุด หน้าร้านจะขายของที่หาไม่เจอ
 * (ตัวกรองซ่อนหมวดที่ปิด แต่สินค้าในหมวดยังขายอยู่ · การ์ดโชว์สีที่กรองไม่ได้)
 *
 * เหตุผลที่ "ทำไม่ได้" ทุกข้อคิดที่นี่ที่เดียว — หน้าหลังบ้านใช้แสดงล่วงหน้า
 * และ service ใช้ตัดสินจริงในทรานแซกชันที่ล็อกแถวแล้ว (ข้อความจึงตรงกันเสมอ)
 */

export type CatalogKind = 'category' | 'brand' | 'size' | 'color';

export const CATALOG_LABEL: Record<CatalogKind, string> = {
  category: 'หมวดหมู่',
  brand: 'แบรนด์',
  size: 'ไซซ์',
  color: 'สี',
};

/** slug ของหมวด/แบรนด์/สี — อยู่ใน URL ของหน้าร้าน (`/shop?category=` · `?brand=` · `?color=`) */
export const CATALOG_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** รหัสไซซ์ — อยู่ใน URL (`?size=`) และเป็นคำที่ตัวค้นหาตีความ เช่น M, XL, EU36 */
export const SIZE_CODE_PATTERN = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;

/** สีเก็บเป็น #RRGGBB ตัวพิมพ์ใหญ่ — แบบเดียวกับข้อมูลตั้งต้น */
export const HEX_PATTERN = /^#[0-9A-F]{6}$/;

export function normalizeHex(value: string): string {
  const trimmed = value.trim().toUpperCase();
  return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
}

/**
 * ของที่ลบแบบ soft delete ต้องคืน slug/ชื่อให้ใช้ใหม่ได้
 *
 * slug (และชื่อแบรนด์) เป็น unique ในฐานข้อมูล **รวมแถวที่ลบไปแล้ว** — ถ้าไม่เปลี่ยน
 * ร้านที่ลบแบรนด์ "Nike" ทิ้งจะสร้าง "Nike" ใหม่ไม่ได้ตลอดไป
 * ต่อท้ายด้วย id 8 ตัวแรกเพื่อไม่ให้ของที่ลบสองครั้งชนกันเอง
 */
export function deletedSlug(slug: string, id: string): string {
  return `${slug}--deleted-${id.slice(0, 8)}`;
}

export function deletedName(name: string, id: string): string {
  return `${name} (ลบแล้ว ${id.slice(0, 8)})`;
}

/* ─────────────────────────── หมวดหมู่ ─────────────────────────── */

export interface CategoryUsage {
  /** สินค้าที่ยังไม่ถูกลบ (ทุกสถานะ) ที่อยู่ในหมวดนี้โดยตรง */
  products: number;
  /** สินค้าที่เปิดขายอยู่ในหมวดนี้โดยตรง */
  activeProducts: number;
  /** หมวดย่อยที่ยังไม่ถูกลบ */
  children: number;
  /** หมวดย่อยที่เปิดใช้อยู่ */
  activeChildren: number;
  /** คูปองที่ยังไม่ถูกลบซึ่งจำกัดไว้ที่หมวดนี้ */
  coupons: number;
}

export interface CatalogBlockers {
  /** ปิดใช้งานไม่ได้เพราะ… — null = ปิดได้ */
  deactivate: string | null;
  /** ลบไม่ได้เพราะ… — null = ลบได้ */
  remove: string | null;
  /** แก้ slug/รหัสไม่ได้เพราะ… — null = แก้ได้ */
  slug: string | null;
}

export function categoryBlockers(usage: CategoryUsage): CatalogBlockers {
  return {
    deactivate:
      usage.activeProducts > 0
        ? `มีสินค้าที่เปิดขายอยู่ในหมวดนี้ ${usage.activeProducts} ชิ้น — ย้ายไปหมวดอื่นหรือปิดการขายก่อน`
        : usage.activeChildren > 0
          ? `มีหมวดย่อยที่เปิดใช้อยู่ ${usage.activeChildren} หมวด — ปิดหมวดย่อยก่อน`
          : null,
    remove:
      usage.products > 0
        ? `ยังมีสินค้า ${usage.products} ชิ้นในหมวดนี้ (รวมที่ปิดการขายแล้ว) — ย้ายไปหมวดอื่นก่อน`
        : usage.children > 0
          ? `ยังมีหมวดย่อย ${usage.children} หมวด — ลบหรือย้ายหมวดย่อยก่อน`
          : usage.coupons > 0
            ? `มีคูปอง ${usage.coupons} ใบที่จำกัดไว้เฉพาะหมวดนี้ — แก้คูปองก่อน ไม่งั้นคูปองจะใช้ไม่ได้เงียบ ๆ`
            : null,
    slug:
      usage.products > 0
        ? 'slug อยู่ในลิงก์ของหน้าร้านที่ลูกค้าแชร์และ Google เก็บไว้ — แก้ได้เฉพาะตอนยังไม่มีสินค้าในหมวด'
        : null,
  };
}

export interface CategoryNode {
  id: string;
  parentId: string | null;
  isActive: boolean;
}

/**
 * ตรวจหมวดแม่ของหมวดหนึ่ง — คืนข้อความที่บอกว่าผิดอะไร หรือ null = ใช้ได้
 *
 * ⚠️ **หมวดซ้อนได้ 2 ชั้นเท่านั้น** (หมวดแม่ → หมวดย่อย)
 *    หน้าร้านกรองสินค้าด้วย "หมวดนี้ + หมวดย่อยชั้นเดียว" (`searchProducts` · ตัวนับในแผงกรอง ·
 *    การ์ดหมวดบนหน้าแรก) ถ้ายอมให้ซ้อนชั้นที่ 3 สินค้าในชั้นล่างสุดจะหายจากหมวดบนสุดเงียบ ๆ
 */
export function checkCategoryParent(input: {
  categoryId: string | null;
  /** หมวดที่กำลังตั้งเป็นแม่ — null = เป็นหมวดระดับบนสุด */
  parent: CategoryNode | null;
  /** หมวดนี้มีหมวดย่อยอยู่แล้วไหม */
  hasChildren: boolean;
  /** หมวดนี้จะเปิดใช้งานไหม (หลังบันทึก) */
  willBeActive: boolean;
}): string | null {
  const { parent } = input;
  if (parent === null) return null;

  if (input.categoryId !== null && parent.id === input.categoryId) {
    return 'หมวดหมู่เป็นหมวดแม่ของตัวเองไม่ได้';
  }

  if (parent.parentId !== null) {
    return 'หมวดแม่ต้องเป็นหมวดระดับบนสุด — หน้าร้านกรองสินค้าได้แค่หมวดแม่กับหมวดย่อยชั้นเดียว';
  }

  if (input.hasChildren) {
    return 'หมวดนี้มีหมวดย่อยอยู่ — ย้ายไปอยู่ใต้หมวดอื่นไม่ได้ เพราะจะซ้อนเกิน 2 ชั้น';
  }

  if (input.willBeActive && !parent.isActive) {
    return 'หมวดแม่ปิดใช้งานอยู่ — เปิดหมวดแม่ก่อน หรือบันทึกหมวดนี้เป็นปิดใช้งาน';
  }

  return null;
}

/* ─────────────────────────── แบรนด์ ─────────────────────────── */

export interface BrandUsage {
  products: number;
  activeProducts: number;
}

export function brandBlockers(usage: BrandUsage): CatalogBlockers {
  return {
    deactivate:
      usage.activeProducts > 0
        ? `มีสินค้าที่เปิดขายอยู่ของแบรนด์นี้ ${usage.activeProducts} ชิ้น — เปลี่ยนแบรนด์หรือปิดการขายก่อน`
        : null,
    remove:
      usage.products > 0
        ? `ยังมีสินค้า ${usage.products} ชิ้นของแบรนด์นี้ (รวมที่ปิดการขายแล้ว) — เปลี่ยนแบรนด์ก่อน`
        : null,
    slug:
      usage.products > 0
        ? 'slug อยู่ในลิงก์ของหน้าร้าน (/shop?brand=…) — แก้ได้เฉพาะตอนยังไม่มีสินค้าของแบรนด์นี้'
        : null,
  };
}

/* ─────────────────────────── ไซซ์ / สี ─────────────────────────── */

export interface VariantUsage {
  /** ตัวเลือกสินค้าทุกตัวที่อ้างถึง (รวมที่ปิด/ลบไปแล้ว — ฐานข้อมูลยังอ้างถึงอยู่) */
  variants: number;
  /** ตัวเลือกที่เปิดขายอยู่จริง (ตัวเลือกเปิด · สินค้าเปิดขาย · ยังไม่ถูกลบ) */
  sellingVariants: number;
}

export function variantOptionBlockers(
  kind: 'size' | 'color',
  usage: VariantUsage,
): CatalogBlockers {
  const label = CATALOG_LABEL[kind];

  return {
    deactivate:
      usage.sellingVariants > 0
        ? `ตัวเลือกที่เปิดขายอยู่ใช้${label}นี้ ${usage.sellingVariants} รายการ — ปิดตัวเลือกเหล่านั้นหรือปิดการขายสินค้าก่อน`
        : null,
    remove:
      usage.variants > 0
        ? `ตัวเลือกสินค้า ${usage.variants} รายการใช้${label}นี้ (รวมที่ปิดไปแล้ว) — ประวัติสินค้ายังอ้างถึง จึงลบไม่ได้ ใช้ "ปิดใช้งาน" แทน`
        : null,
    slug:
      usage.variants > 0
        ? `${kind === 'size' ? 'รหัสไซซ์' : 'slug ของสี'}อยู่ในลิงก์ของหน้าร้านและเป็นคำที่ตัวค้นหาใช้ — แก้ได้เฉพาะตอนยังไม่มีตัวเลือกใช้${label}นี้`
        : null,
  };
}
