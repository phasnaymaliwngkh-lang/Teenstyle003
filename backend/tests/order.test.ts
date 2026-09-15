import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของ Checkout + Order (STEP 10)
 *
 * ใช้ฐานข้อมูลจริง สร้างผู้ใช้ทดสอบ 2 คน (A, B) แล้วลบทุกอย่างที่สร้างขึ้นใน afterAll
 * รวมถึง **คืนค่า reservedQuantity ของทุก variant ที่แตะ** ให้เป็นค่าเดิม
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - ยอดเงินทุกบาทคำนวณที่ server (client ส่งราคามาไม่มีผล)
 *   - จองสต็อก ไม่ตัดสต็อก · ห้าม oversell แม้สั่งพร้อมกัน
 *   - idempotencyKey เดิม → ออเดอร์เดิม ไม่จองซ้ำ
 *   - ตะกร้าถูกเคลียร์เฉพาะรายการที่สั่ง
 *   - ดูออเดอร์ของคนอื่นไม่ได้ · ต้องล็อกอิน · กัน CSRF
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

interface TestUser {
  id: string;
  token: string;
}

let userA: TestUser = { id: '', token: '' };
let userB: TestUser = { id: '', token: '' };

let teeVariant = { id: '', available: 0, finalPrice: 0, sku: '' };
let hatVariant = { id: '', available: 0, finalPrice: 0, sku: '' };
let jeansVariant = { id: '', available: 0, finalPrice: 0, sku: '' };

const touchedVariantIds = new Set<string>();

const BANGKOK_ADDRESS = {
  recipientName: 'ผู้รับทดสอบ',
  phone: '0812345678',
  line1: '1 ซอยทดสอบ',
  subDistrict: 'สีลม',
  district: 'บางรัก',
  province: 'กรุงเทพมหานคร',
  postalCode: '10500',
  saveForLater: false,
};

const UPCOUNTRY_ADDRESS = { ...BANGKOK_ADDRESS, province: 'เชียงใหม่', postalCode: '50000' };

async function createUser(label: string): Promise<TestUser> {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  const user = await prisma.user.create({
    data: { email: `test-order-${label}-${suffix}@teenstyle.test`, roleId: role.id },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

function auth(user: TestUser) {
  return { Authorization: `Bearer ${user.token}` };
}

async function addToCart(user: TestUser, variantId: string, quantity: number): Promise<void> {
  touchedVariantIds.add(variantId);
  const res = await request(app)
    .post('/api/cart/items')
    .set(auth(user))
    .send({ variantId, quantity });

  expect(res.status).toBe(201);
}

function placeOrder(user: TestUser, body: Record<string, unknown>) {
  return request(app)
    .post('/api/orders')
    .set(auth(user))
    .send({ idempotencyKey: randomUUID(), shippingMethod: 'STANDARD', ...body });
}

async function variantOf(slug: string) {
  const res = await request(app).get(`/api/products/${slug}`);
  const variant = (res.body.data.variants as (typeof teeVariant)[]).find(
    (item) => item.available > 0,
  );

  return variant!;
}

beforeAll(async () => {
  userA = await createUser('a');
  userB = await createUser('b');

  teeVariant = await variantOf('oversize-cotton-tee');
  hatVariant = await variantOf('canvas-bucket-hat');
  jeansVariant = await variantOf('baggy-jeans');
});

afterEach(async () => {
  // ล้างตะกร้าของผู้ใช้ทดสอบระหว่างเคส เพื่อไม่ให้ของค้างข้ามเคส
  await prisma.cartItem.deleteMany({
    where: { cart: { userId: { in: [userA.id, userB.id] } } },
  });
});

afterAll(async () => {
  const userIds = [userA.id, userB.id];

  await prisma.order.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.address.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });

  // คืนสต็อกที่จองไว้ระหว่างทดสอบ (ไม่มีออเดอร์จริงเหลืออยู่แล้ว)
  await prisma.inventory.updateMany({
    where: { variantId: { in: [...touchedVariantIds] } },
    data: { reservedQuantity: 0 },
  });

  await disconnectDatabase();
});

describe('GET /api/checkout/summary', () => {
  it('ไม่ล็อกอิน → 401', async () => {
    const res = await request(app).get('/api/checkout/summary');

    expect(res.status).toBe(401);
  });

  it('คิดยอดและค่าจัดส่งที่ server', async () => {
    await addToCart(userA, teeVariant.id, 2);

    const res = await request(app).get('/api/checkout/summary').set(auth(userA));

    expect(res.status).toBe(200);
    expect(res.body.data.subtotal).toBe(teeVariant.finalPrice * 2);
    // STANDARD = 50 บาท เมื่อยอดยังไม่ถึงเกณฑ์ส่งฟรี
    expect(res.body.data.shippingFee).toBe(50);
    expect(res.body.data.total).toBe(teeVariant.finalPrice * 2 + 50);
    expect(res.body.data.checkoutReady).toBe(true);
  });

  it('ยอดถึงเกณฑ์ → ส่งธรรมดาฟรี (กฎเดียวกับที่ใช้คิดเงินจริง)', async () => {
    await addToCart(userA, teeVariant.id, 3);
    await addToCart(userA, jeansVariant.id, 1);

    const res = await request(app).get('/api/checkout/summary').set(auth(userA));
    const standard = res.body.data.shippingOptions.find(
      (option: { code: string }) => option.code === 'STANDARD',
    );

    expect(res.body.data.subtotal).toBeGreaterThanOrEqual(1000);
    expect(standard.fee).toBe(0);
  });

  it('ตะกร้าว่าง → ยังไม่พร้อมสั่งซื้อ พร้อมบอกเหตุผล', async () => {
    const res = await request(app).get('/api/checkout/summary').set(auth(userA));

    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.checkoutReady).toBe(false);
    expect(res.body.data.blockers.length).toBeGreaterThan(0);
  });

  it('ตัวเลือกจัดส่งทุกแบบมีค่าส่งและเวลาที่ชัดเจน', async () => {
    const res = await request(app).get('/api/checkout/summary').set(auth(userA));

    expect(res.body.data.shippingOptions.length).toBe(4);
    for (const option of res.body.data.shippingOptions) {
      expect(typeof option.fee).toBe('number');
      expect(option.etaText.length).toBeGreaterThan(0);
    }
  });
});

describe('POST /api/orders', () => {
  it('สร้างคำสั่งซื้อ: ยอดจาก server · snapshot ครบ · ตะกร้าถูกเคลียร์ · สต็อกถูกจอง (ไม่ตัด)', async () => {
    await addToCart(userA, teeVariant.id, 2);

    const before = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: teeVariant.id },
      select: { quantity: true, reservedQuantity: true },
    });

    const res = await placeOrder(userA, { newAddress: BANGKOK_ADDRESS });

    expect(res.status).toBe(201);
    expect(res.body.data.orderNumber).toMatch(/^TS-\d{8}-\d{4}$/);
    expect(res.body.data.status).toBe('PENDING_PAYMENT');
    expect(res.body.data.paymentStatus).toBe('PENDING');
    expect(res.body.data.subtotal).toBe(teeVariant.finalPrice * 2);
    expect(res.body.data.shippingFee).toBe(50);
    expect(res.body.data.total).toBe(teeVariant.finalPrice * 2 + 50);

    // snapshot ของสินค้าและที่อยู่
    const item = res.body.data.items[0];
    expect(item.variantSku).toBe(teeVariant.sku);
    expect(item.unitPrice).toBe(teeVariant.finalPrice);
    expect(item.lineTotal).toBe(teeVariant.finalPrice * 2);
    expect(res.body.data.address.province).toBe(BANGKOK_ADDRESS.province);
    expect(res.body.data.address.recipientName).toBe(BANGKOK_ADDRESS.recipientName);

    // สต็อก: จองเพิ่ม 2 แต่ quantity ไม่เปลี่ยน
    const after = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: teeVariant.id },
      select: { quantity: true, reservedQuantity: true },
    });
    expect(after.quantity).toBe(before.quantity);
    expect(after.reservedQuantity).toBe(before.reservedQuantity + 2);

    // ยังไม่มี InventoryMovement ของ "ออเดอร์ใบนี้" เพราะยังไม่ตัดสต็อก (ตัดตอนชำระเงิน STEP 11)
    const order = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: res.body.data.orderNumber },
      select: { id: true },
    });
    const movements = await prisma.inventoryMovement.count({
      where: { referenceType: 'ORDER', referenceId: order.id },
    });
    expect(movements).toBe(0);

    // ตะกร้าว่างแล้ว
    const cart = await request(app).get('/api/cart').set(auth(userA));
    expect(cart.body.data.items).toEqual([]);
  });

  it('สั่งเฉพาะรายการที่ติ๊กไว้ — รายการที่ไม่ติ๊กยังอยู่ในตะกร้า', async () => {
    await addToCart(userA, teeVariant.id, 1);
    await addToCart(userA, hatVariant.id, 1);

    const cart = await request(app).get('/api/cart').set(auth(userA));
    const hatItem = cart.body.data.items.find(
      (item: { variantId: string }) => item.variantId === hatVariant.id,
    );
    await request(app)
      .patch(`/api/cart/items/${hatItem.id}/select`)
      .set(auth(userA))
      .send({ selected: false });

    const res = await placeOrder(userA, { newAddress: BANGKOK_ADDRESS });

    expect(res.status).toBe(201);
    expect(res.body.data.itemCount).toBe(1);

    const remaining = await request(app).get('/api/cart').set(auth(userA));
    expect(remaining.body.data.items.length).toBe(1);
    expect(remaining.body.data.items[0].variantId).toBe(hatVariant.id);
  });

  it('idempotencyKey เดิม → ได้ออเดอร์เดิม ไม่สร้างใหม่ ไม่จองสต็อกซ้ำ', async () => {
    await addToCart(userA, teeVariant.id, 1);

    const key = randomUUID();
    const body = {
      idempotencyKey: key,
      shippingMethod: 'STANDARD',
      newAddress: BANGKOK_ADDRESS,
    };

    const first = await request(app).post('/api/orders').set(auth(userA)).send(body);
    const reservedAfterFirst = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: teeVariant.id },
      select: { reservedQuantity: true },
    });

    const second = await request(app).post('/api/orders').set(auth(userA)).send(body);
    const reservedAfterSecond = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: teeVariant.id },
      select: { reservedQuantity: true },
    });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.data.orderNumber).toBe(first.body.data.orderNumber);
    expect(reservedAfterSecond.reservedQuantity).toBe(reservedAfterFirst.reservedQuantity);

    const count = await prisma.order.count({ where: { idempotencyKey: key } });
    expect(count).toBe(1);
  });

  it('ของไม่พอตอนกดสั่ง → 409 และไม่มีออเดอร์เกิดขึ้น', async () => {
    await addToCart(userA, hatVariant.id, 2);

    // มีคนอื่นจองไปหมดก่อน
    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: hatVariant.id },
      select: { quantity: true, reservedQuantity: true },
    });
    await prisma.inventory.update({
      where: { variantId: hatVariant.id },
      data: { reservedQuantity: inventory.quantity },
    });

    const ordersBefore = await prisma.order.count({ where: { userId: userA.id } });
    const res = await placeOrder(userA, { newAddress: BANGKOK_ADDRESS });
    const ordersAfter = await prisma.order.count({ where: { userId: userA.id } });

    expect(res.status).toBe(409);
    expect(res.body.errorCode).toBe('CONFLICT');
    expect(ordersAfter).toBe(ordersBefore);

    await prisma.inventory.update({
      where: { variantId: hatVariant.id },
      data: { reservedQuantity: inventory.reservedQuantity },
    });
  });

  it('สั่งพร้อมกันแย่งชิ้นสุดท้าย → สำเร็จแค่รายเดียว และสต็อกไม่ติดลบ', async () => {
    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: jeansVariant.id },
      select: { quantity: true, reservedQuantity: true },
    });

    // เหลือให้แย่งกันชิ้นเดียว
    await prisma.inventory.update({
      where: { variantId: jeansVariant.id },
      data: { reservedQuantity: inventory.quantity - 1 },
    });

    await addToCart(userA, jeansVariant.id, 1);
    await addToCart(userB, jeansVariant.id, 1);

    const [resA, resB] = await Promise.all([
      placeOrder(userA, { newAddress: BANGKOK_ADDRESS }),
      placeOrder(userB, { newAddress: BANGKOK_ADDRESS }),
    ]);

    const statuses = [resA.status, resB.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const after = await prisma.inventory.findUniqueOrThrow({
      where: { variantId: jeansVariant.id },
      select: { quantity: true, reservedQuantity: true },
    });
    expect(after.reservedQuantity).toBeLessThanOrEqual(after.quantity);
    expect(after.reservedQuantity).toBe(inventory.quantity);

    await prisma.inventory.update({
      where: { variantId: jeansVariant.id },
      data: { reservedQuantity: inventory.reservedQuantity },
    });
  });

  it('สินค้าถูกปิดขายหลังหยิบใส่ตะกร้า → 409', async () => {
    await addToCart(userA, hatVariant.id, 1);

    const variant = await prisma.productVariant.findUniqueOrThrow({
      where: { id: hatVariant.id },
      select: { productId: true },
    });
    await prisma.product.update({
      where: { id: variant.productId },
      data: { status: 'DRAFT' },
    });

    const res = await placeOrder(userA, { newAddress: BANGKOK_ADDRESS });

    await prisma.product.update({
      where: { id: variant.productId },
      data: { status: 'ACTIVE' },
    });

    expect(res.status).toBe(409);
  });

  it('ราคาที่ client แนบมาต้องถูกเมิน', async () => {
    await addToCart(userA, teeVariant.id, 1);

    const res = await placeOrder(userA, {
      newAddress: BANGKOK_ADDRESS,
      subtotal: 1,
      shippingFee: 0,
      total: 1,
      items: [{ productName: 'ของปลอม', unitPrice: 1, quantity: 99 }],
    });

    expect(res.status).toBe(201);
    expect(res.body.data.subtotal).toBe(teeVariant.finalPrice);
    expect(res.body.data.total).toBe(teeVariant.finalPrice + 50);
    expect(res.body.data.itemCount).toBe(1);
    expect(res.body.data.items[0].productName).not.toBe('ของปลอม');
  });

  it('วิธีจัดส่งที่จำกัดพื้นที่ → ใช้กับต่างจังหวัดไม่ได้ (400)', async () => {
    await addToCart(userA, teeVariant.id, 1);

    const res = await placeOrder(userA, {
      newAddress: UPCOUNTRY_ADDRESS,
      shippingMethod: 'SAME_DAY',
    });

    expect(res.status).toBe(400);
  });

  it('รับที่ร้าน → ค่าจัดส่ง 0', async () => {
    await addToCart(userA, teeVariant.id, 1);

    const res = await placeOrder(userA, {
      newAddress: BANGKOK_ADDRESS,
      shippingMethod: 'PICKUP',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.shippingFee).toBe(0);
    expect(res.body.data.total).toBe(teeVariant.finalPrice);
  });

  it('ตะกร้าว่าง → 400', async () => {
    const res = await placeOrder(userA, { newAddress: BANGKOK_ADDRESS });

    expect(res.status).toBe(400);
  });

  it('ใช้ addressId ของคนอื่น → 404', async () => {
    await addToCart(userB, teeVariant.id, 1);
    const orderB = await placeOrder(userB, {
      newAddress: { ...BANGKOK_ADDRESS, saveForLater: true },
    });
    expect(orderB.status).toBe(201);

    const addressOfB = await prisma.address.findFirstOrThrow({
      where: { userId: userB.id },
      select: { id: true },
    });

    await addToCart(userA, teeVariant.id, 1);
    const res = await placeOrder(userA, { addressId: addressOfB.id });

    expect(res.status).toBe(404);
  });

  it.each([
    ['ไม่ส่งที่อยู่มาเลย', { shippingMethod: 'STANDARD' }],
    ['รหัสไปรษณีย์ผิดรูปแบบ', { newAddress: { ...BANGKOK_ADDRESS, postalCode: '123' } }],
    ['เบอร์โทรมีอักขระแปลก', { newAddress: { ...BANGKOK_ADDRESS, phone: 'โทรหน่อย' } }],
    ['วิธีจัดส่งไม่มีในระบบ', { newAddress: BANGKOK_ADDRESS, shippingMethod: 'TELEPORT' }],
  ])('%s → 422', async (_label, body) => {
    const res = await request(app)
      .post('/api/orders')
      .set(auth(userA))
      .send({ idempotencyKey: randomUUID(), shippingMethod: 'STANDARD', ...body });

    expect(res.status).toBe(422);
  });

  it('idempotencyKey ไม่ใช่ UUID → 422', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set(auth(userA))
      .send({ idempotencyKey: 'abc', shippingMethod: 'STANDARD', newAddress: BANGKOK_ADDRESS });

    expect(res.status).toBe(422);
  });

  it('ไม่ล็อกอิน → 401 · origin อื่น → 403', async () => {
    const unauthenticated = await request(app).post('/api/orders').send({
      idempotencyKey: randomUUID(),
      shippingMethod: 'STANDARD',
      newAddress: BANGKOK_ADDRESS,
    });
    expect(unauthenticated.status).toBe(401);

    const crossSite = await request(app)
      .post('/api/orders')
      .set(auth(userA))
      .set('Origin', 'http://evil.example.com')
      .send({
        idempotencyKey: randomUUID(),
        shippingMethod: 'STANDARD',
        newAddress: BANGKOK_ADDRESS,
      });
    expect(crossSite.status).toBe(403);
  });
});

describe('GET /api/orders/:orderNumber', () => {
  it('ดูออเดอร์ของตัวเองได้', async () => {
    await addToCart(userA, teeVariant.id, 1);
    const created = await placeOrder(userA, { newAddress: BANGKOK_ADDRESS });

    const res = await request(app)
      .get(`/api/orders/${created.body.data.orderNumber}`)
      .set(auth(userA));

    expect(res.status).toBe(200);
    expect(res.body.data.orderNumber).toBe(created.body.data.orderNumber);
    expect(res.body.data.items.length).toBe(1);
  });

  it('ดูออเดอร์ของคนอื่นไม่ได้ → 404', async () => {
    await addToCart(userA, teeVariant.id, 1);
    const created = await placeOrder(userA, { newAddress: BANGKOK_ADDRESS });

    const res = await request(app)
      .get(`/api/orders/${created.body.data.orderNumber}`)
      .set(auth(userB));

    expect(res.status).toBe(404);
  });

  it('เลขคำสั่งซื้อผิดรูปแบบ → 422 · ไม่มีจริง → 404', async () => {
    const malformed = await request(app).get('/api/orders/not-an-order').set(auth(userA));
    expect(malformed.status).toBe(422);

    const missing = await request(app).get('/api/orders/TS-19990101-9999').set(auth(userA));
    expect(missing.status).toBe(404);
  });

  it('ไม่ล็อกอิน → 401', async () => {
    const res = await request(app).get('/api/orders/TS-20260101-0001');

    expect(res.status).toBe(401);
  });
});
