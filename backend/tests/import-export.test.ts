import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma, internalGtin13 } from '@teenstyle/database';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { env } from '../src/config/index.ts';

const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

let admin = { id: '', token: '' };
let employee = { id: '', token: '' };
let customer = { id: '', token: '' };

const createdProductIds: string[] = [];

async function createUser(role: 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-import-export-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

const asAdmin = () => ({
  Authorization: `Bearer ${admin.token}`,
  Origin: env.CORS_ORIGIN,
});

const asEmployee = () => ({
  Authorization: `Bearer ${employee.token}`,
  Origin: env.CORS_ORIGIN,
});

const asCustomer = () => ({
  Authorization: `Bearer ${customer.token}`,
  Origin: env.CORS_ORIGIN,
});

beforeAll(async () => {
  admin = await createUser('ADMIN', 'admin');
  employee = await createUser('EMPLOYEE', 'employee');
  customer = await createUser('CUSTOMER', 'customer');
});

afterAll(async () => {
  if (createdProductIds.length > 0) {
    await prisma.product.deleteMany({
      where: { id: { in: createdProductIds } },
    });
  }

  await prisma.session.deleteMany({
    where: { userId: { in: [admin.id, employee.id, customer.id] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [admin.id, employee.id, customer.id] } },
  });

  await disconnectDatabase();
});

const binaryParser = (
  res: unknown,
  callback: (err: Error | null, body: Buffer) => void,
) => {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
};

describe('STEP 18: Import / Export (CSV, Excel)', () => {
  describe('ระบบส่งออกข้อมูล (Export)', () => {
    it('ส่งออกสินค้าเป็น CSV มี UTF-8 BOM และหัวตารางครบถ้วน', async () => {
      const res = await request(app)
        .get('/api/admin/export/products?format=csv')
        .buffer(true)
        .parse(binaryParser)
        .set(asAdmin())
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');

      // ตรวจ UTF-8 BOM
      const buf = res.body as Buffer;
      expect(buf[0]).toBe(0xef);
      expect(buf[1]).toBe(0xbb);
      expect(buf[2]).toBe(0xbf);

      const text = buf.toString('utf-8');
      expect(text).toContain('รหัสสินค้า (ID)');
      expect(text).toContain('ชื่อสินค้า (Name)');
      expect(text).toContain('SKU ตัวเลือก (Variant SKU)');
    });

    it('ส่งออกสินค้าเป็น Excel (.xlsx) เปิดอ่านและมีแถวข้อมูลจริง', async () => {
      const res = await request(app)
        .get('/api/admin/export/products?format=xlsx')
        .buffer(true)
        .parse(binaryParser)
        .set(asAdmin())
        .expect(200);

      expect(res.headers['content-type']).toContain('spreadsheetml');
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(res.body as unknown as Parameters<typeof workbook.xlsx.load>[0]);

      const worksheet = workbook.worksheets[0];
      expect(worksheet).toBeDefined();
      expect(worksheet!.rowCount).toBeGreaterThan(1); // มี header + ข้อมูล seed
    });

    it('ส่งออกคลังสินค้าเป็น CSV และ Excel', async () => {
      const resCsv = await request(app)
        .get('/api/admin/export/inventory?format=csv')
        .buffer(true)
        .parse(binaryParser)
        .set(asEmployee())
        .expect(200);

      expect(resCsv.headers['content-type']).toContain('text/csv');
      const csvText = (resCsv.body as Buffer).toString('utf-8');
      expect(csvText).toContain('Variant ID');
      expect(csvText).toContain('สต็อกในคลัง (Quantity)');

      const resXlsx = await request(app)
        .get('/api/admin/export/inventory?format=xlsx')
        .buffer(true)
        .parse(binaryParser)
        .set(asEmployee())
        .expect(200);

      expect(resXlsx.headers['content-type']).toContain('spreadsheetml');
    });

    it('ส่งออกคำสั่งซื้อเป็น CSV', async () => {
      const res = await request(app)
        .get('/api/admin/export/orders?format=csv')
        .buffer(true)
        .parse(binaryParser)
        .set(asAdmin())
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      const text = (res.body as Buffer).toString('utf-8');
      expect(text).toContain('เลขคำสั่งซื้อ');
      expect(text).toContain('ยอดสุทธิ');
    });

    it('ดาวน์โหลดแม่แบบ (Templates) สำหรับสินค้าและคลังสินค้า', async () => {
      const resProd = await request(app)
        .get('/api/admin/export/templates/products?format=csv')
        .buffer(true)
        .parse(binaryParser)
        .set(asAdmin())
        .expect(200);

      const prodText = (resProd.body as Buffer).toString('utf-8');
      expect(prodText).toContain('productName');
      expect(prodText).toContain('variantSku');

      const resInv = await request(app)
        .get('/api/admin/export/templates/inventory?format=xlsx')
        .buffer(true)
        .parse(binaryParser)
        .set(asEmployee())
        .expect(200);

      expect(resInv.headers['content-type']).toContain('spreadsheetml');
    });
  });

  describe('ระบบนำเข้าสินค้า (Product Import)', () => {
    const validGtin = internalGtin13(String(Date.now()).slice(-10));
    const validCsv = [
      'productName,sku,category,price,variantSku,initialStock,barcode,status',
      `"เสื้อยืดเทสต์นำเข้า ${suffix}","TS-IMP-${suffix}","เสื้อยืด",450,"TS-IMP-VAR-${suffix}",15,"${validGtin}","ACTIVE"`,
    ].join('\n');

    it('Dry Run: ตรวจสอบความถูกต้องโดยไม่บันทึกลงฐานข้อมูล', async () => {
      const res = await request(app)
        .post('/api/admin/import/products?dryRun=true')
        .set(asAdmin())
        .attach('file', Buffer.from(validCsv), 'import_products.csv')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.validCount).toBe(1);
      expect(res.body.data.errorCount).toBe(0);
      expect(res.body.data.preview[0].productName).toContain(`เสื้อยืดเทสต์นำเข้า ${suffix}`);

      // ตรวจสอบฐานข้อมูลว่ายังไม่ถูกสร้างจริง
      const exists = await prisma.product.findUnique({
        where: { sku: `TS-IMP-${suffix}` },
      });
      expect(exists).toBeNull();
    });

    it('นำเข้าจริง: สร้างสินค้า ตัวเลือก สต็อก และ InventoryMovement (STOCK_IN)', async () => {
      const res = await request(app)
        .post('/api/admin/import/products?dryRun=false')
        .set(asAdmin())
        .attach('file', Buffer.from(validCsv), 'import_products.csv')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.dryRun).toBe(false);
      expect(res.body.data.createdProducts).toBe(1);
      expect(res.body.data.createdVariants).toBe(1);

      // ยืนยันในฐานข้อมูลจริง
      const product = await prisma.product.findUnique({
        where: { sku: `TS-IMP-${suffix}` },
        include: {
          variants: {
            include: {
              inventory: true,
              movements: true,
            },
          },
        },
      });

      expect(product).not.toBeNull();
      createdProductIds.push(product!.id);

      expect(product!.price.toNumber()).toBe(450);
      expect(product!.totalStock).toBe(15);

      const variant = product!.variants[0]!;
      expect(variant.sku).toBe(`TS-IMP-VAR-${suffix}`);
      expect(variant.barcode).toBe(validGtin);
      expect(variant.inventory?.quantity).toBe(15);

      // Invariant: สต็อกเริ่มต้นต้องมี InventoryMovement (STOCK_IN)
      expect(variant.movements.length).toBe(1);
      expect(variant.movements[0]!.type).toBe('STOCK_IN');
      expect(variant.movements[0]!.quantity).toBe(15);
      expect(variant.movements[0]!.quantityAfter).toBe(15);

      // Invariant: ต้องมี AdminLog
      const log = await prisma.adminLog.findFirst({
        where: { userId: admin.id, action: 'product.import' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
    });

    it('ปฏิเสธบาร์โค้ดที่ check digit ไม่ถูกต้อง (ตามกฎ STEP 17)', async () => {
      // เลข 13 หลักที่ check digit ผิด (เช่น 2000000000019)
      const badBarcodeCsv = [
        'productName,sku,category,price,variantSku,initialStock,barcode',
        `"เสื้อยืดบาร์โค้ดผิด","TS-BAD-BAR-${suffix}","เสื้อยืด",450,"TS-BAD-VAR-${suffix}",10,"2000000000019"`,
      ].join('\n');

      const res = await request(app)
        .post('/api/admin/import/products?dryRun=true')
        .set(asAdmin())
        .attach('file', Buffer.from(badBarcodeCsv), 'bad_barcode.csv')
        .expect(200);

      expect(res.body.data.errorCount).toBeGreaterThan(0);
      const err = res.body.data.errors.find((e: { field?: string }) => e.field === 'barcode');
      expect(err).toBeDefined();
      expect(err.message).toContain('check digit');
    });

    it('ปฏิเสธเมื่อระบุหมวดหมู่ที่ไม่มีอยู่ในระบบ', async () => {
      const unknownCategoryCsv = [
        'productName,sku,category,price,variantSku,initialStock',
        `"เสื้อยืดหมวดหมู่ผิด","TS-NO-CAT-${suffix}","หมวดหมู่ที่ไม่มีอยู่จริง999",450,"TS-NO-CAT-VAR-${suffix}",10`,
      ].join('\n');

      const res = await request(app)
        .post('/api/admin/import/products?dryRun=true')
        .set(asAdmin())
        .attach('file', Buffer.from(unknownCategoryCsv), 'unknown_category.csv')
        .expect(200);

      expect(res.body.data.errorCount).toBeGreaterThan(0);
      const err = res.body.data.errors.find((e: { field?: string }) => e.field === 'category');
      expect(err).toBeDefined();
      expect(err.message).toContain('ไม่พบหมวดหมู่');
    });
  });

  describe('ระบบปรับสต็อกเป็นชุด (Inventory Stock Take Import)', () => {
    let testVariantId = '';
    const testSku = `TS-STOCKTAKE-VAR-${suffix}`;

    beforeAll(async () => {
      const cat = await prisma.category.findFirstOrThrow({ where: { deletedAt: null } });
      const prod = await prisma.product.create({
        data: {
          name: `สินค้าเทสต์ตรวจนับ ${suffix}`,
          slug: `test-stocktake-${suffix}`,
          sku: `TS-STOCKTAKE-PROD-${suffix}`,
          description: 'เทสต์ตรวจนับสต็อก',
          price: 500,
          categoryId: cat.id,
          variants: {
            create: {
              sku: testSku,
              price: 500,
              inventory: {
                create: {
                  quantity: 20,
                  reservedQuantity: 5, // ลูกค้าจองไว้ 5 ชิ้น
                },
              },
            },
          },
        },
        include: { variants: true },
      });
      createdProductIds.push(prod.id);
      testVariantId = prod.variants[0]!.id;
    });

    it('Dry Run: คำนวณ delta และ preview ยอดก่อน/หลังถูกต้อง', async () => {
      const stockCsv = [
        'sku,type,quantity,reason',
        `"${testSku}","ADJUSTMENT",25,"ตรวจนับรอบเย็น"`,
      ].join('\n');

      const res = await request(app)
        .post('/api/admin/import/inventory?dryRun=true')
        .set(asEmployee())
        .attach('file', Buffer.from(stockCsv), 'stock_take.csv')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.dryRun).toBe(true);
      expect(res.body.data.validCount).toBe(1);

      const preview = res.body.data.preview[0];
      expect(preview.currentQuantity).toBe(20);
      expect(preview.reservedQuantity).toBe(5);
      expect(preview.delta).toBe(5);
      expect(preview.newQuantity).toBe(25);
      expect(preview.status).toBe('VALID');

      // ตรวจสอบว่าในฐานข้อมูลยังคงเป็น 20
      const inv = await prisma.inventory.findUnique({ where: { variantId: testVariantId } });
      expect(inv!.quantity).toBe(20);
    });

    it('ปรับยอดจริง: อัปเดต atomic + บันทึก InventoryMovement + AdminLog', async () => {
      const stockCsv = [
        'sku,type,quantity,reason',
        `"${testSku}","STOCK_IN",10,"รับสินค้าเพิ่มจากโรงงาน"`,
      ].join('\n');

      const res = await request(app)
        .post('/api/admin/import/inventory?dryRun=false')
        .set(asEmployee())
        .attach('file', Buffer.from(stockCsv), 'stock_in.csv')
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.adjustedCount).toBe(1);

      // ตรวจสอบในฐานข้อมูล: จาก 20 + 10 = 30
      const inv = await prisma.inventory.findUnique({ where: { variantId: testVariantId } });
      expect(inv!.quantity).toBe(30);

      const movement = await prisma.inventoryMovement.findFirst({
        where: { variantId: testVariantId, reason: 'รับสินค้าเพิ่มจากโรงงาน' },
      });
      expect(movement).not.toBeNull();
      expect(movement!.type).toBe('STOCK_IN');
      expect(movement!.quantity).toBe(10);
      expect(movement!.quantityBefore).toBe(20);
      expect(movement!.quantityAfter).toBe(30);

      const log = await prisma.adminLog.findFirst({
        where: { userId: employee.id, action: 'inventory.import_adjust' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log).not.toBeNull();
    });

    it('กฎเหล็ก: ปฏิเสธการปรับสต็อกที่ต่ำกว่ายอดที่ลูกค้าจองไว้ (ห้ามติดลบ)', async () => {
      // ปัจจุบันมี 30 จองไว้ 5 ชิ้น → ปรับลดเหลือ 2 ชิ้น (ต่ำกว่าที่จอง 5) ต้องถูกปฏิเสธ!
      const invalidCsv = [
        'sku,type,quantity,reason',
        `"${testSku}","ADJUSTMENT",2,"ปรับลดยอดผิดพลาด"`,
      ].join('\n');

      const res = await request(app)
        .post('/api/admin/import/inventory?dryRun=true')
        .set(asEmployee())
        .attach('file', Buffer.from(invalidCsv), 'negative_stock.csv')
        .expect(200);

      expect(res.body.data.errorCount).toBeGreaterThan(0);
      const err = res.body.data.errors[0];
      expect(err.message).toContain('ต่ำกว่าของที่ลูกค้าจองไว้');

      const preview = res.body.data.preview[0];
      expect(preview.status).toBe('INVALID');
    });
  });

  describe('RBAC & Security', () => {
    it('ลูกค้าทั่วไปเข้าถึง endpoint export ไม่ได้ → 403', async () => {
      await request(app).get('/api/admin/export/products').set(asCustomer()).expect(403);
    });

    it('พนักงานไม่มีสิทธิ์ product:create นำเข้าสินค้าไม่ได้ → 403', async () => {
      const csv = 'productName,sku\n"test","TS-TEST"';
      await request(app)
        .post('/api/admin/import/products')
        .set(asEmployee())
        .attach('file', Buffer.from(csv), 'test.csv')
        .expect(403);
    });

    it('ไม่ส่งไฟล์มาในคำขอนำเข้า → 400', async () => {
      await request(app).post('/api/admin/import/products').set(asAdmin()).expect(400);
    });
  });
});
