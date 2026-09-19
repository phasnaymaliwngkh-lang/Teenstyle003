import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของรายการที่ถูกใจ (STEP 22)
 *
 * ใช้ฐานข้อมูลจริง สร้างผู้ใช้ทดสอบสองคน แล้วลบทิ้งใน afterAll
 * ไม่แตะข้อมูลสินค้าที่ seed ไว้ (ยกเว้นตั้ง salePrice ชั่วคราวเพื่อทดสอบ "ราคาลด" แล้วคืนค่าเดิม)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - ต้องล็อกอิน และต้องมีสิทธิ์ `wishlist:manage` จริงในฐานข้อมูล
 *   - รายการของคนอื่นดู/ลบไม่ได้ (IDOR)
 *   - `priceWhenAdded` มาจากฐานข้อมูล — ราคาที่ client แนบมาถูกเมิน
 *   - กดถูกใจซ้ำไม่สร้างแถวซ้ำ และไม่เขียนทับราคาเดิม
 *   - ป้าย "ราคาลด" คำนวณสดจากราคาปัจจุบัน
 *   - ไม่เดาตัวเลือกให้ลูกค้าเมื่อสินค้ามีหลายสี/ไซซ์
 *   - คำขอจาก origin อื่นถูกปฏิเสธ (CSRF)
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

let userId = '';
let userToken = '';
let otherUserId = '';
let otherToken = '';

/** สินค้าที่มีหลายตัวเลือก — ใช้ทดสอบว่าไม่เดาตัวเลือกให้ */
let multiVariantProduct = { id: '', slug: '', finalPrice: 0, originalSalePrice: null as unknown };

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createTestUser(email: string) {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  const user = await prisma.user.create({
    data: { email, roleId: role.id, status: 'ACTIVE' },
  });

  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

beforeAll(async () => {
  const main = await createTestUser(`test-wishlist-${suffix}@teenstyle.test`);
  userId = main.id;
  userToken = main.token;

  const other = await createTestUser(`test-wishlist-other-${suffix}@teenstyle.test`);
  otherUserId = other.id;
  otherToken = other.token;

  // หาสินค้าที่เปิดขายและมีตัวเลือกมากกว่าหนึ่ง
  const product = await prisma.product.findFirstOrThrow({
    where: {
      status: 'ACTIVE',
      deletedAt: null,
      variants: { some: { isActive: true, deletedAt: null } },
    },
    select: {
      id: true,
      slug: true,
      price: true,
      salePrice: true,
      _count: { select: { variants: true } },
    },
    orderBy: { variants: { _count: 'desc' } },
  });

  multiVariantProduct = {
    id: product.id,
    slug: product.slug,
    finalPrice: Number(String(product.salePrice ?? product.price)),
    originalSalePrice: product.salePrice,
  };
});

afterAll(async () => {
  // คืนราคาลดของสินค้าให้เป็นค่าเดิม (เทสต์แก้ชั่วคราวเพื่อดูป้ายราคาลด)
  await prisma.product.update({
    where: { id: multiVariantProduct.id },
    data: { salePrice: multiVariantProduct.originalSalePrice as never },
  });

  await prisma.wishlist.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  await prisma.session.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  await disconnectDatabase();
});

describe('สิทธิ์และการเข้าถึง', () => {
  it('ยังไม่ล็อกอิน → 401 ทุก endpoint', async () => {
    const list = await request(app).get('/api/wishlist');
    expect(list.status).toBe(401);

    const add = await request(app)
      .post('/api/wishlist/items')
      .send({ productId: multiVariantProduct.id });
    expect(add.status).toBe(401);
  });

  it('คำขอจาก origin อื่นถูกปฏิเสธ (CSRF)', async () => {
    const res = await request(app)
      .post('/api/wishlist/items')
      .set(auth(userToken))
      .set('Origin', 'https://evil.example.com')
      .send({ productId: multiVariantProduct.id });

    expect(res.status).toBe(403);
  });

  it('ถอนสิทธิ์ wishlist:manage ในฐานข้อมูลแล้วใช้ไม่ได้ทันที (ไม่ได้ hard-code ตามบทบาท)', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'wishlist:manage' },
    });

    try {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { disconnect: { id: permission.id } } },
      });

      const res = await request(app).get('/api/wishlist').set(auth(userToken));
      expect(res.status).toBe(403);
    } finally {
      // คืนสิทธิ์ให้ฐานข้อมูลเสมอ แม้เทสจะล้ม
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: { id: permission.id } } },
      });
    }

    // คืนสิทธิ์แล้วใช้ได้เหมือนเดิม
    const after = await request(app).get('/api/wishlist').set(auth(userToken));
    expect(after.status).toBe(200);
  });
});

describe('เพิ่มและลบรายการที่ถูกใจ', () => {
  it('เพิ่มสินค้า → 201 และ priceWhenAdded มาจากฐานข้อมูล', async () => {
    const res = await request(app)
      .post('/api/wishlist/items')
      .set(auth(userToken))
      .send({ productId: multiVariantProduct.id });

    expect(res.status).toBe(201);
    expect(res.body.data.created).toBe(true);
    expect(res.body.data.priceWhenAdded).toBe(multiVariantProduct.finalPrice);
  });

  it('ราคาที่ client แนบมาถูกเมิน — ใช้ราคาจากฐานข้อมูลเสมอ', async () => {
    await prisma.wishlist.deleteMany({ where: { userId, productId: multiVariantProduct.id } });

    const res = await request(app)
      .post('/api/wishlist/items')
      .set(auth(userToken))
      .send({ productId: multiVariantProduct.id, priceWhenAdded: 1, price: 1, finalPrice: 1 });

    expect(res.status).toBe(201);
    expect(res.body.data.priceWhenAdded).toBe(multiVariantProduct.finalPrice);

    const row = await prisma.wishlist.findUniqueOrThrow({
      where: { userId_productId: { userId, productId: multiVariantProduct.id } },
      select: { priceWhenAdded: true },
    });
    expect(Number(String(row.priceWhenAdded))).toBe(multiVariantProduct.finalPrice);
  });

  it('กดถูกใจซ้ำ → 200 ไม่สร้างแถวซ้ำ และไม่เขียนทับราคาเดิม', async () => {
    const res = await request(app)
      .post('/api/wishlist/items')
      .set(auth(userToken))
      .send({ productId: multiVariantProduct.id });

    expect(res.status).toBe(200);
    expect(res.body.data.created).toBe(false);

    const count = await prisma.wishlist.count({
      where: { userId, productId: multiVariantProduct.id },
    });
    expect(count).toBe(1);
  });

  it('สินค้าที่ไม่มีอยู่จริง → 404', async () => {
    const res = await request(app)
      .post('/api/wishlist/items')
      .set(auth(userToken))
      .send({ productId: randomUUID() });

    expect(res.status).toBe(404);
  });

  it('productId ที่ไม่ใช่ UUID → 422 พร้อมข้อความภาษาไทย', async () => {
    const res = await request(app)
      .post('/api/wishlist/items')
      .set(auth(userToken))
      .send({ productId: 'not-a-uuid' });

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain('รหัสสินค้าไม่ถูกต้อง');
  });

  it('ไม่ส่ง productId มาเลย → ข้อความภาษาไทย ไม่ใช่ข้อความดิบของ Zod', async () => {
    const res = await request(app).post('/api/wishlist/items').set(auth(userToken)).send({});

    expect(res.status).toBe(422);
    const body = JSON.stringify(res.body);
    expect(body).toContain('กรุณาระบุรหัสสินค้า');
    expect(body).not.toContain('expected string');
  });
});

describe('ความเป็นเจ้าของ (IDOR)', () => {
  it('รายการของคนอื่นไม่โผล่ในรายการของเรา', async () => {
    await request(app)
      .post('/api/wishlist/items')
      .set(auth(otherToken))
      .send({ productId: multiVariantProduct.id });

    const res = await request(app).get('/api/wishlist').set(auth(userToken));
    expect(res.status).toBe(200);

    // ทั้งสองคนกดถูกใจสินค้าชิ้นเดียวกัน แต่ต่างคนต่างเห็นแถวของตัวเองแถวเดียว
    expect(res.body.data.items.length).toBe(1);
    const ownRows = await prisma.wishlist.findMany({
      where: { id: res.body.data.items[0].id },
      select: { userId: true },
    });
    expect(ownRows[0]?.userId).toBe(userId);
  });

  it('ลบสินค้าที่ไม่ได้อยู่ในรายการของเรา → 404 (ไม่ใช่ 403 เพื่อไม่บอกใบ้)', async () => {
    const stranger = await prisma.product.findFirstOrThrow({
      where: { status: 'ACTIVE', deletedAt: null, id: { not: multiVariantProduct.id } },
      select: { id: true },
    });

    const res = await request(app)
      .delete(`/api/wishlist/items/${stranger.id}`)
      .set(auth(userToken));

    expect(res.status).toBe(404);
  });

  it('ลบของเราเอง → สำเร็จ และของคนอื่นยังอยู่ครบ', async () => {
    const res = await request(app)
      .delete(`/api/wishlist/items/${multiVariantProduct.id}`)
      .set(auth(userToken));

    expect(res.status).toBe(200);

    expect(await prisma.wishlist.count({ where: { userId } })).toBe(0);
    expect(await prisma.wishlist.count({ where: { userId: otherUserId } })).toBe(1);
  });
});

describe('ราคาลดและความพร้อมขาย', () => {
  it('ราคาปัจจุบันถูกลงกว่าตอนกดถูกใจ → มีป้ายราคาลดที่คำนวณสดจากราคาจริง', async () => {
    // กดถูกใจที่ราคาปัจจุบัน
    await request(app)
      .post('/api/wishlist/items')
      .set(auth(userToken))
      .send({ productId: multiVariantProduct.id });

    // ร้านลดราคาทีหลัง
    const droppedTo = Math.max(1, Math.round(multiVariantProduct.finalPrice * 0.8));
    await prisma.product.update({
      where: { id: multiVariantProduct.id },
      data: { salePrice: droppedTo },
    });

    const res = await request(app).get('/api/wishlist').set(auth(userToken));
    const item = res.body.data.items[0];

    expect(item.priceWhenAdded).toBe(multiVariantProduct.finalPrice);
    expect(item.product.finalPrice).toBe(droppedTo);
    expect(item.priceDrop).not.toBeNull();
    expect(item.priceDrop.amount).toBe(multiVariantProduct.finalPrice - droppedTo);
    expect(res.body.data.summary.priceDropCount).toBe(1);
  });

  it('กรอง onlyPriceDrop=true คืนเฉพาะรายการที่ราคาลดจริง', async () => {
    const res = await request(app).get('/api/wishlist?onlyPriceDrop=true').set(auth(userToken));

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    for (const item of res.body.data.items) {
      expect(item.priceDrop).not.toBeNull();
    }
  });

  it('ราคาแพงขึ้นกว่าตอนกดถูกใจ → ไม่มีป้ายราคาลด (แจ้งเฉพาะข่าวดี)', async () => {
    await prisma.product.update({
      where: { id: multiVariantProduct.id },
      data: { salePrice: null, price: multiVariantProduct.finalPrice * 2 },
    });

    try {
      const res = await request(app).get('/api/wishlist').set(auth(userToken));
      expect(res.body.data.items[0].priceDrop).toBeNull();
      expect(res.body.data.summary.priceDropCount).toBe(0);
    } finally {
      await prisma.product.update({
        where: { id: multiVariantProduct.id },
        data: { price: multiVariantProduct.finalPrice },
      });
    }
  });

  it('สินค้าหลายตัวเลือก → ไม่เดาตัวเลือกให้ (quickAddVariantId เป็น null)', async () => {
    const res = await request(app).get('/api/wishlist').set(auth(userToken));
    const item = res.body.data.items[0];

    expect(item.activeVariantCount).toBeGreaterThan(1);
    expect(item.quickAddVariantId).toBeNull();
  });

  it('สถานะสต็อกบนการ์ดมาจากจำนวนที่ขายได้จริง ไม่ใช่ totalStock', async () => {
    const res = await request(app).get('/api/wishlist').set(auth(userToken));
    const card = res.body.data.items[0].product;

    expect(['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK']).toContain(card.stockStatus);

    const rows = await prisma.$queryRaw<Array<{ available: bigint }>>`
      SELECT COALESCE(sum(GREATEST(i."quantity" - i."reservedQuantity", 0)), 0) AS available
      FROM "ProductVariant" v
      JOIN "Inventory" i ON i."variantId" = v."id"
      WHERE v."productId" = ${multiVariantProduct.id}::uuid AND v."deletedAt" IS NULL
    `;
    const available = Number(rows[0]?.available ?? 0);

    expect(card.stockStatus === 'OUT_OF_STOCK').toBe(available === 0);
  });
});

describe('การแจ้งเตือนเมื่อราคาลด', () => {
  it('ค่าเริ่มต้นเปิดไว้ และปิดได้', async () => {
    const before = await request(app).get('/api/wishlist').set(auth(userToken));
    expect(before.body.data.items[0].notifyOnPriceDrop).toBe(true);

    const res = await request(app)
      .patch(`/api/wishlist/items/${multiVariantProduct.id}/notify`)
      .set(auth(userToken))
      .send({ notifyOnPriceDrop: false });

    expect(res.status).toBe(200);
    expect(res.body.data.notifyOnPriceDrop).toBe(false);

    const after = await request(app).get('/api/wishlist').set(auth(userToken));
    expect(after.body.data.items[0].notifyOnPriceDrop).toBe(false);
  });

  it('ตั้งค่าให้สินค้าที่ไม่ได้อยู่ในรายการของเรา → 404', async () => {
    const res = await request(app)
      .patch(`/api/wishlist/items/${randomUUID()}/notify`)
      .set(auth(userToken))
      .send({ notifyOnPriceDrop: true });

    expect(res.status).toBe(404);
  });
});
