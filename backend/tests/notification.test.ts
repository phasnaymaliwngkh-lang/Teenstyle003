import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { notifyWishlistPriceDrops } from '../src/services/notification.service.ts';

/**
 * Integration test ของการแจ้งเตือน (STEP 24)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - **แถวประกาศของพนักงาน (`userId = null`) ไม่หลุดมาที่ฟีดลูกค้า**
 *     นี่คือข้อที่สำคัญที่สุด เพราะการเตือนสต็อกบอกยอดในคลังและยอดที่ถูกจองไว้
 *   - การแจ้งเตือนของคนอื่นอ่าน/กดอ่านไม่ได้ (IDOR → 404 ไม่ใช่ 403)
 *   - เหตุการณ์จริงสร้างการแจ้งเตือนจริง: สั่งซื้อ · ยกเลิก · ส่งของ · ได้รับของ · ตรวจรีวิว
 *   - **COD ไม่แจ้งว่า "ชำระเงินสำเร็จ" ตอนยืนยันคำสั่งซื้อ** (เงินยังไม่ได้รับ)
 *   - แจ้งซ้ำเรื่องเดิมไม่ได้ (webhook ยิงซ้ำ / แอดมินกดซ้ำ)
 *   - ราคาลด: แจ้งเมื่อถูกลงกว่าตอนกดถูกใจ · ไม่แจ้งซ้ำที่ราคาเดิม · แจ้งใหม่เมื่อลดลงอีก
 *     · ปิดสวิตช์แล้วไม่แจ้ง
 *   - client สร้างการแจ้งเตือนเองไม่ได้ (ไม่มี endpoint)
 *   - คำขอจาก origin อื่นถูกปฏิเสธ (CSRF)
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

let customer = { id: '', token: '' };
let other = { id: '', token: '' };
let admin = { id: '', token: '' };

let product = { id: '', slug: '', name: '', price: 0, originalSalePrice: null as unknown };
const createdOrderIds: string[] = [];
/** แถวประกาศของพนักงานที่เทสต์สร้างขึ้นเอง — ต้องลบใน afterAll */
const staffNotificationIds: string[] = [];

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createUser(role: 'CUSTOMER' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-notif-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });

  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

/**
 * เลขคำสั่งซื้อสำหรับเทสต์
 *
 * ⚠️ ต้องตรงรูปแบบ `TS-\d{8}-\d{4}` ที่ `orderNumberParamsSchema` บังคับ
 *    ไม่งั้นทุก endpoint ที่รับเลขคำสั่งซื้อจะตอบ 422 ก่อนถึงตรรกะที่อยากทดสอบ
 *    ใช้ปี 2999 เพื่อไม่ชนกับเลขจริงที่ `nextOrderNumber()` ออกให้ (ซึ่งใช้วันที่วันนี้)
 */
function testOrderNumber(): string {
  const pad = (max: number) => String(Math.floor(Math.random() * max)).padStart(4, '0');
  return `TS-2999${pad(10000)}-${pad(10000)}`;
}

/** คำสั่งซื้อจริงในฐานข้อมูล (ไม่ผ่าน API เพราะต้องคุมสถานะเองหลายขั้น) */
async function createOrder(userId: string, status: 'PENDING_PAYMENT' | 'SHIPPING' | 'PACKING') {
  const order = await prisma.order.create({
    data: {
      orderNumber: testOrderNumber(),
      userId,
      status,
      paymentStatus: status === 'PENDING_PAYMENT' ? 'PENDING' : 'PAID',
      subtotal: 500,
      total: 500,
      addressSnapshot: { recipientName: 'ผู้รับทดสอบ', province: 'กรุงเทพมหานคร' },
      paidAt: status === 'PENDING_PAYMENT' ? null : new Date(),
      items: {
        create: {
          productId: product.id,
          productName: product.name,
          variantSku: `NOTIF-${suffix}`,
          unitPrice: 500,
          quantity: 1,
          lineTotal: 500,
        },
      },
    },
    select: { id: true, orderNumber: true },
  });

  createdOrderIds.push(order.id);
  return order;
}

function feed(token: string, query: Record<string, string> = {}) {
  return request(app).get('/api/notifications').query(query).set(auth(token));
}

beforeAll(async () => {
  customer = await createUser('CUSTOMER', 'cust');
  other = await createUser('CUSTOMER', 'other');
  admin = await createUser('ADMIN', 'admin');

  const row = await prisma.product.findFirstOrThrow({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { id: true, slug: true, name: true, price: true, salePrice: true },
  });

  product = {
    id: row.id,
    slug: row.slug,
    name: row.name,
    price: Number(String(row.price)),
    originalSalePrice: row.salePrice,
  };
});

afterAll(async () => {
  const userIds = [customer.id, other.id, admin.id];

  // คืนราคาลดของสินค้าให้เป็นค่าเดิม (เทสต์แก้ชั่วคราวเพื่อทดสอบการแจ้งราคาลด)
  await prisma.product.update({
    where: { id: product.id },
    data: { salePrice: product.originalSalePrice as never },
  });

  await prisma.notification.deleteMany({ where: { id: { in: staffNotificationIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.review.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.wishlist.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.orderItem.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

beforeEach(async () => {
  await prisma.notification.deleteMany({ where: { userId: { in: [customer.id, other.id] } } });
});

describe('สิทธิ์และการเข้าถึง', () => {
  it('ยังไม่ล็อกอิน → 401 ทุก endpoint', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
    expect((await request(app).get('/api/notifications/unread-count')).status).toBe(401);
    expect((await request(app).patch('/api/notifications/read-all')).status).toBe(401);
  });

  it('คำขอจาก origin อื่นถูกปฏิเสธ (CSRF)', async () => {
    const res = await request(app)
      .patch('/api/notifications/read-all')
      .set(auth(customer.token))
      .set('Origin', 'https://evil.example.com');

    expect(res.status).toBe(403);
  });

  it('ไม่มี endpoint ให้ client สร้างการแจ้งเตือนเอง', async () => {
    const res = await request(app)
      .post('/api/notifications')
      .set(auth(customer.token))
      .send({ title: 'ร้านโอนเงินคืนคุณแล้ว', body: 'กดลิงก์นี้', type: 'SYSTEM' });

    // 404/405 = ไม่มีเส้นทางนี้ · สิ่งที่ห้ามเกิดคือ 200/201
    expect([404, 405]).toContain(res.status);
  });
});

describe('ประกาศของพนักงานต้องไม่หลุดไปที่ฟีดลูกค้า', () => {
  it('แถว userId = null (เตือนสต็อก) ไม่โผล่ในฟีดของลูกค้า และไม่นับเป็นยังไม่อ่าน', async () => {
    const staffRow = await prisma.notification.create({
      data: {
        userId: null,
        type: 'LOW_STOCK',
        channel: 'IN_APP',
        status: 'SENT',
        sentAt: new Date(),
        title: 'สต็อกเหลือน้อย: ข้อมูลภายในร้าน',
        body: 'ในคลัง 3 ชิ้น ถูกจองไว้ 3 ชิ้น เหลือขายได้ 0 ชิ้น',
        data: { variantId: randomUUID(), severity: 'OUT_OF_STOCK' },
      },
      select: { id: true },
    });
    staffNotificationIds.push(staffRow.id);

    const res = await feed(customer.token, { limit: '50' });

    expect(res.status).toBe(200);
    expect((res.body.data.items as { id: string }[]).some((item) => item.id === staffRow.id)).toBe(
      false,
    );
    expect(JSON.stringify(res.body)).not.toContain('ถูกจองไว้');

    const count = await request(app)
      .get('/api/notifications/unread-count')
      .set(auth(customer.token));
    expect(count.body.data.unreadCount).toBe(0);
  });

  it('กดอ่านแถวประกาศของพนักงานไม่ได้ → 404', async () => {
    const staffRow = await prisma.notification.create({
      data: {
        userId: null,
        type: 'LOW_STOCK',
        channel: 'IN_APP',
        status: 'SENT',
        title: 'สต็อกเหลือน้อย',
        body: 'ภายในร้าน',
        data: {},
      },
      select: { id: true },
    });
    staffNotificationIds.push(staffRow.id);

    const res = await request(app)
      .patch(`/api/notifications/${staffRow.id}/read`)
      .set(auth(customer.token));

    expect(res.status).toBe(404);

    const still = await prisma.notification.findUniqueOrThrow({
      where: { id: staffRow.id },
      select: { readAt: true },
    });
    expect(still.readAt).toBeNull();
  });
});

describe('เหตุการณ์จริงสร้างการแจ้งเตือนจริง', () => {
  it('ลูกค้ายกเลิกคำสั่งซื้อ → ได้การแจ้งเตือนหมวดคำสั่งซื้อพร้อมลิงก์ไปใบนั้น', async () => {
    const order = await createOrder(customer.id, 'PENDING_PAYMENT');

    const cancel = await request(app)
      .post(`/api/orders/${order.orderNumber}/cancel`)
      .set(auth(customer.token));
    expect(cancel.status).toBe(200);

    const res = await feed(customer.token);
    const item = (res.body.data.items as { type: string; link: string; group: string }[])[0];

    expect(item?.type).toBe('ORDER_CANCELLED');
    expect(item?.group).toBe('ORDER');
    expect(item?.link).toBe(`/account/orders/${order.orderNumber}`);
    expect(res.body.data.unreadCount).toBe(1);
  });

  it('ร้านกดส่งของ → แจ้งพร้อมเลขพัสดุจริงที่ร้านกรอก (ไม่ใช่เลขสมมติ)', async () => {
    const order = await createOrder(customer.id, 'PACKING');

    const res = await request(app)
      .patch(`/api/admin/orders/${order.orderNumber}/status`)
      .set(auth(admin.token))
      .send({ status: 'SHIPPING', carrier: 'Kerry Express', trackingNumber: 'KE123456789TH' });
    expect(res.status).toBe(200);

    const feedRes = await feed(customer.token);
    const item = (feedRes.body.data.items as { type: string; body: string }[])[0];

    expect(item?.type).toBe('SHIPPING');
    expect(item?.body).toContain('KE123456789TH');
    expect(item?.body).toContain('Kerry Express');
  });

  it('ร้านกดได้รับสินค้าแล้ว → แจ้งของถึง + แจ้งว่าได้รับเงิน COD', async () => {
    const order = await createOrder(customer.id, 'SHIPPING');
    // COD: ยังไม่ได้รับเงินก่อนส่งถึง
    await prisma.order.update({
      where: { id: order.id },
      data: { paymentStatus: 'PENDING' },
    });

    const res = await request(app)
      .patch(`/api/admin/orders/${order.orderNumber}/status`)
      .set(auth(admin.token))
      .send({ status: 'DELIVERED' });
    expect(res.status).toBe(200);

    const feedRes = await feed(customer.token, { limit: '50' });
    const types = (feedRes.body.data.items as { type: string }[]).map((item) => item.type);

    expect(types).toContain('DELIVERED');
    expect(types).toContain('PAYMENT_SUCCESS');
  });

  it('ยืนยัน COD → แจ้งว่ายืนยันคำสั่งซื้อ ไม่ใช่ "ชำระเงินสำเร็จ"', async () => {
    const order = await createOrder(customer.id, 'PENDING_PAYMENT');

    const pay = await request(app)
      .post(`/api/orders/${order.orderNumber}/pay`)
      .set(auth(customer.token))
      .send({ provider: 'COD' });
    expect(pay.status).toBe(200);

    const feedRes = await feed(customer.token, { limit: '50' });
    const items = feedRes.body.data.items as { type: string; title: string }[];

    expect(items.some((item) => item.type === 'ORDER_UPDATE')).toBe(true);
    // เงินปลายทางยังไม่ได้รับ — ห้ามแจ้งว่าได้รับชำระเงินแล้ว (กฎ STEP 11 ข้อ 2)
    expect(items.some((item) => item.type === 'PAYMENT_SUCCESS')).toBe(false);
  });

  it('แจ้งเรื่องเดิมซ้ำไม่ได้ — กดเปลี่ยนสถานะเป็นค่าเดิมซ้ำก็ไม่เพิ่มแถว', async () => {
    const order = await createOrder(customer.id, 'PACKING');

    await request(app)
      .patch(`/api/admin/orders/${order.orderNumber}/status`)
      .set(auth(admin.token))
      .send({ status: 'SHIPPING', carrier: 'Flash', trackingNumber: 'FL999888777TH' });

    // ยิงซ้ำ — state machine ปฏิเสธ (SHIPPING → SHIPPING ไม่ได้) จึงต้องไม่มีแถวใหม่
    await request(app)
      .patch(`/api/admin/orders/${order.orderNumber}/status`)
      .set(auth(admin.token))
      .send({ status: 'SHIPPING', carrier: 'Flash', trackingNumber: 'FL999888777TH' });

    const count = await prisma.notification.count({
      where: { userId: customer.id, type: 'SHIPPING' },
    });
    expect(count).toBe(1);
  });

  it('ผลการตรวจรีวิวถึงเจ้าของรีวิว และลิงก์ไปหน้ารีวิวของฉัน', async () => {
    // ต้องมีคำสั่งซื้อที่ส่งถึงแล้วก่อน จึงจะเขียนรีวิวได้ (กฎ STEP 23)
    const order = await createOrder(customer.id, 'SHIPPING');
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'DELIVERED', deliveredAt: new Date() },
    });

    const created = await request(app).post('/api/reviews').set(auth(customer.token)).send({
      productId: product.id,
      rating: 5,
      comment: 'ของดีมากครับ ใส่สบาย ผ้าไม่ร้อน แนะนำเลย',
    });
    expect(created.status).toBe(201);

    await prisma.notification.deleteMany({ where: { userId: customer.id } });

    const moderate = await request(app)
      .patch(`/api/admin/reviews/${created.body.data.review.id}/status`)
      .set(auth(admin.token))
      .send({ status: 'HIDDEN', adminNote: 'ข้อความไม่เกี่ยวกับสินค้า' });
    expect(moderate.status).toBe(200);

    const feedRes = await feed(customer.token);
    const item = (
      feedRes.body.data.items as { type: string; group: string; body: string; link: string }[]
    )[0];

    expect(item?.type).toBe('REVIEW_UPDATE');
    expect(item?.group).toBe('REVIEW');
    expect(item?.link).toBe('/account/reviews');
    // เจ้าของต้องรู้เหตุผล ไม่ใช่ให้รีวิวหายไปเงียบ ๆ
    expect(item?.body).toContain('ข้อความไม่เกี่ยวกับสินค้า');
  });
});

describe('แจ้งเตือนราคาลดของรายการที่ถูกใจ', () => {
  async function wish(userId: string, notify = true) {
    await prisma.wishlist.deleteMany({ where: { userId, productId: product.id } });
    await prisma.wishlist.create({
      data: {
        userId,
        productId: product.id,
        priceWhenAdded: product.price,
        notifyOnPriceDrop: notify,
      },
    });
  }

  async function setSalePrice(value: number | null) {
    await prisma.product.update({
      where: { id: product.id },
      data: { salePrice: value },
    });
  }

  it('ราคาถูกลงกว่าตอนกดถูกใจ → แจ้ง 1 ครั้ง · เรียกซ้ำที่ราคาเดิมไม่แจ้งอีก', async () => {
    await wish(customer.id);
    await setSalePrice(product.price - 100);

    expect(await notifyWishlistPriceDrops([product.id])).toBe(1);
    expect(await notifyWishlistPriceDrops([product.id])).toBe(0);

    const rows = await prisma.notification.findMany({
      where: { userId: customer.id, type: 'PRICE_DROP' },
      select: { body: true, data: true },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.body).toContain('ถูกลง');
    expect((rows[0]?.data as { notifiedPrice: number }).notifiedPrice).toBe(product.price - 100);
  });

  it('ลดลงอีกรอบ → แจ้งใหม่ · ปรับขึ้นแล้วลงกลับที่เดิม → เงียบ', async () => {
    await wish(customer.id);
    await setSalePrice(product.price - 100);
    await notifyWishlistPriceDrops([product.id]);

    // ขึ้นกลับไปใกล้ราคาเดิม (ยังต่ำกว่าตอนกดถูกใจ) → ไม่ใช่ข่าวดีใหม่ จึงต้องเงียบ
    await setSalePrice(product.price - 50);
    expect(await notifyWishlistPriceDrops([product.id])).toBe(0);

    // ลดลงกว่าครั้งที่แจ้งไปแล้ว → แจ้งใหม่
    await setSalePrice(product.price - 200);
    expect(await notifyWishlistPriceDrops([product.id])).toBe(1);

    const count = await prisma.notification.count({
      where: { userId: customer.id, type: 'PRICE_DROP' },
    });
    expect(count).toBe(2);
  });

  it('ปิดสวิตช์ "เตือนเมื่อลดราคา" แล้วไม่แจ้ง', async () => {
    await wish(customer.id, false);
    await setSalePrice(product.price - 300);

    expect(await notifyWishlistPriceDrops([product.id])).toBe(0);

    const count = await prisma.notification.count({
      where: { userId: customer.id, type: 'PRICE_DROP' },
    });
    expect(count).toBe(0);
  });

  it('ราคาแพงขึ้นไม่แจ้ง', async () => {
    await wish(customer.id);
    await setSalePrice(null); // กลับไปใช้ราคาปกติ = ไม่ถูกลง

    expect(await notifyWishlistPriceDrops([product.id])).toBe(0);
  });

  it('แจ้งเฉพาะเจ้าของรายการที่ถูกใจ ไม่ข้ามไปหาคนอื่น', async () => {
    await wish(customer.id);
    await setSalePrice(product.price - 120);

    await notifyWishlistPriceDrops([product.id]);

    const mine = await prisma.notification.count({
      where: { userId: customer.id, type: 'PRICE_DROP' },
    });
    const theirs = await prisma.notification.count({
      where: { userId: other.id, type: 'PRICE_DROP' },
    });

    expect(mine).toBe(1);
    expect(theirs).toBe(0);
  });
});

describe('อ่านและกรองฟีด', () => {
  async function seedFor(userId: string) {
    await prisma.notification.createMany({
      data: [
        {
          userId,
          type: 'ORDER_CREATED',
          channel: 'IN_APP',
          status: 'SENT',
          title: 'คำสั่งซื้อ',
          body: 'เรื่องคำสั่งซื้อ',
          data: { orderNumber: 'TS-X' },
        },
        {
          userId,
          type: 'PRICE_DROP',
          channel: 'IN_APP',
          status: 'SENT',
          title: 'ราคาลด',
          body: 'เรื่องราคา',
          data: { productSlug: 'a-slug' },
        },
      ],
    });
  }

  it('กรองตามหมวดได้ และตัวเลขยังไม่อ่านนับจากทั้งฟีดไม่ใช่แค่ผลที่กรอง', async () => {
    await seedFor(customer.id);

    const res = await feed(customer.token, { group: 'PRICE' });

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].group).toBe('PRICE');
    // ยังไม่อ่านทั้งฟีด = 2 แม้กรองเหลือ 1 (กระดิ่งต้องแสดงเลขเดียวกันทุกหน้า)
    expect(res.body.data.unreadCount).toBe(2);
  });

  it('กดอ่านรายการเดียว · กดซ้ำไม่ error · อ่านทั้งหมดแล้วเหลือ 0', async () => {
    await seedFor(customer.id);

    const list = await feed(customer.token);
    const first = (list.body.data.items as { id: string }[])[0]!;

    const read = await request(app)
      .patch(`/api/notifications/${first.id}/read`)
      .set(auth(customer.token));
    expect(read.status).toBe(200);
    expect(read.body.data.isRead).toBe(true);

    const again = await request(app)
      .patch(`/api/notifications/${first.id}/read`)
      .set(auth(customer.token));
    expect(again.status).toBe(200);

    const afterOne = await request(app)
      .get('/api/notifications/unread-count')
      .set(auth(customer.token));
    expect(afterOne.body.data.unreadCount).toBe(1);

    const all = await request(app).patch('/api/notifications/read-all').set(auth(customer.token));
    expect(all.body.data.updated).toBe(1);

    const afterAllRead = await request(app)
      .get('/api/notifications/unread-count')
      .set(auth(customer.token));
    expect(afterAllRead.body.data.unreadCount).toBe(0);
  });

  it('เห็นแต่ของตัวเอง · กดอ่านของคนอื่นได้ 404 และแถวนั้นยังไม่ถูกอ่าน', async () => {
    await seedFor(other.id);

    const mine = await feed(customer.token);
    expect(mine.body.data.total).toBe(0);

    const theirs = await prisma.notification.findFirstOrThrow({
      where: { userId: other.id },
      select: { id: true },
    });

    const res = await request(app)
      .patch(`/api/notifications/${theirs.id}/read`)
      .set(auth(customer.token));
    expect(res.status).toBe(404);

    const still = await prisma.notification.findUniqueOrThrow({
      where: { id: theirs.id },
      select: { readAt: true },
    });
    expect(still.readAt).toBeNull();
  });

  it('ทุกแถวที่ระบบสร้างเป็นช่องทาง IN_APP เท่านั้น (ไม่สร้างแถวอีเมลที่ส่งไม่ได้จริง)', async () => {
    const order = await createOrder(customer.id, 'PENDING_PAYMENT');
    await request(app).post(`/api/orders/${order.orderNumber}/cancel`).set(auth(customer.token));

    const rows = await prisma.notification.findMany({
      where: { userId: customer.id },
      select: { channel: true, status: true, sentAt: true },
    });

    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.channel === 'IN_APP')).toBe(true);
    expect(rows.every((row) => row.status === 'SENT' && row.sentAt !== null)).toBe(true);
  });
});
