import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของตะกร้า (STEP 9)
 *
 * ใช้ฐานข้อมูลจริง สร้างผู้ใช้ทดสอบ + ตะกร้าของตัวเอง แล้วลบทิ้งใน afterAll
 * ไม่แตะข้อมูลสินค้าที่ seed ไว้ (เพิ่ม/ลบแต่ตะกร้าของตัวเอง)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - ราคาและยอดรวมมาจาก server เสมอ
 *   - ห้ามเกินสต็อก / ห้ามจำนวน 0 หรือติดลบ / หนึ่ง variant หนึ่งแถว
 *   - ตะกร้าของคนอื่นแตะไม่ได้ (IDOR)
 *   - คำขอจาก origin อื่นถูกปฏิเสธ (CSRF)
 *   - รวมตะกร้า guest เข้าบัญชีตอนล็อกอินได้ และเรียกซ้ำไม่พัง (idempotent)
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);
const userEmail = `test-cart-${suffix}@teenstyle.test`;

let userId = '';
let userToken = '';
/** เวลาเริ่มเทส — ใช้ลบเฉพาะตะกร้า guest ที่เทสนี้สร้างขึ้น */
const startedAt = new Date();
let variantA = { id: '', available: 0, finalPrice: 0 };
let variantB = { id: '', available: 0, finalPrice: 0 };
let outsideVariantId = '';

beforeAll(async () => {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  const user = await prisma.user.create({
    data: { email: userEmail, roleId: role.id, status: 'ACTIVE' },
  });
  userId = user.id;

  userToken = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: userToken, userId, expires: new Date(Date.now() + 60 * 60 * 1000) },
  });

  const tee = await request(app).get('/api/products/oversize-cotton-tee');
  const usable = (tee.body.data.variants as (typeof variantA)[]).filter(
    (variant) => variant.available > 0,
  );
  variantA = usable[0]!;
  variantB = usable[1]!;

  const dress = await request(app).get('/api/products/satin-slip-dress');
  outsideVariantId = dress.body.data.variants[0].id;
});

afterAll(async () => {
  // ลบตะกร้า guest ที่เทสนี้สร้างขึ้น (items ถูกลบตาม cascade)
  await prisma.cart.deleteMany({
    where: { guestToken: { not: null }, createdAt: { gte: startedAt } },
  });
  await prisma.cart.deleteMany({ where: { userId } });
  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await disconnectDatabase();
});

describe('ตะกร้าของ guest', () => {
  it('ยังไม่มี cookie → ตะกร้าเปล่า และไม่สร้างแถวในฐานข้อมูล', async () => {
    const before = await prisma.cart.count();
    const res = await request(app).get('/api/cart');

    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.isGuest).toBe(true);
    expect(res.body.data.summary.subtotal).toBe(0);
    expect(res.body.data.summary.checkoutReady).toBe(false);
    expect(await prisma.cart.count()).toBe(before);
  });

  it('เพิ่มสินค้า → ได้ cookie httpOnly และยอดรวมคำนวณจากราคาใน DB', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/cart/items').send({ variantId: variantA.id, quantity: 2 });

    expect(res.status).toBe(201);

    const setCookie = res.headers['set-cookie'] as unknown as string[] | undefined;
    expect(setCookie?.some((cookie) => cookie.startsWith('cart-token='))).toBe(true);
    expect(setCookie?.some((cookie) => cookie.includes('HttpOnly'))).toBe(true);

    const item = res.body.data.items[0];
    expect(item.quantity).toBe(2);
    expect(item.unitPrice).toBe(variantA.finalPrice);
    expect(item.lineTotal).toBe(variantA.finalPrice * 2);
    expect(res.body.data.summary.subtotal).toBe(variantA.finalPrice * 2);
    expect(res.body.data.summary.checkoutReady).toBe(true);
  });

  it('เพิ่ม variant เดิมซ้ำ → บวกจำนวนในแถวเดิม ไม่สร้างรายการซ้ำ', async () => {
    const agent = request.agent(app);
    await agent.post('/api/cart/items').send({ variantId: variantA.id, quantity: 1 });
    const res = await agent.post('/api/cart/items').send({ variantId: variantA.id, quantity: 2 });

    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].quantity).toBe(3);
  });

  it('ยอดรวมเท่ากับผลบวกของรายการที่ติ๊กเลือกไว้เท่านั้น', async () => {
    const agent = request.agent(app);
    await agent.post('/api/cart/items').send({ variantId: variantA.id, quantity: 1 });
    const added = await agent.post('/api/cart/items').send({ variantId: variantB.id, quantity: 2 });

    const target = added.body.data.items.find(
      (item: { variantId: string }) => item.variantId === variantA.id,
    );
    const res = await agent.patch(`/api/cart/items/${target.id}/select`).send({ selected: false });

    expect(res.body.data.summary.selectedCount).toBe(1);
    expect(res.body.data.summary.subtotal).toBe(variantB.finalPrice * 2);
    // รายการที่ไม่ติ๊กยังอยู่ในตะกร้า
    expect(res.body.data.items.length).toBe(2);
  });

  it('แก้จำนวน ลบรายการ และล้างตะกร้าได้', async () => {
    const agent = request.agent(app);
    const added = await agent.post('/api/cart/items').send({ variantId: variantA.id, quantity: 1 });
    const itemId = added.body.data.items[0].id;

    const updated = await agent.patch(`/api/cart/items/${itemId}`).send({ quantity: 4 });
    expect(updated.body.data.items[0].quantity).toBe(4);
    expect(updated.body.data.summary.subtotal).toBe(variantA.finalPrice * 4);

    const removed = await agent.delete(`/api/cart/items/${itemId}`);
    expect(removed.body.data.items).toEqual([]);

    await agent.post('/api/cart/items').send({ variantId: variantB.id, quantity: 1 });
    const cleared = await agent.delete('/api/cart');
    expect(cleared.body.data.items).toEqual([]);
    expect(cleared.body.data.summary.totalQuantity).toBe(0);
  });
});

describe('กฎสต็อกและการตรวจ input', () => {
  it('เพิ่มเกินจำนวนที่มี → 409 และไม่มีอะไรถูกบันทึก', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/cart/items')
      .send({ variantId: variantA.id, quantity: variantA.available + 1 });

    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, errorCode: 'CONFLICT' });

    const cart = await agent.get('/api/cart');
    expect(cart.body.data.items).toEqual([]);
  });

  it('เพิ่มทีละครั้งจนเกินยอดรวมที่มี → ครั้งที่เกินถูกปฏิเสธ', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/cart/items')
      .send({ variantId: variantA.id, quantity: variantA.available });

    const res = await agent.post('/api/cart/items').send({ variantId: variantA.id, quantity: 1 });

    expect(res.status).toBe(409);

    const cart = await agent.get('/api/cart');
    expect(cart.body.data.items[0].quantity).toBe(variantA.available);
  });

  it('แก้จำนวนเกินสต็อก → 409', async () => {
    const agent = request.agent(app);
    const added = await agent.post('/api/cart/items').send({ variantId: variantA.id, quantity: 1 });
    const itemId = added.body.data.items[0].id;

    const res = await agent
      .patch(`/api/cart/items/${itemId}`)
      .send({ quantity: variantA.available + 5 });

    expect(res.status).toBe(409);
  });

  it.each([
    ['quantity = 0', 0],
    ['quantity ติดลบ', -2],
    ['quantity ไม่ใช่จำนวนเต็ม', 1.5],
    ['quantity เกิน 99', 100],
  ])('%s → 422', async (_label, quantity) => {
    const res = await request(app)
      .post('/api/cart/items')
      .send({ variantId: variantA.id, quantity });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('VALIDATION_ERROR');
  });

  it('variantId ไม่ใช่ UUID → 422 · variant ที่ไม่มีในระบบ → 404', async () => {
    const bad = await request(app).post('/api/cart/items').send({ variantId: 'abc', quantity: 1 });
    expect(bad.status).toBe(422);

    const missing = await request(app)
      .post('/api/cart/items')
      .send({ variantId: '00000000-0000-4000-8000-000000000000', quantity: 1 });
    expect(missing.status).toBe(404);
  });
});

describe('ความปลอดภัย', () => {
  it('แตะรายการในตะกร้าของคนอื่นไม่ได้ (IDOR) → 404', async () => {
    const victim = request.agent(app);
    const added = await victim
      .post('/api/cart/items')
      .send({ variantId: variantA.id, quantity: 1 });
    const victimItemId = added.body.data.items[0].id;

    const attacker = request.agent(app);
    // ให้ attacker มีตะกร้าของตัวเองก่อน แล้วลองแก้ของเหยื่อ
    await attacker.post('/api/cart/items').send({ variantId: variantB.id, quantity: 1 });

    const update = await attacker.patch(`/api/cart/items/${victimItemId}`).send({ quantity: 9 });
    const remove = await attacker.delete(`/api/cart/items/${victimItemId}`);

    expect(update.status).toBe(404);
    expect(remove.status).toBe(404);

    // ของเหยื่อต้องไม่เปลี่ยน
    const victimCart = await victim.get('/api/cart');
    expect(victimCart.body.data.items[0].quantity).toBe(1);
  });

  it('คำขอเปลี่ยนข้อมูลจาก origin อื่น → 403 (CSRF)', async () => {
    const res = await request(app)
      .post('/api/cart/items')
      .set('Origin', 'http://evil.example.com')
      .send({ variantId: variantA.id, quantity: 1 });

    expect(res.status).toBe(403);
    expect(res.body.errorCode).toBe('FORBIDDEN');
  });

  it('อ่านตะกร้าจาก origin อื่นยังได้ (ไม่เปลี่ยนข้อมูล)', async () => {
    const res = await request(app).get('/api/cart').set('Origin', 'http://evil.example.com');

    expect(res.status).toBe(200);
  });

  it('client ส่งราคามาเองไม่มีผล — ราคามาจากฐานข้อมูล', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/cart/items')
      .send({ variantId: variantA.id, quantity: 1, unitPrice: 1, lineTotal: 1, addedPrice: 1 });

    expect(res.body.data.items[0].unitPrice).toBe(variantA.finalPrice);
    expect(res.body.data.summary.subtotal).toBe(variantA.finalPrice);
  });
});

describe('POST /api/cart/looks/:slug — เพิ่มทั้งชุด', () => {
  it('เพิ่มทุกชิ้นในลุคได้ และยอดรวมตรงกับราคาของลุค', async () => {
    const agent = request.agent(app);
    const look = await request(app).get('/api/looks/campus-day');
    const selections = (look.body.data.items as { variants: (typeof variantA)[] }[]).map(
      (item) => ({
        variantId: item.variants.find((variant) => variant.available > 0)!.id,
        quantity: 1,
      }),
    );

    const res = await agent.post('/api/cart/looks/campus-day').send({ selections });

    expect(res.status).toBe(201);
    expect(res.body.data.addedCount).toBe(selections.length);
    expect(res.body.data.skipped).toEqual([]);
    expect(res.body.data.cart.summary.subtotal).toBe(look.body.data.totalPrice);
  });

  it('variant ที่ไม่อยู่ในลุค → ถูกข้ามพร้อมเหตุผล ไม่ล้มทั้งคำขอ', async () => {
    const agent = request.agent(app);
    const res = await agent
      .post('/api/cart/looks/campus-day')
      .send({ selections: [{ variantId: outsideVariantId, quantity: 1 }] });

    expect(res.status).toBe(200);
    expect(res.body.data.addedCount).toBe(0);
    expect(res.body.data.skipped.length).toBe(1);
    expect(res.body.data.cart.items).toEqual([]);
  });

  it('ลุคที่ไม่มีในระบบ → 404 · selections ว่าง → 422', async () => {
    const missing = await request(app)
      .post('/api/cart/looks/no-such-look')
      .send({ selections: [{ variantId: variantA.id, quantity: 1 }] });
    expect(missing.status).toBe(404);

    const empty = await request(app).post('/api/cart/looks/campus-day').send({ selections: [] });
    expect(empty.status).toBe(422);
  });
});

describe('POST /api/cart/merge — รวมตะกร้า guest เข้าบัญชี', () => {
  it('ต้องล็อกอินก่อน → ไม่ล็อกอินได้ 401', async () => {
    const res = await request(app).post('/api/cart/merge');

    expect(res.status).toBe(401);
  });

  it('รวมของจาก guest เข้าตะกร้าผู้ใช้ แล้วลบตะกร้า guest ทิ้ง', async () => {
    const agent = request.agent(app);

    // ตะกร้าของ guest
    await agent.post('/api/cart/items').send({ variantId: variantA.id, quantity: 2 });
    // ตะกร้าของผู้ใช้ (คนละ agent เพื่อไม่ให้ cookie ปน)
    await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ variantId: variantB.id, quantity: 1 });

    const guestCartsBefore = await prisma.cart.count({ where: { guestToken: { not: null } } });

    const res = await agent.post('/api/cart/merge').set('Authorization', `Bearer ${userToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.mergedCount).toBe(1);
    expect(res.body.data.cart.items.length).toBe(2);
    expect(res.body.data.cart.isGuest).toBe(false);
    expect(await prisma.cart.count({ where: { guestToken: { not: null } } })).toBe(
      guestCartsBefore - 1,
    );
  });

  it('เรียกซ้ำไม่พังและไม่เพิ่มของซ้ำ (idempotent)', async () => {
    const first = await request(app)
      .post('/api/cart/merge')
      .set('Authorization', `Bearer ${userToken}`);
    const second = await request(app)
      .post('/api/cart/merge')
      .set('Authorization', `Bearer ${userToken}`);

    expect(second.status).toBe(200);
    expect(second.body.data.mergedCount).toBe(0);
    expect(second.body.data.cart.summary.totalQuantity).toBe(
      first.body.data.cart.summary.totalQuantity,
    );
  });

  it('ยอดที่รวมแล้วห้ามเกินจำนวนที่มีในคลัง', async () => {
    // เคลียร์ตะกร้าผู้ใช้ก่อน แล้วใส่จนเต็มจำนวนที่มี
    await request(app).delete('/api/cart').set('Authorization', `Bearer ${userToken}`);
    await request(app)
      .post('/api/cart/items')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ variantId: variantA.id, quantity: variantA.available });

    // guest ใส่ของชิ้นเดียวกันอีก
    const agent = request.agent(app);
    await agent.post('/api/cart/items').send({ variantId: variantA.id, quantity: 3 });

    const res = await agent.post('/api/cart/merge').set('Authorization', `Bearer ${userToken}`);

    const merged = res.body.data.cart.items.find(
      (item: { variantId: string }) => item.variantId === variantA.id,
    );
    expect(merged.quantity).toBe(variantA.available);
    expect(res.body.data.clampedCount).toBeGreaterThan(0);
  });
});
