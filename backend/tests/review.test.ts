import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของรีวิวสินค้า (STEP 23)
 *
 * ใช้ฐานข้อมูลจริง สร้างผู้ใช้ + คำสั่งซื้อทดสอบ แล้วลบทิ้งใน afterAll
 * ไม่แตะสต็อกของ seed เลย (สร้างแถว Order/OrderItem ตรง ๆ เพราะรีวิวสนใจแค่
 * "เป็นคำสั่งซื้อของฉันไหม" กับ "ได้รับของหรือยัง" ไม่เกี่ยวกับการจอง/ตัดสต็อก)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - รีวิวได้เฉพาะคนที่ซื้อ **และได้รับของแล้ว** — ไม่เคยซื้อ / ยังไม่ได้รับ ต้องเขียนไม่ได้
 *   - หนึ่งคนรีวิวได้ครั้งเดียวต่อสินค้า แม้จะซื้อสินค้าเดียวกันหลายคำสั่งซื้อ
 *   - `status` / `isVerifiedPurchase` / `orderId` ที่ client แนบมาถูกเมิน
 *   - รีวิวใหม่เป็น PENDING และ **ไม่โผล่หน้าร้าน** จนกว่าจะอนุมัติ
 *   - คะแนนเฉลี่ยนับจาก APPROVED เท่านั้น และตรงกับกราฟแท่ง
 *   - แก้รีวิวที่อนุมัติแล้ว → กลับไปรอตรวจใหม่ (และหายจากหน้าร้านทันที)
 *   - รีวิวของคนอื่นแก้/ลบไม่ได้ (IDOR → 404 ไม่ใช่ 403)
 *   - โหวต "มีประโยชน์" หนึ่งคนหนึ่งเสียง และกดของตัวเองไม่ได้
 *   - หลังบ้านต้องมีสิทธิ์ `review:moderate` จริงในฐานข้อมูล และทุกครั้งเขียน AdminLog
 *   - คำขอจาก origin อื่นถูกปฏิเสธ (CSRF)
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

let buyer = { id: '', token: '' };
let buyer2 = { id: '', token: '' };
/** คนที่ไม่เคยซื้ออะไรเลย */
let stranger = { id: '', token: '' };
let admin = { id: '', token: '' };
let employee = { id: '', token: '' };

let product = { id: '', slug: '', name: '' };
/** สินค้าอีกชิ้นที่ซื้อแล้วแต่ยังไม่ได้รับของ */
let undeliveredProduct = { id: '', slug: '' };

const createdOrderIds: string[] = [];
const createdReviewIds: string[] = [];

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createUser(role: 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: {
      email: `test-review-${label}-${suffix}@teenstyle.test`,
      roleId: roleRow.id,
      status: 'ACTIVE',
      name: label === 'buyer' ? 'สมชาย ทดสอบระบบ' : null,
    },
  });

  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

/**
 * สร้างคำสั่งซื้อจริงในฐานข้อมูลพร้อมสินค้าหนึ่งรายการ
 *
 * ไม่ผ่าน `/api/orders` เพราะที่นี่ต้องการคำสั่งซื้อที่ **ส่งถึงแล้ว** ซึ่งต้องไล่สถานะหลายขั้น
 * และการจองสต็อกไม่เกี่ยวกับสิ่งที่เทสต์ชุดนี้พิสูจน์
 */
async function createOrderFor(
  userId: string,
  productId: string,
  status: 'DELIVERED' | 'SHIPPING',
): Promise<string> {
  const order = await prisma.order.create({
    data: {
      orderNumber: `TS-TEST-${randomUUID().slice(0, 12).toUpperCase()}`,
      userId,
      status,
      paymentStatus: status === 'DELIVERED' ? 'PAID' : 'PENDING',
      subtotal: 100,
      total: 100,
      addressSnapshot: { recipientName: 'ผู้รับทดสอบ', province: 'กรุงเทพมหานคร' },
      deliveredAt: status === 'DELIVERED' ? new Date() : null,
      items: {
        create: {
          productId,
          productName: 'สินค้าทดสอบ',
          variantSku: `TEST-${suffix}`,
          unitPrice: 100,
          quantity: 1,
          lineTotal: 100,
        },
      },
    },
    select: { id: true, orderNumber: true },
  });

  createdOrderIds.push(order.id);
  return order.orderNumber;
}

/** เขียนรีวิวแล้วจำ id ไว้ลบทีหลัง */
async function postReview(token: string, productId: string, body: Record<string, unknown> = {}) {
  const res = await request(app)
    .post('/api/reviews')
    .set(auth(token))
    .send({ productId, rating: 5, comment: 'ใส่แล้วสบายมาก ผ้าดีเกินราคา แนะนำเลยครับ', ...body });

  if (res.status === 201) createdReviewIds.push(res.body.data.review.id);
  return res;
}

async function approve(reviewId: string) {
  return request(app)
    .patch(`/api/admin/reviews/${reviewId}/status`)
    .set(auth(admin.token))
    .send({ status: 'APPROVED' });
}

beforeAll(async () => {
  buyer = await createUser('CUSTOMER', 'buyer');
  buyer2 = await createUser('CUSTOMER', 'buyer2');
  stranger = await createUser('CUSTOMER', 'stranger');
  admin = await createUser('ADMIN', 'admin');
  employee = await createUser('EMPLOYEE', 'employee');

  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { id: true, slug: true, name: true },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });

  product = products[0]!;
  undeliveredProduct = products[1]!;

  await createOrderFor(buyer.id, product.id, 'DELIVERED');
  await createOrderFor(buyer2.id, product.id, 'DELIVERED');
  await createOrderFor(buyer.id, undeliveredProduct.id, 'SHIPPING');
});

afterAll(async () => {
  const userIds = [buyer.id, buyer2.id, stranger.id, admin.id, employee.id];

  await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.reviewHelpfulVote.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.review.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

/** เริ่มทุกเคสด้วยสถานะ "ยังไม่มีรีวิวของผู้ใช้ทดสอบ" เพื่อไม่ให้ผูกกับลำดับการรัน */
beforeEach(async () => {
  await prisma.reviewHelpfulVote.deleteMany({
    where: { userId: { in: [buyer.id, buyer2.id, stranger.id] } },
  });
  await prisma.review.deleteMany({ where: { userId: { in: [buyer.id, buyer2.id, stranger.id] } } });
  createdReviewIds.length = 0;
});

describe('สิทธิ์และการเข้าถึง', () => {
  it('อ่านรีวิวได้โดยไม่ต้องล็อกอิน', async () => {
    const res = await request(app).get(`/api/products/${product.slug}/reviews`);

    expect(res.status).toBe(200);
    expect(res.body.data.summary).toBeDefined();
    expect(res.body.data.myReview).toBeNull();
  });

  it('ยังไม่ล็อกอิน → 401 ทุก endpoint ที่ต้องรู้ว่าเป็นใคร', async () => {
    expect((await request(app).get('/api/reviews/me')).status).toBe(401);
    expect(
      (await request(app).post('/api/reviews').send({ productId: product.id, rating: 5 })).status,
    ).toBe(401);
    expect((await request(app).get('/api/admin/reviews')).status).toBe(401);
  });

  it('คำขอจาก origin อื่นถูกปฏิเสธ (CSRF)', async () => {
    const res = await request(app)
      .post('/api/reviews')
      .set(auth(buyer.token))
      .set('Origin', 'https://evil.example.com')
      .send({ productId: product.id, rating: 5, comment: 'ข้อความยาวพอสำหรับผ่าน validation' });

    expect(res.status).toBe(403);
  });

  it('ถอนสิทธิ์ review:create ในฐานข้อมูลแล้วเขียนรีวิวไม่ได้ทันที', async () => {
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { key: 'review:create' },
    });

    try {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { disconnect: { id: permission.id } } },
      });

      const res = await postReview(buyer.token, product.id);
      expect(res.status).toBe(403);
    } finally {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: { id: permission.id } } },
      });
    }

    const after = await postReview(buyer.token, product.id);
    expect(after.status).toBe(201);
  });

  it('พนักงาน (EMPLOYEE) ตรวจรีวิวไม่ได้ — ต้องมีสิทธิ์ review:moderate', async () => {
    const res = await request(app).get('/api/admin/reviews').set(auth(employee.token));
    expect(res.status).toBe(403);
  });
});

describe('เขียนรีวิวได้เฉพาะคนที่ซื้อและได้รับของแล้ว', () => {
  it('คนที่ไม่เคยซื้อ → 403', async () => {
    const res = await postReview(stranger.token, product.id);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('สั่งซื้อ');
  });

  it('ซื้อแล้วแต่ของยังไม่ถึง → 403 พร้อมบอกว่ายังอยู่ระหว่างจัดส่ง', async () => {
    const res = await postReview(buyer.token, undeliveredProduct.id);

    expect(res.status).toBe(403);
    expect(res.body.message).toContain('จัดส่ง');
  });

  it('ได้รับของแล้ว → 201 และ isVerifiedPurchase ผูกกับคำสั่งซื้อจริง', async () => {
    const res = await postReview(buyer.token, product.id);

    expect(res.status).toBe(201);
    expect(res.body.data.review.isVerifiedPurchase).toBe(true);

    const row = await prisma.review.findUniqueOrThrow({
      where: { id: res.body.data.review.id },
      select: { orderId: true, status: true, isVerifiedPurchase: true },
    });

    expect(row.orderId).not.toBeNull();
    expect(row.status).toBe('PENDING');
    expect(row.isVerifiedPurchase).toBe(true);
  });

  it('ค่าที่ client แนบมา (status / isVerifiedPurchase / orderId / helpfulCount) ถูกเมิน', async () => {
    const otherOrderId = createdOrderIds[1]!; // คำสั่งซื้อของลูกค้าอีกคน
    const res = await postReview(buyer.token, product.id, {
      status: 'APPROVED',
      isVerifiedPurchase: false,
      orderId: otherOrderId,
      helpfulCount: 999,
    });

    expect(res.status).toBe(201);

    const row = await prisma.review.findUniqueOrThrow({
      where: { id: res.body.data.review.id },
      select: { status: true, orderId: true, helpfulCount: true },
    });

    expect(row.status).toBe('PENDING');
    expect(row.orderId).not.toBe(otherOrderId);
    expect(row.helpfulCount).toBe(0);
  });

  it('หนึ่งคนรีวิวได้ครั้งเดียวต่อสินค้า แม้จะซื้อสินค้าเดียวกันสองคำสั่งซื้อ', async () => {
    await createOrderFor(buyer.id, product.id, 'DELIVERED');

    expect((await postReview(buyer.token, product.id)).status).toBe(201);

    const second = await postReview(buyer.token, product.id);
    expect(second.status).toBe(409);

    const count = await prisma.review.count({
      where: { userId: buyer.id, productId: product.id, deletedAt: null },
    });
    expect(count).toBe(1);
  });

  it('ดาวนอกช่วง 1–5 และข้อความสั้นเกินไป → 422', async () => {
    expect((await postReview(buyer.token, product.id, { rating: 6 })).status).toBe(422);
    expect((await postReview(buyer.token, product.id, { rating: 0 })).status).toBe(422);
    expect((await postReview(buyer.token, product.id, { comment: 'สั้น' })).status).toBe(422);
  });

  it('GET /api/reviews/eligibility บอกเหตุผลตรงกับความจริงของแต่ละสินค้า', async () => {
    await postReview(buyer.token, product.id);

    const res = await request(app)
      .get('/api/reviews/eligibility')
      .query({ productIds: [product.id, undeliveredProduct.id].join(',') })
      .set(auth(buyer.token));

    expect(res.status).toBe(200);
    const byProduct = new Map(
      (res.body.data.items as { productId: string; reason: string; canReview: boolean }[]).map(
        (item) => [item.productId, item],
      ),
    );

    expect(byProduct.get(product.id)?.reason).toBe('ALREADY_REVIEWED');
    expect(byProduct.get(undeliveredProduct.id)?.reason).toBe('NOT_DELIVERED');
    expect(byProduct.get(undeliveredProduct.id)?.canReview).toBe(false);
  });
});

describe('รีวิวใหม่ต้องผ่านการตรวจก่อนขึ้นหน้าร้าน', () => {
  it('รีวิวที่ยัง PENDING ไม่โผล่ในรายการสาธารณะ และไม่นับในคะแนนเฉลี่ย', async () => {
    const before = await request(app).get(`/api/products/${product.slug}/reviews`);
    const beforeTotal = before.body.data.summary.total as number;

    const created = await postReview(buyer.token, product.id, { rating: 1 });
    expect(created.status).toBe(201);

    const after = await request(app).get(`/api/products/${product.slug}/reviews`);
    expect(after.body.data.summary.total).toBe(beforeTotal);
    expect(
      (after.body.data.items as { id: string }[]).some(
        (item) => item.id === created.body.data.review.id,
      ),
    ).toBe(false);
  });

  it('เจ้าของเห็นรีวิวของตัวเองที่ยังรอตรวจสอบผ่าน myReview', async () => {
    const created = await postReview(buyer.token, product.id);

    const res = await request(app)
      .get(`/api/products/${product.slug}/reviews`)
      .set(auth(buyer.token));

    expect(res.body.data.myReview.id).toBe(created.body.data.review.id);
    expect(res.body.data.myReview.status).toBe('PENDING');
    expect(res.body.data.myReview.isMine).toBe(true);
  });

  it('อนุมัติแล้วจึงขึ้นหน้าร้านและนับในคะแนนเฉลี่ย', async () => {
    const before = await request(app).get(`/api/products/${product.slug}/reviews`);
    const beforeTotal = before.body.data.summary.total as number;

    const created = await postReview(buyer.token, product.id, { rating: 5 });
    expect((await approve(created.body.data.review.id)).status).toBe(200);

    const after = await request(app).get(`/api/products/${product.slug}/reviews`);
    expect(after.body.data.summary.total).toBe(beforeTotal + 1);

    // ไม่ล็อกอินต้องเห็นรีวิวนี้ในรายการสาธารณะ
    expect(
      (after.body.data.items as { id: string }[]).some(
        (item) => item.id === created.body.data.review.id,
      ),
    ).toBe(true);
  });

  it('คะแนนเฉลี่ยตรงกับกราฟแท่ง และกราฟมีครบ 5 ช่องเสมอ', async () => {
    const created = await postReview(buyer.token, product.id, { rating: 4 });
    await approve(created.body.data.review.id);

    const res = await request(app).get(`/api/products/${product.slug}/reviews`);
    const summary = res.body.data.summary as {
      total: number;
      average: number;
      distribution: { rating: number; count: number }[];
    };

    expect(summary.distribution).toHaveLength(5);
    expect(summary.distribution.map((bucket) => bucket.rating)).toEqual([5, 4, 3, 2, 1]);

    const sum = summary.distribution.reduce((acc, bucket) => acc + bucket.count, 0);
    const weighted = summary.distribution.reduce(
      (acc, bucket) => acc + bucket.count * bucket.rating,
      0,
    );

    expect(sum).toBe(summary.total);
    expect(summary.average).toBe(Math.round((weighted / summary.total) * 10) / 10);
  });

  it('ยังไม่มีรีวิวที่อนุมัติ → คะแนนเฉลี่ยเป็น 0 ไม่ใช่ค่ากลางที่เดาเอา', async () => {
    const fresh = await prisma.product.findFirstOrThrow({
      where: { status: 'ACTIVE', deletedAt: null, reviews: { none: { status: 'APPROVED' } } },
      select: { slug: true },
    });

    const res = await request(app).get(`/api/products/${fresh.slug}/reviews`);
    expect(res.body.data.summary.total).toBe(0);
    expect(res.body.data.summary.average).toBe(0);
  });

  it('ไม่ส่งชื่อเต็มหรืออีเมลของผู้รีวิวออกหน้าร้าน', async () => {
    const created = await postReview(buyer.token, product.id);
    await approve(created.body.data.review.id);

    const res = await request(app).get(`/api/products/${product.slug}/reviews`);
    const mine = (res.body.data.items as { id: string; author: { displayName: string } }[]).find(
      (item) => item.id === created.body.data.review.id,
    );

    expect(mine?.author.displayName).toBe('สมชาย ท.');
    expect(JSON.stringify(res.body)).not.toContain('@teenstyle.test');
    expect(JSON.stringify(res.body)).not.toContain('ทดสอบระบบ');
  });
});

describe('แก้และลบรีวิวของตัวเอง', () => {
  it('แก้รีวิวที่อนุมัติแล้ว → กลับไปรอตรวจใหม่ และหายจากหน้าร้านทันที', async () => {
    const created = await postReview(buyer.token, product.id);
    const reviewId = created.body.data.review.id as string;
    await approve(reviewId);

    const res = await request(app)
      .patch(`/api/reviews/${reviewId}`)
      .set(auth(buyer.token))
      .send({ comment: 'ขอแก้ข้อความใหม่ให้ละเอียดกว่าเดิมอีกหน่อยครับ' });

    expect(res.status).toBe(200);
    expect(res.body.data.review.status).toBe('PENDING');

    const list = await request(app).get(`/api/products/${product.slug}/reviews`);
    expect((list.body.data.items as { id: string }[]).some((item) => item.id === reviewId)).toBe(
      false,
    );
  });

  it('แก้รีวิวของคนอื่นไม่ได้ — คืน 404 ไม่ใช่ 403', async () => {
    const created = await postReview(buyer.token, product.id);
    const reviewId = created.body.data.review.id as string;

    const res = await request(app)
      .patch(`/api/reviews/${reviewId}`)
      .set(auth(buyer2.token))
      .send({ rating: 1 });

    expect(res.status).toBe(404);

    const row = await prisma.review.findUniqueOrThrow({
      where: { id: reviewId },
      select: { rating: true },
    });
    expect(row.rating).toBe(5);
  });

  it('ลบรีวิวของคนอื่นไม่ได้ · ลบของตัวเองเป็น soft delete แล้วเขียนใหม่ได้', async () => {
    const created = await postReview(buyer.token, product.id);
    const reviewId = created.body.data.review.id as string;

    expect(
      (await request(app).delete(`/api/reviews/${reviewId}`).set(auth(buyer2.token))).status,
    ).toBe(404);

    const mine = await request(app).delete(`/api/reviews/${reviewId}`).set(auth(buyer.token));
    expect(mine.status).toBe(200);

    const row = await prisma.review.findUniqueOrThrow({
      where: { id: reviewId },
      select: { deletedAt: true },
    });
    expect(row.deletedAt).not.toBeNull();

    // ลบแล้วเขียนใหม่ได้ (เงื่อนไขหนึ่งคนหนึ่งรีวิวนับเฉพาะรีวิวที่ยังไม่ถูกลบ)
    expect((await postReview(buyer.token, product.id)).status).toBe(201);
  });

  it('GET /api/reviews/me เห็นเฉพาะรีวิวของตัวเอง', async () => {
    await postReview(buyer.token, product.id);
    await postReview(buyer2.token, product.id);

    const res = await request(app).get('/api/reviews/me').set(auth(buyer.token));

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items[0].product.id).toBe(product.id);
  });
});

describe('โหวตว่ารีวิวมีประโยชน์', () => {
  async function approvedReviewByBuyer2(): Promise<string> {
    const created = await postReview(buyer2.token, product.id);
    const reviewId = created.body.data.review.id as string;
    await approve(reviewId);
    return reviewId;
  }

  it('กดซ้ำหลายครั้งนับเป็นเสียงเดียว', async () => {
    const reviewId = await approvedReviewByBuyer2();

    for (let i = 0; i < 3; i += 1) {
      const res = await request(app)
        .patch(`/api/reviews/${reviewId}/helpful`)
        .set(auth(buyer.token))
        .send({ helpful: true });

      expect(res.status).toBe(200);
      expect(res.body.data.helpfulCount).toBe(1);
      expect(res.body.data.votedHelpful).toBe(true);
    }

    const votes = await prisma.reviewHelpfulVote.count({ where: { reviewId } });
    expect(votes).toBe(1);
  });

  it('ยกเลิกโหวตแล้วยอดลดลง และไม่ติดลบเมื่อกดยกเลิกซ้ำ', async () => {
    const reviewId = await approvedReviewByBuyer2();

    await request(app)
      .patch(`/api/reviews/${reviewId}/helpful`)
      .set(auth(buyer.token))
      .send({ helpful: true });

    for (let i = 0; i < 2; i += 1) {
      const res = await request(app)
        .patch(`/api/reviews/${reviewId}/helpful`)
        .set(auth(buyer.token))
        .send({ helpful: false });

      expect(res.body.data.helpfulCount).toBe(0);
      expect(res.body.data.votedHelpful).toBe(false);
    }
  });

  it('กดว่ารีวิวของตัวเองมีประโยชน์ไม่ได้', async () => {
    const created = await postReview(buyer.token, product.id);
    const reviewId = created.body.data.review.id as string;
    await approve(reviewId);

    const res = await request(app)
      .patch(`/api/reviews/${reviewId}/helpful`)
      .set(auth(buyer.token))
      .send({ helpful: true });

    expect(res.status).toBe(400);
  });

  it('โหวตรีวิวที่ยังไม่อนุมัติไม่ได้ → 404', async () => {
    const created = await postReview(buyer2.token, product.id);

    const res = await request(app)
      .patch(`/api/reviews/${created.body.data.review.id}/helpful`)
      .set(auth(buyer.token))
      .send({ helpful: true });

    expect(res.status).toBe(404);
  });
});

describe('หลังบ้าน — ตรวจรีวิว', () => {
  it('ซ่อนรีวิว → หายจากหน้าร้านและหายจากคะแนนเฉลี่ย', async () => {
    const created = await postReview(buyer.token, product.id, { rating: 1 });
    const reviewId = created.body.data.review.id as string;
    await approve(reviewId);

    const withReview = await request(app).get(`/api/products/${product.slug}/reviews`);
    const totalWith = withReview.body.data.summary.total as number;

    const res = await request(app)
      .patch(`/api/admin/reviews/${reviewId}/status`)
      .set(auth(admin.token))
      .send({ status: 'HIDDEN', adminNote: 'ข้อความไม่เกี่ยวกับสินค้า' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('HIDDEN');

    const after = await request(app).get(`/api/products/${product.slug}/reviews`);
    expect(after.body.data.summary.total).toBe(totalWith - 1);
  });

  it('ทุกการตรวจเขียน AdminLog พร้อมค่าก่อน/หลัง', async () => {
    const created = await postReview(buyer.token, product.id);
    const reviewId = created.body.data.review.id as string;

    await approve(reviewId);

    const log = await prisma.adminLog.findFirstOrThrow({
      where: { action: 'review.moderate', targetId: reviewId },
      orderBy: { createdAt: 'desc' },
      select: { userId: true, before: true, after: true },
    });

    expect(log.userId).toBe(admin.id);
    expect((log.before as { status: string }).status).toBe('PENDING');
    expect((log.after as { status: string }).status).toBe('APPROVED');
  });

  it('ตัวเลขข้างแท็บสถานะตรงกับจำนวนแถวที่กรองได้จริง', async () => {
    await postReview(buyer.token, product.id);
    const other = await postReview(buyer2.token, product.id);
    await approve(other.body.data.review.id);

    const all = await request(app).get('/api/admin/reviews').set(auth(admin.token));
    const counts = all.body.data.counts as Record<string, number>;

    const pending = await request(app)
      .get('/api/admin/reviews')
      .query({ status: 'PENDING', limit: 100 })
      .set(auth(admin.token));

    expect(pending.body.data.total).toBe(counts['PENDING']);
    expect(
      (pending.body.data.items as { status: string }[]).every((item) => item.status === 'PENDING'),
    ).toBe(true);
  });

  it('สถานะที่ไม่อนุญาตให้ตั้งเอง (PENDING) → 422', async () => {
    const created = await postReview(buyer.token, product.id);

    const res = await request(app)
      .patch(`/api/admin/reviews/${created.body.data.review.id}/status`)
      .set(auth(admin.token))
      .send({ status: 'PENDING' });

    expect(res.status).toBe(422);
  });

  it('รีวิวที่ไม่มีอยู่จริง → 404', async () => {
    const res = await request(app)
      .patch(`/api/admin/reviews/${randomUUID()}/status`)
      .set(auth(admin.token))
      .send({ status: 'APPROVED' });

    expect(res.status).toBe(404);
  });
});
