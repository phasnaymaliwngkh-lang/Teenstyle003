import type { CatalogBlockers, CatalogCategory, CatalogKind, CatalogOverview } from "@/types/admin";

/**
 * กฎของฟอร์มหมวดหมู่ · แบรนด์ · ไซซ์ · สี (STEP 48) — **เพื่อ UX เท่านั้น**
 * backend ตรวจซ้ำทุกข้อ (backend/src/validators/catalog-admin.validator.ts + service)
 * และเหตุผลที่ "ทำไม่ได้" (ปิด/ลบ/แก้ slug) มาจาก server ใน `blockers` ไม่ได้คิดที่นี่
 */

export const CATALOG_TABS: ReadonlyArray<{ kind: CatalogKind; label: string; noun: string }> = [
  { kind: "categories", label: "หมวดหมู่", noun: "หมวดหมู่" },
  { kind: "brands", label: "แบรนด์", noun: "แบรนด์" },
  { kind: "sizes", label: "ไซซ์", noun: "ไซซ์" },
  { kind: "colors", label: "สี", noun: "สี" },
];

export function nounOf(kind: CatalogKind): string {
  return CATALOG_TABS.find((tab) => tab.kind === kind)?.noun ?? "รายการ";
}

export interface CatalogRow {
  id: string;
  name: string;
  /** slug (หมวด/แบรนด์/สี) หรือรหัส (ไซซ์) */
  key: string;
  isActive: boolean;
  blockers: CatalogBlockers;
  usage: string;
  /** 1 = หมวดย่อย (แสดงเยื้อง) */
  depth: 0 | 1;
  description: string | null;
  parentId: string | null;
  hex: string | null;
  /** กลุ่มที่เรียงลำดับร่วมกัน — null = เรียงไม่ได้ (แบรนด์เรียงตามชื่อ) */
  group: string | null;
  hasChildren: boolean;
}

function categoryUsage(row: CatalogCategory): string {
  const parts = [`ขายอยู่ ${row.usage.activeProducts} ชิ้น`, `ทั้งหมด ${row.usage.products} ชิ้น`];
  if (row.parentId === null) parts.push(`หมวดย่อย ${row.usage.children}`);
  if (row.usage.coupons > 0) parts.push(`คูปอง ${row.usage.coupons} ใบ`);
  return parts.join(" · ");
}

export function catalogRows(overview: CatalogOverview, kind: CatalogKind): CatalogRow[] {
  const base = {
    description: null,
    parentId: null,
    hex: null,
    hasChildren: false,
    depth: 0 as const,
  };

  switch (kind) {
    case "categories":
      return overview.categories.map((row) => ({
        ...base,
        id: row.id,
        name: row.name,
        key: row.slug,
        isActive: row.isActive,
        blockers: row.blockers,
        usage: categoryUsage(row),
        depth: row.parentId === null ? 0 : 1,
        description: row.description,
        parentId: row.parentId,
        group: row.parentId ?? "root",
        hasChildren: row.usage.children > 0,
      }));
    case "brands":
      return overview.brands.map((row) => ({
        ...base,
        id: row.id,
        name: row.name,
        key: row.slug,
        isActive: row.isActive,
        blockers: row.blockers,
        usage: `ขายอยู่ ${row.usage.activeProducts} ชิ้น · ทั้งหมด ${row.usage.products} ชิ้น`,
        description: row.description,
        group: null,
      }));
    case "sizes":
      return overview.sizes.map((row) => ({
        ...base,
        id: row.id,
        name: row.name,
        key: row.code,
        isActive: row.isActive,
        blockers: row.blockers,
        usage: `ตัวเลือกที่ขายอยู่ ${row.usage.sellingVariants} · ทั้งหมด ${row.usage.variants}`,
        group: "all",
      }));
    case "colors":
      return overview.colors.map((row) => ({
        ...base,
        id: row.id,
        name: row.name,
        key: row.slug,
        isActive: row.isActive,
        blockers: row.blockers,
        usage: `ตัวเลือกที่ขายอยู่ ${row.usage.sellingVariants} · ทั้งหมด ${row.usage.variants}`,
        hex: row.hex,
        group: "all",
      }));
  }
}

export interface CatalogFormValues {
  name: string;
  /** slug ของหมวด/แบรนด์/สี หรือรหัสของไซซ์ */
  key: string;
  description: string;
  /** "" = หมวดระดับบนสุด */
  parentId: string;
  hex: string;
}

export function emptyCatalogValues(): CatalogFormValues {
  return { name: "", key: "", description: "", parentId: "", hex: "#7C3AED" };
}

export function valuesOf(row: CatalogRow): CatalogFormValues {
  return {
    name: row.name,
    key: row.key,
    description: row.description ?? "",
    parentId: row.parentId ?? "",
    hex: row.hex ?? "#7C3AED",
  };
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODE = /^[A-Z0-9]+(?:-[A-Z0-9]+)*$/;
const HEX = /^#?[0-9A-Fa-f]{6}$/;

/** ตรวจก่อนส่ง — ข้อความเดียวกับที่ backend ตอบ ผู้ใช้จึงเห็นคำอธิบายแบบเดียวกันทุกที่ */
export function checkCatalogValues(kind: CatalogKind, values: CatalogFormValues): string | null {
  if (values.name.trim() === "") return `กรุณาใส่ชื่อ${nounOf(kind)}`;

  if (kind === "sizes") {
    if (!CODE.test(values.key.trim().toUpperCase())) {
      return "รหัสไซซ์ใช้ได้เฉพาะ A-Z ตัวเลข และขีดกลาง เช่น M, XL, EU36";
    }
  } else if (!SLUG.test(values.key.trim().toLowerCase()) || values.key.trim().length < 2) {
    return "slug ใช้ได้เฉพาะ a-z ตัวเลข และขีดกลางคั่นคำ เช่น oversize-tee";
  }

  if (kind === "colors" && !HEX.test(values.hex.trim())) {
    return "ค่าสีต้องเป็นรูปแบบ #RRGGBB เช่น #7C3AED";
  }

  return null;
}

/** ค่าที่ส่งตอนสร้าง — ส่งเฉพาะช่องที่ชนิดนั้นมีจริง */
export function toCreateBody(
  kind: CatalogKind,
  values: CatalogFormValues,
): Record<string, unknown> {
  const name = values.name.trim();
  const key = values.key.trim();
  const description = values.description.trim();

  switch (kind) {
    case "categories":
      return {
        name,
        slug: key,
        ...(description !== "" ? { description } : {}),
        parentId: values.parentId === "" ? null : values.parentId,
      };
    case "brands":
      return { name, slug: key, ...(description !== "" ? { description } : {}) };
    case "sizes":
      return { name, code: key };
    case "colors":
      return { name, slug: key, hex: values.hex.trim() };
  }
}

/**
 * ค่าที่ส่งตอนแก้ — **เฉพาะช่องที่เปลี่ยนจริง** (กฎเดียวกับฟอร์มสินค้า STEP 14 ข้อ 6)
 * ส่ง slug เดิมกลับไปทั้งที่ไม่ได้แก้ จะถูกปฏิเสธเมื่อหมวดมีสินค้าแล้ว ทั้งที่ผู้ใช้แค่แก้ชื่อ
 */
export function toUpdateBody(
  kind: CatalogKind,
  values: CatalogFormValues,
  row: CatalogRow,
): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const name = values.name.trim();
  const key = kind === "sizes" ? values.key.trim().toUpperCase() : values.key.trim().toLowerCase();
  const description = values.description.trim();

  if (name !== row.name) body["name"] = name;
  if (key !== row.key) body[kind === "sizes" ? "code" : "slug"] = key;

  if ((kind === "categories" || kind === "brands") && description !== (row.description ?? "")) {
    body["description"] = description === "" ? null : description;
  }

  if (kind === "categories") {
    const parentId = values.parentId === "" ? null : values.parentId;
    if (parentId !== row.parentId) body["parentId"] = parentId;
  }

  if (kind === "colors") {
    const hex = values.hex.trim().toUpperCase();
    const normalized = hex.startsWith("#") ? hex : `#${hex}`;
    if (normalized !== row.hex) body["hex"] = normalized;
  }

  return body;
}

/** ลำดับใหม่ของกลุ่มเมื่อเลื่อนรายการหนึ่งขึ้น/ลง — ส่งครบทุกรายการในกลุ่มเสมอ */
export function moveWithinGroup(
  rows: CatalogRow[],
  id: string,
  direction: -1 | 1,
): string[] | null {
  const row = rows.find((candidate) => candidate.id === id);
  if (!row || row.group === null) return null;

  const group = rows
    .filter((candidate) => candidate.group === row.group)
    .map((candidate) => candidate.id);
  const index = group.indexOf(id);
  const target = index + direction;

  if (target < 0 || target >= group.length) return null;

  [group[index], group[target]] = [group[target]!, group[index]!];
  return group;
}
