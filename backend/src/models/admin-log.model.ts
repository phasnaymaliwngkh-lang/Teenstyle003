import type { Prisma } from '@teenstyle/database';

/**
 * Audit log ของระบบหลังบ้าน (STEP 27)
 *
 * ตาราง `AdminLog` ถูกเขียนมาตั้งแต่ STEP 13 โดยทุก service ที่แก้ข้อมูลสำคัญ
 * STEP 27 คือการทำให้ "อ่านย้อนหลังได้จริง" ซึ่งต้องแก้หนี้ที่สะสมมาก่อน
 *
 * ⚠️⚠️ **`targetType` ถูกเขียนมาด้วยสองรูปแบบสำหรับของชนิดเดียวกัน**
 *    ตรวจข้อมูลจริงในฐานข้อมูลตอนเริ่ม STEP 27 เจอ:
 *      `KnowledgeArticle` 64 แถว · `KNOWLEDGE_ARTICLE` 5 แถว  ← เรื่องเดียวกัน
 *      `PRODUCT` / `INVENTORY` / `ORDER` (ตัวใหญ่)  กับ  `User` / `Review` (ตัวผสม)
 *    ถ้าตัวกรองของหน้า audit เทียบตรง ๆ **แถวอีกครึ่งจะหายไปเงียบ ๆ**
 *    ซึ่งอันตรายกว่าไม่มีหน้า audit เลย เพราะคนอ่านจะเชื่อว่า "ไม่มีใครแตะของชิ้นนี้"
 *
 *    วิธีแก้ที่เลือก
 *      1. **ไม่แก้ข้อมูลเก่า** — audit log เป็น append-only การไป UPDATE ย้อนหลัง
 *         ทำลายคุณค่าทั้งหมดของมัน (กฎเดียวกับประวัติสต็อก STEP 15 ข้อ 7)
 *      2. **ทำให้เป็นมาตรฐานตอนเขียน** — ทุกที่ต้องผ่าน `writeAdminLog()` ซึ่งรับ
 *         `targetType` เป็น union ที่พิมพ์ผิดแล้วคอมไพล์ไม่ผ่าน
 *      3. **รวมชื่อเก่าตอนอ่าน** — ตัวกรองแปลงเป็นรายการ alias ทั้งหมด (`aliasesOf`)
 *         ค่าที่เคยเขียนไว้จึงยังค้นเจอ
 */

/* ────────────────────────── ชนิดของสิ่งที่ถูกแก้ ────────────────────────── */

export const TARGET_TYPES = [
  'Product',
  'Inventory',
  'Order',
  'Review',
  'User',
  'KnowledgeArticle',
  'AIConversation',
] as const;

export type TargetType = (typeof TARGET_TYPES)[number];

interface TargetMeta {
  label: string;
  /** ค่าที่เคยถูกเขียนลงฐานข้อมูลด้วยรูปแบบอื่นสำหรับของชนิดเดียวกัน */
  aliases: readonly string[];
  /**
   * หน้าในระบบหลังบ้านที่เปิดดูของชิ้นนั้นได้
   * `null` = ยังไม่มีหน้ารายตัว → ต้องส่ง `link: null` กลับไป
   * **ห้ามเดาลิงก์** (กฎเดียวกับ `resolveNotificationLink` ของ STEP 24 ข้อ 10)
   */
  hrefPrefix: string | null;
}

const TARGET_META: Readonly<Record<TargetType, TargetMeta>> = {
  Product: { label: 'สินค้า', aliases: ['PRODUCT'], hrefPrefix: '/admin/products/' },
  Inventory: { label: 'คลังสินค้า', aliases: ['INVENTORY'], hrefPrefix: '/admin/inventory/' },
  // คำสั่งซื้อเก็บ targetId เป็น id แต่หน้าเว็บใช้ orderNumber — service แปลงให้ทีหลัง
  Order: { label: 'คำสั่งซื้อ', aliases: ['ORDER'], hrefPrefix: null },
  Review: { label: 'รีวิวสินค้า', aliases: ['REVIEW'], hrefPrefix: null },
  User: { label: 'บัญชีผู้ใช้', aliases: ['USER'], hrefPrefix: '/admin/customers/' },
  KnowledgeArticle: {
    label: 'คลังความรู้ AI',
    aliases: ['KNOWLEDGE_ARTICLE'],
    hrefPrefix: null,
  },
  AIConversation: {
    label: 'แชตบริการลูกค้า',
    aliases: ['AI_CONVERSATION'],
    hrefPrefix: null,
  },
};

/** ทุกชื่อที่เคยใช้แทนชนิดนี้ — ใช้กับ `where.targetType.in` ตอนกรอง */
export function aliasesOf(type: TargetType): string[] {
  return [type, ...TARGET_META[type].aliases];
}

/** แปลงค่าที่อ่านจากฐานข้อมูลให้เป็นชนิดมาตรฐาน — ไม่รู้จักคืน null (ไม่เดา) */
export function canonicalTargetType(raw: string | null): TargetType | null {
  if (raw === null) return null;

  for (const type of TARGET_TYPES) {
    if (raw === type || TARGET_META[type].aliases.includes(raw)) return type;
  }

  return null;
}

export function targetLabelOf(type: TargetType | null, raw: string | null): string {
  if (type === null) return raw ?? 'ไม่ระบุ';
  return TARGET_META[type].label;
}

/* ────────────────────────── การกระทำ ────────────────────────── */

/**
 * ชื่อการกระทำทั้งหมดที่ระบบเขียนได้ พร้อมคำอธิบายภาษาไทย
 *
 * ⚠️ `inventory.*` มีค่าตาม enum `InventoryMovementType` เพราะ service สร้างชื่อจาก
 *    `input.type.toLowerCase()` — เพิ่มค่าใน enum แล้วต้องมาเพิ่มที่นี่ด้วย
 *    (ค่าที่ไม่มีในรายการนี้จะถูกแสดงด้วยชื่อดิบ ไม่ใช่ซ่อนทิ้ง)
 */
export const ACTION_LABELS: Readonly<Record<string, string>> = {
  'product.create': 'เพิ่มสินค้าใหม่',
  'product.update': 'แก้ไขข้อมูลสินค้า',
  'product.delete': 'ลบสินค้า (ซ่อนจากหน้าร้าน)',
  'product.variant.create': 'เพิ่มตัวเลือกสินค้า',
  'product.variant.update': 'แก้ไขตัวเลือกสินค้า',
  'product.variant.barcode.assign': 'ออกบาร์โค้ดให้ตัวเลือกสินค้า',
  'product.import': 'นำเข้าสินค้าจากไฟล์',
  'inventory.stock_in': 'รับสินค้าเข้าคลัง',
  'inventory.stock_out': 'ตัดสินค้าออกจากคลัง',
  'inventory.adjustment': 'ปรับยอดตามการตรวจนับ',
  'inventory.return': 'รับคืนสินค้าเข้าคลัง',
  'inventory.transfer': 'ย้ายสินค้าระหว่างคลัง',
  'inventory.import_adjust': 'ปรับสต็อกจากไฟล์',
  'order.status.update': 'เปลี่ยนสถานะคำสั่งซื้อ',
  'review.moderate': 'ตรวจรีวิวสินค้า',
  'knowledge.create': 'เพิ่มบทความคลังความรู้',
  'knowledge.update': 'แก้ไขบทความคลังความรู้',
  'knowledge.delete': 'ลบบทความคลังความรู้',
  'knowledge.reset': 'รีเซ็ตคลังความรู้เป็นค่าตั้งต้น',
  'support.ticket.assign': 'รับเรื่องจากลูกค้า',
  'support.ticket.reply': 'ตอบลูกค้าในนามเจ้าหน้าที่',
  'support.ticket.status': 'เปลี่ยนสถานะเคสบริการลูกค้า',
  'customer.status.update': 'เปลี่ยนสถานะบัญชีผู้ใช้',
  'customer.role.update': 'เปลี่ยนบทบาทและสิทธิ์',
};

/** กลุ่มของการกระทำ — ใช้ทำตัวกรองระดับหยาบ (`action` ขึ้นต้นด้วยอะไร) */
export const ACTION_GROUPS = [
  'product',
  'inventory',
  'order',
  'review',
  'knowledge',
  'support',
  'customer',
] as const;

export type ActionGroup = (typeof ACTION_GROUPS)[number];

export const ACTION_GROUP_LABELS: Readonly<Record<ActionGroup, string>> = {
  product: 'สินค้า',
  inventory: 'คลังสินค้า',
  order: 'คำสั่งซื้อ',
  review: 'รีวิว',
  knowledge: 'คลังความรู้ AI',
  support: 'บริการลูกค้า',
  customer: 'บัญชีผู้ใช้',
};

/** คำอธิบายของ action — ค่าที่ไม่รู้จักคืนชื่อดิบ (ดีกว่าแสดงว่าง ๆ หรือเดาความหมาย) */
export function actionLabelOf(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/* ────────────────────────── ตัวเขียน log ────────────────────────── */

export interface AdminLogActor {
  /**
   * `null`/`undefined` = ระบบเป็นคนทำ ไม่ใช่พนักงานคนใดคนหนึ่ง
   * คอลัมน์ `AdminLog.userId` เป็น nullable อยู่แล้ว จึงบันทึกได้ตามจริง
   * **ห้ามใส่ค่าปลอมเพื่อให้ช่องไม่ว่าง** — log ที่ระบุคนผิดแย่กว่า log ที่บอกว่าไม่รู้
   */
  id?: string | null | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface WriteAdminLogInput {
  actor: AdminLogActor;
  action: keyof typeof ACTION_LABELS | (string & {});
  targetType: TargetType;
  /**
   * `null` = การกระทำระดับทั้งระบบที่ไม่ได้เจาะจงของชิ้นไหน (เช่น รีเซ็ตคลังความรู้ทั้งชุด)
   * ส่วนการนำเข้าเป็นชุดใช้ค่า `'BATCH'` ซึ่งเป็นค่าที่เขียนไว้แต่เดิม — คงไว้เพื่อไม่ให้
   * ความหมายของประวัติเก่ากับใหม่ต่างกัน และหน้าเว็บแปลค่านี้เป็นข้อความอ่านออกให้
   */
  targetId?: string | null;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
}

/**
 * เขียน audit log — **ทุกที่ต้องเรียกผ่านฟังก์ชันนี้**
 *
 * ⚠️ ต้องเรียก **ในทรานแซกชันเดียวกับการเปลี่ยนข้อมูล** เสมอ (รับ `tx` ไม่ใช่ prisma)
 *    ไม่งั้นจะมีกรณีที่ข้อมูลเปลี่ยนแล้วแต่ log ไม่ถูกเขียน ซึ่งคือช่องว่างในประวัติ
 *    ที่ตรวจย้อนหลังไม่ได้ว่าใครทำ (กฎ STEP 13 ข้อ 5 · 14 ข้อ 8 · 15 ข้อ 2 · 21 ข้อ 7)
 *
 * ⚠️ `targetType` เป็น union จึงพิมพ์ผิดแล้วคอมไพล์ไม่ผ่าน — นี่คือสิ่งที่กัน
 *    ไม่ให้เกิดชื่อซ้ำซ้อนแบบ `KNOWLEDGE_ARTICLE` vs `KnowledgeArticle` อีก
 */
export async function writeAdminLog(
  tx: Prisma.TransactionClient,
  input: WriteAdminLogInput,
): Promise<void> {
  await tx.adminLog.create({
    data: {
      userId: input.actor.id ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      ...(input.before !== undefined && input.before !== null ? { before: input.before } : {}),
      ...(input.after !== undefined && input.after !== null ? { after: input.after } : {}),
      ...(input.actor.ip !== undefined ? { ipAddress: input.actor.ip } : {}),
      ...(input.actor.userAgent !== undefined ? { userAgent: input.actor.userAgent } : {}),
    },
  });
}

/* ────────────────────────── การเทียบก่อน/หลัง ────────────────────────── */

export interface FieldChangeDto {
  field: string;
  before: string | null;
  after: string | null;
}

function toDisplayValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  return JSON.stringify(value);
}

function asRecord(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * ช่องที่เปลี่ยนจริงระหว่าง `before` กับ `after`
 *
 * ⚠️ นี่คือเหตุผลหลักที่หน้า audit มีประโยชน์ — การโยน JSON สองก้อนให้คนอ่านเทียบเอง
 *    แปลว่าไม่มีใครอ่านจริง ๆ · คำนวณที่ server เพื่อให้ไฟล์ที่ส่งออกได้ผลเดียวกับหน้าจอ
 *
 * ⚠️⚠️ **ช่องที่ "ไม่มีใน `after`" ไม่ได้แปลว่าถูกล้างค่า — แปลว่าไม่ได้ถูกรายงาน**
 *    เจอจริงตอนตรวจ STEP 27 กับข้อมูลจริง: `product.update` เก็บ `before` เป็นสแนปช็อต
 *    เต็ม (ชื่อ · ราคา · SKU · สถานะ) แต่ `after` เก็บเฉพาะช่องที่ผู้ใช้ส่งมาแก้
 *    การเทียบแบบเดิมจึงรายงานว่า **"ชื่อสินค้าถูกล้างเป็นค่าว่าง"** ทั้งที่ไม่มีใครแตะชื่อเลย
 *    — audit log ที่พูดสิ่งที่ไม่จริงแย่กว่าไม่มี audit log
 *
 *    กฎที่ถูกต้อง: ช่องจะถูกนับว่าเปลี่ยนก็ต่อเมื่อ **มีคีย์นั้นอยู่ใน `after` จริง ๆ**
 *    (ค่าจะเป็น `null` ก็ได้ ซึ่งแปลว่า "ล้างค่า" อย่างชัดเจน)
 *    ส่วนคีย์ที่มีแต่ใน `before` จะถูกข้าม เพราะบันทึกไม่ได้บอกว่าค่าใหม่คืออะไร
 *
 * บันทึกที่ `before`/`after` ไม่ใช่ object (เช่นเก็บเป็นข้อความล้วน) คืนรายการว่าง
 * แล้วให้หน้าเว็บแสดงค่าดิบแทน — ดีกว่าแกล้งทำเป็นว่าเทียบได้
 */
export function diffFields(
  before: Prisma.JsonValue | null,
  after: Prisma.JsonValue | null,
): FieldChangeDto[] {
  const beforeRecord = asRecord(before);
  const afterRecord = asRecord(after);

  if (afterRecord === null) return [];

  const changes: FieldChangeDto[] = [];

  for (const key of Object.keys(afterRecord).sort()) {
    const next = toDisplayValue(afterRecord[key]);
    const hadBefore =
      beforeRecord !== null && Object.prototype.hasOwnProperty.call(beforeRecord, key);
    const previous = hadBefore ? toDisplayValue(beforeRecord[key]) : null;

    // ค่าเดิมกับค่าใหม่เท่ากัน และบันทึกมีค่าเดิมให้เทียบ → ไม่ถือว่าเปลี่ยน
    if (hadBefore && previous === next) continue;

    changes.push({ field: key, before: previous, after: next });
  }

  return changes;
}

/* ────────────────────────── DTO ────────────────────────── */

export const ADMIN_LOG_SELECT = {
  id: true,
  action: true,
  targetType: true,
  targetId: true,
  before: true,
  after: true,
  ipAddress: true,
  userAgent: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true, role: { select: { name: true } } } },
} satisfies Prisma.AdminLogSelect;

type AdminLogRow = Prisma.AdminLogGetPayload<{ select: typeof ADMIN_LOG_SELECT }>;

export interface AdminLogDto {
  id: string;
  action: string;
  actionLabel: string;
  /** กลุ่มของการกระทำ — null เมื่อชื่อ action ไม่เข้ากลุ่มไหน */
  group: ActionGroup | null;
  targetType: TargetType | null;
  targetTypeLabel: string;
  /** ค่าดิบที่เก็บไว้จริง — เก็บไว้เพื่อให้ตรวจสอบย้อนหลังได้ว่าตอนนั้นเขียนว่าอะไร */
  rawTargetType: string | null;
  targetId: string | null;
  /** ลิงก์ไปดูของชิ้นนั้น — null = ยังไม่มีหน้ารายตัว (ห้ามเดาลิงก์) */
  link: string | null;
  actor: {
    id: string | null;
    name: string | null;
    email: string;
    role: string | null;
  };
  changes: FieldChangeDto[];
  /** ค่าดิบของ before/after สำหรับกรณีที่เทียบเป็นช่อง ๆ ไม่ได้ */
  before: Prisma.JsonValue | null;
  after: Prisma.JsonValue | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

function groupOf(action: string): ActionGroup | null {
  return ACTION_GROUPS.find((group) => action.startsWith(`${group}.`)) ?? null;
}

/**
 * แปลงแถว log เป็น DTO
 *
 * ⚠️ **`userId` เป็น nullable และ FK เป็น `onDelete: SetNull`**
 *    พนักงานที่ถูกลบบัญชีไปแล้ว log ยังอยู่แต่ไม่มีเจ้าของ (ข้อมูลจริงในฐานข้อมูลตอนนี้
 *    เป็นแบบนี้ทั้ง 123 แถว เพราะเป็นบัญชีทดสอบที่ถูกลบ)
 *    → ต้องแสดงว่า **"บัญชีถูกลบแล้ว"** ไม่ใช่ซ่อนแถวทิ้งหรือแสดงช่องว่าง
 *    การซ่อนแถวคือการทำให้ประวัติหาย ซึ่งตรงข้ามกับหน้าที่ของ audit log
 *
 * @param orderNumberById เลขคำสั่งซื้อที่ service หามาให้ (targetId ของออเดอร์เป็น id ไม่ใช่เลขที่โชว์)
 */
export function toAdminLogDto(
  row: AdminLogRow,
  orderNumberById: Map<string, string> = new Map(),
): AdminLogDto {
  const targetType = canonicalTargetType(row.targetType);
  const meta = targetType === null ? null : TARGET_META[targetType];

  let link: string | null = null;
  if (row.targetId !== null) {
    if (targetType === 'Order') {
      const orderNumber = orderNumberById.get(row.targetId);
      link = orderNumber === undefined ? null : `/admin/orders/${orderNumber}`;
    } else if (meta?.hrefPrefix != null) {
      link = `${meta.hrefPrefix}${row.targetId}`;
    }
  }

  return {
    id: row.id,
    action: row.action,
    actionLabel: actionLabelOf(row.action),
    group: groupOf(row.action),
    targetType,
    targetTypeLabel: targetLabelOf(targetType, row.targetType),
    rawTargetType: row.targetType,
    targetId: row.targetId,
    link,
    actor: {
      id: row.user?.id ?? null,
      name: row.user?.name ?? null,
      email: row.user?.email ?? '(บัญชีถูกลบแล้ว)',
      role: row.user?.role.name ?? null,
    },
    changes: diffFields(row.before, row.after),
    before: row.before,
    after: row.after,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    createdAt: row.createdAt.toISOString(),
  };
}
