import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของการจัดการสินค้าในหลังบ้าน (STEP 14)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - RBAC: ลูกค้าเข้าไม่ได้ · พนักงานที่มีสิทธิ์เข้าได้
 *   - สร้าง/แก้/ลบสินค้าได้จริง และ slug/SKU ซ้ำถูกปฏิเสธ (409)
 *   - **สต็อกเดินผ่าน InventoryMovement เท่านั้น** — รับเข้าครั้งแรกมี movement STOCK_IN จริง
 *     และ cache `totalStock` ตรงกับผลรวม Inventory
 *   - เปิดขาย (ACTIVE) ไม่ได้ถ้าไม่มีรูป/ตัวเลือก
 *   - ลบเป็น soft delete และหายจากหน้าร้านทันที
 *   - ลบไม่ได้ถ้ามีของถูกจองอยู่ในออเดอร์ที่ยังไม่จบ
 *   - รูปต้องมาจากโฮสต์ที่อนุญาต (ตรงกับ next.config)
 *   - ทุกการเปลี่ยนแปลงเขียน AdminLog
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);
const SKU_PREFIX = `TS-TEST-${suffix.toUpperCase().slice(0, 4)}`;

let staff = { id: '', token: '' };
let customer = { id: '', token: '' };
const createdProductIds: string[] = [];

const IMAGE = {
  url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80',
  alt: 'รูปสินค้าทดสอบ',
  isMain: true,
  sortOrder: 0,
};

function productPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const unique = randomUUID().slice(0, 6);

  return {
    name: 'สินค้าทดสอบ STEP 14',
    slug: `test-product-${unique}`,
    sku: `${SKU_PREFIX}-${unique.toUpperCase()}`,
    description: 'คำอธิบายสินค้าทดสอบที่ยาวพอสำหรับ validation',
    shortDescription: 'สินค้าทดสอบ',
    price: 590,
    categorySlug: 'tops',
    status: 'DRAFT',
    minimumStock: 3,
    tags: ['ทดสอบ'],
    images: [IMAGE],
    variants: [
      {
        sku: `${SKU_PREFIX}-${unique.toUpperCase()}-BLA-M`,
        colorSlug: 'black',
        sizeCode: 'M',
        initialStock: 10,
        isActive: true,
      },
    ],
    ...overrides,
  };
}

async function createUser(role: 'CUSTOMER' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-prod-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

function asStaff() {
  return { Authorization: `Bearer ${staff.token}` };
}

async function createProduct(overrides: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/admin/products')
    .set(asStaff())
    .send(productPayload(overrides));

  if (res.status === 201) createdProductIds.push(res.body.data.id);

  return res;
}

beforeAll(async () => {
  staff = await createUser('ADMIN', 'staff');
  customer = await createUser('CUSTOMER', 'cust');
});

afterAll(async () => {
  const userIds = [staff.id, customer.id];

  // ลบสินค้าทดสอบทั้งหมด (variant/inventory/image ถูกลบตาม cascade)
  await prisma.inventoryMovement.deleteMany({
    where: { variant: { productId: { in: createdProductIds } } },
  });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  await disconnectDatabase();
});

describe('RBAC', () => {
  it('ไม่ล็อกอิน → 401 · ลูกค้า → 403', async () => {
    const anonymous = await request(app).get('/api/admin/products');
    const asShopper = await request(app)
      .get('/api/admin/products')
      .set({ Authorization: `Bearer ${customer.token}` });

    expect(anonymous.status).toBe(401);
    expect(asShopper.status).toBe(403);
  });

  it('ลูกค้าสร้างสินค้าไม่ได้ → 403', async () => {
    const res = await request(app)
      .post('/api/admin/products')
      .set({ Authorization: `Bearer ${customer.token}` })
      .send(productPayload());

    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/products', () => {
  it('สร้างสินค้าได้ และรับเข้าครั้งแรกถูกบันทึกเป็น InventoryMovement จริง', async () => {
    const res = await createProduct();

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.variants.length).toBe(1);
    expect(res.body.data.variants[0].quantity).toBe(10);
    expect(res.body.data.totalStock).toBe(10);
    expect(res.body.data.availableStock).toBe(10);

    const movements = await prisma.inventoryMovement.findMany({
      where: { variant: { productId: res.body.data.id } },
      select: {
        type: true,
        quantity: true,
        quantityBefore: true,
        quantityAfter: true,
        userId: true,
      },
    });

    expect(movements.length).toBe(1);
    expect(movements[0]!.type).toBe('STOCK_IN');
    expect(movements[0]!.quantity).toBe(10);
    expect(movements[0]!.quantityBefore).toBe(0);
    expect(movements[0]!.quantityAfter).toBe(10);
    expect(movements[0]!.userId).toBe(staff.id);

    // cache ต้องตรงกับผลรวมจริงในคลัง
    const product = await prisma.product.findUniqueOrThrow({
      where: { id: res.body.data.id },
      select: {
        totalStock: true,
        variants: { select: { inventory: { select: { quantity: true } } } },
      },
    });
    const real = product.variants.reduce(
      (sum, variant) => sum + (variant.inventory?.quantity ?? 0),
      0,
    );
    expect(product.totalStock).toBe(real);
  });

  it('สร้างโดยไม่ระบุสต็อก → สต็อกเป็น 0 และไม่มี movement', async () => {
    const unique = randomUUID().slice(0, 6);
    const res = await createProduct({
      variants: [
        {
          sku: `${SKU_PREFIX}-NOSTOCK-${unique.toUpperCase()}`,
          colorSlug: 'white',
          sizeCode: 'L',
          isActive: true,
        },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.totalStock).toBe(0);

    const movements = await prisma.inventoryMovement.count({
      where: { variant: { productId: res.body.data.id } },
    });
    expect(movements).toBe(0);
  });

  it('slug ซ้ำ → 409 · SKU ซ้ำ → 409', async () => {
    const first = await createProduct();
    expect(first.status).toBe(201);

    const sameSlug = await createProduct({ slug: first.body.data.slug });
    const sameSku = await createProduct({ sku: first.body.data.sku });

    expect(sameSlug.status).toBe(409);
    expect(sameSku.status).toBe(409);
  });

  it('เปิดขายทันทีโดยไม่มีรูป → 400 (ต้องมีรูปก่อนเปิดขาย)', async () => {
    const res = await createProduct({ status: 'ACTIVE', images: [] });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('รูป');
  });

  it('รูปจากโฮสต์ที่ไม่อนุญาต → 422', async () => {
    const res = await createProduct({
      images: [{ ...IMAGE, url: 'https://evil.example.com/pic.jpg' }],
    });

    expect(res.status).toBe(422);
  });

  it('รูป http (ไม่ใช่ https) → 422', async () => {
    const res = await createProduct({
      images: [{ ...IMAGE, url: 'http://images.unsplash.com/photo-1.jpg' }],
    });

    expect(res.status).toBe(422);
  });

  it.each([
    ['ราคาลดสูงกว่าราคาปกติ', { price: 100, salePrice: 200 }],
    ['ราคาติดลบ', { price: -50 }],
    ['slug ตัวใหญ่/อักขระแปลก', { slug: 'BAD Slug!' }],
    ['SKU ตัวเล็ก', { sku: 'lowercase-sku' }],
    ['ไม่มี variant', { variants: [] }],
    ['คำอธิบายสั้นเกินไป', { description: 'สั้น' }],
  ])('%s → 422', async (_label, overrides) => {
    const res = await createProduct(overrides);

    expect(res.status).toBe(422);
  });

  it('SKU ของ variant ซ้ำกันในคำขอเดียว → 422', async () => {
    const unique = randomUUID().slice(0, 6).toUpperCase();
    const duplicated = {
      sku: `${SKU_PREFIX}-DUP-${unique}`,
      colorSlug: 'black',
      sizeCode: 'M',
      initialStock: 1,
      isActive: true,
    };

    const res = await createProduct({
      variants: [duplicated, { ...duplicated, colorSlug: 'white' }],
    });

    expect(res.status).toBe(422);
  });

  it('หมวดหมู่ที่ไม่มีจริง → 400 · สีที่ไม่มีจริง → 400', async () => {
    const badCategory = await createProduct({ categorySlug: 'ไม่มีหมวดนี้' });
    const unique = randomUUID().slice(0, 6).toUpperCase();
    const badColor = await createProduct({
      variants: [
        {
          sku: `${SKU_PREFIX}-BADCOLOR-${unique}`,
          colorSlug: 'ไม่มีสีนี้',
          sizeCode: 'M',
          isActive: true,
        },
      ],
    });

    expect(badCategory.status).toBe(400);
    expect(badColor.status).toBe(400);
  });
});

describe('PATCH /api/admin/products/:productId', () => {
  it('แก้ชื่อ/ราคา/สถานะได้ และเขียน AdminLog', async () => {
    const created = await createProduct();
    const productId = created.body.data.id;

    const res = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set(asStaff())
      .send({ name: 'ชื่อใหม่หลังแก้', price: 690, status: 'ACTIVE' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('ชื่อใหม่หลังแก้');
    expect(res.body.data.price).toBe(690);
    expect(res.body.data.status).toBe('ACTIVE');
    // เปิดขายครั้งแรกต้องมีวันเผยแพร่
    expect(res.body.data.publishedAt).not.toBeNull();

    const log = await prisma.adminLog.findFirstOrThrow({
      where: { action: 'product.update', targetId: productId },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, before: true, after: true },
    });
    expect(log.userId).toBe(staff.id);
    expect(JSON.stringify(log.after)).toContain('ชื่อใหม่หลังแก้');
  });

  it('สินค้าที่เปิดขายแล้วโผล่ในหน้าร้านจริง', async () => {
    const created = await createProduct();
    const productId = created.body.data.id;
    const slug = created.body.data.slug;

    // ยังเป็น DRAFT → หน้าร้านต้องไม่เห็น
    const draft = await request(app).get(`/api/products/${slug}`);
    expect(draft.status).toBe(404);

    await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set(asStaff())
      .send({ status: 'ACTIVE' });

    const active = await request(app).get(`/api/products/${slug}`);
    expect(active.status).toBe(200);
    expect(active.body.data.slug).toBe(slug);
  });

  it('เปิดขายโดยไม่มีตัวเลือกที่ใช้งาน → 400', async () => {
    const created = await createProduct();
    const productId = created.body.data.id;
    const variantId = created.body.data.variants[0].id;

    await request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantId}`)
      .set(asStaff())
      .send({ isActive: false });

    const res = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set(asStaff())
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('ตัวเลือก');
  });

  it('แก้แค่ชื่อ → สถานะและ tag เดิมต้องไม่ถูกแตะ (กัน default ของ Zod ทับค่าจริง)', async () => {
    const created = await createProduct({ tags: ['ของจริง', 'ต้องอยู่'] });
    const productId = created.body.data.id;

    await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set(asStaff())
      .send({ status: 'ACTIVE', minimumStock: 12 });

    const res = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set(asStaff())
      .send({ name: 'แก้แค่ชื่อเท่านั้น' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('แก้แค่ชื่อเท่านั้น');
    expect(res.body.data.status).toBe('ACTIVE');
    expect(res.body.data.minimumStock).toBe(12);
    expect(res.body.data.tags).toEqual(['ของจริง', 'ต้องอยู่']);
  });

  it('ส่ง salePrice = null → เลิกโปรโมชัน กลับไปขายราคาปกติ', async () => {
    const created = await createProduct({ price: 500, salePrice: 399 });
    expect(created.body.data.finalPrice).toBe(399);

    const res = await request(app)
      .patch(`/api/admin/products/${created.body.data.id}`)
      .set(asStaff())
      .send({ salePrice: null });

    expect(res.status).toBe(200);
    expect(res.body.data.salePrice).toBeNull();
    expect(res.body.data.finalPrice).toBe(500);
    expect(res.body.data.discountPercent).toBeNull();
  });

  it('ราคาลดที่สูงกว่าราคาเดิมในฐานข้อมูล → 400', async () => {
    const created = await createProduct({ price: 500 });

    const res = await request(app)
      .patch(`/api/admin/products/${created.body.data.id}`)
      .set(asStaff())
      .send({ salePrice: 900 });

    expect(res.status).toBe(400);
  });

  it('ไม่ส่งอะไรมาเลย → 422 · สินค้าที่ไม่มีจริง → 404', async () => {
    const created = await createProduct();

    const empty = await request(app)
      .patch(`/api/admin/products/${created.body.data.id}`)
      .set(asStaff())
      .send({});
    const missing = await request(app)
      .patch('/api/admin/products/00000000-0000-4000-8000-000000000000')
      .set(asStaff())
      .send({ name: 'x ที่ไหนก็ไม่รู้' });

    expect(empty.status).toBe(422);
    expect(missing.status).toBe(404);
  });
});

describe('variant ของสินค้า', () => {
  it('เพิ่มตัวเลือกใหม่พร้อมรับเข้าสต็อก → มี movement และ cache ตรง', async () => {
    const created = await createProduct();
    const productId = created.body.data.id;
    const unique = randomUUID().slice(0, 6).toUpperCase();

    const res = await request(app)
      .post(`/api/admin/products/${productId}/variants`)
      .set(asStaff())
      .send({
        sku: `${SKU_PREFIX}-ADD-${unique}`,
        colorSlug: 'lavender',
        sizeCode: 'S',
        initialStock: 4,
        isActive: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.data.variants.length).toBe(2);
    expect(res.body.data.totalStock).toBe(14);

    const movements = await prisma.inventoryMovement.count({
      where: { variant: { productId }, type: 'STOCK_IN' },
    });
    expect(movements).toBe(2);
  });

  it('สี/ไซซ์ซ้ำกับตัวเลือกที่มีอยู่ → 409', async () => {
    const created = await createProduct();
    const unique = randomUUID().slice(0, 6).toUpperCase();

    const res = await request(app)
      .post(`/api/admin/products/${created.body.data.id}/variants`)
      .set(asStaff())
      .send({
        sku: `${SKU_PREFIX}-SAME-${unique}`,
        colorSlug: 'black',
        sizeCode: 'M',
        isActive: true,
      });

    expect(res.status).toBe(409);
  });

  it('แก้ราคาและปิดการขายของตัวเลือกได้', async () => {
    const created = await createProduct();
    const variantId = created.body.data.variants[0].id;

    const res = await request(app)
      .patch(`/api/admin/products/${created.body.data.id}/variants/${variantId}`)
      .set(asStaff())
      .send({ price: 777, isActive: false });

    expect(res.status).toBe(200);
    const variant = res.body.data.variants.find((row: { id: string }) => row.id === variantId);
    expect(variant.price).toBe(777);
    expect(variant.isActive).toBe(false);
  });

  it('ราคาลดของตัวเลือกที่ไม่ได้กำหนดราคาเอง → 400 (ไม่บันทึกส่วนลดที่ไม่มีผลจริง)', async () => {
    const created = await createProduct({ price: 400 });
    const productId = created.body.data.id;
    const variantId = created.body.data.variants[0].id;

    // variant นี้ price = null → salePrice จะไม่มีผลกับราคาที่ลูกค้าจ่าย ต้องปฏิเสธ
    const floating = await request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantId}`)
      .set(asStaff())
      .send({ salePrice: 300 });

    expect(floating.status).toBe(400);
    expect(floating.body.message).toContain('ราคาของตัวเลือก');

    // ตอนสร้างตัวเลือกใหม่ก็ใช้กฎเดียวกัน
    const onCreate = await request(app)
      .post(`/api/admin/products/${productId}/variants`)
      .set(asStaff())
      .send({
        sku: `${SKU_PREFIX}-FLOAT-${randomUUID().slice(0, 6).toUpperCase()}`,
        colorSlug: 'white',
        sizeCode: 'L',
        salePrice: 200,
      });
    expect(onCreate.status).toBe(400);
  });

  it('ตั้งราคาเฉพาะของตัวเลือกพร้อมราคาลด แล้วล้างด้วย null ได้', async () => {
    const created = await createProduct({ price: 400 });
    const productId = created.body.data.id;
    const variantId = created.body.data.variants[0].id;

    const tooHigh = await request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantId}`)
      .set(asStaff())
      .send({ price: 450, salePrice: 500 });
    expect(tooHigh.status).toBe(400);

    const ok = await request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantId}`)
      .set(asStaff())
      .send({ price: 450, salePrice: 300 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.variants[0].finalPrice).toBe(300);

    const noSale = await request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantId}`)
      .set(asStaff())
      .send({ salePrice: null });
    expect(noSale.status).toBe(200);
    expect(noSale.body.data.variants[0].salePrice).toBeNull();
    expect(noSale.body.data.variants[0].finalPrice).toBe(450);

    // ล้างราคาของตัวเลือก → กลับไปใช้ราคาของสินค้าแม่
    const backToParent = await request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantId}`)
      .set(asStaff())
      .send({ price: null });
    expect(backToParent.status).toBe(200);
    expect(backToParent.body.data.variants[0].finalPrice).toBe(400);
  });

  it('endpoint สินค้าแก้จำนวนสต็อกตรง ๆ ไม่ได้ → 422 และสต็อกไม่ขยับ', async () => {
    const created = await createProduct();
    const productId = created.body.data.id;
    const variantId = created.body.data.variants[0].id;

    const res = await request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantId}`)
      .set(asStaff())
      .send({ quantity: 9999, initialStock: 9999, totalStock: 9999 });

    // ฟิลด์สต็อกถูกตัดทิ้งทั้งหมด → เหลือคำขอว่าง → ปฏิเสธ
    expect(res.status).toBe(422);

    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { variantId },
      select: { quantity: true },
    });
    expect(inventory.quantity).toBe(10);
  });
});

describe('DELETE /api/admin/products/:productId', () => {
  it('ลบเป็น soft delete และหายจากหน้าร้านทันที', async () => {
    const created = await createProduct({ status: 'DRAFT' });
    const productId = created.body.data.id;
    const slug = created.body.data.slug;

    await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set(asStaff())
      .send({ status: 'ACTIVE' });
    expect((await request(app).get(`/api/products/${slug}`)).status).toBe(200);

    const res = await request(app).delete(`/api/admin/products/${productId}`).set(asStaff());

    expect(res.status).toBe(200);

    const row = await prisma.product.findUniqueOrThrow({
      where: { id: productId },
      select: { deletedAt: true, status: true, variants: { select: { deletedAt: true } } },
    });
    expect(row.deletedAt).not.toBeNull();
    expect(row.status).toBe('ARCHIVED');
    expect(row.variants.every((variant) => variant.deletedAt !== null)).toBe(true);

    // หน้าร้านต้องไม่เห็นอีก และหลังบ้านก็ไม่เจอในรายการ
    expect((await request(app).get(`/api/products/${slug}`)).status).toBe(404);
    expect((await request(app).get(`/api/admin/products/${productId}`).set(asStaff())).status).toBe(
      404,
    );
  });

  it('ลบไม่ได้ถ้ามีของถูกจองอยู่ในออเดอร์ที่ยังไม่จบ → 409', async () => {
    const created = await createProduct();
    const productId = created.body.data.id;
    const variantId = created.body.data.variants[0].id;

    // จำลองว่ามีออเดอร์จองของไว้
    await prisma.inventory.update({
      where: { variantId },
      data: { reservedQuantity: 2 },
    });

    const res = await request(app).delete(`/api/admin/products/${productId}`).set(asStaff());

    expect(res.status).toBe(409);
    expect(res.body.message).toContain('จอง');

    await prisma.inventory.update({ where: { variantId }, data: { reservedQuantity: 0 } });
  });
});

describe('GET /api/admin/products', () => {
  it('ค้นหา กรองสถานะ และนับจำนวนได้', async () => {
    const created = await createProduct();

    const search = await request(app)
      .get(`/api/admin/products?q=${created.body.data.sku}`)
      .set(asStaff());
    expect(search.body.data.total).toBe(1);
    expect(search.body.data.items[0].sku).toBe(created.body.data.sku);

    const drafts = await request(app)
      .get('/api/admin/products?status=DRAFT&limit=50')
      .set(asStaff());
    for (const item of drafts.body.data.items as { status: string }[]) {
      expect(item.status).toBe('DRAFT');
    }

    expect(typeof search.body.data.lowStockCount).toBe('number');
  });

  it('กรองสต็อกต่ำ: จำนวนที่นับตรงกับแถวที่ได้ และคิดจากของที่ขายได้จริง', async () => {
    // สต็อก 2 ชิ้น จุดเตือน 5 → ต้องถือว่าสต็อกต่ำ
    const low = await createProduct({
      minimumStock: 5,
      variants: [
        {
          sku: `${SKU_PREFIX}-LOW-${randomUUID().slice(0, 6).toUpperCase()}`,
          colorSlug: 'black',
          sizeCode: 'S',
          initialStock: 2,
          isActive: true,
        },
      ],
    });

    const res = await request(app).get('/api/admin/products?lowStock=true&limit=50').set(asStaff());

    expect(res.status).toBe(200);
    // ทุกแถวที่คืนมาต้องเข้าเงื่อนไขจริง
    for (const item of res.body.data.items as { availableStock: number; minimumStock: number }[]) {
      expect(item.availableStock).toBeLessThanOrEqual(item.minimumStock);
    }
    expect(res.body.data.total).toBe(res.body.data.lowStockCount);
    expect(
      (res.body.data.items as { id: string }[]).some((item) => item.id === low.body.data.id),
    ).toBe(true);
  });

  it('ตัวเลือกของฟอร์มมาจากฐานข้อมูลจริง', async () => {
    const res = await request(app).get('/api/admin/products/options').set(asStaff());

    expect(res.status).toBe(200);
    expect(res.body.data.categories.length).toBeGreaterThan(0);
    expect(res.body.data.colors.length).toBeGreaterThan(0);
    expect(res.body.data.sizes.length).toBeGreaterThan(0);
    expect(res.body.data.allowedImageHosts).toContain('images.unsplash.com');
  });

  it('สถานะที่ไม่มีใน enum → 422', async () => {
    const res = await request(app).get('/api/admin/products?status=SOMETHING').set(asStaff());

    expect(res.status).toBe(422);
  });
});
