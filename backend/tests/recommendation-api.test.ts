import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import {
  runFallbackStylist,
  searchProductsForStylist,
} from '../src/services/ai-stylist.service.ts';
import { getArticleBySlug, voteArticleHelpful } from '../src/services/knowledge-base.service.ts';
import { flushProductViews } from '../src/services/view-counter.service.ts';

/**
 * Integration test ของการแนะนำสินค้า (STEP 46) — ยิงผ่าน HTTP กับฐานข้อมูลจริง
 *
 *   - ไม่ล็อกอิน / ไม่มีประวัติ / ปิดการแนะนำ → ยอดนิยม พร้อมบอกเหตุผล (และปิดแล้วต้องเหมือนคนไม่ล็อกอินเป๊ะ)
 *   - มีประวัติ → เหตุผลอ้างสินค้าจริงที่ลูกค้าทำ · ไม่แนะนำสิ่งที่รู้จักแล้ว
 *   - ซื้อด้วยกันมาจากคำสั่งซื้อจริงที่ร้านได้เงินแล้ว · ของที่ขายไม่ได้ไม่ถูกแนะนำ
 *   - ยอดเข้าชมรวมเป็นชุด และการอ่านไม่ทำให้ "แก้ไขล่าสุด" ขยับ
 *   - AI Stylist บอกตรง ๆ เมื่อคืนของที่ไม่ตรงเงื่อนไข
 */
const app = createApp();
const prisma = getPrisma();
const suffix = randomUUID().slice(0, 8);

interface TestUser {
  id: string;
  token: string;
}

const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];
let shopper: TestUser;
let fresh: TestUser;
let optedOut: TestUser;
let admin: TestUser;
let anchor: { id: string; slug: string; name: string };
let partner: { id: string; slug: string; name: string; variantId: string };

const auth = (user: TestUser) => ({ Authorization: `Bearer ${user.token}` });

async function createUser(role: 'CUSTOMER' | 'ADMIN', label: string, allowPersonalization = true) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: {
      email: `test-rec-${label}-${suffix}@teenstyle.test`,
      roleId: roleRow.id,
      allowPersonalization,
    },
  });
  const token = `test-session-${randomUUID()}`;

  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });
  createdUserIds.push(user.id);

  return { id: user.id, token };
}

const forYou = (user?: TestUser) => {
  const call = request(app).get('/api/recommendations/for-you?limit=8');
  return user === undefined ? call : call.set(auth(user));
};

/** ตัวเลือกแรกที่ยังมีของ — ใช้สั่งซื้อจริง */
async function variantOf(productId: string): Promise<string> {
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { productId, isActive: true, deletedAt: null, inventory: { quantity: { gt: 3 } } },
    select: { id: true },
  });

  return variant.id;
}

/** ลูกค้าอีกคนสั่ง anchor + partner ในใบเดียวกัน (ยังไม่จ่ายเงิน — ใบนี้จองสต็อกไว้) */
async function orderTogether(label: string) {
  const buyer = await createUser('CUSTOMER', label);

  for (const variantId of [await variantOf(anchor.id), partner.variantId]) {
    expect(
      (await request(app).post('/api/cart/items').set(auth(buyer)).send({ variantId, quantity: 1 }))
        .status,
    ).toBeLessThan(300);
  }

  const order = await request(app)
    .post('/api/orders')
    .set(auth(buyer))
    .send({
      idempotencyKey: randomUUID(),
      shippingMethod: 'STANDARD',
      newAddress: {
        recipientName: 'ผู้รับทดสอบการแนะนำ',
        phone: '0812345678',
        line1: '1 ซอยทดสอบ',
        subDistrict: 'สีลม',
        district: 'บางรัก',
        province: 'กรุงเทพมหานคร',
        postalCode: '10500',
        saveForLater: false,
      },
    });
  expect(order.status).toBe(201);
  createdOrderIds.push(order.body.data.id);

  return { buyer, orderNumber: order.body.data.orderNumber as string };
}

/** สั่งคู่กันแล้วร้านส่งถึง (COD ได้เงินตอนส่งถึง = ใบที่ร้านได้เงินแล้ว) */
async function buyTogether(label: string) {
  const { buyer, orderNumber } = await orderTogether(label);

  await request(app)
    .post(`/api/orders/${orderNumber}/pay`)
    .set(auth(buyer))
    .send({ provider: 'COD' });
  for (const step of [
    { status: 'PACKING' },
    {
      status: 'SHIPPING',
      carrier: 'Kerry Express',
      trackingNumber: `REC${suffix}${label}`.toUpperCase().slice(0, 30),
    },
    { status: 'DELIVERED' },
  ]) {
    expect(
      (
        await request(app)
          .patch(`/api/admin/orders/${orderNumber}/status`)
          .set(auth(admin))
          .send(step)
      ).status,
    ).toBe(200);
  }

  return buyer;
}

/** ผู้ซื้อคนแรกที่ได้รับ anchor + partner แล้ว — รีวิวได้จริง */
let firstBuyer: TestUser;

beforeAll(async () => {
  shopper = await createUser('CUSTOMER', 'shopper');
  fresh = await createUser('CUSTOMER', 'fresh');
  optedOut = await createUser('CUSTOMER', 'optout', false);
  admin = await createUser('ADMIN', 'admin');

  /**
   * คู่สินค้าที่ **ไม่มีอะไรเหมือนกันเลย** (หมวดแม่ · แบรนด์ · tag) — ถ้าคู่นี้ถูกแนะนำด้วยกัน
   * เหตุผลเดียวที่เป็นไปได้คือคำสั่งซื้อจริงที่ซื้อด้วยกัน (ไม่ใช่การเดาจากหมวด)
   */
  const products = await prisma.product.findMany({
    where: { deletedAt: null, status: 'ACTIVE' },
    select: {
      id: true,
      slug: true,
      name: true,
      tags: true,
      brandId: true,
      categoryId: true,
      category: { select: { parentId: true } },
    },
    orderBy: { name: 'asc' },
  });
  const parentOf = (p: (typeof products)[number]) => p.category.parentId ?? p.categoryId;

  outer: for (const a of products) {
    for (const b of products) {
      if (
        a.id !== b.id &&
        parentOf(a) !== parentOf(b) &&
        a.brandId !== b.brandId &&
        !a.tags.some((tag) => b.tags.includes(tag))
      ) {
        anchor = { id: a.id, slug: a.slug, name: a.name };
        partner = { id: b.id, slug: b.slug, name: b.name, variantId: await variantOf(b.id) };
        break outer;
      }
    }
  }

  expect(anchor, 'ข้อมูลตั้งต้นต้องมีสินค้าสองชิ้นที่ไม่เหมือนกันเลย').toBeDefined();

  // ลูกค้าที่มีประวัติ (และคนที่ปิดการแนะนำ) กดถูกใจ anchor ไว้
  for (const user of [shopper, optedOut]) {
    expect(
      (
        await request(app)
          .post('/api/wishlist/items')
          .set(auth(user))
          .send({ productId: anchor.id })
      ).status,
    ).toBeLessThan(300);
  }
});

afterAll(async () => {
  const movements = await prisma.inventoryMovement.findMany({
    where: { referenceType: 'ORDER', referenceId: { in: createdOrderIds } },
    select: { variantId: true, type: true, quantity: true },
  });
  for (const movement of movements) {
    const amount = movement.type === 'STOCK_OUT' ? movement.quantity : -movement.quantity;
    await prisma.inventory.update({
      where: { variantId: movement.variantId },
      data: { quantity: { increment: amount } },
    });
    const owner = await prisma.productVariant.findUniqueOrThrow({
      where: { id: movement.variantId },
      select: { productId: true },
    });
    await prisma.product.update({
      where: { id: owner.productId },
      data: { totalStock: { increment: amount } },
    });
  }

  await prisma.inventoryMovement.deleteMany({
    where: { referenceType: 'ORDER', referenceId: { in: createdOrderIds } },
  });
  await prisma.adminLog.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.review.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.wishlist.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.cartItem.deleteMany({ where: { cart: { userId: { in: createdUserIds } } } });
  await prisma.cart.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });

  await disconnectDatabase();
});

describe('แนะนำสำหรับคุณ', () => {
  it('ไม่ล็อกอิน → ยอดนิยมที่ขายได้จริง บอกเหตุผลว่าเป็นยอดนิยม และห้าม cache ร่วม', async () => {
    const response = await forYou();

    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('private');
    expect(response.body.data).toMatchObject({ mode: 'POPULAR', fallbackReason: 'GUEST' });
    expect(response.body.data.items.length).toBeGreaterThan(0);

    for (const item of response.body.data.items) {
      expect(item.reason).toBe('ยอดนิยมในร้าน');
      expect(item.product.stockStatus).not.toBe('OUT_OF_STOCK');
    }
  });

  it('ยังไม่มีประวัติ → ยอดนิยม (บอกว่ายังไม่มีประวัติ)', async () => {
    const response = await forYou(fresh);

    expect(response.body.data).toMatchObject({ mode: 'POPULAR', fallbackReason: 'NO_HISTORY' });
  });

  it('มีประวัติ → เหตุผลอ้างสินค้าที่ลูกค้าถูกใจจริง · ไม่แนะนำสิ่งที่ถูกใจอยู่แล้ว', async () => {
    const response = await forYou(shopper);
    const items: { product: { id: string }; reason: string }[] = response.body.data.items;

    expect(response.body.data).toMatchObject({ mode: 'PERSONAL', fallbackReason: null });
    expect(items.map((item) => item.product.id)).not.toContain(anchor.id);
    expect(items.some((item) => item.reason === `คล้าย “${anchor.name}” ที่คุณถูกใจ`)).toBe(true);
    // ทุกชิ้นมีเหตุผล: อ้างสินค้าจริง หรือบอกตรง ๆ ว่าเป็นยอดนิยมที่เติมให้ครบ
    for (const item of items) {
      expect(item.reason === 'ยอดนิยมในร้าน' || item.reason.includes('“')).toBe(true);
    }
  });

  /**
   * สวิตช์ในหน้าโปรไฟล์บอกลูกค้าว่า "ปิดแล้วคำแนะนำจะไม่อ้างอิงประวัติของคุณ" — ต้องเป็นจริง
   * คนที่ปิดไว้ (แต่มีประวัติเหมือน shopper) ต้องได้รายการเดียวกับคนที่ไม่ได้ล็อกอินเป๊ะ
   */
  it('ปิดการแนะนำ → ไม่ใช้ประวัติเลย ได้รายการเดียวกับคนที่ไม่ได้ล็อกอิน', async () => {
    const [mine, guest] = await Promise.all([forYou(optedOut), forYou()]);
    const ids = (body: { data: { items: { product: { id: string } }[] } }) =>
      body.data.items.map((item) => item.product.id);

    expect(mine.body.data).toMatchObject({ mode: 'POPULAR', fallbackReason: 'OPTED_OUT' });
    expect(ids(mine.body)).toEqual(ids(guest.body));
  });
});

describe('ซื้อด้วยกัน — จากคำสั่งซื้อจริงที่ร้านได้เงินแล้ว', () => {
  /**
   * ใบที่ยังไม่จ่ายเงินยังไม่ใช่ "การซื้อ" — ลูกค้ากดสั่งแล้วทิ้งได้ และใครก็สร้างใบค้างจ่ายรัว ๆ
   * เพื่อปั่นให้สินค้าของตัวเองขึ้นเป็น "ซื้อด้วยกันบ่อย" ได้ถ้านับใบพวกนี้
   */
  it('ยังไม่มีใครซื้อคู่กัน (มีแค่ใบที่ยังไม่จ่ายเงิน) → ไม่มีรายการ "ซื้อด้วยกัน" (ไม่เดา)', async () => {
    const { buyer, orderNumber } = await orderTogether('unpaid');

    try {
      const response = await request(app).get(`/api/products/${anchor.slug}/recommendations`);

      expect(response.status).toBe(200);
      expect(
        response.body.data.boughtTogether.map(
          (item: { product: { id: string } }) => item.product.id,
        ),
      ).not.toContain(partner.id);
    } finally {
      // ยกเลิกผ่านเส้นทางจริง → คืนของที่จองไว้ (ลบแถวเฉย ๆ แล้ว reservedQuantity จะค้าง — บทเรียน STEP 41)
      expect(
        (await request(app).post(`/api/orders/${orderNumber}/cancel`).set(auth(buyer)).send({}))
          .status,
      ).toBe(200);
    }
  });

  it('ลูกค้าสองคนซื้อคู่กัน → หน้าสินค้าบอกจำนวนใบจริง · คนที่ถูกใจ anchor ได้ partner พร้อมเหตุผล', async () => {
    firstBuyer = await buyTogether('b1');
    await buyTogether('b2');

    const product = await request(app).get(`/api/products/${anchor.slug}/recommendations`);
    const pair = product.body.data.boughtTogether.find(
      (item: { product: { id: string } }) => item.product.id === partner.id,
    );

    expect(pair?.reason).toBe('ซื้อพร้อมกันใน 2 คำสั่งซื้อ');

    const mine = await forYou(shopper);
    const recommended = mine.body.data.items.find(
      (item: { product: { id: string } }) => item.product.id === partner.id,
    );

    expect(recommended?.reason).toBe(`ลูกค้าที่ซื้อ “${anchor.name}” ซื้อชิ้นนี้ด้วย`);
  });

  it('ของที่ขายไม่ได้ (ถูกจองหมด) ไม่ถูกแนะนำ แม้จะซื้อคู่กันบ่อย', async () => {
    const stock = await prisma.inventory.findMany({
      where: { variant: { productId: partner.id } },
      select: { variantId: true, quantity: true, reservedQuantity: true },
    });

    // ตั้งของที่จองไว้ = ของในคลังชั่วคราว (ไม่แตะยอดคลังจริง · วิธีจาก CLAUDE.md STEP 6)
    for (const row of stock) {
      await prisma.inventory.update({
        where: { variantId: row.variantId },
        data: { reservedQuantity: row.quantity },
      });
    }

    try {
      const product = await request(app).get(`/api/products/${anchor.slug}/recommendations`);
      const mine = await forYou(shopper);
      const ids = (items: { product: { id: string } }[]) => items.map((item) => item.product.id);

      expect(ids(product.body.data.boughtTogether)).not.toContain(partner.id);
      expect(ids(product.body.data.similar)).not.toContain(partner.id);
      expect(ids(mine.body.data.items)).not.toContain(partner.id);
    } finally {
      for (const row of stock) {
        await prisma.inventory.update({
          where: { variantId: row.variantId },
          data: { reservedQuantity: row.reservedQuantity },
        });
      }
    }
  });

  /**
   * ซื้อแล้วรีวิว 1 ดาว = บอกร้านว่าไม่ชอบ → ต้องไม่เห็น "คล้าย “X” ที่คุณสั่งซื้อ" อีก
   * (เดิมนับเฉพาะรีวิว 4–5 ดาวเป็นสัญญาณ แต่ไม่ได้ตัดการสั่งซื้อของชิ้นที่ไม่ชอบ)
   */
  it('รีวิวว่าไม่ชอบ → ของชิ้นนั้นไม่ถูกใช้เป็นเหตุผลและไม่ถูกแนะนำกลับ', async () => {
    const mentionsAnchor = (body: { data: { items: { reason: string }[] } }) =>
      body.data.items.some((item) => item.reason.includes(`“${anchor.name}”`));

    // ก่อนรีวิว: ของที่คล้าย anchor ถูกแนะนำโดยอ้าง anchor (ไม่งั้นเทสต์นี้ไม่ได้พิสูจน์อะไร)
    expect(mentionsAnchor((await forYou(firstBuyer)).body)).toBe(true);

    const review = await request(app).post('/api/reviews').set(auth(firstBuyer)).send({
      productId: anchor.id,
      rating: 1,
      comment: 'ไม่ตรงกับที่คาดไว้เลย ผิดหวังมาก',
    });
    expect(review.status).toBe(201);

    const after = await forYou(firstBuyer);

    expect(mentionsAnchor(after.body)).toBe(false);
    expect(
      after.body.data.items.map((item: { product: { id: string } }) => item.product.id),
    ).not.toContain(anchor.id);
  });
});

describe('หน้าสินค้า', () => {
  it('สินค้าคล้ายกันไม่รวมตัวเอง · ลุคที่จัดชิ้นนี้ไว้แสดงชิ้นอื่นในลุคจริง · ไม่มีสินค้า → 404', async () => {
    const item = await prisma.lookItem.findFirstOrThrow({
      where: {
        look: { isActive: true, deletedAt: null },
        product: { deletedAt: null, status: 'ACTIVE' },
      },
      select: {
        product: { select: { id: true, slug: true } },
        look: { select: { slug: true, items: { select: { productId: true } } } },
      },
    });

    const response = await request(app).get(`/api/products/${item.product.slug}/recommendations`);
    const ids = (items: { product: { id: string } }[]) => items.map((row) => row.product.id);

    expect(ids(response.body.data.similar)).not.toContain(item.product.id);

    const look = response.body.data.looks.find(
      (row: { slug: string }) => row.slug === item.look.slug,
    );
    const lookProductIds = item.look.items.map((row) => row.productId);

    expect(look).toBeDefined();
    for (const card of look.items as { id: string }[]) {
      expect(lookProductIds).toContain(card.id);
      expect(card.id).not.toBe(item.product.id);
    }

    expect(
      (await request(app).get('/api/products/no-such-product-46/recommendations')).status,
    ).toBe(404);
  });
});

/**
 * สองเทสต์นี้แตะตัวนับจริง → คืนค่าเดิมทุกช่องใน `finally`
 * (ยอดวิว/โหวตที่เทสต์ทิ้งไว้จะไปโผล่บนหน้าหลังบ้านเป็นตัวเลขที่ไม่เคยเกิดขึ้น — กฎ STEP 21 ข้อ 4)
 */
describe('ยอดเข้าชม — รวมเป็นชุด และการอ่านไม่ใช่การแก้', () => {
  it('เปิดหน้าสินค้า: ยังไม่เขียนทันที · เขียนครบตอนรวมชุด · updatedAt ไม่ขยับ', async () => {
    await flushProductViews();
    const before = await prisma.product.findUniqueOrThrow({
      where: { id: anchor.id },
      select: { viewCount: true, updatedAt: true },
    });

    try {
      for (let index = 0; index < 3; index += 1) {
        expect((await request(app).get(`/api/products/${anchor.slug}`)).status).toBe(200);
      }

      const pending = await prisma.product.findUniqueOrThrow({
        where: { id: anchor.id },
        select: { viewCount: true },
      });
      expect(pending.viewCount).toBe(before.viewCount);

      expect(await flushProductViews()).toBe(3);

      const after = await prisma.product.findUniqueOrThrow({
        where: { id: anchor.id },
        select: { viewCount: true, updatedAt: true },
      });
      expect(after.viewCount).toBe(before.viewCount + 3);
      expect(after.updatedAt.toISOString()).toBe(before.updatedAt.toISOString());
    } finally {
      await flushProductViews();
      await prisma.product.update({ where: { id: anchor.id }, data: before });
    }
  });

  it('อ่านและโหวตบทความคลังความรู้ไม่ทำให้ "แก้ไขล่าสุด" ขยับ', async () => {
    const article = await prisma.knowledgeArticle.findFirstOrThrow({
      where: { isPublished: true },
      orderBy: { slug: 'asc' },
      select: { id: true, slug: true, viewCount: true, helpfulCount: true, updatedAt: true },
    });

    try {
      await getArticleBySlug(article.slug);
      await voteArticleHelpful(article.id, true);

      const after = await prisma.knowledgeArticle.findUniqueOrThrow({
        where: { id: article.id },
        select: { updatedAt: true },
      });
      expect(after.updatedAt.toISOString()).toBe(article.updatedAt.toISOString());
    } finally {
      await prisma.knowledgeArticle.update({
        where: { id: article.id },
        data: {
          viewCount: article.viewCount,
          helpfulCount: article.helpfulCount,
          updatedAt: article.updatedAt,
        },
      });
    }
  });
});

describe('AI Stylist บอกตรง ๆ เมื่อของไม่ตรงเงื่อนไข', () => {
  it('เงื่อนไขที่ไม่มีของตรง → ติดธง relaxed และข้อความบอกว่าไม่ตรงเงื่อนไข ไม่ใช่ "คัดสรรมาให้แล้ว"', async () => {
    const search = await searchProductsForStylist({
      style: 'y2k',
      color: 'ดำ',
      maxPrice: 1,
      limit: 4,
    });

    expect(search.relaxed).toBe(true);
    expect(search.products.every((product) => product.stockStatus !== 'OUT_OF_STOCK')).toBe(true);

    const reply = await runFallbackStylist('อยากได้ชุดสไตล์ y2k สีดำ งบ 1 บาท');

    expect(reply.replyText).toContain('ไม่ได้ตรงเงื่อนไขทั้งหมด');
    expect(reply.replyText).not.toContain('คัดสรรชุด');
  });
});
