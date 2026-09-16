import { randomInt, randomUUID } from 'node:crypto';

import {
  disconnectDatabase,
  getPrisma,
  gtinCheckDigit,
  internalGtin13,
  internalGtin13FromSeed,
  isValidGtin,
  normalizeGtin,
} from '@teenstyle/database';
import bwipjs from 'bwip-js/node';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { env } from '../src/config/index.ts';

import {
  CODE128_START_B,
  CODE128_START_C,
  CODE128_STOP,
  code128Symbols,
  decodeEan13,
  EAN13_L_CODES,
  sbsToModules,
} from './helpers/barcode-decode.ts';

/**
 * Integration test ของระบบบาร์โค้ด / QR (STEP 17)
 *
 * สิ่งที่ต้องพิสูจน์
 *   - **บาร์โค้ดที่วาดออกมาสแกนได้ค่าที่ถูกต้องจริง** — ถอด EAN-13 กลับเป็นเลข 13 หลัก
 *     ด้วยตารางจากมาตรฐาน (ไม่ได้ลอกจากไลบรารี) แล้วเทียบกับค่าในฐานข้อมูล
 *   - **ไม่ยอมรับบาร์โค้ดที่ check digit ผิด** — เลขแบบนั้นสแกนไม่ติด รับไว้ = หลอกร้าน
 *   - สแกนแล้วหาของถูกตัว · ไม่พบต้องตอบว่าไม่พบ (ไม่เดา) · ของที่ลบแล้วสแกนไม่เจอ
 *   - ป้ายทุกตัวอักษรมาจากฐานข้อมูล — ค่าที่ client แนบมาถูกเมิน
 *   - ออกบาร์โค้ดของร้านได้ แต่ **ห้ามเขียนทับเลขเดิม** (409) และเขียน AdminLog
 *   - RBAC: พนักงาน (product:read) สแกน/พิมพ์ป้ายได้ แต่ออกเลขใหม่ไม่ได้ (product:update)
 *   - ฐานข้อมูลเองก็ไม่ยอมรับบาร์โค้ดผิดรูป (CHECK constraint)
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

/**
 * SKU ของเทสต์นี้ใช้ **ตัวอักษรล้วน** โดยเจตนา
 *
 * Code 128 สลับไป subset C เองเมื่อเจอตัวเลขติดกัน 4 หลัก (บีบ 2 หลักเป็น 1 สัญลักษณ์)
 * ถ้าปล่อยให้ SKU สุ่มมีตัวเลขติดกัน เทสต์ที่เทียบสัญลักษณ์กับตัวอักษรจะไม่เสถียร
 * → การสลับ subset ถูกทดสอบแยกไว้อีกเคสหนึ่ง (ดู "สลับไป subset C")
 */
const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

function letterCode(length: number): string {
  let code = '';
  for (let index = 0; index < length; index += 1) {
    code += LETTERS[randomInt(0, LETTERS.length)];
  }

  return code;
}

const SKU_PREFIX = `TS-BAR-${letterCode(4)}`;

let admin = { id: '', token: '' };
let employee = { id: '', token: '' };
let customer = { id: '', token: '' };

const createdProductIds: string[] = [];

/** บาร์โค้ดที่ใช้ทดสอบ — สร้างจาก prefix 20 ของร้าน + check digit ที่คำนวณจริง */
const BARCODE_WITH_GTIN = internalGtin13(String(Date.now()).slice(-10));

let productId = '';
let productSku = '';
let productSlug = '';
/** ตัวเลือกที่มีบาร์โค้ด */
let variantWithBarcode = { id: '', sku: '' };
/** ตัวเลือกที่ยังไม่มีบาร์โค้ด (ใช้ทดสอบ fallback เป็น Code 128 ของ SKU และการออกเลขใหม่) */
let variantWithoutBarcode = { id: '', sku: '' };

const IMAGE = {
  url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80',
  alt: 'รูปสินค้าทดสอบบาร์โค้ด',
  isMain: true,
  sortOrder: 0,
};

async function createUser(role: 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-barcode-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

const asAdmin = () => ({ Authorization: `Bearer ${admin.token}` });
const asEmployee = () => ({ Authorization: `Bearer ${employee.token}` });
const asCustomer = () => ({ Authorization: `Bearer ${customer.token}` });

/** `sbs` = ลำดับความกว้างแถบ/ช่องว่างของบาร์โค้ดที่ bwip-js เข้ารหัสไว้ */
function sbsOf(bcid: string, text: string): number[] {
  const raw = bwipjs.raw({ bcid, text }) as Array<{ sbs: number[] }>;
  const first = raw[0];

  if (first === undefined) throw new Error(`bwip-js ไม่คืนข้อมูลของ ${bcid}`);

  return first.sbs;
}

function lookup(code: string, headers = asAdmin()) {
  return request(app)
    .get(`/api/admin/barcodes/lookup?code=${encodeURIComponent(code)}`)
    .set(headers);
}

/**
 * ป้ายบาร์โค้ดเป็น GET — ค่า array ส่งเป็น query ชื่อเดิมซ้ำหลายครั้ง
 * (`?variantId=a&variantId=b`) เหมือนที่ฟอร์มบนหน้าเว็บส่งมา
 */
function labels(params: Record<string, unknown>, headers = asAdmin()) {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else if (value !== undefined) {
      search.set(key, String(value));
    }
  }

  return request(app).get(`/api/admin/barcodes/labels?${search.toString()}`).set(headers);
}

function assign(variantId: string, headers = asAdmin()) {
  return request(app).post('/api/admin/barcodes/assign').set(headers).send({ variantId });
}

beforeAll(async () => {
  admin = await createUser('ADMIN', 'admin');
  employee = await createUser('EMPLOYEE', 'emp');
  customer = await createUser('CUSTOMER', 'cust');

  const unique = letterCode(6);
  productSku = `${SKU_PREFIX}-${unique}`;
  productSlug = `test-barcode-${unique.toLowerCase()}`;

  const res = await request(app)
    .post('/api/admin/products')
    .set(asAdmin())
    .send({
      name: 'สินค้าทดสอบบาร์โค้ด STEP 17',
      slug: productSlug,
      sku: productSku,
      description: 'สินค้าทดสอบระบบบาร์โค้ดที่มีคำอธิบายยาวพอสำหรับ validation',
      price: 690,
      categorySlug: 'tops',
      status: 'DRAFT',
      minimumStock: 3,
      images: [IMAGE],
      variants: [
        {
          sku: `${productSku}-BLA-M`,
          barcode: BARCODE_WITH_GTIN,
          colorSlug: 'black',
          sizeCode: 'M',
          initialStock: 12,
          isActive: true,
        },
        {
          sku: `${productSku}-WHI-L`,
          colorSlug: 'white',
          sizeCode: 'L',
          initialStock: 4,
          isActive: true,
        },
      ],
    });

  if (res.status !== 201) {
    throw new Error(`สร้างสินค้าทดสอบไม่สำเร็จ: ${res.status} ${JSON.stringify(res.body)}`);
  }

  productId = res.body.data.id;
  createdProductIds.push(productId);

  const variants = res.body.data.variants as Array<{ id: string; sku: string; barcode: string }>;
  const withBarcode = variants.find((variant) => variant.barcode !== null);
  const withoutBarcode = variants.find((variant) => variant.barcode === null);

  if (withBarcode === undefined || withoutBarcode === undefined) {
    throw new Error(`ตัวเลือกทดสอบไม่ครบ: ${JSON.stringify(variants)}`);
  }

  variantWithBarcode = { id: withBarcode.id, sku: withBarcode.sku };
  variantWithoutBarcode = { id: withoutBarcode.id, sku: withoutBarcode.sku };
});

afterAll(async () => {
  const userIds = [admin.id, employee.id, customer.id];

  await prisma.inventoryMovement.deleteMany({
    where: { variant: { productId: { in: createdProductIds } } },
  });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  await disconnectDatabase();
});

/* ─────────────────────── กฎตัวเลขของ GTIN (ไม่แตะฐานข้อมูล) ─────────────────────── */

describe('กฎ check digit ของ GTIN', () => {
  it('บาร์โค้ดจริงที่ตีพิมพ์ใช้กันทั่วโลกต้องผ่านทั้งหมด', () => {
    // EAN-13 · UPC-A · EAN-8 จากตัวอย่างที่เผยแพร่เป็นสาธารณะ
    expect(isValidGtin('4006381333931')).toBe(true);
    expect(isValidGtin('036000291452')).toBe(true);
    expect(isValidGtin('96385074')).toBe(true);
  });

  it('check digit ผิดหนึ่งหลัก / ความยาวผิด / มีตัวอักษร → ไม่ผ่าน', () => {
    expect(isValidGtin('4006381333930')).toBe(false);
    expect(isValidGtin('400638133393')).toBe(false);
    expect(isValidGtin('400638133393X')).toBe(false);
    expect(isValidGtin('')).toBe(false);
  });

  it('check digit คำนวณตามสูตร 3,1 สลับจากหลังมาหน้า', () => {
    expect(gtinCheckDigit('400638133393')).toBe('1');
    expect(gtinCheckDigit('03600029145')).toBe('2');
    expect(gtinCheckDigit('9638507')).toBe('4');
  });

  it('เลขที่ร้านออกเองต้องขึ้นต้นด้วย 20 (ช่วงที่ GS1 สงวนให้ใช้ภายใน) และผ่าน check digit', () => {
    const generated = internalGtin13FromSeed('TS-TEST-001-BLA-M');

    expect(generated).toHaveLength(13);
    expect(generated.startsWith('20')).toBe(true);
    expect(isValidGtin(generated)).toBe(true);
    // seed เดิมต้องได้เลขเดิมเสมอ ไม่งั้น seed ซ้ำจะสร้างเลขใหม่ทุกครั้ง
    expect(internalGtin13FromSeed('TS-TEST-001-BLA-M')).toBe(generated);
  });

  it('ช่องว่างและขีดกลางที่คนพิมพ์เข้ามาถูกตัดออกก่อนตรวจ', () => {
    expect(normalizeGtin(' 400-638 133393 1 ')).toBe('4006381333931');
    expect(isValidGtin(normalizeGtin('400-638-133393-1'))).toBe(true);
  });
});

describe('ตาราง L-code ที่ใช้ถอดรหัสในเทสต์', () => {
  it('ทุกแบบยาว 7 โมดูล เริ่มด้วยช่องว่าง ลงท้ายด้วยแถบ และมีแถบเป็นจำนวนคี่', () => {
    for (const pattern of EAN13_L_CODES) {
      const bars = [...pattern].filter((bit) => bit === '1').length;

      expect(pattern).toHaveLength(7);
      expect(pattern.startsWith('0')).toBe(true);
      expect(pattern.endsWith('1')).toBe(true);
      expect(bars % 2).toBe(1);
    }
  });
});

/* ─────────────────── ป้ายที่พิมพ์ต้องสแกนได้ค่าที่ถูกต้องจริง ─────────────────── */

describe('ถอดรหัสภาพที่วาดออกมา', () => {
  it('EAN-13 ที่วาดจากบาร์โค้ดในฐานข้อมูล ถอดกลับได้เลขเดิมทุกหลัก', async () => {
    const res = await labels({ variantId: [variantWithBarcode.id], symbology: 'auto' });

    expect(res.status).toBe(200);

    const item = res.body.data.items[0];

    expect(item.symbology).toBe('ean13');
    expect(item.encodes).toBe('GTIN');
    expect(item.encodedValue).toBe(BARCODE_WITH_GTIN);
    // ★ หัวใจของเทสต์นี้: ถอดเส้นที่วาดจริงกลับเป็นตัวเลข แล้วต้องตรงกับที่ตั้งใจ
    expect(decodeEan13(sbsOf('ean13', item.encodedValue))).toBe(BARCODE_WITH_GTIN);
  });

  it('เลขที่ต่างกันหนึ่งหลักต้องได้ลายเส้นที่ต่างกัน (ไม่ใช่ภาพนิ่งที่ไม่ขึ้นกับข้อมูล)', () => {
    const other = internalGtin13('9999999999');

    expect(sbsToModules(sbsOf('ean13', BARCODE_WITH_GTIN))).not.toBe(
      sbsToModules(sbsOf('ean13', other)),
    );
    expect(decodeEan13(sbsOf('ean13', other))).toBe(other);
  });

  it('Code 128 ของ SKU: start/stop ตรงมาตรฐาน และสัญลักษณ์เรียงตามตัวอักษรของ SKU', async () => {
    const res = await labels({ variantId: [variantWithoutBarcode.id], symbology: 'auto' });

    expect(res.status).toBe(200);

    const item = res.body.data.items[0];

    // ตัวเลือกนี้ไม่มีบาร์โค้ด → ต้องถอยไปใช้ SKU **ไม่ใช่กุเลขบาร์โค้ดขึ้นมา**
    expect(item.symbology).toBe('code128');
    expect(item.encodes).toBe('SKU');
    expect(item.encodedValue).toBe(variantWithoutBarcode.sku);
    expect(item.barcode).toBeNull();

    const whole = code128Symbols(sbsOf('code128', item.encodedValue));

    expect(whole.start).toBe(CODE128_START_B);
    expect(whole.stop).toBe(CODE128_STOP);
    expect(whole.data).toHaveLength(variantWithoutBarcode.sku.length);

    /**
     * สัญลักษณ์ของสตริงทั้งก้อน ต้องเท่ากับสัญลักษณ์ของตัวอักษรแต่ละตัวต่อกัน
     * → พิสูจน์ว่าเส้นที่วาดมาจาก SKU ตัวนั้นจริง ไม่ใช่ข้อความอื่นที่หน้าตาคล้ายกัน
     */
    const perCharacter = [...variantWithoutBarcode.sku].flatMap(
      (character) => code128Symbols(sbsOf('code128', character)).data,
    );

    expect(whole.data).toEqual(perCharacter);
  });

  it('Code 128 สลับไป subset C เองเมื่อ SKU มีตัวเลขติดกัน (บีบ 2 หลักเป็น 1 สัญลักษณ์)', () => {
    /**
     * ไม่ใช่บั๊ก แต่เป็นพฤติกรรมตามมาตรฐานที่ต้องรู้ไว้:
     * เครื่องสแกนถอดกลับได้ข้อความเดิม แต่จำนวนสัญลักษณ์จะไม่เท่ากับจำนวนตัวอักษร
     * → เทสต์ที่เทียบสัญลักษณ์ต่อตัวอักษรใช้ได้เฉพาะค่าที่ไม่มีตัวเลขติดกัน 4 หลัก
     */
    const numeric = code128Symbols(sbsOf('code128', '12345678'));

    expect(numeric.start).toBe(CODE128_START_C);
    expect(numeric.data).toHaveLength(4);

    const alphanumeric = code128Symbols(sbsOf('code128', 'ABC-123'));

    expect(alphanumeric.start).toBe(CODE128_START_B);
    expect(alphanumeric.data).toHaveLength(7);
  });

  it('SVG มีแค่ <svg> <rect> <path> — ค่าที่เข้ารหัสไม่มีทางหลุดเป็น markup', async () => {
    const res = await labels({ productId, symbology: 'auto' });

    expect(res.status).toBe(200);

    for (const item of res.body.data.items) {
      const tags = [...new Set(item.svg.match(/<[a-zA-Z]+/g))];

      // `<rect>` คือพื้นขาวของภาพ · ที่สำคัญคือ **ไม่มี `<text>`** — ตัวหนังสือถูกวาดเป็นเส้น
      expect(tags.sort()).toEqual(['<path', '<rect', '<svg']);
      expect(item.svg).not.toContain('<text');
      expect(item.svg.toLowerCase()).not.toContain('script');
      expect(item.width).toBeGreaterThan(0);
      expect(item.height).toBeGreaterThan(0);
    }
  });

  it('QR เข้ารหัสลิงก์หน้าสินค้าจริงจากฐานข้อมูล (ไม่ใช่ลิงก์ที่ client ส่งมา)', async () => {
    const res = await labels({ productId, symbology: 'qrcode' });

    expect(res.status).toBe(200);

    const item = res.body.data.items[0];

    expect(item.symbology).toBe('qrcode');
    expect(item.encodes).toBe('PRODUCT_URL');
    expect(item.encodedValue).toBe(
      `${env.FRONTEND_URL.replace(/\/+$/, '')}/product/${productSlug}`,
    );
  });
});

/* ───────────────────────────── สแกนแล้วหาของถูกตัว ───────────────────────────── */

describe('ค้นหาจากโค้ดที่สแกน', () => {
  it('สแกนบาร์โค้ด → ได้ตัวเลือกที่ถูกต้อง พร้อมตัวเลขสต็อกแยก 3 ค่า', async () => {
    const res = await lookup(BARCODE_WITH_GTIN);

    expect(res.status).toBe(200);
    expect(res.body.data.matchedBy).toBe('BARCODE');
    expect(res.body.data.variant.variantId).toBe(variantWithBarcode.id);
    expect(res.body.data.variant.barcodeKind).toBe('EAN-13');
    expect(res.body.data.product.id).toBe(productId);

    const stock = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: variantWithBarcode.id },
      select: { quantity: true, reservedQuantity: true },
    });

    expect(res.body.data.variant.quantity).toBe(stock.quantity);
    expect(res.body.data.variant.reserved).toBe(stock.reservedQuantity);
    expect(res.body.data.variant.available).toBe(
      Math.max(0, stock.quantity - stock.reservedQuantity),
    );
  });

  it('พิมพ์บาร์โค้ดมาพร้อมช่องว่าง/ขีดกลาง ก็ยังหาเจอ', async () => {
    const typed = `${BARCODE_WITH_GTIN.slice(0, 3)} ${BARCODE_WITH_GTIN.slice(3, 8)}-${BARCODE_WITH_GTIN.slice(8)}`;

    const res = await lookup(typed);

    expect(res.status).toBe(200);
    expect(res.body.data.code).toBe(BARCODE_WITH_GTIN);
    expect(res.body.data.variant.variantId).toBe(variantWithBarcode.id);
  });

  it('สแกน SKU ของตัวเลือก (พิมพ์เล็กมาก็ได้) → เจอตัวเลือกนั้น', async () => {
    const res = await lookup(variantWithoutBarcode.sku.toLowerCase());

    expect(res.status).toBe(200);
    expect(res.body.data.matchedBy).toBe('VARIANT_SKU');
    expect(res.body.data.variant.variantId).toBe(variantWithoutBarcode.id);
    expect(res.body.data.variant.barcode).toBeNull();
    expect(res.body.data.variant.barcodeKind).toBeNull();
  });

  it('สแกน SKU ของสินค้า → เจอสินค้า แต่ยังไม่รู้ว่าตัวเลือกไหน (variant = null)', async () => {
    const res = await lookup(productSku);

    expect(res.status).toBe(200);
    expect(res.body.data.matchedBy).toBe('PRODUCT_SKU');
    expect(res.body.data.variant).toBeNull();
    expect(res.body.data.variantCount).toBe(2);
    expect(res.body.data.product.storefrontUrl).toContain(`/product/${productSlug}`);
  });

  it('โค้ดที่ไม่มีในระบบ → 404 พร้อมข้อความไทย ไม่เดาให้', async () => {
    const res = await lookup('2000000000015');

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.errorCode).toBe('NOT_FOUND');
    expect(res.body.message).toContain('ไม่พบสินค้า');
    expect(res.body.message).not.toContain('expected');
  });

  it('โค้ดที่คล้ายกันแต่ไม่ตรงทุกตัว → 404 (ไม่ค้นแบบ LIKE)', async () => {
    const res = await lookup(variantWithBarcode.sku.slice(0, -1));

    expect(res.status).toBe(404);
  });

  it('โค้ดสั้นเกินไป → 422 (validation)', async () => {
    const res = await lookup('1');

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('สินค้าที่ถูกลบแล้ว สแกนไม่เจอ (ของที่ไม่ขายต้องไม่โผล่ในงานคลัง)', async () => {
    const unique = letterCode(6);
    const sku = `${SKU_PREFIX}-DEL-${unique}`;
    const barcode = internalGtin13(String(Date.now() + 12_345).slice(-10));

    const created = await request(app)
      .post('/api/admin/products')
      .set(asAdmin())
      .send({
        name: 'สินค้าทดสอบที่จะถูกลบ',
        slug: `test-barcode-del-${unique.toLowerCase()}`,
        sku,
        description: 'สินค้าทดสอบว่าของที่ลบแล้วต้องสแกนไม่เจอ',
        price: 200,
        categorySlug: 'tops',
        images: [IMAGE],
        variants: [{ sku: `${sku}-BLA-S`, barcode, colorSlug: 'black', sizeCode: 'S' }],
      });

    expect(created.status).toBe(201);
    createdProductIds.push(created.body.data.id);

    expect((await lookup(barcode)).status).toBe(200);

    const deleted = await request(app)
      .delete(`/api/admin/products/${created.body.data.id}`)
      .set(asAdmin());

    expect(deleted.status).toBe(200);
    expect((await lookup(barcode)).status).toBe(404);
  });
});

/* ─────────────────────────────── ป้ายบาร์โค้ด ─────────────────────────────── */

describe('สร้างป้ายบาร์โค้ด', () => {
  it('ระบุ productId → ได้ป้ายของทุกตัวเลือกที่ยังไม่ถูกลบ', async () => {
    const res = await labels({ productId, copies: 3 });

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.copies).toBe(3);
    expect(res.body.data.missingVariantIds).toEqual([]);
  });

  it('ข้อความบนป้ายมาจากฐานข้อมูล — ค่าที่ client แนบมาถูกเมิน', async () => {
    const res = await labels({
      variantId: [variantWithBarcode.id],
      // ค่าปลอมที่พยายามยัดเข้ามาให้พิมพ์ลงป้าย
      productName: 'ของแถมฟรี',
      finalPrice: 1,
      encodedValue: '0000000000000',
      sku: 'HACKED',
      symbology: 'auto',
    });

    expect(res.status).toBe(200);

    const item = res.body.data.items[0];

    expect(item.productName).not.toBe('ของแถมฟรี');
    expect(item.sku).toBe(variantWithBarcode.sku);
    expect(item.encodedValue).toBe(BARCODE_WITH_GTIN);
    expect(item.finalPrice).toBe(690);
  });

  it('ขอ code128 ทั้งที่มีบาร์โค้ด → ได้ Code 128 ของ SKU ตามที่สั่ง', async () => {
    const res = await labels({ variantId: [variantWithBarcode.id], symbology: 'code128' });

    expect(res.status).toBe(200);
    expect(res.body.data.items[0].symbology).toBe('code128');
    expect(res.body.data.items[0].encodedValue).toBe(variantWithBarcode.sku);
  });

  it('variantId ที่ไม่มีจริงปนมา → ยังได้ป้ายของตัวที่มี และบอกตรง ๆ ว่าตัวไหนหาย', async () => {
    const ghost = randomUUID();
    const res = await labels({ variantId: [variantWithBarcode.id, ghost] });

    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.missingVariantIds).toEqual([ghost]);
  });

  it('ไม่พบตัวเลือกเลย → 404 (ไม่คืนกระดาษเปล่า)', async () => {
    const res = await labels({ variantId: [randomUUID()] });

    expect(res.status).toBe(404);
  });

  it('ไม่ส่ง productId และ variantId → 422 · ส่งทั้งคู่ → 422', async () => {
    const neither = await labels({ symbology: 'auto' });
    const both = await labels({ productId, variantId: [variantWithBarcode.id] });

    expect(neither.status).toBe(422);
    expect(both.status).toBe(422);
  });

  it('จำนวนสำเนาเกินเพดาน → 422', async () => {
    const res = await labels({ productId, copies: 999 });

    expect(res.status).toBe(422);
  });
});

/* ───────────────────────── ออกบาร์โค้ดของร้านให้ ───────────────────────── */

describe('ออกบาร์โค้ดของร้าน', () => {
  it('ออกเลขให้ตัวเลือกที่ยังไม่มี → ได้ EAN-13 prefix 20 ที่สแกนได้จริง + เขียน AdminLog', async () => {
    const res = await assign(variantWithoutBarcode.id);

    expect(res.status).toBe(201);

    const barcode = res.body.data.barcode as string;

    expect(barcode.startsWith('20')).toBe(true);
    expect(isValidGtin(barcode)).toBe(true);
    // ถอดกลับจากเส้นจริง — เลขที่ออกให้ต้องพิมพ์เป็นป้ายที่สแกนได้
    expect(decodeEan13(sbsOf('ean13', barcode))).toBe(barcode);

    const saved = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantWithoutBarcode.id },
      select: { barcode: true },
    });

    expect(saved.barcode).toBe(barcode);

    const log = await prisma.adminLog.findFirst({
      where: { userId: admin.id, action: 'product.variant.barcode.assign' },
      orderBy: { createdAt: 'desc' },
    });

    expect(log).not.toBeNull();
    expect((log?.after as { barcode?: string }).barcode).toBe(barcode);

    // สแกนเลขใหม่ต้องเจอตัวเลือกนั้นทันที
    const found = await lookup(barcode);

    expect(found.status).toBe(200);
    expect(found.body.data.variant.variantId).toBe(variantWithoutBarcode.id);
  });

  it('ออกเลขซ้ำให้ตัวที่มีบาร์โค้ดอยู่แล้ว → 409 และเลขเดิมไม่ถูกแก้', async () => {
    const res = await assign(variantWithBarcode.id);

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('CONFLICT');

    const saved = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantWithBarcode.id },
      select: { barcode: true },
    });

    expect(saved.barcode).toBe(BARCODE_WITH_GTIN);
  });

  it('ตัวเลือกที่ไม่มีจริง → 404 · variantId ไม่ใช่ UUID → 422', async () => {
    expect((await assign(randomUUID())).status).toBe(404);
    expect((await assign('not-a-uuid')).status).toBe(422);
  });
});

/* ───────────────────── บาร์โค้ดที่ร้านกรอกเองผ่าน endpoint สินค้า ───────────────────── */

describe('กรอกบาร์โค้ดเองที่หน้าจัดการสินค้า', () => {
  async function patchVariant(body: Record<string, unknown>) {
    return request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantWithBarcode.id}`)
      .set(asAdmin())
      .send(body);
  }

  it('check digit ผิด → ปฏิเสธพร้อมข้อความไทย (ไม่หลุดข้อความดิบของ Zod)', async () => {
    const res = await patchVariant({ barcode: '4006381333930' });

    expect(res.status).toBe(422);
    const detail = JSON.stringify(res.body);

    expect(detail).toContain('check digit');
    expect(detail).not.toContain('expected string');
  });

  it('กรอกพร้อมขีดกลาง → เก็บเป็นตัวเลขล้วนในฐานข้อมูล', async () => {
    const fresh = internalGtin13(String(Date.now() + 777).slice(-10));
    const typed = `${fresh.slice(0, 3)}-${fresh.slice(3)}`;

    const res = await patchVariant({ barcode: typed });

    expect(res.status).toBe(200);

    const saved = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantWithBarcode.id },
      select: { barcode: true },
    });

    expect(saved.barcode).toBe(fresh);

    // คืนค่าเดิมไว้ให้เทสต์อื่นใช้ต่อ
    expect((await patchVariant({ barcode: BARCODE_WITH_GTIN })).status).toBe(200);
  });

  it('บาร์โค้ดซ้ำกับตัวเลือกอื่น → 409', async () => {
    const other = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantWithoutBarcode.id },
      select: { barcode: true },
    });

    expect(other.barcode).not.toBeNull();

    const res = await patchVariant({ barcode: other.barcode! });

    expect(res.status).toBe(409);
  });

  it('ส่ง null → ล้างบาร์โค้ด แล้วออกเลขใหม่ได้ (เส้นทางแก้เลขที่กรอกผิด)', async () => {
    expect((await patchVariant({ barcode: null })).status).toBe(200);

    const cleared = await prisma.productVariant.findUniqueOrThrow({
      where: { id: variantWithBarcode.id },
      select: { barcode: true },
    });

    expect(cleared.barcode).toBeNull();

    const reissued = await assign(variantWithBarcode.id);

    expect(reissued.status).toBe(201);
    expect(isValidGtin(reissued.body.data.barcode)).toBe(true);
  });
});

/* ─────────────────────────────────── RBAC ─────────────────────────────────── */

describe('RBAC', () => {
  it('ไม่ล็อกอิน → 401 · ลูกค้า → 403', async () => {
    const anonymous = await request(app).get('/api/admin/barcodes/lookup?code=1234567890128');
    const shopper = await lookup('1234567890128', asCustomer());

    expect(anonymous.status).toBe(401);
    expect(shopper.status).toBe(403);
  });

  it('พนักงาน (product:read) สแกนและพิมพ์ป้ายได้ แต่ออกบาร์โค้ดใหม่ไม่ได้ (product:update)', async () => {
    const scan = await lookup(variantWithoutBarcode.sku, asEmployee());
    const sheet = await labels({ productId }, asEmployee());
    const issue = await assign(variantWithoutBarcode.id, asEmployee());

    expect(scan.status).toBe(200);
    expect(sheet.status).toBe(200);
    expect(issue.status).toBe(403);
  });

  it('ถอนสิทธิ์ product:read ในฐานข้อมูล → สแกนไม่ได้ทันที (ไม่ได้ hard-code ตามบทบาท)', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'EMPLOYEE' } });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'product:read' },
    });

    try {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { disconnect: { id: permission.id } } },
      });

      const scan = await lookup(variantWithoutBarcode.sku, asEmployee());

      expect(scan.status).toBe(403);
    } finally {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: { id: permission.id } } },
      });
    }
  });
});

/* ───────────────────── ด่านสุดท้าย: ฐานข้อมูลเองก็ไม่ยอมรับของผิดรูป ───────────────────── */

describe('CHECK constraint ของฐานข้อมูล', () => {
  it('เขียนบาร์โค้ดผิดรูปตรงเข้าฐานข้อมูล (ข้าม validator) → ฐานข้อมูลปฏิเสธ', async () => {
    await expect(
      prisma.productVariant.update({
        where: { id: variantWithoutBarcode.id },
        data: { barcode: 'ABC123' },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.productVariant.update({
        where: { id: variantWithoutBarcode.id },
        data: { barcode: '12345' },
      }),
    ).rejects.toThrow();
  });
});
