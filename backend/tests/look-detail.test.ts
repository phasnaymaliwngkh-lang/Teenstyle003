import { disconnectDatabase } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของหน้ารายละเอียดลุค + ซื้อทั้งชุด (STEP 8)
 *
 * อ่านข้อมูลจริงเท่านั้น (ยกเว้น viewCount ที่ endpoint เพิ่มเองตามดีไซน์)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - ราคาและสต็อกมาจาก server เสมอ — ค่าที่ client ส่งมาถูกเมิน
 *   - variant ที่ไม่ได้อยู่ในลุคนี้ใช้ซื้อทั้งชุดไม่ได้
 *   - เลือกไม่ครบ / เกินสต็อก / จำนวนไม่ถูกต้อง ถูกปฏิเสธทุกกรณี
 */
const app = createApp();

const LOOK_SLUG = 'campus-day';

interface VariantLike {
  id: string;
  sku: string;
  available: number;
  finalPrice: number;
}

interface DetailItemLike {
  productId: string;
  slug: string;
  finalPrice: number;
  variants: VariantLike[];
  colors: unknown[];
  sizes: unknown[];
}

let items: DetailItemLike[] = [];
let picks: VariantLike[] = [];
let outsideVariantId = '';

beforeAll(async () => {
  const res = await request(app).get(`/api/looks/${LOOK_SLUG}`);
  items = res.body.data.items;
  picks = items.map(
    (item) => item.variants.find((variant) => variant.available > 0) ?? item.variants[0]!,
  );

  // variant ของสินค้าที่ไม่ได้อยู่ในลุคนี้ (ใช้ทดสอบกฎ NOT_IN_LOOK)
  const other = await request(app).get('/api/products/satin-slip-dress');
  outsideVariantId = other.body.data.variants[0].id;
});

afterAll(async () => {
  await disconnectDatabase();
});

function checkSet(selections: { variantId: string; quantity?: number }[]) {
  return request(app).post(`/api/looks/${LOOK_SLUG}/availability`).send({ selections });
}

describe('GET /api/looks/:slug', () => {
  it('คืนรายละเอียดลุคพร้อม variant ของสินค้าทุกชิ้น', async () => {
    const res = await request(app).get(`/api/looks/${LOOK_SLUG}`);

    expect(res.status).toBe(200);
    expect(res.body.data.slug).toBe(LOOK_SLUG);
    expect(res.body.data.items.length).toBeGreaterThan(0);

    for (const item of res.body.data.items as DetailItemLike[]) {
      expect(item.variants.length).toBeGreaterThan(0);
      expect(item.colors.length).toBeGreaterThan(0);
      expect(item.sizes.length).toBeGreaterThan(0);
      // จำนวนที่ซื้อได้ห้ามติดลบ
      for (const variant of item.variants) {
        expect(variant.available).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('ราคารวมของลุคเท่ากับผลบวกราคาของสินค้าในลุค', async () => {
    const res = await request(app).get(`/api/looks/${LOOK_SLUG}`);
    const sum = (res.body.data.items as DetailItemLike[]).reduce(
      (total, item) => total + item.finalPrice,
      0,
    );

    expect(res.body.data.totalPrice).toBe(sum);
  });

  it('นับจำนวนการเข้าชมเพิ่มขึ้นทุกครั้งที่เปิด', async () => {
    const first = await request(app).get(`/api/looks/${LOOK_SLUG}`);
    const second = await request(app).get(`/api/looks/${LOOK_SLUG}`);

    expect(second.body.data.viewCount).toBeGreaterThan(first.body.data.viewCount);
  });

  it('slug ที่ไม่มีในระบบ → 404', async () => {
    const res = await request(app).get('/api/looks/no-such-look-xyz');

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false, errorCode: 'NOT_FOUND' });
  });

  it('slug ที่มีอักขระนอกรูปแบบ → 422', async () => {
    const res = await request(app).get('/api/looks/BAD_SLUG!!');

    expect(res.status).toBe(422);
  });
});

describe('POST /api/looks/:slug/availability — ด่านตรวจซื้อทั้งชุด', () => {
  it('เลือกครบทุกชิ้นและมีของ → ซื้อทั้งชุดได้ พร้อมยอดรวมจาก server', async () => {
    const res = await checkSet(picks.map((variant) => ({ variantId: variant.id, quantity: 1 })));

    expect(res.status).toBe(200);
    expect(res.body.data.purchasable).toBe(true);
    expect(res.body.data.missingProducts).toEqual([]);
    expect(res.body.data.unavailableCount).toBe(0);
    expect(res.body.data.totalPrice).toBe(
      picks.reduce((sum, variant) => sum + variant.finalPrice, 0),
    );
  });

  it('เลือกไม่ครบ → ซื้อทั้งชุดไม่ได้ และบอกว่าขาดชิ้นไหน', async () => {
    const res = await checkSet([{ variantId: picks[0]!.id, quantity: 1 }]);

    expect(res.status).toBe(200);
    expect(res.body.data.purchasable).toBe(false);
    expect(res.body.data.missingProducts.length).toBe(items.length - 1);
  });

  it('variant ของสินค้าที่ไม่อยู่ในลุคนี้ → NOT_IN_LOOK และไม่ถูกคิดราคา', async () => {
    const res = await checkSet([
      ...picks.map((variant) => ({ variantId: variant.id, quantity: 1 })),
      { variantId: outsideVariantId, quantity: 1 },
    ]);

    expect(res.status).toBe(200);
    expect(res.body.data.purchasable).toBe(false);

    const outside = res.body.data.items.find(
      (item: { variantId: string }) => item.variantId === outsideVariantId,
    );
    expect(outside.reason).toBe('NOT_IN_LOOK');
    expect(outside.lineTotal).toBeNull();
    // ยอดรวมต้องไม่รวมชิ้นที่ไม่ได้อยู่ในลุค
    expect(res.body.data.totalPrice).toBe(
      picks.reduce((sum, variant) => sum + variant.finalPrice, 0),
    );
  });

  it('ขอเกินจำนวนที่มี → INSUFFICIENT_STOCK', async () => {
    const first = picks[0]!;
    const res = await checkSet([
      { variantId: first.id, quantity: first.available + 1 },
      ...picks.slice(1).map((variant) => ({ variantId: variant.id, quantity: 1 })),
    ]);

    expect(res.body.data.purchasable).toBe(false);
    const line = res.body.data.items.find(
      (item: { variantId: string }) => item.variantId === first.id,
    );
    expect(line.reason).toBe('INSUFFICIENT_STOCK');
    expect(line.available).toBe(first.available);
  });

  it('ราคาที่ client แนบมาต้องถูกเมิน — ใช้ราคาจากฐานข้อมูลเท่านั้น', async () => {
    const res = await request(app)
      .post(`/api/looks/${LOOK_SLUG}/availability`)
      .send({
        selections: picks.map((variant) => ({
          variantId: variant.id,
          quantity: 1,
          finalPrice: 1,
          lineTotal: 1,
        })),
      });

    expect(res.status).toBe(200);
    expect(res.body.data.totalPrice).toBe(
      picks.reduce((sum, variant) => sum + variant.finalPrice, 0),
    );
    for (const item of res.body.data.items as { finalPrice: number }[]) {
      expect(item.finalPrice).toBeGreaterThan(1);
    }
  });

  it('variant ที่ไม่มีในระบบ → PRODUCT_UNAVAILABLE', async () => {
    const res = await checkSet([
      { variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 },
    ]);

    expect(res.body.data.purchasable).toBe(false);
    expect(res.body.data.items[0].reason).toBe('PRODUCT_UNAVAILABLE');
  });

  it('quantity = 0 → 422', async () => {
    const res = await checkSet([{ variantId: picks[0]!.id, quantity: 0 }]);

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('quantity ติดลบ → 422', async () => {
    const res = await checkSet([{ variantId: picks[0]!.id, quantity: -3 }]);

    expect(res.status).toBe(422);
  });

  it('quantity ไม่ใช่จำนวนเต็ม → 422', async () => {
    const res = await checkSet([{ variantId: picks[0]!.id, quantity: 2.5 }]);

    expect(res.status).toBe(422);
  });

  it('variantId ไม่ใช่ UUID → 422', async () => {
    const res = await checkSet([{ variantId: 'not-a-uuid', quantity: 1 }]);

    expect(res.status).toBe(422);
  });

  it('selections ว่าง → 422', async () => {
    const res = await checkSet([]);

    expect(res.status).toBe(422);
  });

  it('body ว่าง → 422', async () => {
    const res = await request(app).post(`/api/looks/${LOOK_SLUG}/availability`).send({});

    expect(res.status).toBe(422);
  });

  it('ลุคที่ไม่มีในระบบ → 404', async () => {
    const res = await request(app)
      .post('/api/looks/no-such-look-xyz/availability')
      .send({ selections: [{ variantId: picks[0]!.id, quantity: 1 }] });

    expect(res.status).toBe(404);
  });

  it('ไม่ส่ง quantity มา → ถือเป็น 1 ชิ้น', async () => {
    const res = await checkSet(picks.map((variant) => ({ variantId: variant.id })));

    expect(res.status).toBe(200);
    expect(res.body.data.purchasable).toBe(true);
    for (const item of res.body.data.items as { quantity: number }[]) {
      expect(item.quantity).toBe(1);
    }
  });
});
