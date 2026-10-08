import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * หมวดหมู่ · แบรนด์ · ไซซ์ · สี (STEP 48)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - สิทธิ์: ดู = product:read (พนักงานดูได้) · แก้ = catalog:manage
 *   - หมวดซ้อนได้ 2 ชั้นเท่านั้น (หน้าร้านกรองหมวด + หมวดย่อยชั้นเดียว)
 *   - ปิด/ลบ/แก้ slug ของที่ยังมีคนใช้ไม่ได้ พร้อมเหตุผล · ลบแล้ว slug/ชื่อใช้ใหม่ได้
 *   - **สินค้าที่เปิดขายใช้ได้เฉพาะของที่เปิดใช้อยู่** — ทุกทางที่ผูกของกับสินค้า (รวมนำเข้าไฟล์)
 *     และกันได้แม้สองคนทำพร้อมกัน (ปิดหมวด vs เปิดขายสินค้าในหมวดนั้น)
 *   - ลบสีที่ตัวเลือกยังอ้างถึงไม่ได้ ทั้งที่ service และที่ฐานข้อมูล (FK Restrict)
 *   - แผงกรองหน้าร้านแสดงเฉพาะสี/ไซซ์ที่มีสินค้าขายอยู่จริง
 *   - ทุกการเปลี่ยนเขียน AdminLog
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 6);
const tag = (value: string) => `${value}-${suffix}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let admin = { id: '', token: '' };
let employee = { id: '', token: '' };

const created = {
  products: [] as string[],
  categories: [] as string[],
  brands: [] as string[],
  sizes: [] as string[],
  colors: [] as string[],
  coupons: [] as string[],
};

const IMAGE = {
  url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80',
  alt: 'รูปทดสอบหมวดหมู่',
};

async function createUser(role: 'EMPLOYEE' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-catalog-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

type Overview = {
  categories: Array<{
    id: string;
    slug: string;
    name: string;
    parentId: string | null;
    isActive: boolean;
    blockers: Record<string, string | null>;
  }>;
  brands: Array<{ id: string; slug: string; name: string; isActive: boolean }>;
  sizes: Array<{ id: string; code: string; name: string }>;
  colors: Array<{ id: string; slug: string; hex: string; name: string }>;
};

async function overview(): Promise<Overview> {
  const res = await request(app).get('/api/admin/catalog').set(auth(admin.token));
  expect(res.status).toBe(200);
  return res.body.data as Overview;
}

function api(method: 'post' | 'patch' | 'delete' | 'put', path: string, body?: object) {
  const req = request(app)[method](`/api/admin/catalog${path}`).set(auth(admin.token));
  return body === undefined ? req : req.send(body);
}

async function createCategory(name: string, slug: string, parentId: string | null = null) {
  const res = await api('post', '/categories', { name, slug, parentId });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (res.body.data as Overview).categories.find((c) => c.slug === slug)!;
  created.categories.push(row.id);
  return row;
}

async function createColor(name: string, slug: string, hex = '#123456') {
  const res = await api('post', '/colors', { name, slug, hex });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (res.body.data as Overview).colors.find((c) => c.slug === slug)!;
  created.colors.push(row.id);
  return row;
}

async function createSize(name: string, code: string) {
  const res = await api('post', '/sizes', { name, code });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const row = (res.body.data as Overview).sizes.find((s) => s.code === code.toUpperCase())!;
  created.sizes.push(row.id);
  return row;
}

/** สร้างสินค้าผ่าน API จริง (ตัวเลือกเดียว · ไม่มีสต็อก → ไม่มี movement ให้ต้องล้าง) */
async function createProduct(input: {
  categorySlug: string;
  status?: 'DRAFT' | 'ACTIVE';
  colorSlug?: string;
  sizeCode?: string;
  brandSlug?: string;
}) {
  const unique = randomUUID().slice(0, 6).toUpperCase();
  const res = await request(app)
    .post('/api/admin/products')
    .set(auth(admin.token))
    .send({
      name: `สินค้าทดสอบหมวด ${unique}`,
      slug: `test-cat-${unique.toLowerCase()}`,
      sku: `TS-CAT-${unique}`,
      description: 'สินค้าทดสอบของ STEP 48',
      price: 290,
      categorySlug: input.categorySlug,
      ...(input.brandSlug ? { brandSlug: input.brandSlug } : {}),
      status: input.status ?? 'DRAFT',
      images: [IMAGE],
      variants: [
        {
          sku: `TS-CAT-${unique}-V`,
          initialStock: 0,
          ...(input.colorSlug ? { colorSlug: input.colorSlug } : {}),
          ...(input.sizeCode ? { sizeCode: input.sizeCode } : {}),
        },
      ],
    });

  if (res.status === 201) created.products.push(res.body.data.id);
  return res;
}

beforeAll(async () => {
  admin = await createUser('ADMIN', 'admin');
  employee = await createUser('EMPLOYEE', 'employee');
});

afterAll(async () => {
  const userIds = [admin.id, employee.id];

  await prisma.coupon.deleteMany({ where: { id: { in: created.coupons } } });
  await prisma.product.deleteMany({ where: { id: { in: created.products } } });
  await prisma.product.deleteMany({
    where: { sku: { startsWith: `TS-CATIMP-${suffix.toUpperCase()}` } },
  });
  /**
   * ล้างด้วย suffix ของรอบนี้ด้วย ไม่ใช่แค่ id ที่จดไว้ — ถ้าโค้ดพังจนสร้างแถวที่ควรถูกปฏิเสธ
   * (เช่นหมวดหลาน) เทสต์ล้มก่อนจด id แล้วแถวนั้นค้างในฐานข้อมูล dev (เจอตอนทำ mutation check ของ STEP 48)
   * · slug ของของที่ลบแล้วยังมี suffix อยู่ (`…-<suffix>--deleted-<id>`)
   */
  const mine = { contains: suffix };
  await prisma.size.deleteMany({
    where: { OR: [{ id: { in: created.sizes } }, { code: { contains: suffix.toUpperCase() } }] },
  });
  await prisma.color.deleteMany({
    where: { OR: [{ id: { in: created.colors } }, { slug: mine }] },
  });
  // หมวดย่อยก่อนหมวดแม่ (FK ของ parentId)
  const categories = { OR: [{ id: { in: created.categories } }, { slug: mine }] };
  await prisma.category.deleteMany({ where: { ...categories, parentId: { not: null } } });
  await prisma.category.deleteMany({ where: categories });
  await prisma.brand.deleteMany({
    where: { OR: [{ id: { in: created.brands } }, { slug: mine }] },
  });
  await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe('สิทธิ์', () => {
  it('พนักงานดูได้แต่แก้ไม่ได้ · ไม่ล็อกอิน 401', async () => {
    expect((await request(app).get('/api/admin/catalog')).status).toBe(401);
    expect((await request(app).get('/api/admin/catalog').set(auth(employee.token))).status).toBe(
      200,
    );

    const attempt = await request(app)
      .post('/api/admin/catalog/colors')
      .set(auth(employee.token))
      .send({ name: tag('สีพนักงาน'), slug: tag('employee-color'), hex: '#000000' });
    expect(attempt.status).toBe(403);
  });
});

describe('หมวดหมู่', () => {
  it('ซ้อนได้ 2 ชั้นเท่านั้น — หมวดหลาน · ย้ายหมวดที่มีลูกไปเป็นลูก · เป็นแม่ตัวเอง = 400', async () => {
    const root = await createCategory(tag('หมวดบน'), tag('root'));
    const other = await createCategory(tag('หมวดบนอีกหมวด'), tag('root-other'));
    const child = await createCategory(tag('หมวดย่อย'), tag('child'), root.id);

    const grandchild = await api('post', '/categories', {
      name: tag('หมวดหลาน'),
      slug: tag('grandchild'),
      parentId: child.id,
    });
    expect(grandchild.status).toBe(400);
    expect(grandchild.body.message).toContain('หมวดระดับบนสุด');

    const moveParent = await api('patch', `/categories/${root.id}`, { parentId: other.id });
    expect(moveParent.status).toBe(400);
    expect(moveParent.body.message).toContain('หมวดย่อยอยู่');

    const self = await api('patch', `/categories/${other.id}`, { parentId: other.id });
    expect(self.status).toBe(400);

    // ภาพรวมเรียงหมวดย่อยต่อจากหมวดแม่
    const list = (await overview()).categories.map((c) => c.id);
    expect(list.indexOf(child.id)).toBe(list.indexOf(root.id) + 1);
  });

  it('slug ซ้ำ = 409 · ชื่อซ้ำในหมวดแม่เดียวกัน (ไม่สนตัวพิมพ์) = 409 · ต่างหมวดแม่ใช้ชื่อเดียวกันได้', async () => {
    const a = await createCategory(tag('หมวด A'), tag('cat-a'));
    const b = await createCategory(tag('หมวด B'), tag('cat-b'));

    expect(
      (await api('post', '/categories', { name: tag('อื่น'), slug: tag('cat-a') })).status,
    ).toBe(409);

    await createCategory(`Sale ${suffix}`, tag('sale-a'), a.id);
    const dup = await api('post', '/categories', {
      name: `SALE ${suffix}`,
      slug: tag('sale-a2'),
      parentId: a.id,
    });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toContain('ชื่อนี้');

    await createCategory(`Sale ${suffix}`, tag('sale-b'), b.id);
  });

  it('ปิดหมวดที่มีสินค้าเปิดขายไม่ได้ (บอกจำนวน) · ปิดการขายแล้วปิดหมวดได้ · เขียน AdminLog', async () => {
    const category = await createCategory(tag('หมวดขายอยู่'), tag('selling'));
    const product = await createProduct({ categorySlug: category.slug, status: 'ACTIVE' });
    expect(product.status).toBe(201);

    const blocked = await api('patch', `/categories/${category.id}`, { isActive: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain('1 ชิ้น');

    await request(app)
      .patch(`/api/admin/products/${product.body.data.id}`)
      .set(auth(admin.token))
      .send({ status: 'ARCHIVED' })
      .expect(200);

    const ok = await api('patch', `/categories/${category.id}`, { isActive: false });
    expect(ok.status).toBe(200);

    const log = await prisma.adminLog.findFirst({
      where: { userId: admin.id, action: 'catalog.category.update', targetId: category.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(log?.before).toMatchObject({ isActive: true });
    expect(log?.after).toMatchObject({ isActive: false });
  });

  it('ปิดหมวดแม่ที่หมวดย่อยยังเปิดอยู่ไม่ได้ · เปิดหมวดย่อยใต้หมวดแม่ที่ปิดไม่ได้', async () => {
    const parent = await createCategory(tag('แม่'), tag('mom'));
    const child = await createCategory(tag('ลูก'), tag('kid'), parent.id);

    expect((await api('patch', `/categories/${parent.id}`, { isActive: false })).status).toBe(409);

    await api('patch', `/categories/${child.id}`, { isActive: false }).expect(200);
    await api('patch', `/categories/${parent.id}`, { isActive: false }).expect(200);

    const reopen = await api('patch', `/categories/${child.id}`, { isActive: true });
    expect(reopen.status).toBe(400);
    expect(reopen.body.message).toContain('หมวดแม่ปิดใช้งานอยู่');
  });

  it('แก้ slug ได้เฉพาะตอนยังไม่มีสินค้า (แม้เป็นฉบับร่าง)', async () => {
    const empty = await createCategory(tag('หมวดว่าง'), tag('empty'));
    await api('patch', `/categories/${empty.id}`, { slug: tag('empty-renamed') }).expect(200);

    const used = await createCategory(tag('หมวดมีของ'), tag('used'));
    expect((await createProduct({ categorySlug: used.slug })).status).toBe(201);

    const blocked = await api('patch', `/categories/${used.id}`, { slug: tag('used-renamed') });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain('slug');
  });

  it('ลบไม่ได้ถ้ามีสินค้า · หมวดย่อย · คูปองที่จำกัดไว้ — ลบแล้ว slug ใช้ใหม่ได้', async () => {
    const withProduct = await createCategory(tag('มีสินค้า'), tag('del-product'));
    await createProduct({ categorySlug: withProduct.slug });
    expect((await api('delete', `/categories/${withProduct.id}`)).status).toBe(409);

    const withChild = await createCategory(tag('มีลูก'), tag('del-parent'));
    await createCategory(tag('ลูกของมีลูก'), tag('del-child'), withChild.id);
    expect((await api('delete', `/categories/${withChild.id}`)).status).toBe(409);

    const withCoupon = await createCategory(tag('มีคูปอง'), tag('del-coupon'));
    const coupon = await prisma.coupon.create({
      data: {
        code: `CAT${suffix.toUpperCase()}`,
        name: 'คูปองทดสอบหมวด',
        type: 'PERCENTAGE',
        value: 10,
        startsAt: new Date(),
        endsAt: new Date(Date.now() + 86_400_000),
        categories: { connect: { id: withCoupon.id } },
      },
    });
    created.coupons.push(coupon.id);
    const couponBlocked = await api('delete', `/categories/${withCoupon.id}`);
    expect(couponBlocked.status).toBe(409);
    expect(couponBlocked.body.message).toContain('คูปอง');

    const free = await createCategory(tag('ลบได้'), tag('del-free'));
    await api('delete', `/categories/${free.id}`).expect(200);
    expect((await overview()).categories.some((c) => c.id === free.id)).toBe(false);

    // slug เดิมกลับมาใช้ได้ (แถวที่ลบถูกต่อท้าย slug ไว้)
    await createCategory(tag('ลบได้ ใหม่'), tag('del-free'));
  });

  it('เรียงลำดับต้องส่งหมวดครบทุกหมวดในกลุ่ม — ไม่ครบ = 409', async () => {
    const parent = await createCategory(tag('เรียง'), tag('order-parent'));
    const first = await createCategory(tag('เรียง 1'), tag('order-1'), parent.id);
    const second = await createCategory(tag('เรียง 2'), tag('order-2'), parent.id);

    const partial = await api('put', '/categories/order', {
      parentId: parent.id,
      ids: [second.id],
    });
    expect(partial.status).toBe(409);

    await api('put', '/categories/order', {
      parentId: parent.id,
      ids: [second.id, first.id],
    }).expect(200);

    const children = await prisma.category.findMany({
      where: { parentId: parent.id },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    expect(children.map((c) => c.id)).toEqual([second.id, first.id]);
  });
});

describe('แบรนด์', () => {
  it('ชื่อซ้ำไม่สนตัวพิมพ์ = 409 · ลบแล้วสร้างชื่อเดิมใหม่ได้', async () => {
    const res = await api('post', '/brands', { name: `Brand ${suffix}`, slug: tag('brand') });
    expect(res.status).toBe(201);
    const brand = (res.body.data as Overview).brands.find((b) => b.slug === tag('brand'))!;
    created.brands.push(brand.id);

    expect(
      (await api('post', '/brands', { name: `BRAND ${suffix}`, slug: tag('brand-2') })).status,
    ).toBe(409);

    await api('delete', `/brands/${brand.id}`).expect(200);

    const again = await api('post', '/brands', { name: `Brand ${suffix}`, slug: tag('brand') });
    expect(again.status).toBe(201);
    created.brands.push(
      (again.body.data as Overview).brands.find((b) => b.slug === tag('brand'))!.id,
    );
  });
});

describe('ไซซ์และสี', () => {
  it('ค่าสีถูกทำให้เป็น #RRGGBB · ค่าสีผิดรูป 422 · รหัสไซซ์เป็นตัวพิมพ์ใหญ่', async () => {
    const color = await createColor(tag('สีม่วงทดสอบ'), tag('test-purple'), '7c3aed');
    expect(color.hex).toBe('#7C3AED');

    expect(
      (await api('post', '/colors', { name: tag('สีผิด'), slug: tag('bad'), hex: '#12' })).status,
    ).toBe(422);

    const size = await createSize(tag('ไซซ์ยาว'), `xl-${suffix}`);
    expect(size.code).toBe(`XL-${suffix.toUpperCase()}`);
  });

  it('ลบสีที่ตัวเลือกยังอ้างถึงไม่ได้ (แม้ตัวเลือกถูกลบไปแล้ว) — และฐานข้อมูลก็ไม่ยอม', async () => {
    const category = await createCategory(tag('หมวดสี'), tag('color-cat'));
    const color = await createColor(tag('สีที่ใช้แล้ว'), tag('used-color'));
    const product = await createProduct({ categorySlug: category.slug, colorSlug: color.slug });
    expect(product.status).toBe(201);

    await prisma.productVariant.updateMany({
      where: { productId: product.body.data.id },
      data: { deletedAt: new Date(), isActive: false },
    });

    const blocked = await api('delete', `/colors/${color.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain('ปิดใช้งาน');

    // ด่านสุดท้าย: FK Restrict (เดิม SetNull — ตัวเลือกจะกลายเป็น "ไม่มีสี" เงียบ ๆ)
    await expect(prisma.color.delete({ where: { id: color.id } })).rejects.toThrow();

    const unused = await createColor(tag('สีที่ไม่มีใครใช้'), tag('unused-color'));
    await api('delete', `/colors/${unused.id}`).expect(200);
    expect(await prisma.color.count({ where: { id: unused.id } })).toBe(0);
  });

  it('ปิดสีที่ตัวเลือกของสินค้าที่เปิดขายใช้อยู่ไม่ได้ · ใช้แค่ในฉบับร่างปิดได้', async () => {
    const category = await createCategory(tag('หมวดปิดสี'), tag('deactivate-color-cat'));
    const selling = await createColor(tag('สีขายอยู่'), tag('selling-color'));
    const draftOnly = await createColor(tag('สีในฉบับร่าง'), tag('draft-color'));

    await createProduct({ categorySlug: category.slug, colorSlug: selling.slug, status: 'ACTIVE' });
    await createProduct({ categorySlug: category.slug, colorSlug: draftOnly.slug });

    const blocked = await api('patch', `/colors/${selling.id}`, { isActive: false });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toContain('1 รายการ');

    await api('patch', `/colors/${draftOnly.id}`, { isActive: false }).expect(200);
  });

  it('เรียงไซซ์ต้องส่งครบทุกไซซ์ · ส่งครบแล้วลำดับเปลี่ยนตามจริง', async () => {
    // ไซซ์เป็นข้อมูลของทั้งร้าน — จดค่าเดิมไว้คืนให้ครบ ไม่ทิ้งลำดับที่เทสต์สลับไว้
    const original = await prisma.size.findMany({ select: { id: true, sortOrder: true } });

    try {
      const ids = (await overview()).sizes.map((s) => s.id);
      expect((await api('put', '/sizes/order', { ids: ids.slice(1) })).status).toBe(409);

      const reversed = [...ids].reverse();
      await api('put', '/sizes/order', { ids: reversed }).expect(200);
      expect((await overview()).sizes.map((s) => s.id)).toEqual(reversed);
    } finally {
      for (const row of original) {
        await prisma.size.update({ where: { id: row.id }, data: { sortOrder: row.sortOrder } });
      }
    }
  });
});

describe('สินค้าใช้ได้เฉพาะของที่เปิดใช้อยู่', () => {
  it('สร้างสินค้าในหมวดที่ปิด · เพิ่มตัวเลือกด้วยสีที่ปิด = 400 พร้อมชื่อ', async () => {
    const closed = await createCategory(tag('หมวดที่ปิด'), tag('closed-cat'));
    await api('patch', `/categories/${closed.id}`, { isActive: false }).expect(200);

    const res = await createProduct({ categorySlug: closed.slug });
    expect(res.status).toBe(400);
    expect(res.body.message).toContain(tag('หมวดที่ปิด'));

    const open = await createCategory(tag('หมวดที่เปิด'), tag('open-cat'));
    const closedColor = await createColor(tag('สีที่ปิด'), tag('closed-color'));
    await api('patch', `/colors/${closedColor.id}`, { isActive: false }).expect(200);

    const product = await createProduct({ categorySlug: open.slug });
    const variant = await request(app)
      .post(`/api/admin/products/${product.body.data.id}/variants`)
      .set(auth(admin.token))
      .send({ sku: `TS-CAT-${suffix.toUpperCase()}-CLOSED`, colorSlug: closedColor.slug });
    expect(variant.status).toBe(400);
    expect(variant.body.message).toContain('ปิดใช้งานอยู่');
  });

  it('เปิดขายฉบับร่างที่หมวดถูกปิดไปแล้วไม่ได้ · เปิดตัวเลือกที่สีถูกปิดไปแล้วไม่ได้', async () => {
    const category = await createCategory(tag('หมวดฉบับร่าง'), tag('draft-cat'));
    const color = await createColor(tag('สีฉบับร่าง'), tag('draft-only-color'));
    const product = await createProduct({ categorySlug: category.slug, colorSlug: color.slug });
    const productId = product.body.data.id as string;
    const variantId = product.body.data.variants[0].id as string;

    await request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantId}`)
      .set(auth(admin.token))
      .send({ isActive: false })
      .expect(200);
    await api('patch', `/colors/${color.id}`, { isActive: false }).expect(200);

    const reactivate = await request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantId}`)
      .set(auth(admin.token))
      .send({ isActive: true });
    expect(reactivate.status).toBe(400);

    await api('patch', `/colors/${color.id}`, { isActive: true }).expect(200);
    await request(app)
      .patch(`/api/admin/products/${productId}/variants/${variantId}`)
      .set(auth(admin.token))
      .send({ isActive: true })
      .expect(200);

    await api('patch', `/categories/${category.id}`, { isActive: false }).expect(200);
    const publish = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set(auth(admin.token))
      .send({ status: 'ACTIVE' });
    expect(publish.status).toBe(400);
    expect(publish.body.message).toContain('ปิดใช้งานอยู่');
  });

  it('ปิดหมวดพร้อมกับเปิดขายสินค้าในหมวดนั้น — ไม่มีทางได้สินค้าที่ขายอยู่ในหมวดที่ปิด', async () => {
    for (let round = 0; round < 3; round += 1) {
      const category = await createCategory(tag(`หมวดแข่ง ${round}`), tag(`race-${round}`));
      const product = await createProduct({ categorySlug: category.slug });
      const productId = product.body.data.id as string;

      await Promise.all([
        api('patch', `/categories/${category.id}`, { isActive: false }),
        request(app)
          .patch(`/api/admin/products/${productId}`)
          .set(auth(admin.token))
          .send({ status: 'ACTIVE' }),
      ]);

      const [after, row] = await Promise.all([
        prisma.category.findUniqueOrThrow({ where: { id: category.id } }),
        prisma.product.findUniqueOrThrow({ where: { id: productId } }),
      ]);

      expect(!after.isActive && row.status === 'ACTIVE', `รอบ ${round}`).toBe(false);
    }
  });
});

describe('แผงกรองหน้าร้าน', () => {
  it('สีที่เพิ่งสร้างไม่โผล่ในตัวกรองจนกว่าจะมีสินค้าที่ขายอยู่ใช้ (ไม่ใช่ตัวเลือกที่กดแล้วได้หน้าว่าง)', async () => {
    const category = await createCategory(tag('หมวดตัวกรอง'), tag('filter-cat'));
    const color = await createColor(tag('สีตัวกรอง'), tag('filter-color'));

    // ตัวค้นหาใช้เกณฑ์เดียวกัน — สีที่ยังไม่มีสินค้าไม่ถูกตีความเป็นตัวกรองที่ไม่มีผล
    const searchUnderstandsColor = async () => {
      const res = await request(app).get('/api/search').query({ q: color.name });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return (res.body.data.understood as Array<{ kind: string }>).some(
        (part) => part.kind === 'color',
      );
    };

    const before = await request(app).get('/api/products/filters');
    expect(
      (before.body.data.colors as Array<{ slug: string }>).some((c) => c.slug === color.slug),
    ).toBe(false);
    expect(await searchUnderstandsColor()).toBe(false);

    await createProduct({ categorySlug: category.slug, colorSlug: color.slug, status: 'ACTIVE' });

    const after = await request(app).get('/api/products/filters');
    expect(
      (after.body.data.colors as Array<{ slug: string }>).some((c) => c.slug === color.slug),
    ).toBe(true);
    expect(await searchUnderstandsColor()).toBe(true);
  });
});

describe('นำเข้าไฟล์ใช้กฎเดียวกัน', () => {
  async function importCsv(lines: string[]) {
    return request(app)
      .post('/api/admin/import/products?dryRun=false')
      .set(auth(admin.token))
      .attach('file', Buffer.from(lines.join('\n')), 'catalog.csv');
  }

  const header = 'productName,sku,category,price,variantSku,color,status';
  const sku = (label: string) => `TS-CATIMP-${suffix.toUpperCase()}-${label}`;

  it('สีที่ไม่มีในระบบ = ผิด (เดิมข้ามไปเงียบ ๆ แล้วได้ตัวเลือกที่ไม่มีสี)', async () => {
    const category = await createCategory(tag('หมวดนำเข้า'), tag('import-cat'));

    const res = await importCsv([
      header,
      `"นำเข้าสีผิด","${sku('A')}","${category.slug}",100,"${sku('A')}-V","แดด",""`,
    ]);

    expect(res.body.data.errorCount).toBe(1);
    expect(res.body.data.errors[0]).toMatchObject({ field: 'color' });
    expect(await prisma.product.count({ where: { sku: sku('A') } })).toBe(0);
  });

  it('หมวดที่ปิดอยู่ = ผิด · สินค้าใหม่ ACTIVE (ไม่มีรูป) = ผิด · ไม่ระบุสถานะ = ฉบับร่าง', async () => {
    const closed = await createCategory(tag('หมวดนำเข้าปิด'), tag('import-closed'));
    await api('patch', `/categories/${closed.id}`, { isActive: false }).expect(200);
    const open = await createCategory(tag('หมวดนำเข้าเปิด'), tag('import-open'));

    const closedRes = await importCsv([
      header,
      `"หมวดปิด","${sku('B')}","${closed.slug}",100,"${sku('B')}-V","",""`,
    ]);
    expect(closedRes.body.data.errors[0]).toMatchObject({ field: 'category' });

    const activeRes = await importCsv([
      header,
      `"เปิดขายทันที","${sku('C')}","${open.slug}",100,"${sku('C')}-V","","ACTIVE"`,
    ]);
    expect(activeRes.body.data.errors[0]).toMatchObject({ field: 'status' });
    expect(activeRes.body.data.errors[0].message).toContain('รูป');

    const draftRes = await importCsv([
      header,
      `"ไม่ระบุสถานะ","${sku('D')}","${open.slug}",100,"${sku('D')}-V","",""`,
    ]);
    expect(draftRes.body.data.errorCount).toBe(0);
    expect((await prisma.product.findUniqueOrThrow({ where: { sku: sku('D') } })).status).toBe(
      'DRAFT',
    );
  });

  it('นำเข้าสินค้าเดิมโดยไม่ระบุสถานะ = คงสถานะเดิม (เดิมกลับมาเปิดขายเอง)', async () => {
    const category = await createCategory(tag('หมวดสินค้าเดิม'), tag('import-existing'));
    await importCsv([
      header,
      `"สินค้าเดิม","${sku('E')}","${category.slug}",100,"${sku('E')}-V","",""`,
    ]);
    await prisma.product.update({ where: { sku: sku('E') }, data: { status: 'ARCHIVED' } });

    const res = await importCsv([
      header,
      `"สินค้าเดิม ราคาใหม่","${sku('E')}","${category.slug}",120,"${sku('E')}-V","",""`,
    ]);
    expect(res.body.data.errorCount).toBe(0);

    const product = await prisma.product.findUniqueOrThrow({ where: { sku: sku('E') } });
    expect(product.status).toBe('ARCHIVED');
    expect(product.price.toNumber()).toBe(120);
  });
});
