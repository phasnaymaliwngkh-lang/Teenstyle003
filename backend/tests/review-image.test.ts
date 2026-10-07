import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { REVIEW_IMAGE_LIMIT, uploadRoot } from '../src/config/media.ts';
import { mediaFilePath } from '../src/services/media-storage.ts';

import { jpegFixture, listFiles } from './helpers/images.ts';

/**
 * รูปในรีวิว (STEP 47) — หนี้ที่ STEP 23 กันไว้ ("ห้ามแก้ด้วยการรับ URL จาก client")
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - แนบได้เฉพาะรีวิวของตัวเอง (ของคนอื่น = 404 และไม่มีการแปลงรูป/เก็บไฟล์)
 *   - **แนบหรือถอดรูปแล้วกลับไปรอตรวจใหม่** — รีวิวที่อนุมัติแล้วหายจากหน้าร้านจนกว่าร้านจะตรวจรูป
 *   - รูปที่เก็บไม่มี EXIF (พิกัด GPS ของบ้านลูกค้า) เหลือ
 *   - หน้าร้านเห็นรูปเฉพาะรีวิวที่อนุมัติแล้ว · หลังบ้านเห็นรูปตอนตรวจ
 *   - เพดานจำนวนรูป · ลบรีวิวแล้วรูปถูกจดว่าไม่ได้ใช้ · เขียนรีวิวใหม่แล้วรูปเก่าไม่กลับมา
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let buyer = { id: '', token: '' };
let other = { id: '', token: '' };
let admin = { id: '', token: '' };
let product = { id: '', slug: '' };
const createdOrderIds: string[] = [];

async function createUser(role: 'CUSTOMER' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: {
      email: `test-rimg-${label}-${suffix}@teenstyle.test`,
      roleId: roleRow.id,
      name: 'ลูกค้า ทดสอบรูป',
    },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

async function deliveredOrder(userId: string): Promise<void> {
  const order = await prisma.order.create({
    data: {
      orderNumber: `TS-TEST-${randomUUID().slice(0, 12).toUpperCase()}`,
      userId,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      subtotal: 100,
      total: 100,
      deliveredAt: new Date(),
      addressSnapshot: { recipientName: 'ผู้รับทดสอบ' },
      items: {
        create: {
          productId: product.id,
          productName: 'สินค้าทดสอบ',
          variantSku: `TEST-${suffix}`,
          unitPrice: 100,
          quantity: 1,
          lineTotal: 100,
        },
      },
    },
    select: { id: true },
  });
  createdOrderIds.push(order.id);
}

async function writeReview(token: string): Promise<string> {
  const res = await request(app)
    .post('/api/reviews')
    .set(auth(token))
    .send({ productId: product.id, rating: 5, comment: 'ผ้าดีมาก ใส่สบาย ทรงสวยตามรูปเลย' });

  expect(res.status).toBe(201);
  return res.body.data.review.id as string;
}

function attach(reviewId: string, buffer: Buffer, token = buyer.token) {
  return request(app)
    .post(`/api/reviews/${reviewId}/images`)
    .set(auth(token))
    .attach('file', buffer, { filename: 'review.jpg', contentType: 'image/jpeg' });
}

async function approve(reviewId: string) {
  const res = await request(app)
    .patch(`/api/admin/reviews/${reviewId}/status`)
    .set(auth(admin.token))
    .send({ status: 'APPROVED' });
  expect(res.status).toBe(200);
}

async function publicReviewIds(): Promise<string[]> {
  const res = await request(app).get(`/api/products/${product.slug}/reviews?limit=50`);
  return (res.body.data.items as Array<{ id: string }>).map((item) => item.id);
}

beforeAll(async () => {
  buyer = await createUser('CUSTOMER', 'buyer');
  other = await createUser('CUSTOMER', 'other');
  admin = await createUser('ADMIN', 'admin');

  product = await prisma.product.findFirstOrThrow({
    where: { status: 'ACTIVE', deletedAt: null },
    orderBy: { createdAt: 'asc' },
    select: { id: true, slug: true },
  });

  await deliveredOrder(buyer.id);
  await deliveredOrder(other.id);
});

beforeEach(async () => {
  await prisma.review.deleteMany({ where: { userId: { in: [buyer.id, other.id] } } });
});

afterAll(async () => {
  const userIds = [buyer.id, other.id, admin.id];
  const assets = await prisma.mediaAsset.findMany({
    where: { uploadedById: { in: userIds } },
    select: { storageKey: true },
  });

  for (const asset of assets) {
    await rm(mediaFilePath(asset.storageKey), { force: true });
  }

  await prisma.review.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.mediaAsset.deleteMany({ where: { uploadedById: { in: userIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe('แนบรูปกับรีวิว', () => {
  it('แนบรูปกับรีวิวของตัวเองได้ — ได้ { id, url } และรูปที่เก็บไม่มี EXIF เหลือ', async () => {
    const reviewId = await writeReview(buyer.token);
    const marker = `GPS-HOME-${suffix}`;

    const res = await attach(reviewId, await jpegFixture(1000, 800, { exifMarker: marker }));

    expect(res.status).toBe(201);
    const [image] = res.body.data.review.images as Array<{ id: string; url: string }>;
    expect(image!.url).toMatch(/^\/media\/reviews\//);
    expect(image!.url).toContain(image!.id);

    const stored = await request(app).get(image!.url);
    expect(stored.status).toBe(200);
    expect((stored.body as Buffer).includes(marker)).toBe(false);
    expect((await sharp(stored.body as Buffer).metadata()).exif).toBeUndefined();

    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { url: image!.url } });
    expect(asset).toMatchObject({ purpose: 'REVIEW', uploadedById: buyer.id });
  });

  it('รีวิวของคนอื่น → 404 · ไม่มีการเก็บไฟล์หรือแถวใหม่', async () => {
    const reviewId = await writeReview(buyer.token);
    const filesBefore = await listFiles(uploadRoot());
    const assetsBefore = await prisma.mediaAsset.count();

    const res = await attach(reviewId, await jpegFixture(), other.token);

    expect(res.status).toBe(404);
    expect(await listFiles(uploadRoot())).toEqual(filesBefore);
    expect(await prisma.mediaAsset.count()).toBe(assetsBefore);
  });

  it('ไม่ล็อกอิน → 401', async () => {
    const reviewId = await writeReview(buyer.token);
    const res = await request(app)
      .post(`/api/reviews/${reviewId}/images`)
      .attach('file', await jpegFixture(), 'a.jpg');

    expect(res.status).toBe(401);
  });

  it(`แนบได้ไม่เกิน ${REVIEW_IMAGE_LIMIT} รูป`, async () => {
    const reviewId = await writeReview(buyer.token);
    const image = await jpegFixture(400, 400);

    for (let index = 0; index < REVIEW_IMAGE_LIMIT; index += 1) {
      expect((await attach(reviewId, image)).status).toBe(201);
    }

    const extra = await attach(reviewId, image);
    expect(extra.status).toBe(409);
    expect(extra.body.message).toContain(String(REVIEW_IMAGE_LIMIT));

    const review = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(review.images).toHaveLength(REVIEW_IMAGE_LIMIT);
  });

  it('ส่ง url มาเองไม่ได้ — มีทางเดียวคืออัปโหลดไฟล์', async () => {
    const reviewId = await writeReview(buyer.token);

    const res = await request(app)
      .patch(`/api/reviews/${reviewId}`)
      .set(auth(buyer.token))
      .send({
        comment: 'แก้ข้อความแล้วแอบส่งรูปจากที่อื่นมา',
        images: ['https://evil.example/x.jpg'],
      });

    expect(res.status).toBe(200);
    expect(res.body.data.review.images).toEqual([]);
  });
});

describe('รูปผ่านการตรวจของร้านพร้อมรีวิว', () => {
  it('แนบรูปกับรีวิวที่อนุมัติแล้ว → กลับไปรอตรวจ และหายจากหน้าร้านจนกว่าจะอนุมัติใหม่', async () => {
    const reviewId = await writeReview(buyer.token);
    await approve(reviewId);
    expect(await publicReviewIds()).toContain(reviewId);

    const res = await attach(reviewId, await jpegFixture());
    expect(res.status).toBe(201);
    expect(res.body.data.review.status).toBe('PENDING');
    expect(await publicReviewIds()).not.toContain(reviewId);

    // หลังบ้านเห็นรูปตอนตรวจ
    const queue = await request(app)
      .get('/api/admin/reviews?status=PENDING&limit=50')
      .set(auth(admin.token));
    const queued = (queue.body.data.items as Array<{ id: string; images: unknown[] }>).find(
      (item) => item.id === reviewId,
    );
    expect(queued?.images).toHaveLength(1);

    await approve(reviewId);
    const listed = await request(app).get(`/api/products/${product.slug}/reviews?limit=50`);
    const mine = (
      listed.body.data.items as Array<{ id: string; images: Array<{ url: string }> }>
    ).find((item) => item.id === reviewId);
    expect(mine?.images).toHaveLength(1);
  });

  it('ถอดรูป → กลับไปรอตรวจ · ไฟล์เริ่มนับเวลาเพื่อรอลบ · ถอดรูปที่ไม่มีอยู่ = 404', async () => {
    const reviewId = await writeReview(buyer.token);
    const res = await attach(reviewId, await jpegFixture());
    const [image] = res.body.data.review.images as Array<{ id: string; url: string }>;
    await approve(reviewId);

    const removed = await request(app)
      .delete(`/api/reviews/${reviewId}/images/${image!.id}`)
      .set(auth(buyer.token));

    expect(removed.status).toBe(200);
    expect(removed.body.data.review.images).toEqual([]);
    expect(removed.body.data.review.status).toBe('PENDING');

    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { url: image!.url } });
    expect(asset.unusedSince).not.toBeNull();

    const again = await request(app)
      .delete(`/api/reviews/${reviewId}/images/${image!.id}`)
      .set(auth(buyer.token));
    expect(again.status).toBe(404);

    const notMine = await request(app)
      .delete(`/api/reviews/${reviewId}/images/${image!.id}`)
      .set(auth(other.token));
    expect(notMine.status).toBe(404);
  });

  it('ลบรีวิว → รูปถูกจดว่าไม่ได้ใช้ · เขียนรีวิวใหม่แล้วรูปเก่าไม่กลับมา', async () => {
    const reviewId = await writeReview(buyer.token);
    const res = await attach(reviewId, await jpegFixture());
    const url = (res.body.data.review.images as Array<{ url: string }>)[0]!.url;

    const deleted = await request(app).delete(`/api/reviews/${reviewId}`).set(auth(buyer.token));
    expect(deleted.status).toBe(200);

    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { url } });
    expect(asset.unusedSince).not.toBeNull();

    const rewrite = await request(app)
      .post('/api/reviews')
      .set(auth(buyer.token))
      .send({ productId: product.id, rating: 4, comment: 'เขียนใหม่อีกรอบหลังลบรีวิวเดิม' });

    expect(rewrite.status).toBe(201);
    expect(rewrite.body.data.review.id).toBe(reviewId);
    expect(rewrite.body.data.review.images).toEqual([]);
  });

  it('แนบรูปกับรีวิวที่ลบไปแล้วไม่ได้', async () => {
    const reviewId = await writeReview(buyer.token);
    await request(app).delete(`/api/reviews/${reviewId}`).set(auth(buyer.token));

    expect((await attach(reviewId, await jpegFixture())).status).toBe(404);
  });
});
