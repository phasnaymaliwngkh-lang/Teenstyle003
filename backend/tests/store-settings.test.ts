import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { buildOrderNumber } from '../src/models/order.model.ts';
import { getStorePolicyContent } from '../src/services/ai-cs.service.ts';
import { searchArticles } from '../src/services/knowledge-base.service.ts';

/**
 * การตั้งค่าร้าน (STEP 49)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - สิทธิ์: หน้าร้านอ่านได้ทุกคน · ดู/แก้ในหลังบ้าน = settings:manage (พนักงานไม่มี)
 *   - แก้เฉพาะช่องที่เปลี่ยน · AdminLog before/after คีย์เดียวกัน · ไม่มีอะไรเปลี่ยน = ไม่เขียน log
 *   - ค่าที่ไม่จริงเข้าไม่ได้: ลิงก์โซเชียลที่เป็นหน้าแรกของแพลตฟอร์ม/โดเมนอื่น/http · เบอร์ผิดรูป ·
 *     เวลาตัดรอบผิด · วันคืนนอกขอบเขต · COD 0 · คำอธิบายที่มีจำนวนเงิน · สตริงว่างแทน null
 *   - **ค่าชุดเดียวทุกที่**: หน้าร้าน · บทความคลังความรู้ (ตัวแปร) · AI · ช่องทางชำระเงิน · สิทธิ์คืนสินค้า
 *   - จำนวนวันที่คืนได้: คำสั่งซื้อใหม่ snapshot ค่าตอนสั่ง · ใบเดิมใช้ค่าที่ยาวกว่า (ลดวันไม่ตัดสิทธิ์ย้อนหลัง)
 *
 * ⚠️ แถวการตั้งค่าร้านเป็นของจริงที่ใช้ร่วมกันทั้งระบบ — จดค่าเดิมใน beforeAll แล้วคืนใน afterAll
 *    (บทเรียนเดียวกับอัตราค่าส่งของ STEP 44 · ทำได้เพราะ fileParallelism: false)
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

let admin = { id: '', token: '' };
let employee = { id: '', token: '' };
let customer = { id: '', token: '' };

let original: Awaited<ReturnType<typeof prisma.storeSetting.findUniqueOrThrow>>;
const createdOrderIds: string[] = [];

async function createUser(role: 'CUSTOMER' | 'EMPLOYEE' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-settings-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, token };
}

/** เลขรูปแบบจริง (เส้นทางของลูกค้าตรวจรูปแบบ) แต่เป็นปี 2098 — ไม่ชนกับคำสั่งซื้อจริง */
function testOrderNumber(): string {
  return buildOrderNumber(
    new Date(2098, 0, 1 + Math.floor(Math.random() * 28)),
    Math.floor(Math.random() * 10_000),
  );
}

function patch(body: object, token = admin.token) {
  return request(app).patch('/api/admin/settings').set(auth(token)).send(body);
}

async function setSettings(body: object): Promise<void> {
  const res = await patch(body);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

/** คำสั่งซื้อที่ได้รับของแล้ว (จ่ายแล้ว) — ไม่ผ่านการจองสต็อก จึงไม่มีอะไรต้องคืนคลัง */
async function deliveredOrder(input: { daysAgo: number; returnWindowDays: number }) {
  const variant = await prisma.productVariant.findFirstOrThrow({
    where: { deletedAt: null, isActive: true, product: { status: 'ACTIVE', deletedAt: null } },
    select: { id: true, sku: true, productId: true, product: { select: { name: true } } },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber: testOrderNumber(),
      returnWindowDays: input.returnWindowDays,
      userId: customer.id,
      status: 'DELIVERED',
      paymentStatus: 'PAID',
      subtotal: 390,
      total: 390,
      paidAt: new Date(Date.now() - (input.daysAgo + 2) * 86_400_000),
      deliveredAt: new Date(Date.now() - input.daysAgo * 86_400_000),
      addressSnapshot: { recipientName: 'ผู้รับทดสอบ' },
      items: {
        create: {
          productId: variant.productId,
          variantId: variant.id,
          productName: variant.product.name,
          variantSku: variant.sku,
          unitPrice: 390,
          quantity: 1,
          lineTotal: 390,
        },
      },
    },
    select: { id: true, orderNumber: true },
  });
  createdOrderIds.push(order.id);

  return order;
}

beforeAll(async () => {
  original = await prisma.storeSetting.findUniqueOrThrow({ where: { id: 1 } });
  admin = await createUser('ADMIN', 'admin');
  employee = await createUser('EMPLOYEE', 'employee');
  customer = await createUser('CUSTOMER', 'customer');
});

afterAll(async () => {
  const userIds = [admin.id, employee.id, customer.id];

  try {
    const { id: _id, updatedAt: _updatedAt, ...values } = original;
    await prisma.storeSetting.update({ where: { id: 1 }, data: values });
  } finally {
    // คำสั่งซื้อที่สั่งผ่าน API จองของไว้ — คืนการจองก่อนลบแถว (บทเรียน STEP 41)
    const pending = await prisma.orderItem.findMany({
      where: { order: { userId: customer.id, status: 'PENDING_PAYMENT' } },
      select: { variantId: true, quantity: true },
    });
    for (const item of pending) {
      if (item.variantId === null) continue;
      await prisma.inventory.update({
        where: { variantId: item.variantId },
        data: { reservedQuantity: { decrement: item.quantity } },
      });
    }

    await prisma.order.deleteMany({ where: { userId: customer.id } });
    await prisma.address.deleteMany({ where: { userId: customer.id } });
    await prisma.cart.deleteMany({ where: { userId: customer.id } });
    await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.adminLog.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await disconnectDatabase();
  }
});

describe('สิทธิ์', () => {
  it('หน้าร้านอ่านได้ทุกคน · หลังบ้านต้องล็อกอินและมี settings:manage (พนักงานไม่มี)', async () => {
    const store = await request(app).get('/api/store');
    expect(store.status).toBe(200);
    expect(store.body.data.contactChannels[0].value).toBe('/customer-service');

    expect((await request(app).get('/api/admin/settings')).status).toBe(401);
    expect((await request(app).get('/api/admin/settings').set(auth(employee.token))).status).toBe(
      403,
    );
    expect((await patch({ agentHours: 'ทุกวัน 08:00 น.' }, employee.token)).status).toBe(403);
    expect((await request(app).get('/api/admin/settings').set(auth(admin.token))).status).toBe(200);
  });
});

describe('แก้ค่า', () => {
  it('บันทึกเฉพาะช่องที่เปลี่ยน · log มีคีย์ก่อน/หลังชุดเดียวกัน · ส่งค่าเดิมซ้ำไม่เขียน log', async () => {
    const res = await patch({
      agentHours: `ทุกวัน 10:00 – 20:00 น. (${suffix})`,
      contactPhone: '081-234-5678',
      cutoffTime: original.cutoffTime,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data.settings.contactPhone).toBe('081-234-5678');

    const logs = await prisma.adminLog.findMany({
      where: { userId: admin.id, action: 'settings.store.update' },
      orderBy: { createdAt: 'desc' },
    });
    expect(logs).toHaveLength(1);
    // cutoffTime ส่งมาแต่ค่าเท่าเดิม → ไม่ถูกนับว่าเปลี่ยน
    expect(Object.keys(logs[0]!.before as object).sort()).toEqual(['agentHours', 'contactPhone']);
    expect(Object.keys(logs[0]!.after as object).sort()).toEqual(['agentHours', 'contactPhone']);
    expect((logs[0]!.before as Record<string, unknown>).contactPhone).toBe(original.contactPhone);

    expect((await patch({ contactPhone: '081-234-5678' })).status).toBe(200);
    expect(
      await prisma.adminLog.count({ where: { userId: admin.id, action: 'settings.store.update' } }),
    ).toBe(1);
  });

  it('null = ร้านไม่มีช่องทางนั้น → หายจากหน้าร้าน', async () => {
    await setSettings({ contactPhone: '02-123-4567' });
    let store = (await request(app).get('/api/store')).body.data;
    expect(store.contactChannels.map((c: { label: string }) => c.label)).toContain('โทรศัพท์');

    await setSettings({ contactPhone: null });
    store = (await request(app).get('/api/store')).body.data;
    expect(store.contactPhone).toBeNull();
    expect(store.contactChannels.map((c: { label: string }) => c.label)).not.toContain('โทรศัพท์');
  });
});

describe('ค่าที่ไม่จริงเข้าไม่ได้', () => {
  const rejected: [string, object, string][] = [
    [
      'หน้าแรกของ Instagram ไม่ใช่โปรไฟล์ร้าน',
      { instagramUrl: 'https://instagram.com' },
      'โปรไฟล์',
    ],
    [
      'โดเมนที่แค่ขึ้นต้นเหมือน',
      { instagramUrl: 'https://instagram.com.evil.example/shop' },
      'instagram.com',
    ],
    ['http ไม่ใช่ https', { facebookUrl: 'http://www.facebook.com/teenstyle' }, 'https://'],
    ['ลิงก์ LINE ไปโดเมนอื่น', { lineUrl: 'https://example.com/line' }, 'line.me'],
    ['เบอร์มีตัวอักษร', { contactPhone: '02-000-ABCD' }, 'เบอร์โทร'],
    ['สตริงว่างแทน null', { contactEmail: '' }, 'อีเมล'],
    ['เวลาตัดรอบ 24:00', { cutoffTime: '24:00' }, '24 ชั่วโมง'],
    ['คืนได้ 0 วัน', { returnWindowDays: 0 }, 'อย่างน้อย'],
    ['คืนได้ 91 วัน', { returnWindowDays: 91 }, 'ไม่เกิน'],
    ['COD 0 บาท', { codMaxTotal: 0 }, 'มากกว่า 0'],
    ['COD ทศนิยม 3 ตำแหน่ง', { codMaxTotal: 1000.555 }, 'ทศนิยม'],
    [
      'คำอธิบายมีจำนวนเงิน',
      { description: 'ร้านแฟชั่นวัยรุ่น ส่งฟรีเมื่อซื้อครบ 500 บาท' },
      'จำนวนเงิน',
    ],
    ['ไม่มีอะไรให้แก้', {}, 'ไม่มีข้อมูลที่จะแก้'],
  ];

  it.each(rejected)('%s → 422 พร้อมเหตุผล', async (_name, body, expected) => {
    const res = await patch(body);

    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body.details ?? res.body.message)).toContain(expected);
  });

  it('ลิงก์โปรไฟล์จริงบนโดเมนของแพลตฟอร์มบันทึกได้ และขึ้นในหน้าร้านเฉพาะช่องที่มีค่า', async () => {
    await setSettings({
      instagramUrl: 'https://www.instagram.com/teenstyle.th',
      tiktokUrl: null,
      facebookUrl: null,
      lineUrl: 'https://lin.ee/abc123',
    });

    const store = (await request(app).get('/api/store')).body.data;
    expect(store.socialLinks).toEqual([
      { label: 'Instagram', url: 'https://www.instagram.com/teenstyle.th' },
      { label: 'LINE', url: 'https://lin.ee/abc123' },
    ]);
  });
});

describe('ค่าชุดเดียวทุกที่', () => {
  it('บทความคลังความรู้ · AI · หน้าร้าน ใช้ค่าใหม่ทันที (บทความเก็บตัวแปร ไม่ใช่ตัวเลข)', async () => {
    const values = {
      agentHours: `จันทร์ – ศุกร์ 11:00 – 17:00 น. (${suffix})`,
      contactEmail: `care-${suffix}@example.com`,
      contactPhone: '089-765-4321',
      returnWindowDays: 11,
      codMaxTotal: 3456,
      shippingDays: 'จันทร์ – ศุกร์',
      cutoffTime: '15:45',
    };
    await setSettings(values);

    const articles = (await searchArticles({ page: 1, limit: 50, publishedOnly: false })).items;
    const article = (slug: string) => {
      const found = articles.find((item) => item.slug === slug)!;
      return [found.summary, found.content, ...found.faqPairs.map((faq) => faq.answer)].join('\n');
    };

    const contact = article('contact-support-and-office-hours');
    expect(contact).toContain(values.agentHours);
    expect(contact).toContain(values.contactEmail);
    expect(contact).toContain(values.contactPhone);
    expect(article('return-and-exchange-policy')).toContain('ภายใน **11 วัน**');
    expect(article('payment-methods-cod-guide')).toContain('3,456 บาท');
    for (const text of [contact, article('payment-methods-cod-guide')]) {
      expect(text).not.toContain('{{');
    }

    // ฉบับดิบในฐานข้อมูลยังเป็นตัวแปร — ค่าที่ร้านแก้ไม่ได้ถูกคัดลอกไปค้างในบทความ
    const raw = await prisma.knowledgeArticle.findFirstOrThrow({
      where: { slug: 'contact-support-and-office-hours' },
      select: { content: true },
    });
    expect(raw.content).toContain('{{store.contact}}');
    expect(raw.content).not.toContain(values.contactEmail);

    expect(await getStorePolicyContent('store_info')).toContain(values.agentHours);
    expect(await getStorePolicyContent('store_info')).toContain(values.contactPhone);
    expect(await getStorePolicyContent('return_exchange')).toContain('11 วัน');
    expect(await getStorePolicyContent('payment')).toContain('3,456');
    expect(await getStorePolicyContent('shipping')).toContain('ตัดรอบเวลา 15:45 น.');

    const store = (await request(app).get('/api/store')).body.data;
    expect(store).toMatchObject({
      returnWindowDays: 11,
      codMaxTotal: 3456,
      cutoffTime: '15:45 น.',
      contactEmail: values.contactEmail,
    });
  });

  it('ยอดสูงสุดของ COD ตัดสินจากค่าปัจจุบัน — ทั้งหน้าชำระเงินและด่านจ่ายเงินจริง', async () => {
    const order = await prisma.order.create({
      data: {
        orderNumber: testOrderNumber(),
        returnWindowDays: 7,
        userId: customer.id,
        subtotal: 3000,
        total: 3000,
        addressSnapshot: { recipientName: 'ผู้รับทดสอบ' },
      },
      select: { id: true, orderNumber: true },
    });
    createdOrderIds.push(order.id);
    const cod = async () =>
      (
        await request(app).get(`/api/orders/${order.orderNumber}/payment`).set(auth(customer.token))
      ).body.data.methods.find((method: { code: string }) => method.code === 'COD');

    await setSettings({ codMaxTotal: 5000 });
    expect((await cod()).available).toBe(true);

    await setSettings({ codMaxTotal: 2000 });
    const blocked = await cod();
    expect(blocked.available).toBe(false);
    expect(blocked.unavailableReason).toContain('2,000');

    const pay = await request(app)
      .post(`/api/orders/${order.orderNumber}/pay`)
      .set(auth(customer.token))
      .send({ provider: 'COD' });
    expect(pay.status).toBe(400);
    expect(pay.body.message).toContain('2,000');
  });
});

describe('จำนวนวันที่คืนได้', () => {
  it('คำสั่งซื้อใหม่จดจำนวนวันจากการตั้งค่าตอนสั่ง ไม่ใช่ค่าคงที่ในโค้ด', async () => {
    await setSettings({ returnWindowDays: 12 });

    const product = await request(app).get('/api/products/canvas-bucket-hat');
    const variant = (product.body.data.variants as { id: string; available: number }[]).find(
      (item) => item.available > 0,
    )!;
    expect(
      (
        await request(app)
          .post('/api/cart/items')
          .set(auth(customer.token))
          .send({ variantId: variant.id, quantity: 1 })
      ).status,
    ).toBe(201);

    const res = await request(app)
      .post('/api/orders')
      .set(auth(customer.token))
      .send({
        idempotencyKey: randomUUID(),
        shippingMethod: 'STANDARD',
        newAddress: {
          recipientName: 'ผู้รับทดสอบ',
          phone: '0812345678',
          line1: '1 ซอยทดสอบ',
          subDistrict: 'สีลม',
          district: 'บางรัก',
          province: 'กรุงเทพมหานคร',
          postalCode: '10500',
          saveForLater: false,
        },
      });
    expect(res.status, JSON.stringify(res.body)).toBe(201);

    const saved = await prisma.order.findUniqueOrThrow({
      where: { orderNumber: res.body.data.orderNumber },
      select: { id: true, returnWindowDays: true },
    });
    createdOrderIds.push(saved.id);
    expect(saved.returnWindowDays).toBe(12);
  });

  it('ร้านลดวันลง → ใบที่สั่งตอนนโยบายเดิมยังขอคืนได้ · ร้านขยายวัน → ใบเดิมได้ด้วย', async () => {
    const order = await deliveredOrder({ daysAgo: 5, returnWindowDays: 7 });
    const eligibility = async () =>
      (
        await request(app)
          .get(`/api/returns/eligibility/${order.orderNumber}`)
          .set(auth(customer.token))
      ).body.data;

    await setSettings({ returnWindowDays: 3 });
    const shortened = await eligibility();
    expect(shortened.eligible).toBe(true);
    expect(shortened.windowDays).toBe(7);

    await setSettings({ returnWindowDays: 14 });
    expect((await eligibility()).windowDays).toBe(14);
  });

  it('เลยกำหนดของใบนั้นแล้ว → ขอไม่ได้ และบอกจำนวนวันของใบนั้น · ด่านสร้างคำขอปฏิเสธด้วย', async () => {
    await setSettings({ returnWindowDays: 7 });
    const order = await deliveredOrder({ daysAgo: 10, returnWindowDays: 7 });

    const result = (
      await request(app)
        .get(`/api/returns/eligibility/${order.orderNumber}`)
        .set(auth(customer.token))
    ).body.data;
    expect(result.eligible).toBe(false);
    expect(result.message).toContain('ภายใน 7 วัน');

    // ด่านจริงตอนสร้างคำขอใช้กฎเดียวกัน — หน้าเว็บซ่อนปุ่มอย่างเดียวไม่พอ
    const item = await prisma.orderItem.findFirstOrThrow({
      where: { orderId: order.id },
      select: { id: true },
    });
    const create = await request(app)
      .post('/api/returns')
      .set(auth(customer.token))
      .send({
        orderNumber: order.orderNumber,
        reason: 'DEFECTIVE',
        detail: 'ตะเข็บด้านข้างแตกตั้งแต่ได้รับของ',
        items: [{ orderItemId: item.id, quantity: 1 }],
        idempotencyKey: randomUUID(),
      });
    expect(create.status, JSON.stringify(create.body)).toBe(409);
    expect(create.body.message).toContain('ภายใน 7 วัน');
  });
});
