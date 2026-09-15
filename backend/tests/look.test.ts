import { disconnectDatabase } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของ Look Ideas (STEP 7)
 *
 * ใช้ฐานข้อมูลจริงและอ่านอย่างเดียว จึงไม่กระทบข้อมูลที่ seed ไว้
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - กรอง/ค้นหา/เรียง/แบ่งหน้า ทำที่ server จริง
 *   - จำนวนข้างสไตล์ในตัวกรองตรงกับผลค้นหาจริง (ไม่หลอกผู้ใช้)
 *   - ราคารวมของลุคเท่ากับผลบวกราคาที่จ่ายจริงของสินค้าในลุค
 *   - สถานะ "ซื้อครบชุดได้" สอดคล้องกับสต็อกของสินค้าแต่ละชิ้น
 */
const app = createApp();

interface LookLike {
  slug: string;
  style: string;
  totalPrice: number;
  itemCount: number;
  availableItemCount: number;
  allItemsAvailable: boolean;
  items: { slug: string; finalPrice: number; stockStatus: string }[];
}

afterAll(async () => {
  await disconnectDatabase();
});

describe('GET /api/looks/search', () => {
  it('คืนลุคพร้อมข้อมูลแบ่งหน้า', async () => {
    const res = await request(app).get('/api/looks/search');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.total).toBeGreaterThanOrEqual(4);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.appliedSort).toBe('featured');
  });

  it('ราคารวมของลุคต้องเท่ากับผลบวกราคาที่จ่ายจริงของสินค้าในลุค', async () => {
    const res = await request(app).get('/api/looks/search?limit=24');

    for (const look of res.body.data.items as LookLike[]) {
      const sum = look.items.reduce((total, item) => total + item.finalPrice, 0);
      expect(look.totalPrice).toBe(sum);
      expect(look.availableItemCount).toBe(look.items.length);
    }
  });

  it('allItemsAvailable ต้องสอดคล้องกับสต็อกจริงของทุกชิ้น', async () => {
    const res = await request(app).get('/api/looks/search?limit=24');

    for (const look of res.body.data.items as LookLike[]) {
      const everyInStock = look.items.every((item) => item.stockStatus !== 'OUT_OF_STOCK');
      const complete = look.itemCount === look.availableItemCount && look.items.length > 0;

      expect(look.allItemsAvailable).toBe(complete && everyInStock);
    }
  });

  it('sort=price-asc เรียงตามราคารวมจากน้อยไปมาก', async () => {
    const res = await request(app).get('/api/looks/search?sort=price-asc&limit=24');
    const prices = (res.body.data.items as LookLike[]).map((look) => look.totalPrice);

    expect(prices.length).toBeGreaterThan(1);
    expect([...prices].sort((a, b) => a - b)).toEqual(prices);
  });

  it('sort=price-desc เรียงจากมากไปน้อย', async () => {
    const res = await request(app).get('/api/looks/search?sort=price-desc&limit=24');
    const prices = (res.body.data.items as LookLike[]).map((look) => look.totalPrice);

    expect([...prices].sort((a, b) => b - a)).toEqual(prices);
  });

  it('กรองหลายสไตล์พร้อมกันด้วย CSV ได้', async () => {
    const res = await request(app).get('/api/looks/search?style=PARTY,KOREAN');

    expect(res.status).toBe(200);
    for (const look of res.body.data.items as LookLike[]) {
      expect(['PARTY', 'KOREAN']).toContain(look.style);
    }
  });

  it('ชื่อสไตล์ตัวพิมพ์เล็กก็ใช้ได้ (ผู้ใช้พิมพ์ URL เอง)', async () => {
    const [upper, lower] = await Promise.all([
      request(app).get('/api/looks/search?style=PARTY'),
      request(app).get('/api/looks/search?style=party'),
    ]);

    expect(lower.status).toBe(200);
    expect(lower.body.data.total).toBe(upper.body.data.total);
  });

  it('available=true คืนเฉพาะลุคที่ซื้อครบชุดได้', async () => {
    const res = await request(app).get('/api/looks/search?available=true&limit=24');

    for (const look of res.body.data.items as LookLike[]) {
      expect(look.allItemsAvailable).toBe(true);
    }
  });

  it('กรองช่วงราคารวมได้', async () => {
    const all = await request(app).get('/api/looks/search?limit=24');
    const prices = (all.body.data.items as LookLike[]).map((look) => look.totalPrice);
    const max = Math.min(...prices);

    const res = await request(app).get(`/api/looks/search?maxPrice=${max}&limit=24`);

    expect(res.body.data.total).toBeGreaterThan(0);
    for (const look of res.body.data.items as LookLike[]) {
      expect(look.totalPrice).toBeLessThanOrEqual(max);
    }
  });

  it('แบ่งหน้าแล้วลุคไม่ซ้ำกันระหว่างหน้า', async () => {
    const [page1, page2] = await Promise.all([
      request(app).get('/api/looks/search?limit=2&page=1'),
      request(app).get('/api/looks/search?limit=2&page=2'),
    ]);

    const slugs1 = (page1.body.data.items as LookLike[]).map((look) => look.slug);
    const slugs2 = (page2.body.data.items as LookLike[]).map((look) => look.slug);

    expect(slugs2.some((slug) => slugs1.includes(slug))).toBe(false);
  });

  it('คำค้นที่ไม่มีในระบบ → รายการว่าง ไม่ใช่ error', async () => {
    const res = await request(app).get('/api/looks/search?q=zzzzไม่มีลุคนี้zzzz');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it('สไตล์ที่ไม่มีใน enum → 422', async () => {
    const res = await request(app).get('/api/looks/search?style=NOT_A_STYLE');

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({ success: false, errorCode: 'VALIDATION_ERROR' });
  });

  it('sort ที่ไม่อยู่ใน whitelist → 422 (กัน SQL injection ทาง ORDER BY)', async () => {
    const res = await request(app).get('/api/looks/search?sort=price-asc;DROP TABLE "Look"');

    expect(res.status).toBe(422);
  });

  it('limit เกินเพดาน → 422', async () => {
    const res = await request(app).get('/api/looks/search?limit=999');

    expect(res.status).toBe(422);
  });
});

describe('GET /api/looks/filters', () => {
  it('จำนวนข้างสไตล์ต้องตรงกับผลค้นหาจริงทุกสไตล์', async () => {
    const filters = await request(app).get('/api/looks/filters');
    expect(filters.status).toBe(200);

    const styles = filters.body.data.styles as { value: string; lookCount: number }[];
    expect(styles.length).toBeGreaterThan(0);

    for (const style of styles) {
      const search = await request(app).get(`/api/looks/search?style=${style.value}&limit=24`);
      expect(search.body.data.total).toBe(style.lookCount);
    }
  });

  it('จำนวนลุคทั้งหมดและจำนวนที่ซื้อครบชุดได้ ต้องตรงกับผลค้นหา', async () => {
    const [filters, all, available] = await Promise.all([
      request(app).get('/api/looks/filters'),
      request(app).get('/api/looks/search?limit=24'),
      request(app).get('/api/looks/search?available=true&limit=24'),
    ]);

    expect(filters.body.data.total).toBe(all.body.data.total);
    expect(filters.body.data.availableCount).toBe(available.body.data.total);
  });

  it('ช่วงราคาต้องครอบราคารวมของลุคทั้งหมด', async () => {
    const [filters, all] = await Promise.all([
      request(app).get('/api/looks/filters'),
      request(app).get('/api/looks/search?limit=24'),
    ]);

    const { min, max } = filters.body.data.priceRange;
    for (const look of all.body.data.items as LookLike[]) {
      expect(look.totalPrice).toBeGreaterThanOrEqual(min);
      expect(look.totalPrice).toBeLessThanOrEqual(max);
    }
  });
});

describe('GET /api/looks — ลุคแนะนำบนหน้าแรก', () => {
  it('ใช้ mapper เดียวกับหน้า /looks (ข้อมูลตรงกัน)', async () => {
    const [home, search] = await Promise.all([
      request(app).get('/api/looks?limit=4'),
      request(app).get('/api/looks/search?sort=featured&limit=4'),
    ]);

    expect(home.status).toBe(200);
    const homeSlugs = (home.body.data.items as LookLike[]).map((look) => look.slug);
    const searchSlugs = (search.body.data.items as LookLike[]).map((look) => look.slug);

    expect(homeSlugs).toEqual(searchSlugs);

    const first = (home.body.data.items as LookLike[])[0];
    expect(first).toBeDefined();
    expect(first?.items.length).toBeGreaterThan(0);
    expect(first?.totalPrice).toBeGreaterThan(0);
  });

  it('limit เกินเพดาน → 422', async () => {
    const res = await request(app).get('/api/looks?limit=999');

    expect(res.status).toBe(422);
  });
});
