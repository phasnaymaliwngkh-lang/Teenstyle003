import { getPrisma, Prisma } from '@teenstyle/database';

import { resolveStockStatus } from '../models/product.model.ts';
import { ApiError } from '../utils/api-error.ts';
import { writeAdminLog } from '../models/admin-log.model.ts';
import type {
  AdjustStockInput,
  InventoryListQuery,
  MovementListQuery,
} from '../validators/inventory.validator.ts';

import type { AdminActor } from './product-admin.service.ts';
import { scanAlertsAfterStockChange } from './stock-alert.service.ts';

/**
 * ระบบคลังสินค้าหลังบ้าน (STEP 15)
 *
 * กฎที่ห้ามละเมิด
 *   1. **ห้ามเขียน `Inventory.quantity` โดยไม่มี `InventoryMovement` คู่กัน**
 *      ทุกการเปลี่ยนจำนวนเกิดในทรานแซกชันเดียวพร้อม movement + cache `Product.totalStock`
 *      → ผลรวมของ movement ต้องอธิบายยอดในคลังได้ตลอดเวลา (append-only audit trail)
 *   2. **ห้ามลดจำนวนจนต่ำกว่าของที่ลูกค้าจองไว้** — ของที่ `reservedQuantity` ถืออยู่
 *      เป็นของในออเดอร์ที่ยังไม่จบ ถ้าให้แอดมินตัดทิ้งได้ ออเดอร์นั้นจะส่งของไม่ได้
 *      เงื่อนไขอยู่ใน SQL เดียวกับการอัปเดต (atomic) จึงกัน race condition ได้จริง
 *   3. **ห้ามติดลบ** — มาจากข้อ 2 โดยปริยาย (reserved ≥ 0) + CHECK constraint เป็นด่านสุดท้าย
 *   4. **ปรับซ้ำจากการกดปุ่ม 2 ครั้งต้องไม่มีผล 2 เท่า** — `idempotencyKey` unique ที่ฐานข้อมูล
 *   5. **ทุกการปรับต้องมีเหตุผลและคนทำ** (`reason` + `userId` + AdminLog)
 */

/* ─────────────────────────── รายการสต็อกต่อตัวเลือก ─────────────────────────── */

const INVENTORY_ROW_SELECT = {
  id: true,
  sku: true,
  isActive: true,
  updatedAt: true,
  color: { select: { name: true, slug: true, hex: true } },
  size: { select: { name: true, code: true } },
  inventory: { select: { quantity: true, reservedQuantity: true, location: true } },
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      status: true,
      minimumStock: true,
      category: { select: { name: true, slug: true } },
    },
  },
} as const satisfies Prisma.ProductVariantSelect;

type InventoryRow = Prisma.ProductVariantGetPayload<{ select: typeof INVENTORY_ROW_SELECT }>;

export interface InventoryRowDto {
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

function toInventoryRow(variant: InventoryRow): InventoryRowDto {
  const quantity = variant.inventory?.quantity ?? 0;
  const reserved = variant.inventory?.reservedQuantity ?? 0;
  const available = Math.max(0, quantity - reserved);

  return {
    variantId: variant.id,
    sku: variant.sku,
    isActive: variant.isActive,
    quantity,
    reserved,
    available,
    minimumStock: variant.product.minimumStock,
    // ใช้กฎสถานะสต็อกเดียวกับหน้าร้าน — จุดเตือนตั้งที่ระดับสินค้า ใช้ร่วมกันทุกตัวเลือก
    stockStatus: resolveStockStatus(available, variant.product.minimumStock),
    location: variant.inventory?.location ?? null,
    color: variant.color,
    size: variant.size,
    product: {
      id: variant.product.id,
      name: variant.product.name,
      slug: variant.product.slug,
      sku: variant.product.sku,
      status: String(variant.product.status),
      category: variant.product.category,
    },
    updatedAt: variant.updatedAt.toISOString(),
  };
}

export interface InventorySummary {
  variants: number;
  /** ของในคลังทั้งหมด */
  totalUnits: number;
  reservedUnits: number;
  availableUnits: number;
  outOfStock: number;
  lowStock: number;
}

export interface InventoryListResult {
  items: InventoryRowDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  summary: InventorySummary;
}

/** จำนวนที่ขายได้จริงของ variant หนึ่งตัว (alias ของ Inventory = `i`) */
const VARIANT_AVAILABLE = Prisma.sql`GREATEST(i."quantity" - i."reservedQuantity", 0)`;

function orderByFragment(sort: InventoryListQuery['sort']): Prisma.Sql {
  switch (sort) {
    case 'available-desc':
      return Prisma.sql`${VARIANT_AVAILABLE} DESC, p."name" ASC`;
    case 'product':
      return Prisma.sql`p."name" ASC, v."sku" ASC`;
    case 'updated':
      return Prisma.sql`v."updatedAt" DESC`;
    case 'available-asc':
      // ค่าเริ่มต้น: ของที่ใกล้หมดขึ้นก่อน เพราะเป็นงานที่ต้องจัดการก่อน
      return Prisma.sql`${VARIANT_AVAILABLE} ASC, p."name" ASC`;
  }
}

export async function listInventory(query: InventoryListQuery): Promise<InventoryListResult> {
  const prisma = getPrisma();

  const conditions: Prisma.Sql[] = [
    Prisma.sql`v."deletedAt" IS NULL`,
    Prisma.sql`p."deletedAt" IS NULL`,
  ];

  if (query.q !== undefined && query.q !== '') {
    const pattern = `%${query.q}%`;
    conditions.push(
      Prisma.sql`(p."name" ILIKE ${pattern} OR p."sku" ILIKE ${pattern} OR v."sku" ILIKE ${pattern})`,
    );
  }

  if (query.categorySlug !== undefined) {
    conditions.push(
      Prisma.sql`p."categoryId" = (SELECT id FROM "Category" WHERE "slug" = ${query.categorySlug})`,
    );
  }

  if (query.stockStatus === 'OUT_OF_STOCK') {
    conditions.push(Prisma.sql`${VARIANT_AVAILABLE} = 0`);
  } else if (query.stockStatus === 'LOW_STOCK') {
    conditions.push(
      Prisma.sql`${VARIANT_AVAILABLE} > 0 AND ${VARIANT_AVAILABLE} <= p."minimumStock"`,
    );
  } else if (query.stockStatus === 'IN_STOCK') {
    conditions.push(Prisma.sql`${VARIANT_AVAILABLE} > p."minimumStock"`);
  }

  const where = Prisma.join(conditions, ' AND ');
  const offset = (query.page - 1) * query.limit;

  const [rows, summaryRows] = await Promise.all([
    prisma.$queryRaw<Array<{ id: string; total: bigint }>>(Prisma.sql`
      SELECT v."id", count(*) OVER () AS total
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
      JOIN "Inventory" i ON i."variantId" = v."id"
      WHERE ${where}
      ORDER BY ${orderByFragment(query.sort)}
      LIMIT ${query.limit} OFFSET ${offset}
    `),
    /**
     * สรุปภาพรวมนับจาก **ทุกตัวเลือกที่ยังใช้งานอยู่** ไม่ใช่แค่หน้าที่กำลังดู
     * และไม่ใช้ตัวกรองของผู้ใช้ เพื่อให้ตัวเลขสรุปหมายถึงคลังทั้งร้านเสมอ
     */
    prisma.$queryRaw<
      Array<{
        variants: bigint;
        total_units: bigint | null;
        reserved_units: bigint | null;
        available_units: bigint | null;
        out_of_stock: bigint;
        low_stock: bigint;
      }>
    >(Prisma.sql`
      SELECT count(*)::bigint AS variants,
             sum(i."quantity")::bigint AS total_units,
             sum(i."reservedQuantity")::bigint AS reserved_units,
             sum(${VARIANT_AVAILABLE})::bigint AS available_units,
             count(*) FILTER (WHERE ${VARIANT_AVAILABLE} = 0)::bigint AS out_of_stock,
             count(*) FILTER (
               WHERE ${VARIANT_AVAILABLE} > 0 AND ${VARIANT_AVAILABLE} <= p."minimumStock"
             )::bigint AS low_stock
      FROM "ProductVariant" v
      JOIN "Product" p ON p."id" = v."productId"
      JOIN "Inventory" i ON i."variantId" = v."id"
      WHERE v."deletedAt" IS NULL AND p."deletedAt" IS NULL
    `),
  ]);

  const total = rows.length > 0 ? Number(rows[0]!.total) : 0;
  const ids = rows.map((row) => row.id);

  const variants =
    ids.length === 0
      ? []
      : await prisma.productVariant.findMany({
          where: { id: { in: ids } },
          select: INVENTORY_ROW_SELECT,
        });

  // findMany ไม่รับประกันลำดับตาม in[] จึงเรียงกลับตามที่ SQL จัดไว้
  const rank = new Map(ids.map((id, index) => [id, index]));
  const items = variants
    .map(toInventoryRow)
    .sort((a, b) => (rank.get(a.variantId) ?? 0) - (rank.get(b.variantId) ?? 0));

  const summary = summaryRows[0];

  return {
    items,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
    summary: {
      variants: Number(summary?.variants ?? 0),
      totalUnits: Number(summary?.total_units ?? 0),
      reservedUnits: Number(summary?.reserved_units ?? 0),
      availableUnits: Number(summary?.available_units ?? 0),
      outOfStock: Number(summary?.out_of_stock ?? 0),
      lowStock: Number(summary?.low_stock ?? 0),
    },
  };
}

/* ─────────────────────────── ประวัติการเคลื่อนไหว ─────────────────────────── */

export interface MovementDto {
  id: string;
  type: string;
  /** จำนวนเป็นบวกเสมอ — ทิศทางดูจาก type และ before/after */
  quantity: number;
  quantityBefore: number;
  quantityAfter: number;
  /** ผลต่างจริง (+/-) คำนวณจาก before/after ไม่ใช่เดาจาก type */
  delta: number;
  reason: string;
  referenceType: string | null;
  referenceId: string | null;
  variant: { id: string; sku: string; productName: string; productId: string | null };
  /** ใครทำ — null = ระบบทำเอง (เช่น ตัดสต็อกจาก webhook การชำระเงิน) */
  actor: { id: string; name: string | null; email: string } | null;
  createdAt: string;
}

export interface MovementListResult {
  items: MovementDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export async function listMovements(query: MovementListQuery): Promise<MovementListResult> {
  const prisma = getPrisma();

  const where: Prisma.InventoryMovementWhereInput = {
    ...(query.variantId !== undefined ? { variantId: query.variantId } : {}),
    ...(query.productId !== undefined ? { variant: { productId: query.productId } } : {}),
    ...(query.type !== undefined
      ? { type: query.type as Prisma.EnumInventoryMovementTypeFilter }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.inventoryMovement.count({ where }),
    prisma.inventoryMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: {
        id: true,
        type: true,
        quantity: true,
        quantityBefore: true,
        quantityAfter: true,
        reason: true,
        referenceType: true,
        referenceId: true,
        createdAt: true,
        variant: {
          select: { id: true, sku: true, productId: true, product: { select: { name: true } } },
        },
        user: { select: { id: true, name: true, email: true } },
      },
    }),
  ]);

  return {
    items: rows.map((row) => ({
      id: row.id,
      type: String(row.type),
      quantity: row.quantity,
      quantityBefore: row.quantityBefore,
      quantityAfter: row.quantityAfter,
      delta: row.quantityAfter - row.quantityBefore,
      reason: row.reason,
      referenceType: row.referenceType,
      referenceId: row.referenceId,
      variant: {
        id: row.variant.id,
        sku: row.variant.sku,
        productName: row.variant.product.name,
        productId: row.variant.productId,
      },
      actor: row.user,
      createdAt: row.createdAt.toISOString(),
    })),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
  };
}

/* ─────────────────────────── รายละเอียดต่อตัวเลือก ─────────────────────────── */

export interface VariantInventoryDto {
  inventory: InventoryRowDto;
  movements: MovementDto[];
  /** จำนวนครั้งที่เคยเคลื่อนไหวทั้งหมด — ใช้บอกว่ามีประวัติเก่ากว่านี้อีกไหม */
  movementCount: number;
}

export async function getVariantInventory(variantId: string): Promise<VariantInventoryDto> {
  const variant = await getPrisma().productVariant.findFirst({
    where: { id: variantId, deletedAt: null },
    select: INVENTORY_ROW_SELECT,
  });

  if (!variant) {
    throw ApiError.notFound('ไม่พบตัวเลือกสินค้านี้');
  }

  const history = await listMovements({ variantId, page: 1, limit: 20 });

  return {
    inventory: toInventoryRow(variant),
    movements: history.items,
    movementCount: history.total,
  };
}

/* ─────────────────────────── ปรับสต็อก ─────────────────────────── */

/** ทิศทางและจำนวนที่จะเปลี่ยน คิดจาก input + ยอดปัจจุบัน */
function resolveDelta(input: AdjustStockInput, current: number): number {
  switch (input.type) {
    case 'STOCK_IN':
      return input.quantity;
    case 'STOCK_OUT':
      return -input.quantity;
    case 'ADJUSTMENT':
      return input.countedQuantity - current;
  }
}

export async function adjustStock(
  actor: AdminActor,
  variantId: string,
  input: AdjustStockInput,
): Promise<VariantInventoryDto> {
  const prisma = getPrisma();
  const key = input.idempotencyKey === undefined ? null : `adjust:${input.idempotencyKey}`;

  await prisma.$transaction(async (tx) => {
    const variant = await tx.productVariant.findFirst({
      where: { id: variantId, deletedAt: null },
      select: {
        id: true,
        sku: true,
        productId: true,
        product: { select: { name: true } },
        inventory: { select: { quantity: true, reservedQuantity: true } },
      },
    });

    if (!variant) {
      throw ApiError.notFound('ไม่พบตัวเลือกสินค้านี้');
    }

    if (!variant.inventory) {
      throw ApiError.conflict('ตัวเลือกนี้ยังไม่มีข้อมูลคลัง');
    }

    // กดปุ่มซ้ำด้วยคีย์เดิม → ไม่ทำอะไรเพิ่ม (ผลลัพธ์เท่ากับครั้งแรก)
    if (key !== null) {
      const existing = await tx.inventoryMovement.findUnique({
        where: { idempotencyKey: key },
        select: { id: true },
      });
      if (existing) return;
    }

    const before = variant.inventory.quantity;
    const delta = resolveDelta(input, before);

    if (delta === 0) {
      throw ApiError.badRequest(
        input.type === 'ADJUSTMENT'
          ? `ยอดที่นับได้ตรงกับระบบอยู่แล้ว (${before} ชิ้น) ไม่มีอะไรต้องปรับ`
          : 'จำนวนที่ปรับต้องไม่เป็น 0',
      );
    }

    /**
     * อัปเดตแบบ atomic พร้อมเงื่อนไขในตัวคำสั่ง
     *   `quantity + delta >= reservedQuantity` กันทั้งการติดลบ **และ**
     *   การตัดของที่ลูกค้าจองไว้ในออเดอร์ที่ยังไม่จบ
     * `RETURNING` ให้ยอดหลังอัปเดตจากคำสั่งเดียวกัน จึงไม่มีช่องให้ค่าเปลี่ยนระหว่างอ่าน/เขียน
     * (`updatedAt` ต้องเซ็ตเอง เพราะ @updatedAt ของ Prisma ไม่ทำงานกับ raw SQL)
     */
    const updated = await tx.$queryRaw<Array<{ after: number; reserved: number }>>`
      UPDATE "Inventory"
         SET "quantity" = "quantity" + ${delta},
             "updatedAt" = now()
       WHERE "variantId" = ${variantId}::uuid
         AND "quantity" + ${delta} >= "reservedQuantity"
      RETURNING "quantity" AS after, "reservedQuantity" AS reserved
    `;

    const row = updated[0];

    if (row === undefined) {
      const reserved = variant.inventory.reservedQuantity;

      throw ApiError.conflict(
        reserved > 0
          ? `ลดไม่ได้: มีของ ${reserved} ชิ้นถูกจองไว้ในคำสั่งซื้อที่ยังไม่จบ ` +
              `ยอดในคลังต้องไม่ต่ำกว่านั้น (ปัจจุบัน ${before} ชิ้น)`
          : `ลดไม่ได้: คลังมี ${before} ชิ้น จำนวนหลังปรับจะติดลบ`,
      );
    }

    const after = Number(row.after);

    await tx.inventoryMovement.create({
      data: {
        variantId,
        type: input.type,
        // ฐานข้อมูลบังคับให้ quantity เป็นบวก (CHECK) ทิศทางอ่านจาก before/after
        quantity: Math.abs(delta),
        quantityBefore: before,
        quantityAfter: after,
        reason: input.reason,
        referenceType: 'MANUAL',
        ...(key !== null ? { idempotencyKey: key } : {}),
        userId: actor.id,
      },
    });

    // cache ผลรวมต่อสินค้า ต้องขยับพร้อมกันในทรานแซกชันเดียว
    await tx.product.update({
      where: { id: variant.productId },
      data: { totalStock: { increment: delta } },
    });

    await writeAdminLog(tx, {
      actor,
      action: `inventory.${input.type.toLowerCase()}`,
      targetType: 'Inventory',
      targetId: variantId,
      before: { quantity: before, sku: variant.sku, product: variant.product.name },
      after: { quantity: after, delta, reason: input.reason },
    });
  });

  /**
   * ตรวจเตือนสต็อก **หลังทรานแซกชัน commit แล้ว** (STEP 16)
   * รอให้เสร็จก่อนตอบกลับ เพื่อให้หน้าจอที่โหลดต่อจากนี้เห็นสถานะเดียวกัน
   * ถ้าการแจ้งเตือนล้ม จะถูกกลืนไว้ข้างในแล้ว log — ไม่ทำให้การปรับสต็อกที่สำเร็จแล้วพัง
   */
  await scanAlertsAfterStockChange([variantId]);

  return getVariantInventory(variantId);
}
