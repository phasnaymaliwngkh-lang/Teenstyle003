import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของการค้นหา (STEP 45) — ยิงผ่าน HTTP กับสินค้าจริงในฐานข้อมูล
 *
 * คำตอบที่ถูกคำนวณจากฐานข้อมูลตรง ๆ ในเทสต์ ไม่ได้พิมพ์ชื่อสินค้าที่คาดไว้
 * (กฎ STEP 40 ข้อ 2: assertion ต้องอ้างแหล่งความจริง) — แก้ข้อมูลตั้งต้นแล้วเทสต์ยังหมายความเหมือนเดิม
 */
const app = createApp();
const prisma = getPrisma();

afterAll(async () => {
  await disconnectDatabase();
});

const search = (params: Record<string, string>) =>
  request(app)
    .get('/api/search')
    .query({ limit: '48', ...params });

const idsOf = (body: { data: { products: { items: { id: string }[] } } }) =>
  body.data.products.items.map((item) => item.id).sort();

describe('ผลค้นหาตรงกับฐานข้อมูล', () => {
  it('"สีดำ ราคาไม่เกิน …" ได้สินค้าที่มีตัวเลือกสีดำและราคาที่จ่ายจริงไม่เกินนั้นครบทุกชิ้น ไม่เกินไม่ขาด', async () => {
    const budget = 1000;
    const expected = (
      await prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM "Product" p
         WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE'
           AND COALESCE(p."salePrice", p."price") <= ${budget}
           AND EXISTS (
             SELECT 1 FROM "ProductVariant" v JOIN "Color" c ON c.id = v."colorId"
              WHERE v."productId" = p.id AND v."deletedAt" IS NULL AND v."isActive" AND c."slug" = 'black')`
    )
      .map((row) => row.id)
      .sort();

    expect(
      expected.length,
      'ข้อมูลตั้งต้นต้องมีสินค้าสีดำในงบนี้ — ไม่งั้นเทสต์นี้ว่าง',
    ).toBeGreaterThan(0);

    const response = await search({ q: `สีดำ ราคาไม่เกิน ${budget} บาท` });

    expect(response.status).toBe(200);
    expect(
      response.body.data.understood.map((part: { label: string }) => part.label).sort(),
    ).toEqual(['ราคาไม่เกิน 1,000 บาท', 'สีดำ'].sort());
    expect(idsOf(response.body)).toEqual(expected);
  });

  /**
   * หน้า /search กับหน้า /shop ต้องตอบเหมือนกันเมื่อเงื่อนไขเหมือนกัน — `shopQuery` คือสะพานระหว่างสองหน้า
   * ถ้าคิดต่างกัน ลูกค้ากด "กรองต่อที่หน้าร้าน" แล้วจำนวนสินค้าเปลี่ยนเองโดยไม่ได้แตะอะไร
   */
  it('เงื่อนไขชุดเดียวกันใน /api/products/search ได้สินค้าชุดเดียวกัน', async () => {
    for (const q of [
      'เสื้อสีดำราคาไม่เกิน 800',
      'กางเกงยีนส์',
      'y2k ลดราคา',
      'กระโปรง ไซซ์ M พร้อมส่ง',
    ]) {
      const found = await search({ q, sort: 'newest' });
      const shop = await request(app)
        .get('/api/products/search')
        .query({ ...found.body.data.shopQuery, sort: 'newest', limit: '48' });

      expect(shop.status, q).toBe(200);
      expect(shop.body.data.items.map((item: { id: string }) => item.id).sort(), q).toEqual(
        idsOf(found.body),
      );
    }
  });

  it('หลายคำ: ทุกคำต้องตรง และคำหนึ่งตรงกับชื่อหมวดแม่ได้ ("กางเกง" เจอยีนส์ใต้หมวดกางเกง)', async () => {
    const jeans = await prisma.product.findFirst({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        category: { parent: { name: { contains: 'กางเกง' } }, name: { contains: 'ยีนส์' } },
      },
      select: { id: true, name: true },
    });

    expect(jeans, 'ข้อมูลตั้งต้นต้องมียีนส์ในหมวดย่อยของกางเกง').not.toBeNull();
    expect(jeans!.name).not.toContain('กางเกง');

    const response = await search({ q: 'กางเกงยีนส์' });

    expect(response.body.data.terms).toEqual(['กางเกง', 'ยีนส์']);
    expect(idsOf(response.body)).toContain(jeans!.id);
  });

  it('/shop ค้นหลายคำได้แล้ว — "เสื้อ oversize" ไม่ต้องอยู่ติดกันในชื่อ', async () => {
    const tee = await prisma.product.findFirst({
      where: {
        deletedAt: null,
        status: 'ACTIVE',
        name: { contains: 'เสื้อ' },
        tags: { has: 'oversize' },
      },
      select: { id: true },
    });

    expect(tee).not.toBeNull();

    const response = await request(app)
      .get('/api/products/search')
      .query({ q: 'เสื้อ oversize', limit: '48' });

    expect(response.body.data.items.map((item: { id: string }) => item.id)).toContain(tee!.id);
  });
});

describe('สิ่งที่ร้านตอบไม่ได้ต้องบอกตรง ๆ', () => {
  it('สีที่ร้านไม่มี → ไม่มีสินค้า ไม่มีลุค และบอกว่าเข้าใจว่าเป็นสีอะไร', async () => {
    const red = await prisma.color.count({ where: { name: { startsWith: 'แดง' } } });
    expect(red, 'เทสต์นี้สมมติว่าร้านยังไม่มีสีแดง').toBe(0);

    const response = await search({ q: 'เดรสสีแดง' });

    expect(response.body.data.products.total).toBe(0);
    expect(response.body.data.looks).toEqual([]);
    expect(response.body.data.understood).toEqual([
      { kind: 'color', label: 'สีแดง', available: false },
    ]);
  });

  it('พิมพ์ผิด → แนะนำคำที่มีอยู่จริงในร้าน', async () => {
    const response = await search({ q: 'กระโปง' });

    expect(response.body.data.products.total).toBe(0);
    expect(response.body.data.suggestions.some((word: string) => word.includes('กระโปรง'))).toBe(
      true,
    );

    // ทุกคำแนะนำต้องค้นแล้วเจอของจริง — แนะนำคำที่ค้นแล้วว่างอีกคือวนลูปให้ลูกค้า
    for (const word of response.body.data.suggestions as string[]) {
      expect((await search({ q: word })).body.data.products.total, word).toBeGreaterThan(0);
    }
  });

  /**
   * ข้อมูลตั้งต้นมีสินค้าที่เขียนว่า "ผ้าคอตตอน 100%" — ผลต้องเป็นสินค้าที่มี % จริงเท่านั้น
   * ถ้าไม่ escape `%` จะกลายเป็น `ILIKE '%%%'` แล้วได้ทุกสินค้าในร้าน
   */
  it('"%" ค้นหาเครื่องหมาย % จริง — ไม่ใช่ได้ทุกสินค้าในร้าน', async () => {
    // ⚠️ ใช้ `contains` ของ Prisma เป็นคำตอบอ้างอิงไม่ได้ — มันไม่ escape `%` เอง (`contains: '%'` ได้ทุกแถว)
    const [withPercent, all] = await Promise.all([
      prisma.$queryRaw<{ id: string }[]>`
        SELECT p.id FROM "Product" p
         WHERE p."deletedAt" IS NULL AND p."status" = 'ACTIVE'
           AND (position('%' in p."name") > 0 OR position('%' in p."sku") > 0
                OR position('%' in p."description") > 0)`,
      prisma.product.count({ where: { deletedAt: null, status: 'ACTIVE' } }),
    ]);

    expect(withPercent.length).toBeLessThan(all);

    const response = await search({ q: '%' });

    expect(response.body.data.terms).toEqual(['%']);
    expect(idsOf(response.body)).toEqual(withPercent.map((row) => row.id).sort());
  });

  it('ค้นแบบตรงตัว → ไม่ตีความสีหรือราคา', async () => {
    const response = await search({ q: 'สีดำ', literal: 'true' });

    expect(response.body.data.understood).toEqual([]);
    expect(response.body.data.terms).toEqual(['สีดำ']);
    expect(response.body.data.shopQuery).toEqual({ q: 'สีดำ' });
  });
});

describe('คำแนะนำระหว่างพิมพ์', () => {
  it('สินค้าในกล่องแนะนำคือ 5 ชิ้นแรกของผลค้นหาเดียวกัน', async () => {
    const suggest = await request(app).get('/api/search/suggest').query({ q: 'ฮู้ด' });
    const full = await search({ q: 'ฮู้ด', limit: '5' });

    expect(suggest.status).toBe(200);
    expect(suggest.body.data.products.length).toBeGreaterThan(0);
    expect(suggest.body.data.products.map((item: { id: string }) => item.id)).toEqual(
      full.body.data.products.items.map((item: { id: string }) => item.id),
    );
  });

  it('คำค้นว่าง/ยาวเกิน → 422 พร้อมเหตุผลภาษาไทย', async () => {
    const empty = await request(app).get('/api/search');
    const long = await search({ q: 'ก'.repeat(121) });

    expect(empty.status).toBe(422);
    expect(JSON.stringify(empty.body.details)).toContain('กรุณาพิมพ์คำที่ต้องการค้นหา');
    expect(long.status).toBe(422);
  });
});
