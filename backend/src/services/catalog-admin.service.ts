import { getPrisma, Prisma } from '@teenstyle/database';

import { writeAdminLog, type AdminLogActor, type TargetType } from '../models/admin-log.model.ts';
import {
  brandBlockers,
  categoryBlockers,
  checkCategoryParent,
  deletedName,
  deletedSlug,
  variantOptionBlockers,
  type BrandUsage,
  type CatalogBlockers,
  type CategoryUsage,
  type VariantUsage,
} from '../models/catalog.model.ts';
import { ApiError } from '../utils/api-error.ts';
import type {
  CreateBrandInput,
  CreateCategoryInput,
  CreateColorInput,
  CreateSizeInput,
  UpdateBrandInput,
  UpdateCategoryInput,
  UpdateColorInput,
  UpdateSizeInput,
} from '../validators/catalog-admin.validator.ts';

/**
 * หมวดหมู่ · แบรนด์ · ไซซ์ · สี ในหลังบ้าน (STEP 48)
 *
 * **กฎที่ห้ามละเมิด** (เหตุผลเต็มอยู่ที่ models/catalog.model.ts และ docs/21-catalog.md)
 *
 * 1. สินค้าที่เปิดขายใช้ได้เฉพาะของที่เปิดใช้อยู่ → ปิด/ลบของที่สินค้าขายอยู่ใช้ไม่ได้ (409 + เหตุผล)
 *    ฝั่งผูกของกับสินค้าตรวจที่ catalog-guard.ts — ทั้งสองฝั่งล็อกแถวเดียวกัน
 * 2. หมวดซ้อนได้ 2 ชั้นเท่านั้น (หน้าร้านกรองหมวด + หมวดย่อยชั้นเดียว)
 * 3. slug/รหัสอยู่ในลิงก์ของหน้าร้าน → แก้ได้เฉพาะตอนยังไม่มีสินค้า/ตัวเลือกใช้
 * 4. ลบหมวด/แบรนด์ = soft delete + คืน slug (และชื่อแบรนด์) ให้ใช้ใหม่ได้ ·
 *    ลบสี/ไซซ์ = ลบจริง ได้เฉพาะตอนไม่มีตัวเลือกไหนอ้างถึงเลย (FK เป็น Restrict เป็นด่านสุดท้าย)
 * 5. ทุกการเปลี่ยนเขียน AdminLog ในทรานแซกชันเดียวกัน · ล็อกแถว `FOR UPDATE` ก่อนนับการใช้งาน
 */

type Tx = Prisma.TransactionClient;

/* ─────────────────────────── DTO ─────────────────────────── */

interface CatalogRowBase {
  id: string;
  name: string;
  isActive: boolean;
  blockers: CatalogBlockers;
}

export interface CategoryAdminDto extends CatalogRowBase {
  slug: string;
  description: string | null;
  parentId: string | null;
  sortOrder: number;
  usage: CategoryUsage;
}

export interface BrandAdminDto extends CatalogRowBase {
  slug: string;
  description: string | null;
  usage: BrandUsage;
}

export interface SizeAdminDto extends CatalogRowBase {
  code: string;
  sortOrder: number;
  usage: VariantUsage;
}

export interface ColorAdminDto extends CatalogRowBase {
  slug: string;
  hex: string;
  sortOrder: number;
  usage: VariantUsage;
}

export interface CatalogOverviewDto {
  /** หมวดบนสุดเรียงตาม sortOrder แล้วตามด้วยหมวดย่อยของแต่ละหมวด */
  categories: CategoryAdminDto[];
  brands: BrandAdminDto[];
  sizes: SizeAdminDto[];
  colors: ColorAdminDto[];
}

/* ─────────────────────────── การใช้งาน ─────────────────────────── */

/** จำนวนสินค้า (ไม่นับที่ลบ) และที่เปิดขาย แยกตามคอลัมน์ที่ระบุ — groupBy รอบเดียว */
async function productCountsBy(
  db: Tx | ReturnType<typeof getPrisma>,
  column: 'categoryId' | 'brandId',
): Promise<Map<string, { products: number; activeProducts: number }>> {
  const rows = await db.product.groupBy({
    by: [column, 'status'],
    where: { deletedAt: null },
    _count: { _all: true },
  });

  const counts = new Map<string, { products: number; activeProducts: number }>();
  for (const row of rows) {
    const id = row[column];
    if (id === null) continue;
    const entry = counts.get(id) ?? { products: 0, activeProducts: 0 };
    entry.products += row._count._all;
    if (row.status === 'ACTIVE') entry.activeProducts += row._count._all;
    counts.set(id, entry);
  }

  return counts;
}

/**
 * จำนวนตัวเลือกที่อ้างถึงสี/ไซซ์ — นับรวมที่ปิด/ลบไปแล้ว (FK ยังอ้างถึง) และที่เปิดขายจริง
 * GROUP BY รอบเดียว ไม่ใช่ subquery ต่อแถว (กฎ STEP 34 ข้อ 1)
 */
async function variantCountsBy(
  db: Tx | ReturnType<typeof getPrisma>,
  column: 'colorId' | 'sizeId',
  onlyId?: string,
): Promise<Map<string, VariantUsage>> {
  const col = Prisma.raw(`v."${column}"`);
  const rows = await db.$queryRaw<
    Array<{ id: string; variants: bigint; selling: bigint }>
  >(Prisma.sql`
    SELECT ${col} AS id,
           count(*) AS variants,
           count(*) FILTER (
             WHERE v."deletedAt" IS NULL AND v."isActive"
               AND p."deletedAt" IS NULL AND p."status" = 'ACTIVE'
           ) AS selling
    FROM "ProductVariant" v
    JOIN "Product" p ON p."id" = v."productId"
    WHERE ${col} IS NOT NULL ${onlyId === undefined ? Prisma.empty : Prisma.sql`AND ${col} = ${onlyId}::uuid`}
    GROUP BY ${col}
  `);

  return new Map(
    rows.map((row) => [
      row.id,
      { variants: Number(row.variants), sellingVariants: Number(row.selling) },
    ]),
  );
}

async function couponCountsByCategory(
  db: Tx | ReturnType<typeof getPrisma>,
): Promise<Map<string, number>> {
  const coupons = await db.coupon.findMany({
    where: { deletedAt: null },
    select: { categories: { select: { id: true } } },
  });

  const counts = new Map<string, number>();
  for (const coupon of coupons) {
    for (const category of coupon.categories) {
      counts.set(category.id, (counts.get(category.id) ?? 0) + 1);
    }
  }

  return counts;
}

async function categoryUsageOf(tx: Tx, id: string): Promise<CategoryUsage> {
  const [products, activeProducts, children, activeChildren, coupons] = await Promise.all([
    tx.product.count({ where: { categoryId: id, deletedAt: null } }),
    tx.product.count({ where: { categoryId: id, deletedAt: null, status: 'ACTIVE' } }),
    tx.category.count({ where: { parentId: id, deletedAt: null } }),
    tx.category.count({ where: { parentId: id, deletedAt: null, isActive: true } }),
    tx.coupon.count({ where: { deletedAt: null, categories: { some: { id } } } }),
  ]);

  return { products, activeProducts, children, activeChildren, coupons };
}

async function brandUsageOf(tx: Tx, id: string): Promise<BrandUsage> {
  const [products, activeProducts] = await Promise.all([
    tx.product.count({ where: { brandId: id, deletedAt: null } }),
    tx.product.count({ where: { brandId: id, deletedAt: null, status: 'ACTIVE' } }),
  ]);

  return { products, activeProducts };
}

async function variantUsageOf(
  tx: Tx,
  column: 'colorId' | 'sizeId',
  id: string,
): Promise<VariantUsage> {
  return (await variantCountsBy(tx, column, id)).get(id) ?? { variants: 0, sellingVariants: 0 };
}

/* ─────────────────────────── ภาพรวม (อ่านอย่างเดียว) ─────────────────────────── */

export async function getCatalogOverview(): Promise<CatalogOverviewDto> {
  const prisma = getPrisma();

  const [
    categories,
    brands,
    sizes,
    colors,
    byCategory,
    byBrand,
    couponsByCategory,
    byColor,
    bySize,
  ] = await Promise.all([
    prisma.category.findMany({
      where: { deletedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        parentId: true,
        sortOrder: true,
        isActive: true,
      },
    }),
    prisma.brand.findMany({
      where: { deletedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true, description: true, isActive: true },
    }),
    prisma.size.findMany({
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: { id: true, name: true, code: true, sortOrder: true, isActive: true },
    }),
    prisma.color.findMany({
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, slug: true, hex: true, sortOrder: true, isActive: true },
    }),
    productCountsBy(prisma, 'categoryId'),
    productCountsBy(prisma, 'brandId'),
    couponCountsByCategory(prisma),
    variantCountsBy(prisma, 'colorId'),
    variantCountsBy(prisma, 'sizeId'),
  ]);

  const childrenOf = (id: string) => categories.filter((row) => row.parentId === id);

  const toCategory = (row: (typeof categories)[number]): CategoryAdminDto => {
    const children = childrenOf(row.id);
    const counts = byCategory.get(row.id) ?? { products: 0, activeProducts: 0 };
    const usage: CategoryUsage = {
      ...counts,
      children: children.length,
      activeChildren: children.filter((child) => child.isActive).length,
      coupons: couponsByCategory.get(row.id) ?? 0,
    };

    return { ...row, usage, blockers: categoryBlockers(usage) };
  };

  // หมวดบนสุดตามลำดับ แล้วตามด้วยหมวดย่อยของมัน — หน้าเว็บแสดงเป็นต้นไม้ได้เลย
  const ordered = categories
    .filter((row) => row.parentId === null)
    .flatMap((root) => [root, ...childrenOf(root.id)]);

  return {
    categories: ordered.map(toCategory),
    brands: brands.map((row) => {
      const usage = byBrand.get(row.id) ?? { products: 0, activeProducts: 0 };
      return { ...row, usage, blockers: brandBlockers(usage) };
    }),
    sizes: sizes.map((row) => {
      const usage = bySize.get(row.id) ?? { variants: 0, sellingVariants: 0 };
      return { ...row, usage, blockers: variantOptionBlockers('size', usage) };
    }),
    colors: colors.map((row) => {
      const usage = byColor.get(row.id) ?? { variants: 0, sellingVariants: 0 };
      return { ...row, usage, blockers: variantOptionBlockers('color', usage) };
    }),
  };
}

/* ─────────────────────────── ตัวช่วยร่วม ─────────────────────────── */

const LOCKABLE = {
  Category: Prisma.raw('"Category"'),
  Brand: Prisma.raw('"Brand"'),
  Size: Prisma.raw('"Size"'),
  Color: Prisma.raw('"Color"'),
} as const;

/** ล็อกแถวก่อนนับการใช้งาน — คนที่ผูกของกับสินค้าพร้อมกันต้องรอ (คู่กับ FOR SHARE ใน catalog-guard) */
async function lockRow(tx: Tx, table: keyof typeof LOCKABLE, id: string): Promise<void> {
  const softDelete = table === 'Category' || table === 'Brand';
  const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT "id" FROM ${LOCKABLE[table]}
    WHERE "id" = ${id}::uuid ${softDelete ? Prisma.sql`AND "deletedAt" IS NULL` : Prisma.empty}
    FOR UPDATE
  `);

  if (rows.length === 0) {
    throw ApiError.notFound('ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)');
  }
}

const FIELD_LABEL: Record<string, string> = {
  slug: 'slug นี้',
  name: 'ชื่อนี้',
  code: 'รหัสไซซ์นี้',
};

/**
 * unique ชนกัน (P2002) → 409 ที่บอกว่าช่องไหนซ้ำ
 * ตรวจล่วงหน้าแล้วก็ยังต้องมี — สองคนสร้างชื่อเดียวกันพร้อมกันได้ ฐานข้อมูลคือด่านสุดท้าย
 */
function rethrowUnique(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const detail = JSON.stringify(error.meta ?? {});
    const field = Object.keys(FIELD_LABEL).find((key) => detail.includes(key));
    throw ApiError.conflict(`${field ? FIELD_LABEL[field] : 'ค่านี้'}ถูกใช้แล้ว — เลือกค่าอื่น`);
  }

  throw error;
}

async function writeLog(
  tx: Tx,
  actor: AdminLogActor,
  targetType: TargetType,
  action: string,
  targetId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): Promise<void> {
  await writeAdminLog(tx, {
    actor,
    action,
    targetType,
    targetId,
    before: before as Prisma.InputJsonValue | null,
    after: after as Prisma.InputJsonValue,
  });
}

/** ค่าเดิมเฉพาะช่องที่ถูกแก้ — before/after คีย์ชุดเดียวกัน (กฎ STEP 27) */
function changedFields<T extends Record<string, unknown>>(
  current: T,
  next: Partial<T>,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(next)) {
    if (value === undefined || current[key] === value) continue;
    before[key] = current[key] ?? null;
    after[key] = value;
  }

  return { before, after };
}

/** ชื่อซ้ำแบบไม่สนตัวพิมพ์ — ฐานข้อมูลเทียบตรงตัว "Nike" กับ "nike" จึงผ่านทั้งคู่ */
function assertNameFree(existing: { id: string } | null, label: string): void {
  if (existing !== null) {
    throw ApiError.conflict(`มี${label}ชื่อนี้อยู่แล้ว — ใช้ชื่ออื่น หรือแก้รายการเดิมแทน`);
  }
}

async function nextSortOrder(
  tx: Tx,
  table: 'category' | 'size' | 'color',
  parentId?: string | null,
): Promise<number> {
  const result =
    table === 'category'
      ? await tx.category.aggregate({
          where: { parentId: parentId ?? null, deletedAt: null },
          _max: { sortOrder: true },
        })
      : table === 'size'
        ? await tx.size.aggregate({ _max: { sortOrder: true } })
        : await tx.color.aggregate({ _max: { sortOrder: true } });

  return (result._max.sortOrder ?? -1) + 1;
}

/* ─────────────────────────── หมวดหมู่ ─────────────────────────── */

async function parentNode(tx: Tx, parentId: string | null) {
  if (parentId === null) return null;

  const rows = await tx.$queryRaw<
    Array<{ id: string; parentId: string | null; isActive: boolean }>
  >`
    SELECT "id", "parentId", "isActive" FROM "Category"
    WHERE "id" = ${parentId}::uuid AND "deletedAt" IS NULL
    FOR SHARE
  `;

  const parent = rows[0];
  if (!parent) throw ApiError.badRequest('ไม่พบหมวดแม่ที่เลือก (อาจถูกลบไปแล้ว)');

  return parent;
}

async function assertSiblingNameFree(
  tx: Tx,
  name: string,
  parentId: string | null,
  exceptId?: string,
): Promise<void> {
  const existing = await tx.category.findFirst({
    where: {
      parentId,
      deletedAt: null,
      name: { equals: name, mode: 'insensitive' },
      ...(exceptId !== undefined ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });

  if (existing !== null) {
    throw ApiError.conflict(
      parentId === null ? 'มีหมวดระดับบนสุดชื่อนี้อยู่แล้ว' : 'หมวดแม่นี้มีหมวดย่อยชื่อนี้อยู่แล้ว',
    );
  }
}

export async function createCategory(actor: AdminLogActor, input: CreateCategoryInput) {
  return getPrisma()
    .$transaction(async (tx) => {
      const parentId = input.parentId ?? null;
      const parent = await parentNode(tx, parentId);
      const problem = checkCategoryParent({
        categoryId: null,
        parent,
        hasChildren: false,
        willBeActive: input.isActive,
      });
      if (problem !== null) throw ApiError.badRequest(problem);

      await assertSiblingNameFree(tx, input.name, parentId);

      const created = await tx.category.create({
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description || null,
          parentId,
          isActive: input.isActive,
          sortOrder: await nextSortOrder(tx, 'category', parentId),
        },
        select: { id: true },
      });

      await writeLog(tx, actor, 'Category', 'catalog.category.create', created.id, null, {
        name: input.name,
        slug: input.slug,
        parentId,
        isActive: input.isActive,
      });

      return created;
    })
    .catch(rethrowUnique);
}

export async function updateCategory(actor: AdminLogActor, id: string, input: UpdateCategoryInput) {
  return getPrisma()
    .$transaction(async (tx) => {
      await lockRow(tx, 'Category', id);

      const current = await tx.category.findUniqueOrThrow({
        where: { id },
        select: { name: true, slug: true, description: true, parentId: true, isActive: true },
      });
      const usage = await categoryUsageOf(tx, id);
      const blockers = categoryBlockers(usage);

      if (input.slug !== undefined && input.slug !== current.slug && blockers.slug !== null) {
        throw ApiError.conflict(blockers.slug);
      }

      if (input.isActive === false && current.isActive && blockers.deactivate !== null) {
        throw ApiError.conflict(blockers.deactivate);
      }

      const nextParentId = input.parentId !== undefined ? input.parentId : current.parentId;
      const willBeActive = input.isActive ?? current.isActive;
      const parentChanged = nextParentId !== current.parentId;

      // ตรวจหมวดแม่ทุกครั้งที่ย้าย หรือจะเปิดใช้ (หมวดย่อยที่เปิดอยู่ใต้หมวดแม่ที่ปิด = หาไม่เจอ)
      if (parentChanged || (willBeActive && !current.isActive)) {
        const problem = checkCategoryParent({
          categoryId: id,
          parent: await parentNode(tx, nextParentId),
          hasChildren: usage.children > 0,
          willBeActive,
        });
        if (problem !== null) throw ApiError.badRequest(problem);
      }

      const nextName = input.name ?? current.name;
      if (input.name !== undefined || parentChanged) {
        await assertSiblingNameFree(tx, nextName, nextParentId, id);
      }

      const next = {
        name: input.name,
        slug: input.slug,
        description: input.description === undefined ? undefined : input.description || null,
        parentId: input.parentId,
        isActive: input.isActive,
      };
      const { before, after } = changedFields(current, next);

      if (Object.keys(after).length === 0) return { id };

      await tx.category.update({
        where: { id },
        data: {
          ...(after as Prisma.CategoryUncheckedUpdateInput),
          // ย้ายไปอยู่ใต้หมวดอื่น = ต่อท้ายพี่น้องชุดใหม่
          ...(parentChanged
            ? { sortOrder: await nextSortOrder(tx, 'category', nextParentId) }
            : {}),
        },
      });

      await writeLog(tx, actor, 'Category', 'catalog.category.update', id, before, after);

      return { id };
    })
    .catch(rethrowUnique);
}

export async function deleteCategory(actor: AdminLogActor, id: string) {
  return getPrisma().$transaction(async (tx) => {
    await lockRow(tx, 'Category', id);

    const current = await tx.category.findUniqueOrThrow({
      where: { id },
      select: { name: true, slug: true },
    });
    const blockers = categoryBlockers(await categoryUsageOf(tx, id));

    if (blockers.remove !== null) throw ApiError.conflict(blockers.remove);

    await tx.category.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, slug: deletedSlug(current.slug, id) },
    });

    await writeLog(
      tx,
      actor,
      'Category',
      'catalog.category.delete',
      id,
      { name: current.name, slug: current.slug, deleted: false },
      { name: current.name, slug: deletedSlug(current.slug, id), deleted: true },
    );

    return { id, deleted: true };
  });
}

/* ─────────────────────────── แบรนด์ ─────────────────────────── */

async function assertBrandNameFree(tx: Tx, name: string, exceptId?: string): Promise<void> {
  assertNameFree(
    await tx.brand.findFirst({
      where: {
        deletedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId !== undefined ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    }),
    'แบรนด์',
  );
}

export async function createBrand(actor: AdminLogActor, input: CreateBrandInput) {
  return getPrisma()
    .$transaction(async (tx) => {
      await assertBrandNameFree(tx, input.name);

      const created = await tx.brand.create({
        data: {
          name: input.name,
          slug: input.slug,
          description: input.description || null,
          isActive: input.isActive,
        },
        select: { id: true },
      });

      await writeLog(tx, actor, 'Brand', 'catalog.brand.create', created.id, null, {
        name: input.name,
        slug: input.slug,
        isActive: input.isActive,
      });

      return created;
    })
    .catch(rethrowUnique);
}

export async function updateBrand(actor: AdminLogActor, id: string, input: UpdateBrandInput) {
  return getPrisma()
    .$transaction(async (tx) => {
      await lockRow(tx, 'Brand', id);

      const current = await tx.brand.findUniqueOrThrow({
        where: { id },
        select: { name: true, slug: true, description: true, isActive: true },
      });
      const blockers = brandBlockers(await brandUsageOf(tx, id));

      if (input.slug !== undefined && input.slug !== current.slug && blockers.slug !== null) {
        throw ApiError.conflict(blockers.slug);
      }
      if (input.isActive === false && current.isActive && blockers.deactivate !== null) {
        throw ApiError.conflict(blockers.deactivate);
      }
      if (input.name !== undefined) await assertBrandNameFree(tx, input.name, id);

      const { before, after } = changedFields(current, {
        name: input.name,
        slug: input.slug,
        description: input.description === undefined ? undefined : input.description || null,
        isActive: input.isActive,
      });

      if (Object.keys(after).length === 0) return { id };

      await tx.brand.update({ where: { id }, data: after as Prisma.BrandUpdateInput });
      await writeLog(tx, actor, 'Brand', 'catalog.brand.update', id, before, after);

      return { id };
    })
    .catch(rethrowUnique);
}

export async function deleteBrand(actor: AdminLogActor, id: string) {
  return getPrisma().$transaction(async (tx) => {
    await lockRow(tx, 'Brand', id);

    const current = await tx.brand.findUniqueOrThrow({
      where: { id },
      select: { name: true, slug: true },
    });
    const blockers = brandBlockers(await brandUsageOf(tx, id));

    if (blockers.remove !== null) throw ApiError.conflict(blockers.remove);

    // ชื่อแบรนด์ก็ unique — ต้องคืนทั้งชื่อและ slug ให้สร้างแบรนด์ชื่อเดิมใหม่ได้
    const freed = { name: deletedName(current.name, id), slug: deletedSlug(current.slug, id) };

    await tx.brand.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false, ...freed },
    });

    await writeLog(
      tx,
      actor,
      'Brand',
      'catalog.brand.delete',
      id,
      { ...current, deleted: false },
      { ...freed, deleted: true },
    );

    return { id, deleted: true };
  });
}

/* ─────────────────────────── ไซซ์ / สี ─────────────────────────── */

export async function createSize(actor: AdminLogActor, input: CreateSizeInput) {
  return getPrisma()
    .$transaction(async (tx) => {
      assertNameFree(
        await tx.size.findFirst({
          where: { name: { equals: input.name, mode: 'insensitive' } },
          select: { id: true },
        }),
        'ไซซ์',
      );

      const created = await tx.size.create({
        data: { ...input, sortOrder: await nextSortOrder(tx, 'size') },
        select: { id: true },
      });

      await writeLog(tx, actor, 'Size', 'catalog.size.create', created.id, null, { ...input });

      return created;
    })
    .catch(rethrowUnique);
}

export async function updateSize(actor: AdminLogActor, id: string, input: UpdateSizeInput) {
  return getPrisma()
    .$transaction(async (tx) => {
      await lockRow(tx, 'Size', id);

      const current = await tx.size.findUniqueOrThrow({
        where: { id },
        select: { name: true, code: true, isActive: true },
      });
      const blockers = variantOptionBlockers('size', await variantUsageOf(tx, 'sizeId', id));

      if (input.code !== undefined && input.code !== current.code && blockers.slug !== null) {
        throw ApiError.conflict(blockers.slug);
      }
      if (input.isActive === false && current.isActive && blockers.deactivate !== null) {
        throw ApiError.conflict(blockers.deactivate);
      }
      if (input.name !== undefined) {
        assertNameFree(
          await tx.size.findFirst({
            where: { name: { equals: input.name, mode: 'insensitive' }, id: { not: id } },
            select: { id: true },
          }),
          'ไซซ์',
        );
      }

      const { before, after } = changedFields(current, input);
      if (Object.keys(after).length === 0) return { id };

      await tx.size.update({ where: { id }, data: after as Prisma.SizeUpdateInput });
      await writeLog(tx, actor, 'Size', 'catalog.size.update', id, before, after);

      return { id };
    })
    .catch(rethrowUnique);
}

export async function createColor(actor: AdminLogActor, input: CreateColorInput) {
  return getPrisma()
    .$transaction(async (tx) => {
      assertNameFree(
        await tx.color.findFirst({
          where: { name: { equals: input.name, mode: 'insensitive' } },
          select: { id: true },
        }),
        'สี',
      );

      const created = await tx.color.create({
        data: { ...input, sortOrder: await nextSortOrder(tx, 'color') },
        select: { id: true },
      });

      await writeLog(tx, actor, 'Color', 'catalog.color.create', created.id, null, { ...input });

      return created;
    })
    .catch(rethrowUnique);
}

export async function updateColor(actor: AdminLogActor, id: string, input: UpdateColorInput) {
  return getPrisma()
    .$transaction(async (tx) => {
      await lockRow(tx, 'Color', id);

      const current = await tx.color.findUniqueOrThrow({
        where: { id },
        select: { name: true, slug: true, hex: true, isActive: true },
      });
      const blockers = variantOptionBlockers('color', await variantUsageOf(tx, 'colorId', id));

      if (input.slug !== undefined && input.slug !== current.slug && blockers.slug !== null) {
        throw ApiError.conflict(blockers.slug);
      }
      if (input.isActive === false && current.isActive && blockers.deactivate !== null) {
        throw ApiError.conflict(blockers.deactivate);
      }
      if (input.name !== undefined) {
        assertNameFree(
          await tx.color.findFirst({
            where: { name: { equals: input.name, mode: 'insensitive' }, id: { not: id } },
            select: { id: true },
          }),
          'สี',
        );
      }

      const { before, after } = changedFields(current, input);
      if (Object.keys(after).length === 0) return { id };

      await tx.color.update({ where: { id }, data: after as Prisma.ColorUpdateInput });
      await writeLog(tx, actor, 'Color', 'catalog.color.update', id, before, after);

      return { id };
    })
    .catch(rethrowUnique);
}

/**
 * ลบสี/ไซซ์จริง — ได้เฉพาะตอนไม่มีตัวเลือกไหนอ้างถึงเลย (รวมที่ปิด/ลบไปแล้ว)
 * FK เป็น Restrict อยู่แล้ว (STEP 48) — ตรวจก่อนเพื่อบอกเหตุผลที่อ่านออก แทน error ของฐานข้อมูล
 */
export async function deleteVariantOption(
  actor: AdminLogActor,
  kind: 'size' | 'color',
  id: string,
) {
  return getPrisma().$transaction(async (tx) => {
    const table = kind === 'size' ? 'Size' : 'Color';
    await lockRow(tx, table, id);

    const blockers = variantOptionBlockers(
      kind,
      await variantUsageOf(tx, kind === 'size' ? 'sizeId' : 'colorId', id),
    );
    if (blockers.remove !== null) throw ApiError.conflict(blockers.remove);

    const removed =
      kind === 'size'
        ? await tx.size.delete({ where: { id }, select: { name: true, code: true } })
        : await tx.color.delete({ where: { id }, select: { name: true, slug: true, hex: true } });

    await writeLog(
      tx,
      actor,
      table,
      `catalog.${kind}.delete`,
      id,
      { ...removed, deleted: false },
      {
        ...removed,
        deleted: true,
      },
    );

    return { id, deleted: true };
  });
}

/* ─────────────────────────── เรียงลำดับ ─────────────────────────── */

/**
 * ลำดับใหม่ของ **ทุกรายการ** ในกลุ่ม — ไม่ครบ/ไม่ตรง/ซ้ำ = 409 ไม่เดาเติมให้
 * (หน้าจอของคนกดอาจเห็นรายการไม่ครบ ถ้ามีคนเพิ่มหรือลบพร้อมกัน — แพตเทิร์นเดียวกับรูปสินค้า STEP 47)
 */
function assertSameSet(current: readonly string[], requested: readonly string[]): void {
  const set = new Set(current);
  const ok =
    new Set(requested).size === requested.length &&
    requested.length === current.length &&
    requested.every((id) => set.has(id));

  if (!ok) {
    throw ApiError.conflict(
      'รายการไม่ตรงกับข้อมูลตอนนี้ (อาจมีคนเพิ่มหรือลบไปแล้ว) — โหลดหน้าใหม่แล้วลองอีกครั้ง',
    );
  }
}

export async function reorderCategories(
  actor: AdminLogActor,
  parentId: string | null,
  ids: readonly string[],
) {
  return getPrisma().$transaction(async (tx) => {
    const siblings = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "Category"
      WHERE "deletedAt" IS NULL AND "parentId" IS NOT DISTINCT FROM ${parentId}::uuid
      ORDER BY "sortOrder", "name"
      FOR UPDATE
    `;
    const before = siblings.map((row) => row.id);
    assertSameSet(before, ids);

    for (const [index, id] of ids.entries()) {
      await tx.category.update({ where: { id }, data: { sortOrder: index } });
    }

    await writeLog(
      tx,
      actor,
      'Category',
      'catalog.category.reorder',
      parentId ?? 'ROOT',
      {
        order: before,
      },
      { order: [...ids] },
    );

    return { ids: [...ids] };
  });
}

export async function reorderVariantOptions(
  actor: AdminLogActor,
  kind: 'size' | 'color',
  ids: readonly string[],
) {
  return getPrisma().$transaction(async (tx) => {
    const table = kind === 'size' ? Prisma.raw('"Size"') : Prisma.raw('"Color"');
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT "id" FROM ${table} ORDER BY "sortOrder", "name" FOR UPDATE
    `);
    const before = rows.map((row) => row.id);
    assertSameSet(before, ids);

    for (const [index, id] of ids.entries()) {
      if (kind === 'size') await tx.size.update({ where: { id }, data: { sortOrder: index } });
      else await tx.color.update({ where: { id }, data: { sortOrder: index } });
    }

    await writeLog(
      tx,
      actor,
      kind === 'size' ? 'Size' : 'Color',
      `catalog.${kind}.reorder`,
      'ALL',
      { order: before },
      { order: [...ids] },
    );

    return { ids: [...ids] };
  });
}
