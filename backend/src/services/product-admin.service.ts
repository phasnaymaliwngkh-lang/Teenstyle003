import { getPrisma, Prisma } from '@teenstyle/database';

import { AVAILABLE_STOCK_SQL } from '../models/availability.ts';
import { resolveProductPrice, resolveVariantPrice, toNumber } from '../models/pricing.ts';
import { resolveStockStatus } from '../models/product.model.ts';
import { writeAdminLog } from '../models/admin-log.model.ts';
import { ApiError } from '../utils/api-error.ts';
import type {
  AddVariantInput,
  AdminProductListQuery,
  CreateProductInput,
  UpdateProductInput,
  UpdateVariantInput,
} from '../validators/product-admin.validator.ts';

import { notifySafely, notifyWishlistPriceDrops } from './notification.service.ts';

/**
 * จัดการสินค้าในหลังบ้าน (STEP 14)
 *
 * กฎที่ห้ามละเมิด
 *   1. **สต็อกเดินผ่าน InventoryMovement เท่านั้น** — endpoint สินค้าห้ามเขียน `Inventory.quantity`
 *      ตรง ๆ · การรับเข้าครั้งแรกของ variant ถูกบันทึกเป็น movement `STOCK_IN` จริง
 *      พร้อมอัปเดต cache `Product.totalStock` ในทรานแซกชันเดียวกัน
 *   2. **ลบสินค้าเป็น soft delete** (`deletedAt` + `status = ARCHIVED`) — ประวัติคำสั่งซื้อ
 *      ต้องอ้างอิงสินค้าเดิมได้ตลอด (OrderItem เก็บ snapshot ไว้แล้ว แต่ FK ยังต้องอยู่)
 *   3. **slug / SKU ซ้ำไม่ได้** — ตรวจก่อนเขียนและแปลง unique violation ของฐานข้อมูลเป็น 409
 *   4. **ทุกการเปลี่ยนแปลงเขียน AdminLog** (ใคร แก้อะไร ก่อน/หลัง)
 *   5. **ห้ามเผยแพร่สินค้าที่ยังไม่มีข้อมูลครบ** — จะตั้ง ACTIVE ได้ต้องมีรูปและ variant ที่ขายได้
 */

const ADMIN_PRODUCT_SELECT = {
  id: true,
  name: true,
  slug: true,
  sku: true,
  description: true,
  shortDescription: true,
  price: true,
  salePrice: true,
  status: true,
  minimumStock: true,
  totalStock: true,
  tags: true,
  viewCount: true,
  publishedAt: true,
  createdAt: true,
  updatedAt: true,
  deletedAt: true,
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  images: {
    orderBy: { sortOrder: 'asc' },
    select: { id: true, url: true, alt: true, isMain: true, sortOrder: true },
  },
  variants: {
    orderBy: { sku: 'asc' },
    select: {
      id: true,
      sku: true,
      barcode: true,
      price: true,
      salePrice: true,
      isActive: true,
      deletedAt: true,
      color: { select: { name: true, slug: true, hex: true } },
      size: { select: { name: true, code: true } },
      inventory: { select: { quantity: true, reservedQuantity: true } },
    },
  },
  _count: { select: { orderItems: true } },
} as const satisfies Prisma.ProductSelect;

type AdminProductRow = Prisma.ProductGetPayload<{ select: typeof ADMIN_PRODUCT_SELECT }>;

export interface AdminProductDto {
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
  status: string;
  minimumStock: number;
  /** cache ของผลรวมในคลัง */
  totalStock: number;
  /** จำนวนที่ขายได้จริง (หักที่จองไว้) */
  availableStock: number;
  reservedStock: number;
  stockStatus: string;
  tags: string[];
  viewCount: number;
  category: { id: string; name: string; slug: string };
  brand: { id: string; name: string; slug: string } | null;
  images: { id: string; url: string; alt: string; isMain: boolean; sortOrder: number }[];
  variants: {
    id: string;
    sku: string;
    /** บาร์โค้ดสินค้า (GTIN) — null = ยังไม่มี (พิมพ์ป้ายเป็น Code 128 ของ SKU ได้) */
    barcode: string | null;
    price: number;
    salePrice: number | null;
    finalPrice: number;
    /** true = ตัวเลือกนี้กำหนดราคาของตัวเองไว้ (false = ใช้ราคาของสินค้าแม่) */
    overridesPrice: boolean;
    isActive: boolean;
    color: { name: string; slug: string; hex: string } | null;
    size: { name: string; code: string } | null;
    quantity: number;
    reserved: number;
    available: number;
  }[];
  /** จำนวนครั้งที่สินค้านี้ถูกสั่งซื้อ — ใช้เตือนก่อนลบ */
  orderItemCount: number;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

function toAdminProduct(product: AdminProductRow): AdminProductDto {
  const price = resolveProductPrice(product);

  const variants = product.variants
    .filter((variant) => variant.deletedAt === null)
    .map((variant) => {
      const variantPrice = resolveVariantPrice(variant, product);
      const quantity = variant.inventory?.quantity ?? 0;
      const reserved = variant.inventory?.reservedQuantity ?? 0;

      return {
        id: variant.id,
        sku: variant.sku,
        barcode: variant.barcode,
        price: variantPrice.price,
        salePrice: variantPrice.salePrice,
        finalPrice: variantPrice.finalPrice,
        // ต้องบอกให้ชัด ไม่ให้หน้าหลังบ้านเดาจากการเทียบราคากับสินค้าแม่
        overridesPrice: variant.price !== null,
        isActive: variant.isActive,
        color: variant.color,
        size: variant.size,
        quantity,
        reserved,
        available: Math.max(0, quantity - reserved),
      };
    });

  const reservedStock = variants.reduce((sum, variant) => sum + variant.reserved, 0);
  const availableStock = variants.reduce((sum, variant) => sum + variant.available, 0);

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    description: product.description,
    shortDescription: product.shortDescription,
    price: price.price,
    salePrice: price.salePrice,
    finalPrice: price.finalPrice,
    discountPercent: price.discountPercent,
    status: product.status,
    minimumStock: product.minimumStock,
    totalStock: product.totalStock,
    availableStock,
    reservedStock,
    stockStatus: resolveStockStatus(availableStock, product.minimumStock),
    tags: product.tags,
    viewCount: product.viewCount,
    category: product.category,
    brand: product.brand,
    images: product.images,
    variants,
    orderItemCount: product._count.orderItems,
    publishedAt: product.publishedAt?.toISOString() ?? null,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    deletedAt: product.deletedAt?.toISOString() ?? null,
  };
}

export interface AdminProductListResult {
  items: AdminProductDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: { status: string; count: number }[];
  lowStockCount: number;
}

/**
 * id ของสินค้าที่ "ขายได้จริง" ต่ำกว่าหรือเท่ากับจุดเตือน
 *
 * ต้องคิดจาก `quantity - reservedQuantity` ของ Inventory จริง ไม่ใช่ cache `Product.totalStock`
 * (cache ไม่หักของที่จองไว้) และ Prisma เทียบสองคอลัมน์ในเงื่อนไขไม่ได้ จึงใช้ raw SQL
 * ⚠️ คืนทั้งชุดเพื่อให้การนับและการแบ่งหน้าตรงกัน — แคตตาล็อกใหญ่ขึ้นให้ย้ายไปทำที่ระบบคลัง (STEP 15)
 */
async function findLowStockProductIds(prisma: ReturnType<typeof getPrisma>): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT p."id"
    FROM "Product" p
    WHERE p."deletedAt" IS NULL
      AND ${AVAILABLE_STOCK_SQL} <= p."minimumStock"
  `);

  return rows.map((row) => row.id);
}

export async function listAdminProducts(
  query: AdminProductListQuery,
): Promise<AdminProductListResult> {
  const prisma = getPrisma();
  const lowStockIds = await findLowStockProductIds(prisma);

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    // กรองก่อนนับและก่อนแบ่งหน้า ไม่งั้นจำนวนที่แสดงกับแถวที่เห็นจะไม่ตรงกัน
    ...(query.lowStock === true ? { id: { in: lowStockIds } } : {}),
    ...(query.status !== undefined
      ? { status: query.status as Prisma.EnumProductStatusFilter }
      : {}),
    ...(query.categorySlug !== undefined ? { category: { slug: query.categorySlug } } : {}),
    ...(query.q !== undefined && query.q !== ''
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' } },
            { sku: { contains: query.q, mode: 'insensitive' } },
            { slug: { contains: query.q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [total, rows, grouped] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: ADMIN_PRODUCT_SELECT,
    }),
    prisma.product.groupBy({
      by: ['status'],
      where: { deletedAt: null },
      _count: { _all: true },
    }),
  ]);

  return {
    items: rows.map(toAdminProduct),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit),
    counts: grouped.map((row) => ({ status: String(row.status), count: row._count._all })),
    lowStockCount: lowStockIds.length,
  };
}

export async function getAdminProduct(productId: string): Promise<AdminProductDto> {
  const product = await getPrisma().product.findFirst({
    where: { id: productId, deletedAt: null },
    select: ADMIN_PRODUCT_SELECT,
  });

  if (!product) {
    throw ApiError.notFound('ไม่พบสินค้านี้');
  }

  return toAdminProduct(product);
}

/** ตัวเลือกสำหรับฟอร์ม (หมวดหมู่ แบรนด์ สี ไซซ์) — มาจากฐานข้อมูลจริง */
export interface ProductFormOptionsDto {
  categories: { id: string; name: string; slug: string; parentName: string | null }[];
  brands: { id: string; name: string; slug: string }[];
  colors: { name: string; slug: string; hex: string }[];
  sizes: { name: string; code: string }[];
  allowedImageHosts: string[];
}

export async function getProductFormOptions(): Promise<ProductFormOptionsDto> {
  const prisma = getPrisma();
  const { ALLOWED_IMAGE_HOSTS } = await import('../config/media.ts');

  const [categories, brands, colors, sizes] = await Promise.all([
    prisma.category.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, name: true, slug: true, parent: { select: { name: true } } },
    }),
    prisma.brand.findMany({
      where: { deletedAt: null, isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, slug: true },
    }),
    prisma.color.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { name: true, slug: true, hex: true },
    }),
    prisma.size.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { name: true, code: true },
    }),
  ]);

  return {
    categories: categories.map((category) => ({
      id: category.id,
      name: category.name,
      slug: category.slug,
      parentName: category.parent?.name ?? null,
    })),
    brands,
    colors,
    sizes,
    allowedImageHosts: [...ALLOWED_IMAGE_HOSTS],
  };
}

/** แปลง unique violation ของ Prisma เป็นข้อความที่ผู้ใช้เข้าใจ */
function rethrowUnique(error: unknown): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    const fields = Array.isArray(error.meta?.['target'])
      ? (error.meta['target'] as string[]).join(', ')
      : String(error.meta?.['target'] ?? '');

    throw ApiError.conflict(`ค่านี้มีอยู่ในระบบแล้ว (${fields || 'ซ้ำกับข้อมูลเดิม'})`);
  }

  throw error;
}

async function resolveRefs(
  tx: Prisma.TransactionClient,
  input: { categorySlug?: string | undefined; brandSlug?: string | undefined },
): Promise<{ categoryId?: string; brandId?: string | null }> {
  const result: { categoryId?: string; brandId?: string | null } = {};

  if (input.categorySlug !== undefined) {
    const category = await tx.category.findFirst({
      where: { slug: input.categorySlug, deletedAt: null },
      select: { id: true },
    });
    if (!category) throw ApiError.badRequest(`ไม่พบหมวดหมู่ "${input.categorySlug}"`);
    result.categoryId = category.id;
  }

  if (input.brandSlug !== undefined) {
    if (input.brandSlug === '') {
      result.brandId = null;
    } else {
      const brand = await tx.brand.findFirst({
        where: { slug: input.brandSlug, deletedAt: null },
        select: { id: true },
      });
      if (!brand) throw ApiError.badRequest(`ไม่พบแบรนด์ "${input.brandSlug}"`);
      result.brandId = brand.id;
    }
  }

  return result;
}

/** สร้าง variant + คลัง + การรับเข้าครั้งแรก (ถ้ามี) ในทรานแซกชันที่ส่งเข้ามา */
async function createVariantRow(
  tx: Prisma.TransactionClient,
  productId: string,
  variant: AddVariantInput,
  actorUserId: string,
  productName: string,
): Promise<{ id: string; stockIn: number }> {
  const [color, size] = await Promise.all([
    variant.colorSlug === undefined
      ? Promise.resolve(null)
      : tx.color.findUnique({ where: { slug: variant.colorSlug }, select: { id: true } }),
    variant.sizeCode === undefined
      ? Promise.resolve(null)
      : tx.size.findUnique({ where: { code: variant.sizeCode }, select: { id: true } }),
  ]);

  assertVariantPriceShape(variant.price ?? null, variant.salePrice ?? null);

  if (variant.colorSlug !== undefined && color === null) {
    throw ApiError.badRequest(`ไม่พบสี "${variant.colorSlug}"`);
  }
  if (variant.sizeCode !== undefined && size === null) {
    throw ApiError.badRequest(`ไม่พบไซซ์ "${variant.sizeCode}"`);
  }

  const created = await tx.productVariant.create({
    data: {
      productId,
      sku: variant.sku,
      // บาร์โค้ด (STEP 17) — ไม่ส่งมา = ยังไม่มี · ออกเลขของร้านให้ทีหลังได้ที่ /admin/barcodes
      barcode: variant.barcode ?? null,
      price: variant.price ?? null,
      salePrice: variant.salePrice ?? null,
      colorId: color?.id ?? null,
      sizeId: size?.id ?? null,
      isActive: variant.isActive,
      // สร้างแถวคลังเป็น 0 เสมอ — จำนวนจริงมาจาก movement เท่านั้น
      inventory: { create: { quantity: 0, reservedQuantity: 0 } },
    },
    select: { id: true },
  });

  if (variant.initialStock > 0) {
    /**
     * รับเข้าครั้งแรก — ต้องเดินผ่าน InventoryMovement เหมือนการรับของทุกครั้ง
     * เพื่อให้ audit trail ครบและยอดในคลังตรวจย้อนหลังได้
     */
    await tx.inventory.update({
      where: { variantId: created.id },
      data: { quantity: variant.initialStock },
    });

    await tx.inventoryMovement.create({
      data: {
        variantId: created.id,
        type: 'STOCK_IN',
        quantity: variant.initialStock,
        quantityBefore: 0,
        quantityAfter: variant.initialStock,
        reason: `รับเข้าครั้งแรกตอนสร้างตัวเลือกของ "${productName}"`,
        referenceType: 'PRODUCT',
        referenceId: productId,
        idempotencyKey: `variant:${created.id}:initial-stock`,
        userId: actorUserId,
      },
    });

    await tx.product.update({
      where: { id: productId },
      data: { totalStock: { increment: variant.initialStock } },
    });
  }

  return { id: created.id, stockIn: variant.initialStock };
}

export interface AdminActor {
  id: string;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

async function writeLog(
  tx: Prisma.TransactionClient,
  actor: AdminActor,
  action: string,
  targetId: string,
  before: Prisma.InputJsonValue | null,
  after: Prisma.InputJsonValue,
): Promise<void> {
  await writeAdminLog(tx, { actor, action, targetType: 'Product', targetId, before, after });
}

/**
 * ตรวจรูปราคาของ variant ให้ตรงกับกฎราคาที่ `models/pricing.ts` ใช้คิดเงินจริง
 *
 * กฎนั้นคือ: variant ที่ `price = null` ใช้ราคา **และโปรโมชัน** ของสินค้าแม่ทั้งคู่
 * → `salePrice` ของ variant ที่ไม่ได้กำหนดราคาเองจะไม่มีผลกับราคาที่ลูกค้าจ่าย
 *   ถ้ายอมให้บันทึกไว้ แอดมินจะเข้าใจว่าลดราคาแล้วแต่หน้าร้านเก็บเงินเต็ม — ต้องปฏิเสธไปเลย
 */
function assertVariantPriceShape(price: number | null, salePrice: number | null): void {
  if (salePrice !== null && price === null) {
    throw ApiError.badRequest(
      'ถ้าจะตั้งราคาลดของตัวเลือก ต้องกำหนดราคาของตัวเลือกนั้นด้วย (ไม่กำหนด = ใช้ราคาและโปรโมชันของสินค้าแม่)',
    );
  }

  if (salePrice !== null && price !== null && salePrice >= price) {
    throw ApiError.badRequest('ราคาลดต้องน้อยกว่าราคาปกติ');
  }
}

/** ตรวจว่าสินค้าพร้อมเผยแพร่จริงไหม (มีรูปและตัวเลือกที่ขายได้) */
function assertPublishable(product: {
  images: unknown[];
  variants: { isActive: boolean; deletedAt: Date | null }[];
}): void {
  if (product.images.length === 0) {
    throw ApiError.badRequest('ต้องมีรูปสินค้าอย่างน้อย 1 รูปก่อนเปิดขาย');
  }

  const sellable = product.variants.filter(
    (variant) => variant.isActive && variant.deletedAt === null,
  );

  if (sellable.length === 0) {
    throw ApiError.badRequest('ต้องมีตัวเลือกสินค้าที่เปิดใช้งานอย่างน้อย 1 รายการก่อนเปิดขาย');
  }
}

export async function createProduct(
  actor: AdminActor,
  input: CreateProductInput,
): Promise<AdminProductDto> {
  const prisma = getPrisma();

  const productId = await prisma
    .$transaction(async (tx) => {
      const refs = await resolveRefs(tx, input);

      if (input.status === 'ACTIVE') {
        assertPublishable({
          images: input.images,
          variants: input.variants.map((variant) => ({
            isActive: variant.isActive,
            deletedAt: null,
          })),
        });
      }

      const product = await tx.product.create({
        data: {
          name: input.name,
          slug: input.slug,
          sku: input.sku,
          description: input.description,
          shortDescription: input.shortDescription ?? null,
          price: input.price,
          salePrice: input.salePrice ?? null,
          categoryId: refs.categoryId!,
          brandId: refs.brandId ?? null,
          status: input.status,
          minimumStock: input.minimumStock,
          tags: input.tags,
          // publishedAt มีค่าเฉพาะสินค้าที่เปิดขายจริง
          publishedAt: input.status === 'ACTIVE' ? new Date() : null,
          images: {
            createMany: {
              data: input.images.map((image, index) => ({
                url: image.url,
                alt: image.alt,
                // ถ้าไม่ได้เลือกรูปหลักไว้ ให้รูปแรกเป็นรูปหลัก
                isMain: image.isMain || (index === 0 && !input.images.some((row) => row.isMain)),
                sortOrder: image.sortOrder,
              })),
            },
          },
        },
        select: { id: true, name: true },
      });

      for (const variant of input.variants) {
        await createVariantRow(tx, product.id, variant, actor.id, product.name);
      }

      await writeLog(tx, actor, 'product.create', product.id, null, {
        name: input.name,
        slug: input.slug,
        sku: input.sku,
        status: input.status,
        variants: input.variants.length,
      });

      return product.id;
    })
    .catch(rethrowUnique);

  return getAdminProduct(productId);
}

export async function updateProduct(
  actor: AdminActor,
  productId: string,
  input: UpdateProductInput,
): Promise<AdminProductDto> {
  const prisma = getPrisma();

  await prisma
    .$transaction(async (tx) => {
      const current = await tx.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: {
          id: true,
          name: true,
          slug: true,
          sku: true,
          price: true,
          salePrice: true,
          status: true,
          minimumStock: true,
          publishedAt: true,
          // ช่องด้านล่างดึงมาเพื่อบันทึก "ค่าเดิม" ลง audit log ให้ครบทุกช่องที่ PATCH แก้ได้
          description: true,
          shortDescription: true,
          categoryId: true,
          brandId: true,
          tags: true,
          images: { select: { id: true } },
          variants: { select: { isActive: true, deletedAt: true } },
        },
      });

      if (!current) {
        throw ApiError.notFound('ไม่พบสินค้านี้');
      }

      /**
       * ราคาลดต้องต่ำกว่าราคาปกติแม้ส่งมาแก้แค่ตัวใดตัวหนึ่ง
       * `salePrice: null` = เลิกโปรโมชัน · ไม่ส่งมา = ใช้ค่าเดิมในฐานข้อมูล
       */
      const nextPrice = input.price ?? toNumber(current.price);
      const nextSale =
        input.salePrice !== undefined
          ? input.salePrice
          : current.salePrice === null
            ? null
            : toNumber(current.salePrice);

      if (nextSale !== null && nextSale >= nextPrice) {
        throw ApiError.badRequest('ราคาลดต้องน้อยกว่าราคาปกติ');
      }

      if (input.status === 'ACTIVE') {
        assertPublishable({
          images: input.images ?? current.images,
          variants: current.variants,
        });
      }

      const refs = await resolveRefs(tx, input);

      // เปลี่ยนรูป = แทนที่ทั้งชุด (ง่ายและคาดเดาได้ · STEP 47 จะทำจัดการรูปแบบละเอียด)
      if (input.images !== undefined) {
        await tx.productImage.deleteMany({ where: { productId } });
        await tx.productImage.createMany({
          data: input.images.map((image, index) => ({
            productId,
            url: image.url,
            alt: image.alt,
            isMain: image.isMain || (index === 0 && !input.images!.some((row) => row.isMain)),
            sortOrder: image.sortOrder,
          })),
        });
      }

      await tx.product.update({
        where: { id: productId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.sku !== undefined ? { sku: input.sku } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.shortDescription !== undefined
            ? { shortDescription: input.shortDescription }
            : {}),
          ...(input.price !== undefined ? { price: input.price } : {}),
          ...(input.salePrice !== undefined ? { salePrice: input.salePrice } : {}),
          ...(refs.categoryId !== undefined ? { categoryId: refs.categoryId } : {}),
          ...(refs.brandId !== undefined ? { brandId: refs.brandId } : {}),
          ...(input.minimumStock !== undefined ? { minimumStock: input.minimumStock } : {}),
          ...(input.tags !== undefined ? { tags: input.tags } : {}),
          ...(input.status !== undefined
            ? {
                status: input.status,
                // ตั้งวันเผยแพร่ครั้งแรกที่เปิดขาย และไม่รีเซ็ตเมื่อเปิดซ้ำ
                ...(input.status === 'ACTIVE' && current.publishedAt === null
                  ? { publishedAt: new Date() }
                  : {}),
              }
            : {}),
        },
      });

      /**
       * ⚠️ `before` ต้องมี **คีย์เดียวกับ `after`** ไม่ใช่สแนปช็อตเต็มของสินค้า
       *    เดิมเก็บ before เป็นชุดคงที่ (ชื่อ · slug · SKU · ราคา · สถานะ) แต่ after
       *    เก็บเฉพาะช่องที่ผู้ใช้ส่งมาแก้ → หน้าประวัติเทียบแล้วรายงานว่า
       *    "ชื่อสินค้าถูกล้างเป็นค่าว่าง" ทั้งที่ไม่มีใครแตะชื่อ (เจอจริงตอนตรวจ STEP 27)
       *    ตอนนี้เก็บค่าเดิมเฉพาะช่องที่ถูกแก้จริง ประวัติจึงอ่านได้ว่า "จาก X เป็น Y"
       */
      const after: Record<string, unknown> = {
        ...input,
        images: input.images === undefined ? undefined : input.images.length,
      };

      const currentValues: Record<string, unknown> = {
        name: current.name,
        slug: current.slug,
        sku: current.sku,
        description: current.description,
        shortDescription: current.shortDescription,
        price: toNumber(current.price),
        salePrice: current.salePrice === null ? null : toNumber(current.salePrice),
        categoryId: current.categoryId,
        brandId: current.brandId,
        minimumStock: current.minimumStock,
        tags: current.tags,
        status: current.status,
        images: current.images.length,
      };

      const before: Record<string, unknown> = {};
      for (const key of Object.keys(after)) {
        if (after[key] === undefined) continue;
        if (Object.prototype.hasOwnProperty.call(currentValues, key)) {
          before[key] = currentValues[key];
        }
      }

      await writeLog(
        tx,
        actor,
        'product.update',
        productId,
        before as Prisma.InputJsonValue,
        after as Prisma.InputJsonValue,
      );
    })
    .catch(rethrowUnique);

  /**
   * ราคาเปลี่ยนแล้ว → บอกคนที่กดถูกใจไว้ ถ้าถูกลงกว่าตอนที่เขากด (STEP 22 → STEP 24)
   *
   * ⚠️ เรียกทุกครั้งที่แก้สินค้าโดยไม่เช็คก่อนว่าราคาขยับไหม เพราะตัวตัดสินจริงอยู่ใน
   *    `notifyWishlistPriceDrops` ซึ่งเทียบราคาปัจจุบันกับ `priceWhenAdded` ของแต่ละคน
   *    และกับราคาที่เคยแจ้งไปแล้ว (แก้แค่ชื่อสินค้าจึงไม่มีใครได้แจ้งเตือน)
   * ⚠️ หลัง commit และกลืน error เอง — แจ้งเตือนล้มต้องไม่ทำให้การแก้สินค้าที่บันทึกแล้วพัง
   */
  await notifySafely(
    () => notifyWishlistPriceDrops([productId]),
    `product:${productId}:price-drop`,
  );

  return getAdminProduct(productId);
}

/** ลบสินค้า = soft delete + ปิดขาย (ประวัติคำสั่งซื้อต้องอ้างอิงได้ตลอด) */
export async function archiveProduct(
  actor: AdminActor,
  productId: string,
): Promise<{ id: string; orderItemCount: number }> {
  const prisma = getPrisma();

  const product = await prisma.product.findFirst({
    where: { id: productId, deletedAt: null },
    select: {
      id: true,
      name: true,
      status: true,
      _count: { select: { orderItems: true } },
      variants: { select: { id: true, inventory: { select: { reservedQuantity: true } } } },
    },
  });

  if (!product) {
    throw ApiError.notFound('ไม่พบสินค้านี้');
  }

  // มีของถูกจองอยู่ = มีออเดอร์ที่ยังไม่จบ ห้ามลบจนกว่าจะเคลียร์
  const reserved = product.variants.reduce(
    (sum, variant) => sum + (variant.inventory?.reservedQuantity ?? 0),
    0,
  );

  if (reserved > 0) {
    throw ApiError.conflict(
      `สินค้านี้ถูกจองไว้ในคำสั่งซื้อที่ยังไม่จบ ${reserved} ชิ้น — จัดการคำสั่งซื้อให้เรียบร้อยก่อนลบ`,
    );
  }

  await prisma.$transaction(async (tx) => {
    const now = new Date();

    await tx.product.update({
      where: { id: productId },
      data: { deletedAt: now, status: 'ARCHIVED' },
    });

    // ปิดตัวเลือกทั้งหมดด้วย เพื่อไม่ให้หลุดไปโผล่ที่ไหน
    await tx.productVariant.updateMany({
      where: { productId },
      data: { deletedAt: now, isActive: false },
    });

    await writeLog(
      tx,
      actor,
      'product.delete',
      productId,
      { name: product.name, status: product.status },
      { deleted: true, softDelete: true },
    );
  });

  return { id: productId, orderItemCount: product._count.orderItems };
}

export async function addVariant(
  actor: AdminActor,
  productId: string,
  input: AddVariantInput,
): Promise<AdminProductDto> {
  const prisma = getPrisma();

  await prisma
    .$transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true, name: true },
      });

      if (!product) throw ApiError.notFound('ไม่พบสินค้านี้');

      const created = await createVariantRow(tx, productId, input, actor.id, product.name);

      await writeLog(tx, actor, 'product.variant.create', productId, null, {
        variantId: created.id,
        sku: input.sku,
        initialStock: created.stockIn,
      });
    })
    .catch(rethrowUnique);

  return getAdminProduct(productId);
}

export async function updateVariant(
  actor: AdminActor,
  productId: string,
  variantId: string,
  input: UpdateVariantInput,
): Promise<AdminProductDto> {
  const prisma = getPrisma();

  await prisma
    .$transaction(async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: variantId, productId, deletedAt: null },
        select: {
          id: true,
          sku: true,
          barcode: true,
          price: true,
          salePrice: true,
          isActive: true,
        },
      });

      if (!variant) throw ApiError.notFound('ไม่พบตัวเลือกสินค้านี้');

      // ตรวจกับค่าที่จะเป็นจริงหลังแก้ ไม่ใช่เฉพาะค่าที่ส่งมาในคำขอนี้
      const nextPrice =
        input.price !== undefined
          ? input.price
          : variant.price === null
            ? null
            : toNumber(variant.price);
      const nextSale =
        input.salePrice !== undefined
          ? input.salePrice
          : variant.salePrice === null
            ? null
            : toNumber(variant.salePrice);

      assertVariantPriceShape(nextPrice, nextSale);

      await tx.productVariant.update({
        where: { id: variantId },
        data: {
          ...(input.price !== undefined ? { price: input.price } : {}),
          ...(input.salePrice !== undefined ? { salePrice: input.salePrice } : {}),
          // `null` = ล้างบาร์โค้ด · ไม่ส่งมา = ไม่แตะ (STEP 17)
          ...(input.barcode !== undefined ? { barcode: input.barcode } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });

      await writeLog(
        tx,
        actor,
        'product.variant.update',
        productId,
        {
          variantId,
          sku: variant.sku,
          barcode: variant.barcode,
          price: variant.price === null ? null : toNumber(variant.price),
          isActive: variant.isActive,
        },
        { variantId, ...input },
      );
      // `barcode` เป็นคอลัมน์ unique (STEP 17) → เลขซ้ำต้องกลายเป็น 409 ไม่ใช่ 500
    })
    .catch(rethrowUnique);

  return getAdminProduct(productId);
}
