import { randomInt } from 'node:crypto';

import { getPrisma, internalGtin13, isValidGtin, Prisma } from '@teenstyle/database';

import { env } from '../config/index.ts';
import { renderSymbol, symbologyForGtin, type Symbology } from '../models/barcode.ts';
import { resolveVariantPrice } from '../models/pricing.ts';
import { resolveStockStatus } from '../models/product.model.ts';
import { ApiError } from '../utils/api-error.ts';
import type { LabelRequestInput } from '../validators/barcode.validator.ts';

import type { AdminActor } from './product-admin.service.ts';

/**
 * บาร์โค้ด / QR ของสินค้า (STEP 17)
 *
 * แยกให้ชัดว่าอะไรเป็นอะไร — การปนกันคือต้นเหตุของป้ายที่สแกนไม่ติด
 *
 *   - `ProductVariant.sku`     ร้านตั้งเอง (บังคับมี) → รหัสภายในร้าน พิมพ์เป็น Code 128 ได้เสมอ
 *   - `ProductVariant.barcode` GTIN (EAN-8 / UPC-A / EAN-13) ที่ตรวจ check digit แล้ว
 *                              → เลขที่สแกนได้ที่เคาน์เตอร์หรือเครื่อง POS
 *
 * กฎที่ห้ามละเมิด
 *   1. **ค่าที่เข้ารหัสต้องอ่านจากฐานข้อมูล** — client ส่งได้แค่ variantId / productId / โค้ดที่สแกนมา
 *      ห้ามให้ client กำหนดข้อความที่จะพิมพ์ลงป้าย ไม่งั้นป้ายจะไม่ตรงกับของจริง
 *   2. **ห้ามสร้างบาร์โค้ดที่ check digit ไม่ถูกต้อง** — เลขแบบนั้นสแกนไม่ติด
 *      การเก็บไว้เท่ากับหลอกร้านว่าใช้งานได้ (กฎอยู่ที่ database/src/gtin.ts)
 *   3. **บาร์โค้ดที่ร้านออกเองใช้ prefix 20** ซึ่ง GS1 สงวนไว้ให้ใช้ภายในองค์กร
 *      ห้ามไปสวม prefix ของประเทศหรือบริษัทอื่น
 *   4. **ไม่มีการเดา** — สแกนแล้วไม่พบต้องตอบว่าไม่พบ
 */

/* ─────────────────────────────── ค้นหาจากโค้ดที่สแกน ─────────────────────────────── */

const LOOKUP_VARIANT_SELECT = {
  id: true,
  sku: true,
  barcode: true,
  isActive: true,
  price: true,
  salePrice: true,
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
      price: true,
      salePrice: true,
      category: { select: { name: true, slug: true } },
      images: { where: { isMain: true }, take: 1, select: { url: true, alt: true } },
    },
  },
} as const satisfies Prisma.ProductVariantSelect;

type LookupVariantRow = Prisma.ProductVariantGetPayload<{ select: typeof LOOKUP_VARIANT_SELECT }>;

export interface BarcodeProductDto {
  id: string;
  name: string;
  slug: string;
  sku: string;
  status: string;
  minimumStock: number;
  category: { name: string; slug: string };
  imageUrl: string | null;
  /** ลิงก์หน้าสินค้าบนหน้าร้าน — ค่าเดียวกับที่ QR เข้ารหัส */
  storefrontUrl: string;
}

export interface BarcodeVariantDto {
  variantId: string;
  sku: string;
  barcode: string | null;
  /** ชื่อมาตรฐานของบาร์โค้ด (null = ยังไม่มีบาร์โค้ด หรือเลขที่เก็บไว้ใช้ไม่ได้) */
  barcodeKind: 'EAN-8' | 'UPC-A' | 'EAN-13' | null;
  isActive: boolean;
  color: { name: string; slug: string; hex: string } | null;
  size: { name: string; code: string } | null;
  finalPrice: number;
  quantity: number;
  reserved: number;
  available: number;
  stockStatus: string;
  location: string | null;
}

export interface BarcodeLookupResult {
  /** โค้ดที่ใช้ค้นจริง (บาร์โค้ดจะถูกตัดช่องว่างและขีดกลางออกก่อน) */
  code: string;
  matchedBy: 'BARCODE' | 'VARIANT_SKU' | 'PRODUCT_SKU';
  product: BarcodeProductDto;
  /** null = ตรงกับ SKU ของสินค้า จึงยังไม่รู้ว่าตัวเลือกไหน */
  variant: BarcodeVariantDto | null;
  /** จำนวนตัวเลือกที่ยังขายอยู่ของสินค้านี้ */
  variantCount: number;
}

function storefrontUrlOf(slug: string): string {
  return `${env.FRONTEND_URL.replace(/\/+$/, '')}/product/${encodeURIComponent(slug)}`;
}

/** ชื่อมาตรฐานของบาร์โค้ดที่เก็บไว้ — null ถ้าเลขในฐานข้อมูลใช้ไม่ได้จริง */
function barcodeKindOf(barcode: string): 'EAN-8' | 'UPC-A' | 'EAN-13' | null {
  const symbology = symbologyForGtin(barcode);

  if (symbology === 'ean8') return 'EAN-8';
  if (symbology === 'upca') return 'UPC-A';
  if (symbology === 'ean13') return 'EAN-13';

  return null;
}

function toProductDto(product: {
  id: string;
  name: string;
  slug: string;
  sku: string;
  status: unknown;
  minimumStock: number;
  category: { name: string; slug: string };
  images: { url: string }[];
}): BarcodeProductDto {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    sku: product.sku,
    status: String(product.status),
    minimumStock: product.minimumStock,
    category: product.category,
    imageUrl: product.images[0]?.url ?? null,
    storefrontUrl: storefrontUrlOf(product.slug),
  };
}

function toVariantDto(variant: LookupVariantRow): BarcodeVariantDto {
  const quantity = variant.inventory?.quantity ?? 0;
  const reserved = variant.inventory?.reservedQuantity ?? 0;
  const available = Math.max(0, quantity - reserved);
  const price = resolveVariantPrice(variant, variant.product);

  return {
    variantId: variant.id,
    sku: variant.sku,
    barcode: variant.barcode,
    barcodeKind: variant.barcode === null ? null : barcodeKindOf(variant.barcode),
    isActive: variant.isActive,
    color: variant.color,
    size: variant.size,
    finalPrice: price.finalPrice,
    quantity,
    reserved,
    available,
    stockStatus: resolveStockStatus(available, variant.product.minimumStock),
    location: variant.inventory?.location ?? null,
  };
}

async function countSellableVariants(productId: string): Promise<number> {
  return getPrisma().productVariant.count({
    where: { productId, deletedAt: null, isActive: true },
  });
}

/**
 * ค้นหาจากโค้ดที่สแกนหรือพิมพ์เข้ามา
 *
 * ลำดับการค้น: บาร์โค้ด → SKU ของตัวเลือก → SKU ของสินค้า
 * (เครื่องสแกนส่งบาร์โค้ดมาบ่อยที่สุด จึงค้นอันนั้นก่อน)
 *
 * ⚠️ **ไม่ค้นแบบเดา** — ไม่มี LIKE ไม่มีการตัดตัวอักษรท้ายให้ · ไม่พบคือ 404
 *    เพราะการเดาให้ในงานคลังหมายถึงไปปรับสต็อกผิดตัว
 */
export async function lookupCode(rawCode: string): Promise<BarcodeLookupResult> {
  const prisma = getPrisma();
  const trimmed = rawCode.trim();
  /** บาร์โค้ดที่คนพิมพ์มักมีช่องว่างหรือขีดกลางคั่น — ตัดออกก่อนเทียบเฉพาะกรณีบาร์โค้ด */
  const digits = trimmed.replace(/[\s-]/g, '');
  const upper = trimmed.toUpperCase();

  const byBarcode = /^[0-9]+$/.test(digits)
    ? await prisma.productVariant.findFirst({
        where: { barcode: digits, deletedAt: null, product: { deletedAt: null } },
        select: LOOKUP_VARIANT_SELECT,
      })
    : null;

  if (byBarcode !== null) {
    return {
      code: digits,
      matchedBy: 'BARCODE',
      product: toProductDto(byBarcode.product),
      variant: toVariantDto(byBarcode),
      variantCount: await countSellableVariants(byBarcode.product.id),
    };
  }

  const bySku = await prisma.productVariant.findFirst({
    where: { sku: upper, deletedAt: null, product: { deletedAt: null } },
    select: LOOKUP_VARIANT_SELECT,
  });

  if (bySku !== null) {
    return {
      code: upper,
      matchedBy: 'VARIANT_SKU',
      product: toProductDto(bySku.product),
      variant: toVariantDto(bySku),
      variantCount: await countSellableVariants(bySku.product.id),
    };
  }

  const product = await prisma.product.findFirst({
    where: { sku: upper, deletedAt: null },
    select: {
      id: true,
      name: true,
      slug: true,
      sku: true,
      status: true,
      minimumStock: true,
      category: { select: { name: true, slug: true } },
      images: { where: { isMain: true }, take: 1, select: { url: true } },
    },
  });

  if (product !== null) {
    return {
      code: upper,
      matchedBy: 'PRODUCT_SKU',
      product: toProductDto(product),
      variant: null,
      variantCount: await countSellableVariants(product.id),
    };
  }

  throw ApiError.notFound(
    `ไม่พบสินค้าที่ตรงกับ "${trimmed}" — ตรวจว่าเป็นบาร์โค้ดหรือ SKU ของร้านนี้`,
  );
}

/* ────────────────────────────────── ป้ายบาร์โค้ด ────────────────────────────────── */

export type RequestedSymbology = 'auto' | 'code128' | 'qrcode';

export interface LabelItemDto {
  variantId: string;
  productId: string;
  productName: string;
  productSlug: string;
  sku: string;
  barcode: string | null;
  isActive: boolean;
  colorName: string | null;
  sizeName: string | null;
  finalPrice: number;
  /** สัญลักษณ์ที่ใช้วาดจริง (อาจต่างจากที่ขอ เมื่อขอเป็น auto) */
  symbology: Symbology;
  /** ค่าที่ถูกเข้ารหัสไว้ในภาพ — สแกนแล้วต้องได้ค่านี้ */
  encodedValue: string;
  /** สแกนแล้วได้อะไร: บาร์โค้ดสินค้า / รหัสภายในร้าน / ลิงก์หน้าสินค้า */
  encodes: 'GTIN' | 'SKU' | 'PRODUCT_URL';
  svg: string;
  width: number;
  height: number;
}

export interface LabelSheetResult {
  requested: RequestedSymbology;
  copies: number;
  items: LabelItemDto[];
  /**
   * variantId ที่ขอมาแต่ใช้ไม่ได้ (ไม่มีจริงหรือถูกลบแล้ว)
   * ต้องบอกตรง ๆ ว่าอันไหนหายไป ห้ามพิมพ์ป้ายให้น้อยกว่าที่ขอแบบเงียบ ๆ
   */
  missingVariantIds: string[];
}

const LABEL_VARIANT_SELECT = {
  id: true,
  sku: true,
  barcode: true,
  isActive: true,
  price: true,
  salePrice: true,
  color: { select: { name: true } },
  size: { select: { name: true } },
  product: { select: { id: true, name: true, slug: true, price: true, salePrice: true } },
} as const satisfies Prisma.ProductVariantSelect;

type LabelVariantRow = Prisma.ProductVariantGetPayload<{ select: typeof LABEL_VARIANT_SELECT }>;

/**
 * เลือกสัญลักษณ์และค่าที่จะเข้ารหัสของตัวเลือกหนึ่งตัว
 *
 * `auto` = ใช้บาร์โค้ดสินค้า (EAN/UPC) ถ้ามีและใช้ได้จริง ไม่มีก็ใช้ Code 128 ของ SKU
 * → ป้ายจึงสแกนได้เสมอ **โดยไม่ต้องกุเลขบาร์โค้ดขึ้นมาให้**
 */
function planSymbol(
  variant: LabelVariantRow,
  requested: RequestedSymbology,
): { symbology: Symbology; value: string; encodes: LabelItemDto['encodes'] } {
  if (requested === 'qrcode') {
    return {
      symbology: 'qrcode',
      value: storefrontUrlOf(variant.product.slug),
      encodes: 'PRODUCT_URL',
    };
  }

  if (requested === 'code128') {
    return { symbology: 'code128', value: variant.sku, encodes: 'SKU' };
  }

  const gtinSymbology =
    variant.barcode !== null && isValidGtin(variant.barcode)
      ? symbologyForGtin(variant.barcode)
      : null;

  if (gtinSymbology !== null && variant.barcode !== null) {
    return { symbology: gtinSymbology, value: variant.barcode, encodes: 'GTIN' };
  }

  return { symbology: 'code128', value: variant.sku, encodes: 'SKU' };
}

export async function buildLabels(input: LabelRequestInput): Promise<LabelSheetResult> {
  const prisma = getPrisma();

  const where: Prisma.ProductVariantWhereInput =
    input.variantIds !== undefined
      ? { id: { in: input.variantIds }, deletedAt: null, product: { deletedAt: null } }
      : { productId: input.productId, deletedAt: null, product: { deletedAt: null } };

  const variants = await prisma.productVariant.findMany({
    where,
    orderBy: { sku: 'asc' },
    select: LABEL_VARIANT_SELECT,
  });

  if (variants.length === 0) {
    throw ApiError.notFound('ไม่พบตัวเลือกสินค้าที่จะพิมพ์ป้าย');
  }

  const found = new Set(variants.map((variant) => variant.id));

  return {
    requested: input.symbology,
    copies: input.copies,
    missingVariantIds: (input.variantIds ?? []).filter((id) => !found.has(id)),
    items: variants.map((variant) => {
      const plan = planSymbol(variant, input.symbology);
      const rendered = renderSymbol(plan.symbology, plan.value, {
        // QR ไม่ต้องมีข้อความในภาพ เพราะป้ายพิมพ์ชื่อสินค้าและ SKU ไว้ข้าง ๆ อยู่แล้ว
        showText: plan.symbology !== 'qrcode',
      });
      const price = resolveVariantPrice(variant, variant.product);

      return {
        variantId: variant.id,
        productId: variant.product.id,
        productName: variant.product.name,
        productSlug: variant.product.slug,
        sku: variant.sku,
        barcode: variant.barcode,
        isActive: variant.isActive,
        colorName: variant.color?.name ?? null,
        sizeName: variant.size?.name ?? null,
        finalPrice: price.finalPrice,
        symbology: rendered.symbology,
        encodedValue: rendered.value,
        encodes: plan.encodes,
        svg: rendered.svg,
        width: rendered.width,
        height: rendered.height,
      };
    }),
  };
}

/* ───────────────────────────── ออกบาร์โค้ดของร้านให้ ───────────────────────────── */

/** จำนวนครั้งที่ยอมสุ่มใหม่เมื่อเลขที่สุ่มได้ชนกับของเดิม */
const ASSIGN_MAX_ATTEMPTS = 5;

function randomInternalGtin13(): string {
  let body = '';
  for (let index = 0; index < 10; index += 1) {
    body += String(randomInt(0, 10));
  }

  return internalGtin13(body);
}

export interface AssignBarcodeResult {
  variantId: string;
  sku: string;
  barcode: string;
  barcodeKind: 'EAN-13';
  /** จำนวนครั้งที่ต้องสุ่ม (มากกว่า 1 = เจอเลขซ้ำแล้วสุ่มใหม่) */
  attempts: number;
}

/**
 * ออกบาร์โค้ดของร้าน (GTIN-13 prefix 20) ให้ตัวเลือกที่ยังไม่มี
 *
 * ⚠️ **ไม่เขียนทับบาร์โค้ดเดิม** — ถ้ามีอยู่แล้วต้อง 409 เพราะเลขเดิมอาจเป็นเลขจริง
 *    จากผู้ผลิตที่พิมพ์ติดกับสินค้าไปแล้ว การเปลี่ยนเงียบ ๆ ทำให้ของในร้านสแกนไม่ตรงกับระบบ
 *    (ถ้าต้องการเปลี่ยน ต้องล้างค่าเดิมที่หน้าจัดการสินค้าก่อน)
 * ⚠️ ความไม่ซ้ำมาจาก unique index ของฐานข้อมูล — การสุ่มใหม่เป็นเพียงการลดโอกาสชน
 *    ไม่ใช่การรับประกัน
 */
export async function assignInternalBarcode(
  actor: AdminActor,
  variantId: string,
): Promise<AssignBarcodeResult> {
  const prisma = getPrisma();

  const variant = await prisma.productVariant.findFirst({
    where: { id: variantId, deletedAt: null, product: { deletedAt: null } },
    select: { id: true, sku: true, barcode: true, productId: true },
  });

  if (variant === null) throw ApiError.notFound('ไม่พบตัวเลือกสินค้านี้');

  if (variant.barcode !== null) {
    throw ApiError.conflict(
      `ตัวเลือกนี้มีบาร์โค้ด ${variant.barcode} อยู่แล้ว — ถ้าต้องการเลขใหม่ ให้ล้างค่าเดิมที่หน้าจัดการสินค้าก่อน`,
    );
  }

  for (let attempt = 1; attempt <= ASSIGN_MAX_ATTEMPTS; attempt += 1) {
    const candidate = randomInternalGtin13();

    try {
      return await prisma.$transaction(async (tx) => {
        await tx.productVariant.update({ where: { id: variantId }, data: { barcode: candidate } });

        await tx.adminLog.create({
          data: {
            userId: actor.id,
            action: 'product.variant.barcode.assign',
            targetType: 'PRODUCT',
            targetId: variant.productId,
            before: { variantId, sku: variant.sku, barcode: null },
            after: { variantId, sku: variant.sku, barcode: candidate, source: 'INTERNAL' },
            ...(actor.ip !== undefined ? { ipAddress: actor.ip } : {}),
            ...(actor.userAgent !== undefined ? { userAgent: actor.userAgent } : {}),
          },
        });

        return {
          variantId,
          sku: variant.sku,
          barcode: candidate,
          barcodeKind: 'EAN-13' as const,
          attempts: attempt,
        };
      });
    } catch (error) {
      const isDuplicate =
        error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

      if (!isDuplicate || attempt === ASSIGN_MAX_ATTEMPTS) throw error;
    }
  }

  // มาถึงบรรทัดนี้ไม่ได้ (ลูปด้านบน return หรือ throw เสมอ) — มีไว้ให้ TypeScript พอใจ
  throw ApiError.internal('ออกบาร์โค้ดไม่สำเร็จ');
}
