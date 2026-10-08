import { randomUUID } from 'node:crypto';
import { rm } from 'node:fs/promises';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import sharp from 'sharp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { PRODUCT_IMAGE_LIMIT, uploadRoot, UPLOAD_LIMITS } from '../src/config/media.ts';
import { mediaFileExists, mediaFilePath } from '../src/services/media-storage.ts';

import { gifFixture, jpegFixture, listFiles } from './helpers/images.ts';

/**
 * รูปสินค้าในหลังบ้าน (STEP 47)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - สิทธิ์ตรวจ **ก่อน** รับไฟล์ · ต้องมี `product:update` (พนักงานไม่มี)
 *   - อัปโหลดแล้วได้ไฟล์จริง + แถว MediaAsset + รูปแรกเป็นรูปหลัก · ไฟล์ที่ไม่ผ่านไม่เหลืออะไรค้าง
 *   - ไฟล์ปลอม/ผิดชนิด/ใหญ่เกิน ถูกปฏิเสธพร้อมเหตุผลภาษาไทย
 *   - เพดาน 10 รูปกันได้แม้อัปโหลดพร้อมกัน (ล็อกแถว) และคนแพ้ไม่ทิ้งไฟล์ไว้
 *   - "รูปแรก = รูปหลัก" ทั้งตอนเรียงใหม่ ถอดรูป และสร้างสินค้า · มีรูปหลักรูปเดียวเสมอ
 *   - เรียงใหม่ต้องส่งรูปครบทุกรูป ไม่งั้น 409
 *   - สินค้าที่เปิดขายถอดรูปสุดท้ายไม่ได้ · ถอดรูปไม่ลบไฟล์ (snapshot ของคำสั่งซื้อยังชี้อยู่)
 *   - PATCH สินค้าไม่แตะรูปอีกแล้ว · ทุกการเปลี่ยนเขียน AdminLog
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);
const SKU_PREFIX = `TS-IMG-${suffix.toUpperCase().slice(0, 4)}`;
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let admin = { id: '', token: '' };
let employee = { id: '', token: '' };
let customer = { id: '', token: '' };
const createdProductIds: string[] = [];
const createdOrderIds: string[] = [];

const EXTERNAL_IMAGE = {
  url: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=800&q=80',
  alt: 'รูปจากโฮสต์ภายนอก',
};

async function createUser(role: 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-pimg-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

async function createProduct(overrides: Record<string, unknown> = {}): Promise<string> {
  const unique = randomUUID().slice(0, 6).toUpperCase();
  const res = await request(app)
    .post('/api/admin/products')
    .set(auth(admin.token))
    .send({
      name: `สินค้าทดสอบรูป ${unique}`,
      slug: `test-img-${unique.toLowerCase()}`,
      sku: `${SKU_PREFIX}-${unique}`,
      description: 'สินค้าทดสอบสำหรับการจัดการรูป',
      price: 390,
      categorySlug: 'tops',
      variants: [{ sku: `${SKU_PREFIX}-${unique}-V`, initialStock: 0 }],
      ...overrides,
    });

  expect(res.status).toBe(201);
  createdProductIds.push(res.body.data.id);
  return res.body.data.id as string;
}

async function upload(
  productId: string,
  buffer: Buffer,
  alt = 'รูปสินค้าทดสอบ',
  token = admin.token,
) {
  return request(app)
    .post(`/api/admin/products/${productId}/images`)
    .set(auth(token))
    .field('alt', alt)
    .attach('file', buffer, { filename: 'photo.jpg', contentType: 'image/jpeg' });
}

async function mainImages(productId: string) {
  return prisma.productImage.findMany({ where: { productId, isMain: true } });
}

beforeAll(async () => {
  admin = await createUser('ADMIN', 'admin');
  employee = await createUser('EMPLOYEE', 'employee');
  customer = await createUser('CUSTOMER', 'customer');
});

afterAll(async () => {
  const userIds = [admin.id, employee.id, customer.id];
  const assets = await prisma.mediaAsset.findMany({
    where: { uploadedById: { in: userIds } },
    select: { storageKey: true },
  });

  for (const asset of assets) {
    await rm(mediaFilePath(asset.storageKey), { force: true });
  }

  await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  await prisma.mediaAsset.deleteMany({ where: { uploadedById: { in: userIds } } });
  await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe('สิทธิ์', () => {
  it('ไม่ล็อกอิน 401 · ลูกค้า 403 · พนักงาน (ไม่มี product:update) 403 — และไม่มีไฟล์ถูกเก็บ', async () => {
    const productId = await createProduct();
    const image = await jpegFixture();
    const filesBefore = await listFiles(uploadRoot());

    const anonymous = await request(app)
      .post(`/api/admin/products/${productId}/images`)
      .field('alt', 'x')
      .attach('file', image, 'a.jpg');
    expect(anonymous.status).toBe(401);
    expect((await upload(productId, image, 'รูป', customer.token)).status).toBe(403);
    expect((await upload(productId, image, 'รูป', employee.token)).status).toBe(403);

    expect(await listFiles(uploadRoot())).toEqual(filesBefore);
    expect(await prisma.productImage.count({ where: { productId } })).toBe(0);
  });
});

describe('อัปโหลดรูป', () => {
  it('ได้ไฟล์ WebP จริง + แถว MediaAsset ของผู้อัปโหลด · รูปแรกเป็นรูปหลัก · เขียน AdminLog', async () => {
    const productId = await createProduct();
    const res = await upload(productId, await jpegFixture(1200, 900), 'เสื้อสีม่วงด้านหน้า');

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveLength(1);

    const [image] = res.body.data as Array<{
      url: string;
      isMain: boolean;
      uploaded: boolean;
      alt: string;
    }>;
    expect(image).toMatchObject({ isMain: true, uploaded: true, alt: 'เสื้อสีม่วงด้านหน้า' });
    expect(image!.url).toMatch(/^\/media\/products\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.webp$/);

    const asset = await prisma.mediaAsset.findUniqueOrThrow({ where: { url: image!.url } });
    expect(asset).toMatchObject({
      purpose: 'PRODUCT',
      uploadedById: admin.id,
      width: 1200,
      height: 900,
      mimeType: 'image/webp',
      unusedSince: null,
    });
    expect(await mediaFileExists(asset.storageKey)).toBe(true);

    const served = await request(app).get(image!.url);
    expect(served.status).toBe(200);
    expect((await sharp(served.body as Buffer).metadata()).format).toBe('webp');

    const log = await prisma.adminLog.findFirst({
      where: { userId: admin.id, action: 'product.image.add', targetId: productId },
    });
    expect(log?.after).toMatchObject({ imageCount: 1, url: image!.url });
  });

  it('ไฟล์ที่ไม่ผ่านไม่ทิ้งอะไรไว้ — ทั้งไฟล์บนดิสก์และแถวในฐานข้อมูล', async () => {
    const productId = await createProduct();
    const filesBefore = await listFiles(uploadRoot());
    const assetsBefore = await prisma.mediaAsset.count();

    const fakeJpeg = await upload(productId, Buffer.from('<html><script>alert(1)</script></html>'));
    expect(fakeJpeg.status).toBe(400);
    expect(fakeJpeg.body.message).toContain('ไม่ใช่รูป');

    const gif = await request(app)
      .post(`/api/admin/products/${productId}/images`)
      .set(auth(admin.token))
      .field('alt', 'รูปเคลื่อนไหว')
      .attach('file', await gifFixture(), { filename: 'a.gif', contentType: 'image/gif' });
    expect(gif.status).toBe(400);
    expect(gif.body.message).toContain('JPEG');

    const heic = await request(app)
      .post(`/api/admin/products/${productId}/images`)
      .set(auth(admin.token))
      .field('alt', 'รูปจาก iPhone')
      .attach('file', Buffer.from('fake'), { filename: 'a.heic', contentType: 'image/heic' });
    expect(heic.status).toBe(400);
    expect(heic.body.message).toContain('HEIC');

    const tooSmall = await upload(productId, await jpegFixture(500, 500));
    expect(tooSmall.status).toBe(400);
    expect(tooSmall.body.message).toContain('เล็กเกินไป');

    const noAlt = await upload(productId, await jpegFixture(), '');
    expect(noAlt.status).toBe(422);

    const noFile = await request(app)
      .post(`/api/admin/products/${productId}/images`)
      .set(auth(admin.token))
      .field('alt', 'ไม่มีไฟล์');
    expect(noFile.status).toBe(400);
    expect(noFile.body.message).toContain('ไฟล์รูป');

    expect(await listFiles(uploadRoot())).toEqual(filesBefore);
    expect(await prisma.mediaAsset.count()).toBe(assetsBefore);
    expect(await prisma.productImage.count({ where: { productId } })).toBe(0);
  });

  it('ไฟล์ใหญ่เกินกำหนด → 413 พร้อมบอกขนาดของรูป (ไม่ใช่ 5MB ของไฟล์นำเข้า)', async () => {
    const productId = await createProduct();
    const res = await upload(productId, Buffer.alloc(UPLOAD_LIMITS.maxBytes + 1024, 1));

    expect(res.status).toBe(413);
    expect(res.body.errorCode).toBe('PAYLOAD_TOO_LARGE');
    expect(res.body.message).toContain('8 MB');
  });

  it('สินค้าที่ไม่มีอยู่หรือถูกลบแล้ว → 404 โดยไม่แปลงรูป', async () => {
    const assetsBefore = await prisma.mediaAsset.count();
    const res = await upload(randomUUID(), await jpegFixture());

    expect(res.status).toBe(404);
    expect(await prisma.mediaAsset.count()).toBe(assetsBefore);
  });

  it(`อัปโหลดพร้อมกันตอนเหลือที่ว่าง 1 รูป → ได้ ${PRODUCT_IMAGE_LIMIT} รูปพอดี และคนแพ้ไม่ทิ้งไฟล์ไว้`, async () => {
    const productId = await createProduct();

    await prisma.productImage.createMany({
      data: Array.from({ length: PRODUCT_IMAGE_LIMIT - 1 }, (_, index) => ({
        productId,
        url: `${EXTERNAL_IMAGE.url}&n=${index}`,
        alt: `รูปที่ ${index + 1}`,
        sortOrder: index,
        isMain: index === 0,
      })),
    });

    const filesBefore = (await listFiles(uploadRoot())).length;
    const image = await jpegFixture();
    const results = await Promise.all([upload(productId, image), upload(productId, image)]);

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(results.find((res) => res.status === 409)?.body.message).toContain(
      String(PRODUCT_IMAGE_LIMIT),
    );
    expect(await prisma.productImage.count({ where: { productId } })).toBe(PRODUCT_IMAGE_LIMIT);

    // ไฟล์บนดิสก์เพิ่มแค่ไฟล์เดียว = ตรงกับแถว MediaAsset ที่เพิ่ม
    expect((await listFiles(uploadRoot())).length).toBe(filesBefore + 1);
    expect(await mainImages(productId)).toHaveLength(1);
  });
});

describe('รูปแรก = รูปหลัก', () => {
  it('เรียงใหม่แล้วรูปแรกกลายเป็นรูปหลัก มีรูปหลักรูปเดียว · เขียน AdminLog', async () => {
    const productId = await createProduct();
    await upload(productId, await jpegFixture(), 'รูปหน้า');
    const second = await upload(productId, await jpegFixture(), 'รูปหลัง');
    const [front, back] = second.body.data as Array<{ id: string; url: string; isMain: boolean }>;

    expect(back!.isMain).toBe(false);

    const res = await request(app)
      .put(`/api/admin/products/${productId}/images/order`)
      .set(auth(admin.token))
      .send({ imageIds: [back!.id, front!.id] });

    expect(res.status).toBe(200);
    expect(res.body.data.map((image: { id: string }) => image.id)).toEqual([back!.id, front!.id]);
    expect(res.body.data[0].isMain).toBe(true);
    expect(res.body.data[1].isMain).toBe(false);

    const mains = await mainImages(productId);
    expect(mains.map((image) => image.id)).toEqual([back!.id]);

    const log = await prisma.adminLog.findFirst({
      where: { userId: admin.id, action: 'product.image.reorder', targetId: productId },
    });
    expect(log?.after).toMatchObject({ mainUrl: back!.url });
  });

  it('ส่งรูปไม่ครบ · มีรูปของสินค้าอื่น · ซ้ำ → 409 และลำดับเดิมไม่ขยับ', async () => {
    const productId = await createProduct();
    await upload(productId, await jpegFixture(), 'รูป 1');
    const res = await upload(productId, await jpegFixture(), 'รูป 2');
    const ids = (res.body.data as Array<{ id: string }>).map((image) => image.id);

    const otherProduct = await createProduct();
    const other = await upload(otherProduct, await jpegFixture(), 'รูปของสินค้าอื่น');
    const otherId = (other.body.data as Array<{ id: string }>)[0]!.id;

    for (const imageIds of [[ids[1]], [ids[1], otherId], [ids[1], ids[1]]]) {
      const attempt = await request(app)
        .put(`/api/admin/products/${productId}/images/order`)
        .set(auth(admin.token))
        .send({ imageIds });

      expect(attempt.status, JSON.stringify(imageIds)).toBe(409);
    }

    const order = await prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    expect(order.map((row) => row.id)).toEqual(ids);
  });

  it('ถอดรูปหลัก → รูปถัดไปขึ้นเป็นรูปหลักเอง และเรียงเลขใหม่ไม่มีช่องว่าง', async () => {
    const productId = await createProduct();
    await upload(productId, await jpegFixture(), 'รูป 1');
    await upload(productId, await jpegFixture(), 'รูป 2');
    const res = await upload(productId, await jpegFixture(), 'รูป 3');
    const [first, second, third] = res.body.data as Array<{ id: string }>;

    const removed = await request(app)
      .delete(`/api/admin/products/${productId}/images/${first!.id}`)
      .set(auth(admin.token));

    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual([
      expect.objectContaining({ id: second!.id, isMain: true, sortOrder: 0 }),
      expect.objectContaining({ id: third!.id, isMain: false, sortOrder: 1 }),
    ]);
  });

  it('สร้างสินค้าโดยเลือกรูปที่สองเป็นรูปหลัก → รูปนั้นถูกย้ายขึ้นเป็นรูปแรก', async () => {
    const productId = await createProduct({
      images: [
        { ...EXTERNAL_IMAGE, url: `${EXTERNAL_IMAGE.url}&a=1`, alt: 'รูป A' },
        { ...EXTERNAL_IMAGE, url: `${EXTERNAL_IMAGE.url}&b=1`, alt: 'รูป B', isMain: true },
      ],
    });

    const images = await prisma.productImage.findMany({
      where: { productId },
      orderBy: { sortOrder: 'asc' },
    });

    expect(images.map((image) => [image.alt, image.isMain, image.sortOrder])).toEqual([
      ['รูป B', true, 0],
      ['รูป A', false, 1],
    ]);
  });

  it('ฐานข้อมูลไม่ยอมให้มีรูปหลักสองรูป (ด่านสุดท้าย)', async () => {
    const productId = await createProduct({ images: [EXTERNAL_IMAGE] });

    await expect(
      prisma.productImage.create({
        data: { productId, url: `${EXTERNAL_IMAGE.url}&x=2`, alt: 'รูปหลักซ้อน', isMain: true },
      }),
    ).rejects.toThrow();
  });
});

describe('แก้และถอดรูป', () => {
  it('แก้ alt ได้ · alt สั้นเกิน 422 · AdminLog เก็บค่าเดิมกับค่าใหม่', async () => {
    const productId = await createProduct();
    const res = await upload(productId, await jpegFixture(), 'คำอธิบายเดิม');
    const imageId = (res.body.data as Array<{ id: string }>)[0]!.id;

    const tooShort = await request(app)
      .patch(`/api/admin/products/${productId}/images/${imageId}`)
      .set(auth(admin.token))
      .send({ alt: 'x' });
    expect(tooShort.status).toBe(422);

    const ok = await request(app)
      .patch(`/api/admin/products/${productId}/images/${imageId}`)
      .set(auth(admin.token))
      .send({ alt: 'คำอธิบายใหม่' });
    expect(ok.status).toBe(200);
    expect(ok.body.data[0].alt).toBe('คำอธิบายใหม่');

    const log = await prisma.adminLog.findFirst({
      where: { userId: admin.id, action: 'product.image.update', targetId: productId },
    });
    expect(log?.before).toMatchObject({ alt: 'คำอธิบายเดิม' });
    expect(log?.after).toMatchObject({ alt: 'คำอธิบายใหม่' });
  });

  it('รูปของสินค้าอื่นแก้/ถอดผ่านสินค้านี้ไม่ได้ → 404', async () => {
    const productId = await createProduct();
    const otherProduct = await createProduct();
    const other = await upload(otherProduct, await jpegFixture(), 'รูปของสินค้าอื่น');
    const otherImageId = (other.body.data as Array<{ id: string }>)[0]!.id;

    const patch = await request(app)
      .patch(`/api/admin/products/${productId}/images/${otherImageId}`)
      .set(auth(admin.token))
      .send({ alt: 'แอบแก้' });
    const remove = await request(app)
      .delete(`/api/admin/products/${productId}/images/${otherImageId}`)
      .set(auth(admin.token));

    expect(patch.status).toBe(404);
    expect(remove.status).toBe(404);
    expect(await prisma.productImage.count({ where: { id: otherImageId } })).toBe(1);
  });

  it('สินค้าที่เปิดขายถอดรูปสุดท้ายไม่ได้', async () => {
    const productId = await createProduct({ status: 'ACTIVE', images: [EXTERNAL_IMAGE] });
    const imageId = (await prisma.productImage.findFirstOrThrow({ where: { productId } })).id;

    const res = await request(app)
      .delete(`/api/admin/products/${productId}/images/${imageId}`)
      .set(auth(admin.token));

    expect(res.status).toBe(400);
    expect(res.body.message).toContain('อย่างน้อย 1 รูป');
    expect(await prisma.productImage.count({ where: { productId } })).toBe(1);
  });

  it('ถอดรูปไม่ลบไฟล์ · ไฟล์ที่ไม่มีใครใช้เริ่มนับเวลา · ไฟล์ที่เป็น snapshot ของคำสั่งซื้อไม่ถูกจด', async () => {
    const productId = await createProduct();
    await upload(productId, await jpegFixture(), 'รูปที่ไม่มีใครสั่ง');
    const res = await upload(productId, await jpegFixture(), 'รูปที่อยู่ในคำสั่งซื้อ');
    const [plain, ordered] = res.body.data as Array<{ id: string; url: string }>;

    const order = await prisma.order.create({
      data: {
        orderNumber: `TS-TEST-${randomUUID().slice(0, 12).toUpperCase()}`,
        returnWindowDays: 7,
        userId: customer.id,
        subtotal: 390,
        total: 390,
        addressSnapshot: { recipientName: 'ผู้รับทดสอบ' },
        items: {
          create: {
            productId,
            productName: 'สินค้าทดสอบรูป',
            variantSku: `${SKU_PREFIX}-SNAP`,
            imageUrl: ordered!.url,
            unitPrice: 390,
            quantity: 1,
            lineTotal: 390,
          },
        },
      },
      select: { id: true },
    });
    createdOrderIds.push(order.id);

    for (const image of [plain!, ordered!]) {
      const removed = await request(app)
        .delete(`/api/admin/products/${productId}/images/${image.id}`)
        .set(auth(admin.token));
      expect(removed.status).toBe(200);
    }

    const plainAsset = await prisma.mediaAsset.findUniqueOrThrow({ where: { url: plain!.url } });
    const orderedAsset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { url: ordered!.url },
    });

    expect(plainAsset.unusedSince).not.toBeNull();
    expect(orderedAsset.unusedSince).toBeNull();
    expect(await mediaFileExists(plainAsset.storageKey)).toBe(true);
    expect(await mediaFileExists(orderedAsset.storageKey)).toBe(true);

    // ถอดหมดแล้ว (สินค้าเป็นฉบับร่าง) — ไม่มีรูปหลักค้าง
    expect(await mainImages(productId)).toHaveLength(0);
  });

  it('PATCH สินค้าไม่แตะรูปอีกแล้ว — ส่ง images มาถูกตัดทิ้ง', async () => {
    const productId = await createProduct({ images: [EXTERNAL_IMAGE] });

    const onlyImages = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set(auth(admin.token))
      .send({ images: [] });
    expect(onlyImages.status).toBe(422);

    const withName = await request(app)
      .patch(`/api/admin/products/${productId}`)
      .set(auth(admin.token))
      .send({ name: 'ชื่อใหม่ของสินค้าทดสอบรูป', images: [] });
    expect(withName.status).toBe(200);
    expect(await prisma.productImage.count({ where: { productId } })).toBe(1);
  });
});
