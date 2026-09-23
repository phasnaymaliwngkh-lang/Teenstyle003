import { Readable } from 'node:stream';

import { getPrisma, isValidGtin, Prisma } from '@teenstyle/database';
import ExcelJS from 'exceljs';

import { resolveStockStatus } from '../models/product.model.ts';
import {
  MIME_CSV,
  MIME_XLSX,
  styleWorksheet,
  workbookToBuffer,
  type ExportResult,
} from '../models/spreadsheet.ts';
import { ApiError } from '../utils/api-error.ts';
import type {
  ExportInventoryQuery,
  ExportOrdersQuery,
  ExportProductsQuery,
  FileFormat,
} from '../validators/import-export.validator.ts';
import {
  inventoryImportRowSchema,
  productImportRowSchema,
} from '../validators/import-export.validator.ts';

import type { AdminActor } from './product-admin.service.ts';
import { notifySafely, notifyWishlistPriceDrops } from './notification.service.ts';
import { scanAlertsAfterStockChange } from './stock-alert.service.ts';

/**
 * บริการนำเข้าและส่งออกข้อมูล (STEP 18 — Import / Export CSV, Excel)
 *
 * กฎที่ห้ามละเมิด
 *   1. สต็อกห้ามติดลบ และห้ามตัดของที่ลูกค้าจองไว้ (atomic check quantity + delta >= reservedQuantity)
 *   2. ทุกการปรับสต็อกต้องมี InventoryMovement เสมอ (append-only audit trail)
 *   3. บาร์โค้ดต้องผ่านการคำนวณ check digit จริง (ตามกฎ STEP 17)
 *   4. ไฟล์ CSV สำหรับ Excel บน Windows ต้องมี UTF-8 BOM ป้องกันตัวอักษรไทยเพี้ยน
 *   5. บันทึก AdminLog สำหรับทุกการนำเข้า
 */

export type { ExportResult };

export interface ImportErrorDetail {
  row: number;
  field?: string;
  sku?: string;
  message: string;
}

export interface ProductImportPreview {
  row: number;
  productName: string;
  sku: string;
  variantSku: string;
  category: string;
  brand?: string;
  price: number;
  salePrice?: number | null;
  color?: string;
  size?: string;
  barcode?: string;
  initialStock: number;
  action: 'CREATE' | 'UPDATE';
}

export interface ProductImportResult {
  success: boolean;
  dryRun: boolean;
  totalRows: number;
  validCount: number;
  errorCount: number;
  errors: ImportErrorDetail[];
  createdProducts?: number;
  updatedProducts?: number;
  createdVariants?: number;
  updatedVariants?: number;
  preview?: ProductImportPreview[];
}

export interface InventoryImportPreview {
  row: number;
  sku: string;
  productName: string;
  type: string;
  currentQuantity: number;
  reservedQuantity: number;
  delta: number;
  newQuantity: number;
  availableBefore: number;
  availableAfter: number;
  reason: string;
  status: 'VALID' | 'INVALID';
  error?: string;
}

export interface InventoryImportResult {
  success: boolean;
  dryRun: boolean;
  totalRows: number;
  validCount: number;
  errorCount: number;
  errors: ImportErrorDetail[];
  adjustedCount?: number;
  preview?: InventoryImportPreview[];
}

/* ─────────────────────────── File Helpers ─────────────────────────── */

// สไตล์หัวตาราง · UTF-8 BOM · MIME type ย้ายไป models/spreadsheet.ts ตอน STEP 26
// (รายงานยอดขายใช้ชุดเดียวกัน ไฟล์ที่ส่งออกจากทุกที่จึงหน้าตาเหมือนกัน)

function isZipBuffer(buf: Buffer): boolean {
  return (
    buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04
  );
}

async function parseSpreadsheetBuffer(
  fileBuffer: Buffer,
  fileName: string,
): Promise<ExcelJS.Worksheet> {
  const workbook = new ExcelJS.Workbook();
  const isCsv = fileName.toLowerCase().endsWith('.csv') || !isZipBuffer(fileBuffer);

  if (isCsv) {
    // ลบ BOM ถ้ามี
    let cleanBuffer = fileBuffer;
    if (
      cleanBuffer.length >= 3 &&
      cleanBuffer[0] === 0xef &&
      cleanBuffer[1] === 0xbb &&
      cleanBuffer[2] === 0xbf
    ) {
      cleanBuffer = cleanBuffer.subarray(3);
    }
    await workbook.csv.read(Readable.from(cleanBuffer));
  } else {
    await workbook.xlsx.load(fileBuffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  }

  const worksheet = workbook.worksheets[0];
  if (!worksheet || worksheet.rowCount === 0) {
    throw ApiError.badRequest('ไฟล์ที่อัปโหลดไม่มีข้อมูลหรือว่างเปล่า');
  }

  return worksheet;
}

/* ─────────────────────────── ส่งออกสินค้า ─────────────────────────── */

export async function exportProducts(query: ExportProductsQuery): Promise<ExportResult> {
  const prisma = getPrisma();

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    ...(query.status !== 'ALL' ? { status: query.status } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.brandId ? { brandId: query.brandId } : {}),
  };

  const products = await prisma.product.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      category: { select: { name: true, slug: true } },
      brand: { select: { name: true, slug: true } },
      variants: {
        where: { deletedAt: null },
        orderBy: { sku: 'asc' },
        include: {
          color: { select: { name: true, slug: true } },
          size: { select: { name: true, code: true } },
          inventory: { select: { quantity: true, reservedQuantity: true, location: true } },
        },
      },
    },
  });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Products');

  worksheet.columns = [
    { header: 'รหัสสินค้า (ID)', key: 'productId' },
    { header: 'ชื่อสินค้า (Name)', key: 'name' },
    { header: 'Slug', key: 'slug' },
    { header: 'SKU สินค้า', key: 'productSku' },
    { header: 'หมวดหมู่ (Category)', key: 'category' },
    { header: 'แบรนด์ (Brand)', key: 'brand' },
    { header: 'สถานะ (Status)', key: 'status' },
    { header: 'ราคาปกติ (Price)', key: 'price' },
    { header: 'ราคาลด (Sale Price)', key: 'salePrice' },
    { header: 'จุดเตือนสต็อกต่ำ (Min Stock)', key: 'minimumStock' },
    { header: 'SKU ตัวเลือก (Variant SKU)', key: 'variantSku' },
    { header: 'สี (Color)', key: 'color' },
    { header: 'ไซซ์ (Size)', key: 'size' },
    { header: 'บาร์โค้ด (Barcode)', key: 'barcode' },
    { header: 'ราคาเฉพาะตัวเลือก (Variant Price)', key: 'variantPrice' },
    { header: 'ราคาลดเฉพาะตัวเลือก (Variant Sale)', key: 'variantSalePrice' },
    { header: 'สต็อกในคลัง (Quantity)', key: 'quantity' },
    { header: 'จองไว้ (Reserved)', key: 'reserved' },
    { header: 'ขายได้จริง (Available)', key: 'available' },
    { header: 'ที่เก็บ (Location)', key: 'location' },
    { header: 'เปิดใช้งาน (Active)', key: 'isActive' },
  ];

  for (const product of products) {
    if (product.variants.length === 0) {
      worksheet.addRow({
        productId: product.id,
        name: product.name,
        slug: product.slug,
        productSku: product.sku,
        category: product.category.name,
        brand: product.brand?.name ?? '',
        status: product.status,
        price: Number(product.price),
        salePrice: product.salePrice !== null ? Number(product.salePrice) : '',
        minimumStock: product.minimumStock,
        variantSku: '',
        color: '',
        size: '',
        barcode: '',
        variantPrice: '',
        variantSalePrice: '',
        quantity: 0,
        reserved: 0,
        available: 0,
        location: '',
        isActive: false,
      });
    } else {
      for (const variant of product.variants) {
        const qty = variant.inventory?.quantity ?? 0;
        const res = variant.inventory?.reservedQuantity ?? 0;
        const avail = Math.max(0, qty - res);

        worksheet.addRow({
          productId: product.id,
          name: product.name,
          slug: product.slug,
          productSku: product.sku,
          category: product.category.name,
          brand: product.brand?.name ?? '',
          status: product.status,
          price: Number(product.price),
          salePrice: product.salePrice !== null ? Number(product.salePrice) : '',
          minimumStock: product.minimumStock,
          variantSku: variant.sku,
          color: variant.color?.name ?? '',
          size: variant.size?.name ?? '',
          barcode: variant.barcode ?? '',
          variantPrice: variant.price !== null ? Number(variant.price) : '',
          variantSalePrice: variant.salePrice !== null ? Number(variant.salePrice) : '',
          quantity: qty,
          reserved: res,
          available: avail,
          location: variant.inventory?.location ?? '',
          isActive: variant.isActive ? 'YES' : 'NO',
        });
      }
    }
  }

  styleWorksheet(worksheet);

  const dateStr = new Date().toISOString().slice(0, 10);
  const ext = query.format === 'csv' ? 'csv' : 'xlsx';
  const filename = `products_export_${dateStr}.${ext}`;
  const buffer = await workbookToBuffer(workbook, query.format);

  return {
    buffer,
    filename,
    mimeType: query.format === 'csv' ? MIME_CSV : MIME_XLSX,
  };
}

/* ─────────────────────────── ส่งออกคลังสินค้า ─────────────────────────── */

export async function exportInventory(query: ExportInventoryQuery): Promise<ExportResult> {
  const prisma = getPrisma();

  const variants = await prisma.productVariant.findMany({
    where: {
      deletedAt: null,
      product: { deletedAt: null },
      ...(query.location ? { inventory: { location: { contains: query.location } } } : {}),
    },
    orderBy: [{ product: { name: 'asc' } }, { sku: 'asc' }],
    include: {
      product: {
        select: {
          id: true,
          name: true,
          sku: true,
          minimumStock: true,
          category: { select: { name: true } },
        },
      },
      color: { select: { name: true } },
      size: { select: { name: true } },
      inventory: {
        select: { quantity: true, reservedQuantity: true, location: true, updatedAt: true },
      },
    },
  });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Inventory');

  worksheet.columns = [
    { header: 'Variant ID', key: 'variantId' },
    { header: 'SKU ตัวเลือก', key: 'sku' },
    { header: 'บาร์โค้ด (Barcode)', key: 'barcode' },
    { header: 'ชื่อสินค้า', key: 'productName' },
    { header: 'หมวดหมู่', key: 'category' },
    { header: 'สี', key: 'color' },
    { header: 'ไซซ์', key: 'size' },
    { header: 'ที่เก็บ (Location)', key: 'location' },
    { header: 'สต็อกในคลัง (Quantity)', key: 'quantity' },
    { header: 'จองไว้ (Reserved)', key: 'reserved' },
    { header: 'ขายได้จริง (Available)', key: 'available' },
    { header: 'จุดเตือนสต็อกต่ำ', key: 'minimumStock' },
    { header: 'สถานะสต็อก', key: 'stockStatus' },
    { header: 'อัปเดตล่าสุด', key: 'updatedAt' },
  ];

  for (const variant of variants) {
    const qty = variant.inventory?.quantity ?? 0;
    const res = variant.inventory?.reservedQuantity ?? 0;
    const avail = Math.max(0, qty - res);
    const stockStatus = resolveStockStatus(avail, variant.product.minimumStock);

    if (query.stockStatus !== 'ALL' && stockStatus !== query.stockStatus) {
      continue;
    }

    worksheet.addRow({
      variantId: variant.id,
      sku: variant.sku,
      barcode: variant.barcode ?? '',
      productName: variant.product.name,
      category: variant.product.category.name,
      color: variant.color?.name ?? '',
      size: variant.size?.name ?? '',
      location: variant.inventory?.location ?? '',
      quantity: qty,
      reserved: res,
      available: avail,
      minimumStock: variant.product.minimumStock,
      stockStatus,
      updatedAt: variant.inventory?.updatedAt ? variant.inventory.updatedAt.toISOString() : '',
    });
  }

  styleWorksheet(worksheet);

  const dateStr = new Date().toISOString().slice(0, 10);
  const ext = query.format === 'csv' ? 'csv' : 'xlsx';
  const filename = `inventory_export_${dateStr}.${ext}`;
  const buffer = await workbookToBuffer(workbook, query.format);

  return {
    buffer,
    filename,
    mimeType: query.format === 'csv' ? MIME_CSV : MIME_XLSX,
  };
}

/* ─────────────────────────── ส่งออกคำสั่งซื้อ ─────────────────────────── */

export async function exportOrders(query: ExportOrdersQuery): Promise<ExportResult> {
  const prisma = getPrisma();

  const where: Prisma.OrderWhereInput = {
    deletedAt: null,
    ...(query.status !== 'ALL' ? { status: query.status } : {}),
    ...(query.startDate || query.endDate
      ? {
          createdAt: {
            ...(query.startDate ? { gte: new Date(query.startDate) } : {}),
            ...(query.endDate ? { lte: new Date(query.endDate) } : {}),
          },
        }
      : {}),
  };

  const orders = await prisma.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      user: { select: { name: true, email: true, phone: true } },
      items: { select: { id: true } },
      payments: {
        select: { provider: true, status: true, amount: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      shipments: {
        select: { trackingNumber: true, status: true },
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  });

  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Orders');

  worksheet.columns = [
    { header: 'เลขคำสั่งซื้อ', key: 'orderNumber' },
    { header: 'วันที่สั่งซื้อ', key: 'createdAt' },
    { header: 'ชื่อลูกค้า', key: 'customerName' },
    { header: 'อีเมลลูกค้า', key: 'customerEmail' },
    { header: 'เบอร์โทร', key: 'customerPhone' },
    { header: 'สถานะคำสั่งซื้อ', key: 'orderStatus' },
    { header: 'สถานะการชำระเงิน', key: 'paymentStatus' },
    { header: 'ช่องทางชำระเงิน', key: 'paymentMethod' },
    { header: 'ยอดสินค้ารวม', key: 'subtotal' },
    { header: 'ส่วนลด', key: 'discount' },
    { header: 'ค่าจัดส่ง', key: 'shippingFee' },
    { header: 'ยอดสุทธิ', key: 'total' },
    { header: 'จำนวนชิ้น', key: 'itemCount' },
    { header: 'วิธีจัดส่ง', key: 'shippingMethod' },
    { header: 'เลขพัสดุ', key: 'trackingNumber' },
  ];

  for (const order of orders) {
    const latestPayment = order.payments[0];
    const latestShipment = order.shipments[0];

    worksheet.addRow({
      orderNumber: order.orderNumber,
      createdAt: order.createdAt.toISOString(),
      customerName: order.user.name ?? 'ไม่ระบุ',
      customerEmail: order.user.email,
      customerPhone: order.user.phone ?? '',
      orderStatus: order.status,
      paymentStatus: order.paymentStatus,
      paymentMethod: latestPayment?.provider ?? '',
      subtotal: Number(order.subtotal),
      discount: Number(order.discountTotal),
      shippingFee: Number(order.shippingFee),
      total: Number(order.total),
      itemCount: order.items.length,
      shippingMethod: order.shippingMethod,
      trackingNumber: order.trackingNumber ?? latestShipment?.trackingNumber ?? '',
    });
  }

  styleWorksheet(worksheet);

  const dateStr = new Date().toISOString().slice(0, 10);
  const ext = query.format === 'csv' ? 'csv' : 'xlsx';
  const filename = `orders_export_${dateStr}.${ext}`;
  const buffer = await workbookToBuffer(workbook, query.format);

  return {
    buffer,
    filename,
    mimeType: query.format === 'csv' ? MIME_CSV : MIME_XLSX,
  };
}

/* ─────────────────────────── ดาวน์โหลด Template ─────────────────────────── */

export async function getTemplate(
  type: 'products' | 'inventory',
  format: FileFormat,
): Promise<ExportResult> {
  const workbook = new ExcelJS.Workbook();

  if (type === 'products') {
    const worksheet = workbook.addWorksheet('Products Template');
    worksheet.columns = [
      { header: 'productName', key: 'productName' },
      { header: 'sku', key: 'sku' },
      { header: 'category', key: 'category' },
      { header: 'brand', key: 'brand' },
      { header: 'price', key: 'price' },
      { header: 'salePrice', key: 'salePrice' },
      { header: 'minimumStock', key: 'minimumStock' },
      { header: 'variantSku', key: 'variantSku' },
      { header: 'color', key: 'color' },
      { header: 'size', key: 'size' },
      { header: 'barcode', key: 'barcode' },
      { header: 'initialStock', key: 'initialStock' },
      { header: 'description', key: 'description' },
      { header: 'status', key: 'status' },
    ];

    worksheet.addRow({
      productName: 'เสื้อยืด Oversized ลายกราฟิก',
      sku: 'TS-TEE-OVER-01',
      category: 'เสื้อยืด (T-Shirts)',
      brand: 'TEENSTYLE Originals',
      price: 590,
      salePrice: 490,
      minimumStock: 5,
      variantSku: 'TS-TEE-OVER-01-BLK-M',
      color: 'ดำ',
      size: 'M',
      barcode: '2000000000010',
      initialStock: 20,
      description: 'เสื้อยืดทรงโอเวอร์ไซส์ ผลิตจากผ้าคอตตอน 100%',
      status: 'ACTIVE',
    });

    styleWorksheet(worksheet);
    const filename = `products_template.${format}`;
    const buffer = await workbookToBuffer(workbook, format);
    return { buffer, filename, mimeType: format === 'csv' ? MIME_CSV : MIME_XLSX };
  }

  // template inventory
  const worksheet = workbook.addWorksheet('Inventory Template');
  worksheet.columns = [
    { header: 'sku', key: 'sku' },
    { header: 'type', key: 'type' },
    { header: 'quantity', key: 'quantity' },
    { header: 'reason', key: 'reason' },
  ];

  worksheet.addRow({
    sku: 'TS-TEE-OVER-01-BLK-M',
    type: 'ADJUSTMENT',
    quantity: 15,
    reason: 'ตรวจนับสต็อกประจำสัปดาห์',
  });
  worksheet.addRow({
    sku: '2000000000010',
    type: 'STOCK_IN',
    quantity: 10,
    reason: 'รับสินค้าลอตใหม่เข้าคลัง',
  });

  styleWorksheet(worksheet);
  const filename = `inventory_template.${format}`;
  const buffer = await workbookToBuffer(workbook, format);
  return { buffer, filename, mimeType: format === 'csv' ? MIME_CSV : MIME_XLSX };
}

/* ─────────────────────────── นำเข้าสินค้า ─────────────────────────── */

const PRODUCT_HEADER_MAP: Record<string, string> = {
  // English
  productname: 'productName',
  name: 'productName',
  sku: 'sku',
  productsku: 'sku',
  category: 'category',
  brand: 'brand',
  price: 'price',
  saleprice: 'salePrice',
  minimumstock: 'minimumStock',
  minstock: 'minimumStock',
  variantsku: 'variantSku',
  color: 'color',
  size: 'size',
  barcode: 'barcode',
  initialstock: 'initialStock',
  stock: 'initialStock',
  description: 'description',
  status: 'status',
  // Thai
  ชื่อสินค้า: 'productName',
  รหัสสินค้า: 'sku',
  หมวดหมู่: 'category',
  แบรนด์: 'brand',
  ราคา: 'price',
  ราคาลด: 'salePrice',
  จุดเตือนสต็อกต่ำ: 'minimumStock',
  skuตัวเลือก: 'variantSku',
  สี: 'color',
  ไซซ์: 'size',
  บาร์โค้ด: 'barcode',
  สต็อกเริ่มต้น: 'initialStock',
  รายละเอียด: 'description',
  สถานะ: 'status',
};

function normalizeHeader(raw: string): string {
  const clean = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_()-]/g, '');
  return PRODUCT_HEADER_MAP[clean] ?? PRODUCT_HEADER_MAP[raw.trim()] ?? raw.trim();
}

export async function importProducts(
  actor: AdminActor,
  fileBuffer: Buffer,
  fileName: string,
  dryRun: boolean,
): Promise<ProductImportResult> {
  const prisma = getPrisma();
  const worksheet = await parseSpreadsheetBuffer(fileBuffer, fileName);

  const headerRow = worksheet.getRow(1);
  const colIndexToKey: Record<number, string> = {};

  headerRow.eachCell((cell, colNumber) => {
    const rawVal = String(cell.value ?? '');
    if (rawVal) {
      colIndexToKey[colNumber] = normalizeHeader(rawVal);
    }
  });

  const errors: ImportErrorDetail[] = [];
  const validRows: Array<{
    rowNumber: number;
    data: ReturnType<typeof productImportRowSchema.parse>;
    categoryRef: { id: string; name: string };
    brandRef: { id: string; name: string } | null;
    colorRef: { id: string; name: string } | null;
    sizeRef: { id: string; name: string } | null;
    isExistingVariant: boolean;
    isExistingProduct: boolean;
  }> = [];

  // ดึง Master Data มาแคชไว้ในหน่วยความจำสำหรับการตรวจสอบรอบเดียว (High Performance)
  const [categories, brands, colors, sizes, existingProducts, existingVariants] = await Promise.all(
    [
      prisma.category.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, slug: true },
      }),
      prisma.brand.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true, slug: true },
      }),
      prisma.color.findMany({ select: { id: true, name: true, slug: true } }),
      prisma.size.findMany({ select: { id: true, name: true, code: true } }),
      prisma.product.findMany({
        where: { deletedAt: null },
        select: { id: true, sku: true, slug: true, name: true },
      }),
      prisma.productVariant.findMany({
        where: { deletedAt: null },
        select: { id: true, sku: true, barcode: true, productId: true },
      }),
    ],
  );

  const seenVariantSkusInFile = new Set<string>();

  for (let r = 2; r <= worksheet.rowCount; r += 1) {
    const row = worksheet.getRow(r);
    let hasAnyData = false;
    const rawObj: Record<string, unknown> = {};

    for (const [colNumStr, key] of Object.entries(colIndexToKey)) {
      const colNum = Number(colNumStr);
      const cellVal = row.getCell(colNum).value;
      if (cellVal !== null && cellVal !== undefined && String(cellVal).trim() !== '') {
        hasAnyData = true;
        // จัดการชนิดข้อมูลตัวเลขและสตริง
        if (['price', 'salePrice', 'minimumStock', 'initialStock'].includes(key)) {
          const num = Number(cellVal);
          rawObj[key] = isNaN(num) ? cellVal : num;
        } else {
          rawObj[key] =
            typeof cellVal === 'object' && 'text' in cellVal
              ? (cellVal as { text: string }).text
              : String(cellVal).trim();
        }
      }
    }

    if (!hasAnyData) continue; // ข้ามแถวว่าง

    // 1. Zod schema validation
    const parsed = productImportRowSchema.safeParse(rawObj);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          row: r,
          field: issue.path.join('.'),
          message: issue.message,
        });
      }
      continue;
    }

    const data = parsed.data;

    // 2. Barcode check digit validation (STEP 17 Invariant)
    if (data.barcode && data.barcode.length > 0) {
      if (!isValidGtin(data.barcode)) {
        errors.push({
          row: r,
          field: 'barcode',
          message: `บาร์โค้ด "${data.barcode}" ไม่ผ่านการตรวจสอบ check digit ตามมาตรฐาน GS1`,
        });
        continue;
      }
    }

    // 3. ตรวจสอบหมวดหมู่ (Category)
    const categoryRef = categories.find(
      (c) =>
        c.name.toLowerCase() === data.category.toLowerCase() ||
        c.slug.toLowerCase() === data.category.toLowerCase(),
    );
    if (!categoryRef) {
      errors.push({
        row: r,
        field: 'category',
        message: `ไม่พบหมวดหมู่ "${data.category}" ในระบบ`,
      });
      continue;
    }

    // 4. ตรวจสอบแบรนด์ (Brand)
    let brandRef: { id: string; name: string } | null = null;
    if (data.brand) {
      const foundBrand = brands.find(
        (b) =>
          b.name.toLowerCase() === data.brand!.toLowerCase() ||
          b.slug.toLowerCase() === data.brand!.toLowerCase(),
      );
      if (!foundBrand) {
        errors.push({
          row: r,
          field: 'brand',
          message: `ไม่พบแบรนด์ "${data.brand}" ในระบบ`,
        });
        continue;
      }
      brandRef = foundBrand;
    }

    // 5. ตรวจสอบสี (Color)
    let colorRef: { id: string; name: string } | null = null;
    if (data.color) {
      const foundColor = colors.find(
        (c) =>
          c.name.toLowerCase() === data.color!.toLowerCase() ||
          c.slug.toLowerCase() === data.color!.toLowerCase(),
      );
      if (foundColor) {
        colorRef = foundColor;
      }
    }

    // 6. ตรวจสอบไซซ์ (Size)
    let sizeRef: { id: string; name: string } | null = null;
    if (data.size) {
      const foundSize = sizes.find(
        (s) =>
          s.name.toLowerCase() === data.size!.toLowerCase() ||
          s.code.toLowerCase() === data.size!.toLowerCase(),
      );
      if (foundSize) {
        sizeRef = foundSize;
      }
    }

    // 7. ตรวจสอบ SKU ชนกันภายในไฟล์เดียวกัน
    if (seenVariantSkusInFile.has(data.variantSku)) {
      errors.push({
        row: r,
        field: 'variantSku',
        message: `SKU ตัวเลือก "${data.variantSku}" ซ้ำกับรายการอื่นในไฟล์เดียวกัน`,
      });
      continue;
    }
    seenVariantSkusInFile.add(data.variantSku);

    const isExistingProduct = existingProducts.some(
      (p) => p.sku.toLowerCase() === data.sku.toLowerCase(),
    );
    const isExistingVariant = existingVariants.some(
      (v) => v.sku.toLowerCase() === data.variantSku.toLowerCase(),
    );

    validRows.push({
      rowNumber: r,
      data,
      categoryRef,
      brandRef,
      colorRef,
      sizeRef,
      isExistingProduct,
      isExistingVariant,
    });
  }

  const preview: ProductImportPreview[] = validRows.map((item) => ({
    row: item.rowNumber,
    productName: item.data.productName,
    sku: item.data.sku,
    variantSku: item.data.variantSku,
    category: item.categoryRef.name,
    brand: item.brandRef?.name,
    price: item.data.price,
    salePrice: item.data.salePrice,
    color: item.colorRef?.name,
    size: item.sizeRef?.name,
    barcode: item.data.barcode || undefined,
    initialStock: item.data.initialStock,
    action: item.isExistingVariant ? 'UPDATE' : 'CREATE',
  }));

  if (dryRun || errors.length > 0) {
    return {
      success: errors.length === 0,
      dryRun: true,
      totalRows: validRows.length + errors.length,
      validCount: validRows.length,
      errorCount: errors.length,
      errors,
      preview,
    };
  }

  // ดำเนินการบันทึกจริงใน transaction
  let createdProducts = 0;
  let updatedProducts = 0;
  let createdVariants = 0;
  let updatedVariants = 0;
  /** สินค้าที่ราคาถูกเขียนทับในรอบนี้ — ใช้แจ้งคนที่กดถูกใจไว้หลัง commit (STEP 24) */
  const repricedProductIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    // จัดกลุ่มตาม Product SKU
    const productGroups = new Map<string, typeof validRows>();
    for (const item of validRows) {
      const group = productGroups.get(item.data.sku) ?? [];
      group.push(item);
      productGroups.set(item.data.sku, group);
    }

    for (const [prodSku, rows] of productGroups.entries()) {
      const firstRow = rows[0];
      if (!firstRow) continue;
      const first = firstRow.data;
      const categoryRef = firstRow.categoryRef;
      const brandRef = firstRow.brandRef;

      // ตรวจหา product เดิม
      let product = await tx.product.findUnique({
        where: { sku: prodSku },
        select: { id: true, slug: true, totalStock: true },
      });

      const slug =
        first.slug && first.slug.length > 0
          ? first.slug
          : first.productName
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, '-')
              .replace(/^-|-$/g, '') || `product-${Date.now()}`;

      if (!product) {
        product = await tx.product.create({
          data: {
            name: first.productName,
            slug,
            sku: prodSku,
            description: first.description || first.productName,
            price: first.price,
            salePrice: first.salePrice ?? null,
            categoryId: categoryRef.id,
            brandId: brandRef?.id ?? null,
            status: first.status,
            minimumStock: first.minimumStock,
            publishedAt: first.status === 'ACTIVE' ? new Date() : null,
          },
          select: { id: true, slug: true, totalStock: true },
        });
        createdProducts += 1;
      } else {
        await tx.product.update({
          where: { id: product.id },
          data: {
            name: first.productName,
            price: first.price,
            salePrice: first.salePrice ?? null,
            categoryId: categoryRef.id,
            brandId: brandRef?.id ?? null,
            status: first.status,
            minimumStock: first.minimumStock,
          },
        });
        updatedProducts += 1;
        // นำเข้าไฟล์เขียนราคาทับทุกครั้ง จึงอาจทำให้ราคาถูกลงกว่าตอนที่ลูกค้ากดถูกใจ
        repricedProductIds.push(product.id);
      }

      // จัดการ Variants ใน Product
      for (const rowItem of rows) {
        const vData = rowItem.data;
        const colorRef = rowItem.colorRef;
        const sizeRef = rowItem.sizeRef;

        const existingVar = await tx.productVariant.findUnique({
          where: { sku: vData.variantSku },
          select: { id: true, inventory: { select: { quantity: true } } },
        });

        if (!existingVar) {
          const variant = await tx.productVariant.create({
            data: {
              productId: product.id,
              sku: vData.variantSku,
              barcode: vData.barcode || null,
              colorId: colorRef?.id ?? null,
              sizeId: sizeRef?.id ?? null,
              price: vData.price,
              salePrice: vData.salePrice ?? null,
              isActive: true,
              inventory: {
                create: {
                  quantity: vData.initialStock,
                  reservedQuantity: 0,
                },
              },
            },
            select: { id: true },
          });

          if (vData.initialStock > 0) {
            await tx.inventoryMovement.create({
              data: {
                variantId: variant.id,
                type: 'STOCK_IN',
                quantity: vData.initialStock,
                quantityBefore: 0,
                quantityAfter: vData.initialStock,
                reason: 'นำเข้าสินค้าเริ่มต้นจากไฟล์',
                userId: actor.id,
              },
            });

            await tx.product.update({
              where: { id: product.id },
              data: { totalStock: { increment: vData.initialStock } },
            });
          }

          createdVariants += 1;
        } else {
          await tx.productVariant.update({
            where: { id: existingVar.id },
            data: {
              barcode: vData.barcode || undefined,
              colorId: colorRef?.id ?? undefined,
              sizeId: sizeRef?.id ?? undefined,
              price: vData.price,
              salePrice: vData.salePrice ?? null,
            },
          });
          updatedVariants += 1;
        }
      }
    }

    // เขียน Audit log
    await tx.adminLog.create({
      data: {
        userId: actor.id,
        action: 'product.import',
        targetType: 'PRODUCT',
        targetId: 'BATCH',
        before: Prisma.JsonNull,
        after: {
          createdProducts,
          updatedProducts,
          createdVariants,
          updatedVariants,
          totalRows: validRows.length,
        },
        ...(actor.ip ? { ipAddress: actor.ip } : {}),
        ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
      },
    });
  });

  // ราคาที่ถูกเขียนทับอาจถูกลงกว่าตอนที่ลูกค้ากดถูกใจ → แจ้งหลัง commit (STEP 24)
  await notifySafely(
    () => notifyWishlistPriceDrops(repricedProductIds),
    'product-import:price-drop',
  );

  return {
    success: true,
    dryRun: false,
    totalRows: validRows.length,
    validCount: validRows.length,
    errorCount: 0,
    errors: [],
    createdProducts,
    updatedProducts,
    createdVariants,
    updatedVariants,
  };
}

/* ─────────────────────────── ปรับสต็อกเป็นชุด (Stock Take) ─────────────────────────── */

const INVENTORY_HEADER_MAP: Record<string, string> = {
  sku: 'sku',
  barcode: 'sku',
  type: 'type',
  quantity: 'quantity',
  reason: 'reason',
  // Thai
  รหัสสินค้า: 'sku',
  บาร์โค้ด: 'sku',
  ประเภท: 'type',
  จำนวน: 'quantity',
  เหตุผล: 'reason',
};

function normalizeInventoryHeader(raw: string): string {
  const clean = raw
    .trim()
    .toLowerCase()
    .replace(/[\s_()-]/g, '');
  return INVENTORY_HEADER_MAP[clean] ?? INVENTORY_HEADER_MAP[raw.trim()] ?? raw.trim();
}

export async function importInventory(
  actor: AdminActor,
  fileBuffer: Buffer,
  fileName: string,
  dryRun: boolean,
): Promise<InventoryImportResult> {
  const prisma = getPrisma();
  const worksheet = await parseSpreadsheetBuffer(fileBuffer, fileName);

  const headerRow = worksheet.getRow(1);
  const colIndexToKey: Record<number, string> = {};

  headerRow.eachCell((cell, colNumber) => {
    const rawVal = String(cell.value ?? '');
    if (rawVal) {
      colIndexToKey[colNumber] = normalizeInventoryHeader(rawVal);
    }
  });

  const errors: ImportErrorDetail[] = [];
  const candidateRows: Array<{
    rowNumber: number;
    raw: Record<string, unknown>;
  }> = [];

  for (let r = 2; r <= worksheet.rowCount; r += 1) {
    const row = worksheet.getRow(r);
    let hasAnyData = false;
    const rawObj: Record<string, unknown> = {};

    for (const [colNumStr, key] of Object.entries(colIndexToKey)) {
      const colNum = Number(colNumStr);
      const cellVal = row.getCell(colNum).value;
      if (cellVal !== null && cellVal !== undefined && String(cellVal).trim() !== '') {
        hasAnyData = true;
        if (key === 'quantity') {
          const num = Number(cellVal);
          rawObj[key] = isNaN(num) ? cellVal : num;
        } else {
          rawObj[key] =
            typeof cellVal === 'object' && 'text' in cellVal
              ? (cellVal as { text: string }).text
              : String(cellVal).trim();
        }
      }
    }

    if (!hasAnyData) continue;
    candidateRows.push({ rowNumber: r, raw: rawObj });
  }

  // ดึงข้อมูล Variant ทั้งหมดที่มี SKU หรือ Barcode ตรงกับในไฟล์
  const searchCodes = candidateRows.map((item) => String(item.raw['sku'] ?? ''));
  const variants = await prisma.productVariant.findMany({
    where: {
      deletedAt: null,
      OR: [{ sku: { in: searchCodes } }, { barcode: { in: searchCodes } }],
    },
    include: {
      product: { select: { id: true, name: true } },
      inventory: { select: { quantity: true, reservedQuantity: true } },
    },
  });

  const preview: InventoryImportPreview[] = [];
  const validExecutions: Array<{
    rowNumber: number;
    variantId: string;
    productId: string;
    type: 'ADJUSTMENT' | 'STOCK_IN' | 'STOCK_OUT';
    delta: number;
    quantityBefore: number;
    quantityAfter: number;
    reason: string;
  }> = [];

  for (const item of candidateRows) {
    const r = item.rowNumber;
    const parsed = inventoryImportRowSchema.safeParse(item.raw);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push({
          row: r,
          field: issue.path.join('.'),
          message: issue.message,
        });
      }
      continue;
    }

    const data = parsed.data;
    const variant = variants.find(
      (v) => v.sku === data.sku || (v.barcode && v.barcode === data.sku),
    );

    if (!variant || !variant.inventory) {
      errors.push({
        row: r,
        field: 'sku',
        sku: data.sku,
        message: `ไม่พบตัวเลือกสินค้าหรือบาร์โค้ด "${data.sku}" ในระบบ`,
      });
      preview.push({
        row: r,
        sku: data.sku,
        productName: 'ไม่พบในระบบ',
        type: data.type,
        currentQuantity: 0,
        reservedQuantity: 0,
        delta: 0,
        newQuantity: 0,
        availableBefore: 0,
        availableAfter: 0,
        reason: data.reason,
        status: 'INVALID',
        error: `ไม่พบตัวเลือกสินค้าหรือบาร์โค้ด "${data.sku}"`,
      });
      continue;
    }

    const currentQty = variant.inventory.quantity;
    const reservedQty = variant.inventory.reservedQuantity;
    let delta = 0;

    switch (data.type) {
      case 'STOCK_IN':
        delta = data.quantity;
        break;
      case 'STOCK_OUT':
        delta = -data.quantity;
        break;
      case 'ADJUSTMENT':
        delta = data.quantity - currentQty;
        break;
    }

    const newQty = currentQty + delta;
    const availBefore = Math.max(0, currentQty - reservedQty);
    const availAfter = Math.max(0, newQty - reservedQty);

    // กฎเหล็ก: สต็อกห้ามต่ำกว่าที่ลูกค้าจองไว้ และห้ามติดลบ
    if (newQty < reservedQty) {
      const msg = `ยอดสต็อกหลังปรับติดลบหรือต่ำกว่าของที่ลูกค้าจองไว้ (ยอดปัจจุบัน: ${currentQty}, ลูกค้าจอง: ${reservedQty}, ต้องการปรับ: ${delta})`;
      errors.push({
        row: r,
        field: 'quantity',
        sku: data.sku,
        message: msg,
      });
      preview.push({
        row: r,
        sku: variant.sku,
        productName: variant.product.name,
        type: data.type,
        currentQuantity: currentQty,
        reservedQuantity: reservedQty,
        delta,
        newQuantity: newQty,
        availableBefore: availBefore,
        availableAfter: availAfter,
        reason: data.reason,
        status: 'INVALID',
        error: msg,
      });
      continue;
    }

    preview.push({
      row: r,
      sku: variant.sku,
      productName: variant.product.name,
      type: data.type,
      currentQuantity: currentQty,
      reservedQuantity: reservedQty,
      delta,
      newQuantity: newQty,
      availableBefore: availBefore,
      availableAfter: availAfter,
      reason: data.reason,
      status: 'VALID',
    });

    if (delta !== 0) {
      validExecutions.push({
        rowNumber: r,
        variantId: variant.id,
        productId: variant.product.id,
        type: data.type,
        delta,
        quantityBefore: currentQty,
        quantityAfter: newQty,
        reason: data.reason,
      });
    }
  }

  if (dryRun || errors.length > 0) {
    return {
      success: errors.length === 0,
      dryRun: true,
      totalRows: candidateRows.length,
      validCount: candidateRows.length - errors.length,
      errorCount: errors.length,
      errors,
      preview,
    };
  }

  // ดำเนินการปรับยอดสต็อกจริงใน transaction แบบ atomic
  await prisma.$transaction(async (tx) => {
    for (const exec of validExecutions) {
      const updated = await tx.$queryRaw<Array<{ after: number }>>`
        UPDATE "Inventory"
           SET "quantity" = "quantity" + ${exec.delta},
               "updatedAt" = now()
         WHERE "variantId" = ${exec.variantId}::uuid
           AND "quantity" + ${exec.delta} >= "reservedQuantity"
         RETURNING "quantity" AS after
      `;

      const updatedRow = updated[0];
      if (updated.length === 0 || !updatedRow) {
        throw ApiError.conflict(
          `ไม่สามารถปรับสต็อกตัวเลือก ${exec.variantId} ได้ (สต็อกเปลี่ยนไปในระหว่างประมวลผล)`,
        );
      }

      await tx.inventoryMovement.create({
        data: {
          variantId: exec.variantId,
          type: exec.type,
          quantity: Math.abs(exec.delta),
          quantityBefore: exec.quantityBefore,
          quantityAfter: updatedRow.after,
          reason: exec.reason,
          userId: actor.id,
        },
      });

      await tx.product.update({
        where: { id: exec.productId },
        data: { totalStock: { increment: exec.delta } },
      });
    }

    await tx.adminLog.create({
      data: {
        userId: actor.id,
        action: 'inventory.import_adjust',
        targetType: 'INVENTORY',
        targetId: 'BATCH',
        before: Prisma.JsonNull,
        after: {
          adjustedCount: validExecutions.length,
          totalRows: candidateRows.length,
        },
        ...(actor.ip ? { ipAddress: actor.ip } : {}),
        ...(actor.userAgent ? { userAgent: actor.userAgent } : {}),
      },
    });
  });

  const affectedVariantIds = validExecutions.map((e) => e.variantId);
  if (affectedVariantIds.length > 0) {
    await scanAlertsAfterStockChange(affectedVariantIds);
  }

  return {
    success: true,
    dryRun: false,
    totalRows: candidateRows.length,
    validCount: validExecutions.length,
    errorCount: 0,
    errors: [],
    adjustedCount: validExecutions.length,
  };
}
