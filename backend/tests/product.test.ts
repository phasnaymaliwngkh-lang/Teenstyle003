import { disconnectDatabase } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของ Product System (STEP 6)
 *
 * ใช้ฐานข้อมูลจริงและอ่านอย่างเดียว (ไม่สร้าง/ลบข้อมูล) จึงไม่กระทบข้อมูลที่ seed ไว้
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - ค้นหา/กรอง/เรียง/แบ่งหน้า ทำงานที่ฝั่ง server จริง
 *   - จำนวนในตัวกรองตรงกับผลค้นหาจริง (ไม่หลอกผู้ใช้)
 *   - ราคาเรียงตามราคาที่ต้องจ่ายจริง (salePrice ถ้ามี)
 *   - ตรวจสต็อกที่ server ป้องกันการซื้อเกินจำนวน / จำนวนติดลบ / สินค้าที่ไม่มีอยู่
 */
const app = createApp();

interface CardLike {
  id: string;
  slug: string;
  finalPrice: number;
  price: number;
  salePrice: number | null;
  stockStatus: string;
  discountPercent: number | null;
}

let firstVariantId = '';
let firstVariantAvailable = 0;

beforeAll(async () => {
  const res = await request(app).get('/api/products/oversize-cotton-tee');
  const variant = res.body.data.variants.find((item: { available: number }) => item.available > 0);
  firstVariantId = variant.id;
  firstVariantAvailable = variant.available;
});

afterAll(async () => {
  await disconnectDatabase();
});

describe('GET /api/products/search', () => {
  it('คืนรายการสินค้าพร้อมข้อมูลแบ่งหน้า', async () => {
    const res = await request(app).get('/api/products/search?limit=5');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items.length).toBeLessThanOrEqual(5);
    expect(res.body.data.total).toBeGreaterThanOrEqual(12);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.totalPages).toBe(Math.ceil(res.body.data.total / 5));
  });

  it('แบ่งหน้าแล้วสินค้าไม่ซ้ำกันระหว่างหน้า', async () => {
    const [page1, page2] = await Promise.all([
      request(app).get('/api/products/search?limit=5&page=1'),
      request(app).get('/api/products/search?limit=5&page=2'),
    ]);

    const ids1 = page1.body.data.items.map((item: CardLike) => item.id);
    const ids2 = page2.body.data.items.map((item: CardLike) => item.id);

    expect(ids2.some((id: string) => ids1.includes(id))).toBe(false);
  });

  it('sort=price-asc เรียงตามราคาที่ต้องจ่ายจริง (ไม่ใช่ราคาตั้ง)', async () => {
    const res = await request(app).get('/api/products/search?sort=price-asc&limit=48');
    const prices = res.body.data.items.map((item: CardLike) => item.finalPrice);

    expect(prices.length).toBeGreaterThan(1);
    expect([...prices].sort((a: number, b: number) => a - b)).toEqual(prices);
  });

  it('sort=price-desc เรียงจากมากไปน้อย', async () => {
    const res = await request(app).get('/api/products/search?sort=price-desc&limit=48');
    const prices = res.body.data.items.map((item: CardLike) => item.finalPrice);

    expect([...prices].sort((a: number, b: number) => b - a)).toEqual(prices);
  });

  it('กรองหมวดหมู่แม่ ต้องรวมสินค้าในหมวดย่อยด้วย', async () => {
    const res = await request(app).get('/api/products/search?category=tops&limit=48');

    expect(res.status).toBe(200);
    expect(res.body.data.total).toBeGreaterThanOrEqual(3);
  });

  it('onSale=true คืนเฉพาะสินค้าที่ลดราคาจริง', async () => {
    const res = await request(app).get('/api/products/search?onSale=true&limit=48');

    expect(res.body.data.total).toBeGreaterThan(0);
    for (const item of res.body.data.items as CardLike[]) {
      expect(item.salePrice).not.toBeNull();
      expect(item.finalPrice).toBeLessThan(item.price);
      expect(item.discountPercent).toBeGreaterThan(0);
    }
  });

  it('inStock=true ไม่คืนสินค้าที่หมด', async () => {
    const res = await request(app).get('/api/products/search?inStock=true&limit=48');

    for (const item of res.body.data.items as CardLike[]) {
      expect(item.stockStatus).not.toBe('OUT_OF_STOCK');
    }
  });

  it('คำค้นที่ไม่มีในระบบ → รายการว่าง ไม่ใช่ error', async () => {
    const res = await request(app).get('/api/products/search?q=zzzzไม่มีสินค้านี้zzzz');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it('sort ที่ไม่อยู่ในรายการที่อนุญาต → 422 (กัน SQL injection ทาง ORDER BY)', async () => {
    const res = await request(app).get('/api/products/search?sort=price-asc;DROP TABLE "Product"');

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
  });

  it('limit เกินเพดานที่กำหนด → 422', async () => {
    const res = await request(app).get('/api/products/search?limit=9999');

    expect(res.status).toBe(422);
  });
});

describe('GET /api/products/filters', () => {
  it('จำนวนสินค้าข้างหมวดหมู่ต้องตรงกับผลค้นหาจริงทุกหมวด', async () => {
    const filters = await request(app).get('/api/products/filters');
    expect(filters.status).toBe(200);

    const categories = filters.body.data.categories as { slug: string; productCount: number }[];
    expect(categories.length).toBeGreaterThan(0);

    for (const category of categories) {
      const search = await request(app).get(
        `/api/products/search?category=${category.slug}&limit=48`,
      );
      expect(search.body.data.total).toBe(category.productCount);
    }
  });

  it('ช่วงราคาที่ส่งมาต้องครอบราคาสินค้าจริงทั้งหมด', async () => {
    const [filters, products] = await Promise.all([
      request(app).get('/api/products/filters'),
      request(app).get('/api/products/search?limit=48'),
    ]);

    const { min, max } = filters.body.data.priceRange;
    for (const item of products.body.data.items as CardLike[]) {
      expect(item.finalPrice).toBeGreaterThanOrEqual(min);
      expect(item.finalPrice).toBeLessThanOrEqual(max);
    }
  });
});

describe('GET /api/products/:slug', () => {
  it('slug ที่มีอยู่ → 200 พร้อม variant และจำนวนที่ซื้อได้', async () => {
    const res = await request(app).get('/api/products/oversize-cotton-tee');

    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe('oversize-cotton-tee');
    expect(res.body.data.variants.length).toBeGreaterThan(0);
    expect(res.body.data.colors.length).toBeGreaterThan(0);
    expect(res.body.data.sizes.length).toBeGreaterThan(0);
    // จำนวนที่ซื้อได้ต้องไม่ติดลบเสมอ
    for (const variant of res.body.data.variants as { available: number }[]) {
      expect(variant.available).toBeGreaterThanOrEqual(0);
    }
  });

  it('slug ที่ไม่มีในระบบ → 404', async () => {
    const res = await request(app).get('/api/products/no-such-product-xyz');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, errorCode: 'NOT_FOUND' });
  });

  it('slug ที่มีอักขระนอกรูปแบบ → 422', async () => {
    const res = await request(app).get('/api/products/BAD_SLUG!!');

    expect(res.status).toBe(422);
  });
});

describe('POST /api/products/availability — ด่านตรวจสต็อกฝั่ง server', () => {
  it('จำนวนเท่าที่มีจริง → ซื้อได้', async () => {
    const res = await request(app)
      .post('/api/products/availability')
      .send({ variantId: firstVariantId, quantity: firstVariantAvailable });

    expect(res.status).toBe(200);
    expect(res.body.data.purchasable).toBe(true);
    expect(res.body.data.available).toBe(firstVariantAvailable);
    // ราคาต้องมาจาก server ไม่ใช่จากที่ client ส่งมา
    expect(typeof res.body.data.variant.finalPrice).toBe('number');
  });

  it('ขอเกินจำนวนที่มี 1 ชิ้น → ซื้อไม่ได้ (INSUFFICIENT_STOCK)', async () => {
    const res = await request(app)
      .post('/api/products/availability')
      .send({ variantId: firstVariantId, quantity: firstVariantAvailable + 1 });

    expect(res.status).toBe(200);
    expect(res.body.data.purchasable).toBe(false);
    expect(res.body.data.reason).toBe('INSUFFICIENT_STOCK');
  });

  it('quantity = 0 → 422', async () => {
    const res = await request(app)
      .post('/api/products/availability')
      .send({ variantId: firstVariantId, quantity: 0 });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('quantity ติดลบ → 422', async () => {
    const res = await request(app)
      .post('/api/products/availability')
      .send({ variantId: firstVariantId, quantity: -5 });

    expect(res.status).toBe(422);
  });

  it('quantity ไม่ใช่จำนวนเต็ม → 422', async () => {
    const res = await request(app)
      .post('/api/products/availability')
      .send({ variantId: firstVariantId, quantity: 1.5 });

    expect(res.status).toBe(422);
  });

  it('variantId ไม่ใช่ UUID → 422', async () => {
    const res = await request(app)
      .post('/api/products/availability')
      .send({ variantId: 'not-a-uuid', quantity: 1 });

    expect(res.status).toBe(422);
  });

  it('variant ที่ไม่มีในระบบ → 404', async () => {
    const res = await request(app)
      .post('/api/products/availability')
      .send({ variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 });

    expect(res.status).toBe(404);
  });

  it('body ว่าง → 422', async () => {
    const res = await request(app).post('/api/products/availability').send({});

    expect(res.status).toBe(422);
  });
});
