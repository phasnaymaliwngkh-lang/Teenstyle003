import { randomUUID } from 'node:crypto';
import { readFile, rm, writeFile } from 'node:fs/promises';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { MEDIA_RULES, uploadRoot, UPLOAD_LIMITS } from '../src/config/media.ts';
import { serveMedia } from '../src/middlewares/media-static.ts';
import { globalRateLimiter } from '../src/middlewares/rate-limit.ts';
import {
  checkSourceImage,
  MEDIA_KEY_PATTERN,
  mediaIdFromUrl,
  mediaStorageKey,
  mediaUrlOf,
} from '../src/models/media.model.ts';
import { mediaFileExists, mediaFilePath } from '../src/services/media-storage.ts';
import { processImage, storeImage, type StoredImage } from '../src/services/media.service.ts';

import { gifFixture, jpegFixture, listFiles, pngFixture } from './helpers/images.ts';

/**
 * ไฟล์รูปที่ร้านเก็บเอง (STEP 47)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - รูปแบบที่อยู่ไฟล์: สิ่งที่ระบบสร้าง ระบบอ่านกลับได้ (บทเรียน STEP 40)
 *   - ไฟล์ที่เก็บ **ไม่มี EXIF เหลือเลย** (ก้อนเดียวกับพิกัด GPS) และหมุนตาม orientation แล้ว
 *   - ตัดสินชนิดไฟล์จากเนื้อไฟล์: HTML ที่แอบอ้างเป็นรูป · GIF · SVG · รูปเล็ก · รูปพิกเซลมหาศาล · ไฟล์ขาด
 *   - เสิร์ฟเฉพาะ path ที่ระบบสร้าง (path traversal ไม่ผ่าน) และอยู่ก่อน rate limit
 *   - ตัวล้างไฟล์ลบเฉพาะไฟล์ที่ไม่มีที่ไหนใช้และพ้นช่วงผ่อนผัน — **snapshot ของคำสั่งซื้อนับว่าใช้อยู่**
 *   - หน้าคลังรูปอ่านอย่างเดียว · ต้องมีสิทธิ์ `media:manage`
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let admin = { id: '', token: '' };
let employee = { id: '', token: '' };
let customer = { id: '', token: '' };

const createdAssetIds: string[] = [];
const createdOrderIds: string[] = [];
const createdProductIds: string[] = [];

async function createUser(role: 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-media-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

/** เก็บรูปจริงผ่านท่อเดียวกับระบบ (แปลง + เขียนไฟล์ + แถว MediaAsset) โดยไม่ผูกกับอะไร */
async function storeTestAsset(purpose: 'PRODUCT' | 'REVIEW'): Promise<StoredImage> {
  const image = await storeImage(
    { buffer: await jpegFixture(900, 900), purpose, uploaderId: admin.id },
    async (_tx, stored) => stored,
  );
  createdAssetIds.push(image.id);
  return image;
}

beforeAll(async () => {
  admin = await createUser('ADMIN', 'admin');
  employee = await createUser('EMPLOYEE', 'employee');
  customer = await createUser('CUSTOMER', 'customer');
});

afterAll(async () => {
  const userIds = [admin.id, employee.id, customer.id];
  const assets = await prisma.mediaAsset.findMany({
    where: { id: { in: createdAssetIds } },
    select: { storageKey: true },
  });

  for (const asset of assets) {
    await rm(mediaFilePath(asset.storageKey), { force: true });
  }

  await prisma.review.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.mediaAsset.deleteMany({ where: { id: { in: createdAssetIds } } });
  await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe('รูปแบบที่อยู่ไฟล์ — สิ่งที่ระบบสร้าง ระบบอ่านกลับได้', () => {
  it('storageKey ที่สร้างผ่านตัวตรวจตอนเสิร์ฟ และอ่าน id กลับจาก url ได้ตรง', () => {
    const id = randomUUID();

    for (const purpose of ['PRODUCT', 'REVIEW'] as const) {
      const key = mediaStorageKey(purpose, id, new Date('2026-10-08T23:59:00Z'));

      expect(key).toBe(`${MEDIA_RULES[purpose].folder}/2026/10/${id}.webp`);
      expect(MEDIA_KEY_PATTERN.test(key)).toBe(true);
      expect(mediaIdFromUrl(mediaUrlOf(key))).toBe(id);
    }
  });

  it('เดือนตัดตาม UTC — ที่อยู่ไฟล์ไม่ขึ้นกับโซนเวลาของเครื่องที่รัน', () => {
    expect(mediaStorageKey('PRODUCT', randomUUID(), new Date('2026-10-31T20:00:00Z'))).toContain(
      '/2026/10/',
    );
  });

  it('url ภายนอก หรือ path ที่ไม่ใช่รูปแบบของระบบ ไม่มี id', () => {
    const id = randomUUID();

    expect(mediaIdFromUrl('https://images.unsplash.com/photo-1.jpg')).toBeNull();
    expect(mediaIdFromUrl(`/media/products/2026/10/${id}.jpg`)).toBeNull();
    expect(mediaIdFromUrl(`/media/avatars/2026/10/${id}.webp`)).toBeNull();
    expect(mediaIdFromUrl(`/media/products/2026/10/../${id}.webp`)).toBeNull();
    expect(MEDIA_KEY_PATTERN.test(`products/2026/10/${id}.webp/../../.env`)).toBe(false);
  });
});

describe('ตรวจรูปจากหัวไฟล์ (ฟังก์ชันล้วน)', () => {
  it('ปฏิเสธ GIF · SVG · HEIC · รูปเคลื่อนไหว · รูปที่ไม่รู้จัก พร้อมบอกชนิดที่รับ', () => {
    const size = { width: 1000, height: 1000 };

    expect(checkSourceImage({ format: 'gif', ...size }, 'PRODUCT')).toContain('GIF');
    expect(checkSourceImage({ format: 'svg', ...size }, 'PRODUCT')).toContain('SVG');
    expect(checkSourceImage({ format: 'heif', compression: 'hevc', ...size }, 'PRODUCT')).toContain(
      'HEIC',
    );
    expect(checkSourceImage({ format: 'webp', pages: 3, ...size }, 'PRODUCT')).toContain(
      'เคลื่อนไหว',
    );
    expect(checkSourceImage({ format: 'tiff', ...size }, 'PRODUCT')).toContain('JPEG');
    expect(checkSourceImage({ format: 'heif', compression: 'av1', ...size }, 'PRODUCT')).toBeNull();
  });

  it('ด้านสั้นต้องถึงเกณฑ์ของการใช้งานนั้น — รูปรีวิวรับเล็กกว่ารูปสินค้าได้', () => {
    const small = { format: 'jpeg', width: 400, height: 300 };

    expect(checkSourceImage(small, 'PRODUCT')).toContain(`${MEDIA_RULES.PRODUCT.minShortEdge} px`);
    expect(checkSourceImage(small, 'REVIEW')).toBeNull();
  });

  it('รูปที่พิกเซลเกินเพดาน (decompression bomb) ถูกปฏิเสธก่อนถอดรหัส', () => {
    const side = Math.ceil(Math.sqrt(UPLOAD_LIMITS.maxInputPixels)) + 1;

    expect(checkSourceImage({ format: 'png', width: side, height: side }, 'PRODUCT')).toContain(
      'ล้านพิกเซล',
    );
  });
});

describe('แปลงรูปก่อนเก็บ', () => {
  it('ไฟล์ที่เก็บไม่มี EXIF เหลือ (ก้อนเดียวกับพิกัด GPS) และเป็น WebP', async () => {
    const marker = `EXIF-MARKER-${suffix}`;
    const source = await jpegFixture(900, 900, { exifMarker: marker });

    // ยืนยันก่อนว่ารูปต้นฉบับมี EXIF จริง ไม่งั้นเทสต์นี้พิสูจน์อะไรไม่ได้
    expect((await sharp(source).metadata()).exif).toBeDefined();
    expect(source.includes(marker)).toBe(true);

    const processed = await processImage(source, 'REVIEW');
    const meta = await sharp(processed.data).metadata();

    expect(meta.format).toBe('webp');
    expect(meta.exif).toBeUndefined();
    expect(meta.xmp).toBeUndefined();
    expect(processed.data.includes(marker)).toBe(false);
  });

  it('หมุนตาม EXIF orientation ก่อนตัด metadata — รูปแนวตั้งจากมือถือไม่นอนตะแคง', async () => {
    // 900×600 ที่บอกว่า "หมุน 90° ตามเข็ม" = รูปจริงเป็นแนวตั้ง 600×900
    const source = await jpegFixture(900, 600, { orientation: 6 });
    const processed = await processImage(source, 'REVIEW');

    expect([processed.width, processed.height]).toEqual([600, 900]);
    expect((await sharp(processed.data).metadata()).orientation).toBeUndefined();
  });

  it('ย่อด้านยาวตามเพดานของการใช้งาน และไม่ขยายรูปที่เล็กกว่า', async () => {
    const big = await processImage(await jpegFixture(3000, 2000), 'PRODUCT');
    expect(Math.max(big.width, big.height)).toBe(MEDIA_RULES.PRODUCT.maxLongEdge);

    const review = await processImage(await jpegFixture(3000, 2000), 'REVIEW');
    expect(Math.max(review.width, review.height)).toBe(MEDIA_RULES.REVIEW.maxLongEdge);

    const small = await processImage(await jpegFixture(800, 700), 'PRODUCT');
    expect([small.width, small.height]).toEqual([800, 700]);
    expect(small.originalBytes).toBeGreaterThan(0);
  });

  it('รับ PNG และ AVIF', async () => {
    await expect(processImage(await pngFixture(700, 700), 'PRODUCT')).resolves.toBeDefined();

    const avif = await sharp(await jpegFixture(700, 700))
      .avif()
      .toBuffer();
    await expect(processImage(avif, 'PRODUCT')).resolves.toBeDefined();
  });

  it('ไฟล์ HTML ที่ตั้งชื่อเป็นรูป · GIF · SVG · รูปเล็ก · ไฟล์ขาด · ไฟล์ว่าง ถูกปฏิเสธด้วย 400', async () => {
    const html = Buffer.from('<!doctype html><script>alert(1)</script>');
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="900"><script>alert(1)</script></svg>',
    );
    const jpeg = await jpegFixture(900, 900);
    const truncated = jpeg.subarray(0, Math.floor(jpeg.length / 2));

    const cases: Array<[Buffer, string]> = [
      [html, 'ไม่ใช่รูป'],
      [await gifFixture(), 'GIF'],
      [svg, 'SVG'],
      [await pngFixture(300, 300), 'เล็กเกินไป'],
      [truncated, 'ไม่สำเร็จ'],
      [Buffer.alloc(0), 'ว่างเปล่า'],
    ];

    for (const [buffer, message] of cases) {
      await expect(processImage(buffer, 'PRODUCT')).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining(message),
      });
    }
  });
});

describe('เสิร์ฟไฟล์ที่ /media', () => {
  it('ไฟล์ที่เก็บแล้วเปิดได้ — WebP · cache ได้ตลอดไป · nosniff', async () => {
    const asset = await storeTestAsset('PRODUCT');

    const res = await request(app).get(asset.url);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('image/webp');
    expect(res.headers['cache-control']).toContain('immutable');
    expect(res.headers['cache-control']).toContain('max-age=31536000');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBe('inline');

    const onDisk = await readFile(mediaFilePath(asset.storageKey));
    expect(Buffer.compare(res.body as Buffer, onDisk)).toBe(0);
  });

  it('path ที่ไม่ใช่รูปแบบของระบบ หรือพยายามออกนอกโฟลเดอร์ ได้ 404 ทั้งหมด', async () => {
    const id = randomUUID();
    const attempts = [
      `/media/products/2026/10/${id}.webp`, // รูปแบบถูกแต่ไม่มีไฟล์
      '/media/../.env',
      '/media/%2e%2e/%2e%2e/.env',
      '/media/..%2f..%2f.env',
      `/media/products/2026/10/${id}.webp/../../../../.env`,
      '/media/products/2026/10/',
      '/media/.gitkeep',
    ];

    for (const path of attempts) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(404);
      expect(JSON.stringify(res.body)).not.toContain('DATABASE_URL');
    }
  });

  it('ไฟล์ชั่วคราวที่กำลังเขียน (ยังไม่ครบ) เปิดไม่ได้ แม้อยู่ในโฟลเดอร์เดียวกัน', async () => {
    const asset = await storeTestAsset('PRODUCT');
    // ชื่อเดียวกับที่ writeMediaFile ใช้ระหว่างเขียน — ไฟล์ครึ่ง ๆ กลาง ๆ ห้ามหลุดถึงผู้ใช้
    const suffixOfTemp = `.${randomUUID()}.tmp`;
    const tempPath = `${mediaFilePath(asset.storageKey)}${suffixOfTemp}`;
    await writeFile(tempPath, 'half-written');

    try {
      const res = await request(app).get(`${asset.url}${suffixOfTemp}`);
      expect(res.status).toBe(404);
      expect(res.text).not.toContain('half-written');
    } finally {
      await rm(tempPath, { force: true });
    }
  });

  it('เขียนไฟล์ผ่าน /media ไม่ได้', async () => {
    const asset = await storeTestAsset('PRODUCT');
    const res = await request(app).post(asset.url).send('x');

    expect(res.status).toBe(404);
    expect(await mediaFileExists(asset.storageKey)).toBe(true);
  });

  it('อยู่ก่อน rate limit — รูปทั้งร้านมาจาก IP ของ server frontend ตัวเดียว', () => {
    const stack = (app as unknown as { router: { stack: Array<{ handle: unknown }> } }).router
      .stack;
    const mediaIndex = stack.findIndex((layer) => layer.handle === serveMedia);
    const limiterIndex = stack.findIndex((layer) => layer.handle === globalRateLimiter);

    expect(mediaIndex).toBeGreaterThanOrEqual(0);
    expect(limiterIndex).toBeGreaterThanOrEqual(0);
    expect(mediaIndex).toBeLessThan(limiterIndex);
  });
});

describe('คลังรูปและตัวล้างไฟล์', () => {
  it('ต้องมีสิทธิ์ media:manage — ไม่ล็อกอิน 401 · พนักงาน/ลูกค้า 403', async () => {
    expect((await request(app).get('/api/admin/media')).status).toBe(401);
    expect((await request(app).get('/api/admin/media').set(auth(employee.token))).status).toBe(403);
    expect(
      (await request(app).post('/api/admin/media/purge').set(auth(customer.token))).status,
    ).toBe(403);
  });

  it('ลบเฉพาะไฟล์ที่ไม่มีที่ไหนใช้และพ้นช่วงผ่อนผัน — snapshot ของคำสั่งซื้อนับว่ายังใช้อยู่', async () => {
    /**
     * ⚠️ ตัวล้างไฟล์ทำงานกับไฟล์ทั้งระบบ — ถ้าฐานข้อมูลมีไฟล์อื่นที่ลบได้อยู่แล้ว
     *    เทสต์นี้จะลบมันไปด้วย จึงหยุดตั้งแต่ต้นแทนที่จะทำลายข้อมูลเงียบ ๆ
     */
    const longAgo = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const foreignPurgeable = await prisma.mediaAsset.count({
      where: { unusedSince: { lte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    expect(foreignPurgeable, 'มีไฟล์อื่นในฐานข้อมูลที่ตัวล้างจะลบ — ล้างก่อนรันเทสต์นี้').toBe(0);

    const category = await prisma.category.findFirstOrThrow({ select: { id: true } });
    const product = await prisma.product.create({
      data: {
        name: `สินค้าทดสอบคลังรูป ${suffix}`,
        slug: `test-media-${suffix}`,
        sku: `TS-MEDIA-${suffix.toUpperCase()}`,
        description: 'สินค้าทดสอบสำหรับตัวล้างไฟล์',
        price: 100,
        categoryId: category.id,
      },
      select: { id: true },
    });
    createdProductIds.push(product.id);

    const onProduct = await storeTestAsset('PRODUCT');
    const onOrderSnapshot = await storeTestAsset('PRODUCT');
    const onLiveReview = await storeTestAsset('REVIEW');
    const onDeletedReview = await storeTestAsset('REVIEW');
    const orphanOld = await storeTestAsset('REVIEW');
    const orphanFresh = await storeTestAsset('REVIEW');

    await prisma.productImage.create({
      data: { productId: product.id, url: onProduct.url, alt: 'รูปทดสอบ', isMain: true },
    });

    const order = await prisma.order.create({
      data: {
        orderNumber: `TS-TEST-${randomUUID().slice(0, 12).toUpperCase()}`,
        userId: customer.id,
        subtotal: 100,
        total: 100,
        addressSnapshot: { recipientName: 'ผู้รับทดสอบ' },
        items: {
          create: {
            productName: 'สินค้าที่ถอดรูปไปแล้ว',
            variantSku: `TEST-${suffix}`,
            imageUrl: onOrderSnapshot.url,
            unitPrice: 100,
            quantity: 1,
            lineTotal: 100,
          },
        },
      },
      select: { id: true },
    });
    createdOrderIds.push(order.id);

    await prisma.review.create({
      data: {
        productId: product.id,
        userId: customer.id,
        rating: 5,
        comment: 'รีวิวที่ยังอยู่',
        images: [onLiveReview.url],
      },
    });
    await prisma.review.create({
      data: {
        productId: product.id,
        userId: admin.id,
        rating: 4,
        comment: 'รีวิวที่ลูกค้าลบไปแล้ว',
        images: [onDeletedReview.url],
        deletedAt: new Date(),
      },
    });

    // จดเวลาเก่าให้ทุกไฟล์ (รวมไฟล์ที่ยังใช้อยู่ — จำลองการจดผิด) ยกเว้นไฟล์ที่เพิ่งเลิกใช้
    await prisma.mediaAsset.updateMany({
      where: {
        id: {
          in: [onProduct.id, onOrderSnapshot.id, onLiveReview.id, onDeletedReview.id, orphanOld.id],
        },
      },
      data: { unusedSince: longAgo },
    });
    await prisma.mediaAsset.update({
      where: { id: orphanFresh.id },
      data: { unusedSince: new Date() },
    });

    // ── คลังรูปเป็นการอ่านอย่างเดียว: ไม่ขยับ unusedSince ของใคร ──
    const marksBefore = await prisma.mediaAsset.findMany({
      where: { id: { in: createdAssetIds } },
      select: { id: true, unusedSince: true },
      orderBy: { id: 'asc' },
    });

    const library = await request(app)
      .get('/api/admin/media?usage=unused&limit=60')
      .set(auth(admin.token));
    expect(library.status).toBe(200);

    const marksAfter = await prisma.mediaAsset.findMany({
      where: { id: { in: createdAssetIds } },
      select: { id: true, unusedSince: true },
      orderBy: { id: 'asc' },
    });
    expect(marksAfter).toEqual(marksBefore);

    // ตัวกรอง "ไม่ได้ใช้" กับตัวเลขสรุปนับด้วยเกณฑ์เดียวกัน
    expect(library.body.data.total).toBe(library.body.data.summary.unused);
    const unusedIds = new Set(
      (library.body.data.items as Array<{ id: string }>).map((item) => item.id),
    );
    expect(unusedIds.has(orphanOld.id)).toBe(true);
    expect(unusedIds.has(onDeletedReview.id)).toBe(true);
    expect(unusedIds.has(onOrderSnapshot.id)).toBe(false);

    const snapshotRow = await request(app)
      .get('/api/admin/media?usage=in-use&limit=60')
      .set(auth(admin.token));
    const snapshotItem = (
      snapshotRow.body.data.items as Array<{ id: string; usage: { orderItemCount: number } }>
    ).find((item) => item.id === onOrderSnapshot.id);
    expect(snapshotItem?.usage.orderItemCount).toBe(1);

    // ── ล้าง ──
    const purge = await request(app).post('/api/admin/media/purge').set(auth(admin.token));
    expect(purge.status).toBe(200);
    expect(purge.body.data.deleted).toBe(2);
    expect(purge.body.data.waiting).toBeGreaterThanOrEqual(1);

    const remaining = await prisma.mediaAsset.findMany({
      where: { id: { in: createdAssetIds } },
      select: { id: true, unusedSince: true },
    });
    const remainingById = new Map(remaining.map((row) => [row.id, row]));

    expect(remainingById.has(orphanOld.id)).toBe(false);
    expect(remainingById.has(onDeletedReview.id)).toBe(false);
    expect(await mediaFileExists(orphanOld.storageKey)).toBe(false);
    expect(await mediaFileExists(onDeletedReview.storageKey)).toBe(false);

    // ไฟล์ที่ยังถูกใช้อยู่ไม่ถูกลบ และเวลาที่จดผิดถูกล้างกลับเป็น null
    for (const kept of [onProduct, onOrderSnapshot, onLiveReview]) {
      expect(remainingById.get(kept.id)?.unusedSince).toBeNull();
      expect(await mediaFileExists(kept.storageKey)).toBe(true);
    }

    // ไฟล์ที่เพิ่งเลิกใช้ยังรอครบช่วงผ่อนผัน
    expect(remainingById.get(orphanFresh.id)?.unusedSince).not.toBeNull();
    expect(await mediaFileExists(orphanFresh.storageKey)).toBe(true);

    const log = await prisma.adminLog.findFirst({
      where: { userId: admin.id, action: 'media.purge' },
      orderBy: { createdAt: 'desc' },
    });
    expect((log?.before as { urls: string[] } | null)?.urls.sort()).toEqual(
      [orphanOld.url, onDeletedReview.url].sort(),
    );
  });

  it('ไม่มีไฟล์ที่ลบได้ = ลบ 0 ไฟล์ และไม่เขียน log', async () => {
    const logsBefore = await prisma.adminLog.count({
      where: { userId: admin.id, action: 'media.purge' },
    });
    const purge = await request(app).post('/api/admin/media/purge').set(auth(admin.token));

    expect(purge.status).toBe(200);
    expect(purge.body.data.deleted).toBe(0);
    expect(
      await prisma.adminLog.count({ where: { userId: admin.id, action: 'media.purge' } }),
    ).toBe(logsBefore);
  });

  it('เทสต์ไม่เขียนไฟล์ลงโฟลเดอร์รูปจริงของ dev', async () => {
    expect(uploadRoot()).toContain('teenstyle-test-uploads');
    expect((await listFiles(uploadRoot())).every((file) => file.endsWith('.webp'))).toBe(true);
  });
});
