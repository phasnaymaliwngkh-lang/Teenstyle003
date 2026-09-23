import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import {
  addDays,
  bucketLabelOf,
  bucketsInRange,
  changeRatio,
  daysBetween,
  formatInZone,
  previousRange,
  zonedDayEnd,
  zonedDayStart,
} from '../src/models/analytics.model.ts';

/**
 * Integration test ของรายงานยอดขาย (STEP 26)
 *
 * ใช้ฐานข้อมูลจริง และวางข้อมูลทดสอบไว้ที่ **ปี 2099** ทั้งหมด
 * เพื่อให้ช่วงเวลาที่ query ไม่มีทางชนกับข้อมูล seed หรือของเทสต์ไฟล์อื่น
 * (แพตเทิร์นเดียวกับเลขคำสั่งซื้อ TS-2999 ของ STEP 24)
 *
 * สิ่งที่ต้องพิสูจน์
 *   - **ตัดวันตามเวลาร้าน ไม่ใช่ UTC** — ออเดอร์ตี 2 ครึ่งของวันที่ 10 ต้องอยู่ในวันที่ 10
 *     ไม่ใช่ตกไปวันที่ 9 (นี่คือบั๊กที่จะทำให้ยอดรายวันผิดทั้งแผ่นโดยไม่มีอะไรฟ้อง)
 *   - ช่วงที่ไม่มีคำสั่งซื้อต้องเป็นจุด 0 ในกราฟ ไม่ใช่หายไป
 *   - ยอดขายนับเฉพาะเงินที่ได้รับจริง — ใบที่ยกเลิก/COD ที่ยังไม่เก็บเงิน ไม่เข้ายอด
 *   - ตัดรอบตาม `paidAt` ไม่ใช่ `createdAt`
 *   - **อันดับเรียงก่อนแบ่งหน้า** (หนี้ที่ STEP 25 กันไว้)
 *   - ช่วงก่อนหน้าเป็น 0 → `changePercent` เป็น null ไม่ใช่ 0 หรือ 100%
 *   - ต้องมีสิทธิ์ `analytics:read` จริงในฐานข้อมูล
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/**
 * supertest ไม่แปลงเนื้อไฟล์ให้เอง — ถ้าไม่ใส่ parser นี้ `res.body` จะเป็น object ว่าง
 * (แพตเทิร์นเดียวกับ tests/import-export.test.ts ของ STEP 18)
 */
const binaryParser = (res: unknown, callback: (err: Error | null, body: Buffer) => void) => {
  const stream = res as NodeJS.ReadableStream;
  const chunks: Buffer[] = [];
  stream.on('data', (chunk: Buffer) => chunks.push(chunk));
  stream.on('end', () => callback(null, Buffer.concat(chunks)));
};

interface TestUser {
  id: string;
  email: string;
  token: string;
}

const createdUserIds: string[] = [];
const createdOrderIds: string[] = [];

let admin: TestUser;
let employee: TestUser;
let customer: TestUser;
let buyerA: TestUser;
let buyerB: TestUser;
let buyerC: TestUser;

/** สินค้าจริงจาก seed — ใช้ผูก OrderItem ให้รายงานตามสินค้า/หมวดหมู่มีข้อมูลจริง */
let productOne = { id: '', name: '', categoryName: '' };
let productTwo = { id: '', name: '', categoryName: '' };

async function createTestUser(role: string, tag: string): Promise<TestUser> {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role as 'CUSTOMER' } });
  const email = `test-analytics-${tag}-${suffix}@teenstyle.test`;

  const user = await prisma.user.create({
    data: { email, name: `รายงาน ${tag}`, roleId: roleRow.id, status: 'ACTIVE' },
  });
  createdUserIds.push(user.id);

  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, email, token };
}

interface OrderSpec {
  user: TestUser;
  total: number;
  /** เวลาที่ได้รับเงิน (ISO พร้อม offset) — null = ยังไม่ได้เงิน */
  paidAt: string | null;
  createdAt: string;
  status?: string;
  paymentStatus?: string;
  shippingMethod?: string;
  shippingFee?: number;
  discountTotal?: number;
  provider?: string;
  items?: Array<{ product: { id: string; name: string }; quantity: number; lineTotal: number }>;
}

let orderSeq = 0;

async function createOrder(spec: OrderSpec): Promise<string> {
  orderSeq += 1;
  const shippingFee = spec.shippingFee ?? 0;
  const discountTotal = spec.discountTotal ?? 0;
  const subtotal = spec.total - shippingFee + discountTotal;

  const order = await prisma.order.create({
    data: {
      orderNumber: `TS-20990101-${String(orderSeq).padStart(4, '0')}`,
      userId: spec.user.id,
      subtotal,
      shippingFee,
      discountTotal,
      total: spec.total,
      status: (spec.status ?? 'DELIVERED') as 'DELIVERED',
      paymentStatus: (spec.paymentStatus ?? 'PAID') as 'PAID',
      shippingMethod: (spec.shippingMethod ?? 'STANDARD') as 'STANDARD',
      createdAt: new Date(spec.createdAt),
      paidAt: spec.paidAt === null ? null : new Date(spec.paidAt),
      addressSnapshot: { recipientName: 'ผู้รับทดสอบ', province: 'กรุงเทพมหานคร' },
      items: spec.items
        ? {
            create: spec.items.map((item) => ({
              productId: item.product.id,
              productName: item.product.name,
              variantSku: `TEST-${orderSeq}`,
              unitPrice: item.lineTotal / item.quantity,
              quantity: item.quantity,
              lineTotal: item.lineTotal,
            })),
          }
        : undefined,
      payments: {
        create: {
          provider: (spec.provider ?? 'COD') as 'COD',
          status: (spec.paidAt === null ? 'PENDING' : 'PAID') as 'PAID',
          amount: spec.total,
          paidAt: spec.paidAt === null ? null : new Date(spec.paidAt),
        },
      },
    },
    select: { id: true },
  });

  createdOrderIds.push(order.id);
  return order.id;
}

beforeAll(async () => {
  admin = await createTestUser('ADMIN', 'admin');
  employee = await createTestUser('EMPLOYEE', 'employee');
  customer = await createTestUser('CUSTOMER', 'customer');
  buyerA = await createTestUser('CUSTOMER', 'buyer-a');
  buyerB = await createTestUser('CUSTOMER', 'buyer-b');
  buyerC = await createTestUser('CUSTOMER', 'buyer-c');

  const products = await prisma.product.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, category: { select: { name: true } } },
    orderBy: { createdAt: 'asc' },
    take: 2,
  });

  productOne = {
    id: products[0]!.id,
    name: products[0]!.name,
    categoryName: products[0]!.category.name,
  };
  productTwo = {
    id: products[1]!.id,
    name: products[1]!.name,
    categoryName: products[1]!.category.name,
  };

  /**
   * ⚠️ ออเดอร์ใบนี้คือหัวใจของเทสต์เรื่องโซนเวลา
   *    ได้เงินตอน 02:30 น. **ตามเวลาไทย** ของวันที่ 10 → เป็น 19:30Z ของวันที่ 9
   *    ถ้ารายงานตัดวันแบบ UTC ยอดนี้จะไปโผล่วันที่ 9 ซึ่งผิด
   */
  await createOrder({
    user: buyerA,
    total: 1_000,
    createdAt: '2099-03-09T10:00:00+07:00',
    paidAt: '2099-03-10T02:30:00+07:00',
    shippingFee: 50,
    provider: 'STRIPE',
    shippingMethod: 'EXPRESS',
    items: [{ product: productOne, quantity: 2, lineTotal: 950 }],
  });

  // วันที่ 11 ไม่มีออเดอร์เลย → ต้องเป็นจุด 0 ในกราฟ ไม่ใช่หายไป
  await createOrder({
    user: buyerA,
    total: 2_000,
    createdAt: '2099-03-12T09:00:00+07:00',
    paidAt: '2099-03-12T09:30:00+07:00',
    shippingFee: 0,
    provider: 'STRIPE',
    items: [{ product: productOne, quantity: 1, lineTotal: 2_000 }],
  });

  await createOrder({
    user: buyerB,
    total: 5_000,
    createdAt: '2099-03-12T20:00:00+07:00',
    paidAt: '2099-03-12T20:30:00+07:00',
    shippingFee: 100,
    discountTotal: 200,
    provider: 'COD',
    shippingMethod: 'SAME_DAY',
    items: [{ product: productTwo, quantity: 5, lineTotal: 5_100 }],
  });

  await createOrder({
    user: buyerB,
    total: 700,
    createdAt: '2099-03-13T08:00:00+07:00',
    paidAt: '2099-03-13T08:30:00+07:00',
    provider: 'COD',
    items: [{ product: productTwo, quantity: 1, lineTotal: 700 }],
  });

  // ยกเลิกแล้ว — ห้ามเข้ายอดขาย แม้จะเคยจ่าย
  await createOrder({
    user: buyerC,
    total: 9_999,
    createdAt: '2099-03-12T10:00:00+07:00',
    paidAt: '2099-03-12T10:30:00+07:00',
    status: 'CANCELLED',
    paymentStatus: 'REFUNDED',
    items: [{ product: productOne, quantity: 9, lineTotal: 9_999 }],
  });

  // COD ที่ยังไม่ได้เก็บเงิน — ห้ามเข้ายอดขายของช่วง
  await createOrder({
    user: buyerC,
    total: 3_333,
    createdAt: '2099-03-12T11:00:00+07:00',
    paidAt: null,
    status: 'SHIPPING',
    paymentStatus: 'PENDING',
    items: [{ product: productOne, quantity: 3, lineTotal: 3_333 }],
  });

  // อยู่ในช่วงเทียบ (ช่วงก่อนหน้า) — ใช้ตรวจการเปรียบเทียบ
  await createOrder({
    user: buyerA,
    total: 400,
    createdAt: '2099-03-06T10:00:00+07:00',
    paidAt: '2099-03-06T10:30:00+07:00',
    items: [{ product: productOne, quantity: 1, lineTotal: 400 }],
  });
});

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }

  await disconnectDatabase();
});

/* ─────────────────────── ฟังก์ชันคำนวณวันและช่วง ─────────────────────── */

describe('เครื่องมือจัดการวันและโซนเวลา', () => {
  it('เที่ยงคืนตามเวลาไทยตรงกับ 17:00Z ของวันก่อนหน้า', () => {
    expect(zonedDayStart('2099-03-10').toISOString()).toBe('2099-03-09T17:00:00.000Z');
  });

  it('วินาทีสุดท้ายของวันตามเวลาไทยคือ 16:59:59.999Z ของวันเดียวกัน', () => {
    expect(zonedDayEnd('2099-03-10').toISOString()).toBe('2099-03-10T16:59:59.999Z');
  });

  it('เวลาตี 2 ครึ่งของไทยยังนับเป็นวันเดียวกัน ไม่ใช่เมื่อวาน', () => {
    // 2099-03-10T02:30+07:00 = 2099-03-09T19:30Z
    const at = new Date('2099-03-09T19:30:00.000Z');

    expect(formatInZone(at)).toBe('2099-03-10');
    expect(at.toISOString().slice(0, 10)).toBe('2099-03-09'); // สิ่งที่ UTC จะตอบ (ผิด)
  });

  it('สัปดาห์เริ่มวันจันทร์แบบเดียวกับ date_trunc ของ PostgreSQL', () => {
    // 2099-03-10 เป็นวันอังคาร → สัปดาห์เริ่ม 2099-03-09
    expect(bucketLabelOf('2099-03-10', 'week')).toBe('2099-03-09');
    expect(bucketLabelOf('2099-03-09', 'week')).toBe('2099-03-09');
    expect(bucketLabelOf('2099-03-15', 'week')).toBe('2099-03-09');
    expect(bucketLabelOf('2099-03-16', 'week')).toBe('2099-03-16');
  });

  it('เดือนตัดที่วันที่ 1 เสมอ', () => {
    expect(bucketLabelOf('2099-03-21', 'month')).toBe('2099-03-01');
  });

  it('สร้างป้ายครบทุกช่วงและไม่ซ้ำ', () => {
    expect(bucketsInRange('2099-03-09', '2099-03-13', 'day')).toEqual([
      '2099-03-09',
      '2099-03-10',
      '2099-03-11',
      '2099-03-12',
      '2099-03-13',
    ]);
    expect(bucketsInRange('2099-03-09', '2099-03-20', 'week')).toEqual([
      '2099-03-09',
      '2099-03-16',
    ]);
  });

  it('ช่วงเทียบยาวเท่ากันและจบก่อนวันเริ่มหนึ่งวัน', () => {
    expect(daysBetween('2099-03-09', '2099-03-13')).toBe(5);
    expect(previousRange('2099-03-09', '2099-03-13')).toEqual({
      from: '2099-03-04',
      to: '2099-03-08',
    });
    expect(addDays('2099-03-01', -1)).toBe('2099-02-28');
  });

  it('ช่วงก่อนหน้าเป็น 0 → เทียบไม่ได้ (null) ไม่ใช่ 0 หรือ 100%', () => {
    expect(changeRatio(5_000, 0)).toBeNull();
    expect(changeRatio(0, 0)).toBeNull();
    expect(changeRatio(150, 100)).toBe(50);
    expect(changeRatio(50, 100)).toBe(-50);
  });
});

/* ─────────────────────── สิทธิ์ ─────────────────────── */

describe('สิทธิ์ของหน้ารายงาน', () => {
  it('ลูกค้าทั่วไปเข้าไม่ได้', async () => {
    const response = await request(app)
      .get('/api/admin/analytics/summary')
      .set(auth(customer.token));

    expect(response.status).toBe(403);
  });

  it('พนักงานเข้าไม่ได้ — ยอดขายทั้งร้านไม่ใช่ข้อมูลที่พนักงานหน้าร้านต้องเห็น', async () => {
    const response = await request(app)
      .get('/api/admin/analytics/summary')
      .set(auth(employee.token));

    expect(response.status).toBe(403);
  });

  it('ยังไม่ล็อกอิน → 401', async () => {
    const response = await request(app).get('/api/admin/analytics/summary');

    expect(response.status).toBe(401);
  });
});

/* ─────────────────────── สรุปยอดขาย ─────────────────────── */

describe('GET /api/admin/analytics/summary', () => {
  const range = 'from=2099-03-09&to=2099-03-13';

  it('ยอดขายนับเฉพาะเงินที่ได้รับจริง — ใบที่ยกเลิกและ COD ที่ยังไม่เก็บเงินไม่เข้ายอด', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/summary?${range}`)
      .set(auth(admin.token));

    expect(response.status).toBe(200);
    // 1,000 + 2,000 + 5,000 + 700 = 8,700 (ไม่รวม 9,999 ที่ยกเลิก และ 3,333 ที่ยังไม่เก็บเงิน)
    expect(response.body.data.revenue.value).toBe(8_700);
    expect(response.body.data.paidOrders.value).toBe(4);
    expect(response.body.data.averageOrderValue.value).toBe(2_175);
    // buyerA และ buyerB — buyerC ไม่นับเพราะไม่มีใบที่ได้เงิน
    expect(response.body.data.payingCustomers.value).toBe(2);
  });

  it('⚠️ ตัดวันตามเวลาร้าน — ออเดอร์ตี 2 ครึ่งของวันที่ 10 อยู่ในวันที่ 10 ไม่ใช่วันที่ 9', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/summary?${range}&granularity=day`)
      .set(auth(admin.token));

    const byBucket = new Map<string, number>(
      response.body.data.series.map((point: { bucket: string; revenue: number }) => [
        point.bucket,
        point.revenue,
      ]),
    );

    expect(byBucket.get('2099-03-10')).toBe(1_000);
    expect(byBucket.get('2099-03-09')).toBe(0);
  });

  it('วันที่ไม่มีคำสั่งซื้อต้องเป็นจุด 0 ไม่ใช่หายไปจากกราฟ', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/summary?${range}&granularity=day`)
      .set(auth(admin.token));

    const buckets = response.body.data.series.map((point: { bucket: string }) => point.bucket);

    expect(buckets).toEqual(['2099-03-09', '2099-03-10', '2099-03-11', '2099-03-12', '2099-03-13']);

    const empty = response.body.data.series.find(
      (point: { bucket: string }) => point.bucket === '2099-03-11',
    );
    expect(empty).toEqual({ bucket: '2099-03-11', revenue: 0, orders: 0 });
  });

  it('ตัดรอบตาม paidAt ไม่ใช่ createdAt', async () => {
    // ใบ 1,000 บาท สร้างวันที่ 9 แต่ได้เงินวันที่ 10
    const onlyNinth = await request(app)
      .get('/api/admin/analytics/summary?from=2099-03-09&to=2099-03-09')
      .set(auth(admin.token));

    expect(onlyNinth.body.data.revenue.value).toBe(0);

    const onlyTenth = await request(app)
      .get('/api/admin/analytics/summary?from=2099-03-10&to=2099-03-10')
      .set(auth(admin.token));

    expect(onlyTenth.body.data.revenue.value).toBe(1_000);
  });

  it('เทียบกับช่วงก่อนหน้าที่ยาวเท่ากัน', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/summary?${range}`)
      .set(auth(admin.token));

    expect(response.body.data.range.comparedTo).toEqual({
      from: '2099-03-04',
      to: '2099-03-08',
    });
    // ช่วงก่อนหน้ามีใบเดียว 400 บาท
    expect(response.body.data.revenue.previous).toBe(400);
    expect(response.body.data.revenue.changePercent).toBe(2_075);
  });

  it('ช่วงก่อนหน้าไม่มียอด → changePercent เป็น null', async () => {
    const response = await request(app)
      .get('/api/admin/analytics/summary?from=2099-06-01&to=2099-06-05')
      .set(auth(admin.token));

    expect(response.body.data.revenue.value).toBe(0);
    expect(response.body.data.revenue.previous).toBe(0);
    expect(response.body.data.revenue.changePercent).toBeNull();
  });

  it('บอกโซนเวลาที่ใช้ตัดวันกลับไปด้วย', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/summary?${range}`)
      .set(auth(admin.token));

    expect(response.body.data.range.timeZone).toBe('Asia/Bangkok');
    expect(response.body.data.range.days).toBe(5);
  });

  it('granularity=week ยุบเป็นสัปดาห์เริ่มวันจันทร์', async () => {
    const response = await request(app)
      .get('/api/admin/analytics/summary?from=2099-03-09&to=2099-03-20&granularity=week')
      .set(auth(admin.token));

    const buckets = response.body.data.series.map((point: { bucket: string }) => point.bucket);
    expect(buckets).toEqual(['2099-03-09', '2099-03-16']);
    expect(response.body.data.series[0].revenue).toBe(8_700);
  });
});

describe('การตรวจช่วงเวลา', () => {
  it('วันเริ่มอยู่หลังวันสิ้นสุด → 422', async () => {
    const response = await request(app)
      .get('/api/admin/analytics/summary?from=2099-03-20&to=2099-03-10')
      .set(auth(admin.token));

    expect(response.status).toBe(422);
  });

  it('ช่วงยาวเกิน 366 วัน → 422', async () => {
    const response = await request(app)
      .get('/api/admin/analytics/summary?from=2097-01-01&to=2099-01-01')
      .set(auth(admin.token));

    expect(response.status).toBe(422);
  });

  it('วันที่ที่ไม่มีในปฏิทิน → 422', async () => {
    const response = await request(app)
      .get('/api/admin/analytics/summary?from=2099-02-31&to=2099-03-01')
      .set(auth(admin.token));

    expect(response.status).toBe(422);
  });

  it('ไม่ส่งช่วงมาเลยก็ใช้ได้ (30 วันล่าสุด)', async () => {
    const response = await request(app).get('/api/admin/analytics/summary').set(auth(admin.token));

    expect(response.status).toBe(200);
    expect(response.body.data.range.days).toBe(30);
    expect(response.body.data.series).toHaveLength(30);
  });
});

/* ─────────────────────── อันดับสินค้า ─────────────────────── */

describe('GET /api/admin/analytics/products', () => {
  const range = 'from=2099-03-09&to=2099-03-13';

  it('รวมยอดต่อสินค้าจาก OrderItem จริง', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/products?${range}&limit=50`)
      .set(auth(admin.token));

    expect(response.status).toBe(200);

    const one = response.body.data.items.find(
      (item: { productId: string }) => item.productId === productOne.id,
    );
    const two = response.body.data.items.find(
      (item: { productId: string }) => item.productId === productTwo.id,
    );

    // productOne: 950 (วันที่10) + 2,000 (วันที่12) = 2,950 · 3 ชิ้น · 2 ใบ
    expect(one).toMatchObject({ revenue: 2_950, quantity: 3, orders: 2 });
    // productTwo: 5,100 + 700 = 5,800 · 6 ชิ้น · 2 ใบ
    expect(two).toMatchObject({ revenue: 5_800, quantity: 6, orders: 2 });
  });

  it('⚠️ เรียงก่อนแบ่งหน้า — หน้าแรกได้อันดับหนึ่งของทั้งช่วง ไม่ใช่ของแถวที่หยิบมา', async () => {
    const first = await request(app)
      .get(`/api/admin/analytics/products?${range}&sort=revenue&limit=1&page=1`)
      .set(auth(admin.token));

    const second = await request(app)
      .get(`/api/admin/analytics/products?${range}&sort=revenue&limit=1&page=2`)
      .set(auth(admin.token));

    expect(first.body.data.items[0].productId).toBe(productTwo.id);
    expect(first.body.data.items[0].revenue).toBe(5_800);
    expect(second.body.data.items[0].productId).toBe(productOne.id);
    expect(second.body.data.items[0].revenue).toBe(2_950);

    // จำนวนรวมต้องเป็นของทั้งช่วง ไม่ใช่ของหน้าปัจจุบัน
    expect(first.body.data.total).toBe(2);
    expect(first.body.data.totals.revenue).toBe(8_750);
  });

  it('เรียงตามจำนวนชิ้นให้ผลต่างจากเรียงตามยอดได้', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/products?${range}&sort=quantity&limit=50`)
      .set(auth(admin.token));

    expect(response.body.data.items[0].productId).toBe(productTwo.id);
    expect(response.body.data.items[0].quantity).toBe(6);
  });

  it('ใช้ชื่อสินค้าปัจจุบัน ไม่ใช่ชื่อที่ค้างอยู่ใน snapshot', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/products?${range}&limit=50`)
      .set(auth(admin.token));

    const one = response.body.data.items.find(
      (item: { productId: string }) => item.productId === productOne.id,
    );

    expect(one.productName).toBe(productOne.name);
    expect(one.slug).not.toBeNull();
  });
});

/* ─────────────────────── อันดับลูกค้า ─────────────────────── */

describe('GET /api/admin/analytics/customers', () => {
  const range = 'from=2099-03-09&to=2099-03-13';

  it('⚠️ เรียงก่อนแบ่งหน้า — หนี้ที่ STEP 25 กันไว้', async () => {
    const first = await request(app)
      .get(`/api/admin/analytics/customers?${range}&limit=1&page=1`)
      .set(auth(admin.token));

    expect(first.status).toBe(200);
    // buyerB ซื้อ 5,700 · buyerA ซื้อ 3,000
    expect(first.body.data.items[0].userId).toBe(buyerB.id);
    expect(first.body.data.items[0].revenue).toBe(5_700);
    expect(first.body.data.total).toBe(2);

    const second = await request(app)
      .get(`/api/admin/analytics/customers?${range}&limit=1&page=2`)
      .set(auth(admin.token));

    expect(second.body.data.items[0].userId).toBe(buyerA.id);
    expect(second.body.data.items[0].revenue).toBe(3_000);
  });

  it('คิดยอดเฉลี่ยต่อใบ และช่วงเวลาที่ซื้อครั้งแรก/ล่าสุด', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/customers?${range}&limit=50`)
      .set(auth(admin.token));

    const a = response.body.data.items.find(
      (item: { userId: string }) => item.userId === buyerA.id,
    );

    expect(a.orders).toBe(2);
    expect(a.averageOrderValue).toBe(1_500);
    expect(a.email).toBe(buyerA.email);
    expect(new Date(a.firstOrderAt).getTime()).toBeLessThan(new Date(a.lastOrderAt).getTime());
  });

  it('นับลูกค้าที่ซื้อซ้ำจากทั้งช่วง ไม่ใช่แค่หน้าปัจจุบัน', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/customers?${range}&limit=1`)
      .set(auth(admin.token));

    // buyerA และ buyerB ซื้อคนละ 2 ใบ
    expect(response.body.data.repeatCustomers).toBe(2);
    expect(response.body.data.items).toHaveLength(1);
  });

  it('ลูกค้าที่ไม่มีใบที่ได้รับเงินไม่อยู่ในอันดับ', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/customers?${range}&limit=50`)
      .set(auth(admin.token));

    const ids = response.body.data.items.map((item: { userId: string }) => item.userId);
    expect(ids).not.toContain(buyerC.id);
  });
});

/* ─────────────────────── แยกตามมิติ ─────────────────────── */

describe('GET /api/admin/analytics/breakdown', () => {
  const range = 'from=2099-03-09&to=2099-03-13';

  it('แยกตามช่องทางชำระเงินจากตาราง Payment ที่จ่ายสำเร็จ', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/breakdown?${range}`)
      .set(auth(admin.token));

    expect(response.status).toBe(200);

    const byKey = new Map<string, { revenue: number; label: string }>(
      response.body.data.byPaymentProvider.map(
        (row: { key: string; revenue: number; label: string }) => [
          row.key,
          { revenue: row.revenue, label: row.label },
        ],
      ),
    );

    expect(byKey.get('STRIPE')?.revenue).toBe(3_000);
    expect(byKey.get('COD')?.revenue).toBe(5_700);
    expect(byKey.get('COD')?.label).toBe('เก็บเงินปลายทาง');
  });

  it('แยกตามวิธีจัดส่ง และสัดส่วนรวมกันได้ประมาณ 100%', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/breakdown?${range}`)
      .set(auth(admin.token));

    const rows = response.body.data.byShippingMethod as Array<{
      key: string;
      revenue: number;
      share: number;
    }>;

    const total = rows.reduce((sum, row) => sum + row.revenue, 0);
    expect(total).toBe(8_700);

    const shares = rows.reduce((sum, row) => sum + row.share, 0);
    expect(shares).toBeGreaterThan(99);
    expect(shares).toBeLessThan(101);
  });

  it('แยกตามหมวดหมู่คิดจาก OrderItem ไม่ใช่ Order.total', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/breakdown?${range}`)
      .set(auth(admin.token));

    const rows = response.body.data.byCategory as Array<{ key: string; revenue: number }>;
    const total = rows.reduce((sum, row) => sum + row.revenue, 0);

    // ผลรวม lineTotal ของใบที่ได้เงิน = 950 + 2,000 + 5,100 + 700 = 8,750
    expect(total).toBe(8_750);
  });

  it('ยอดตามบิลกับยอดเฉพาะสินค้าไม่เท่ากันโดยธรรมชาติ และอธิบายส่วนต่างได้', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/breakdown?${range}`)
      .set(auth(admin.token));

    const { orderRevenue, productRevenue, shippingFees, discounts } =
      response.body.data.reconciliation;

    expect(orderRevenue).toBe(8_700);
    expect(productRevenue).toBe(8_750);
    expect(shippingFees).toBe(150);
    expect(discounts).toBe(200);
    // ยอดตามบิล = ยอดสินค้า − ส่วนลด + ค่าจัดส่ง
    expect(orderRevenue).toBe(productRevenue - discounts + shippingFees);
  });

  it('ตารางสถานะนับใบที่ "สร้าง" ในช่วงนี้ รวมใบที่ยกเลิกและยังไม่จ่าย', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/breakdown?${range}`)
      .set(auth(admin.token));

    const byStatus = new Map<string, number>(
      response.body.data.ordersByStatus.map((row: { key: string; orders: number }) => [
        row.key,
        row.orders,
      ]),
    );

    // 6 ใบถูกสร้างในช่วง 9–13 (ใบวันที่ 6 อยู่นอกช่วง)
    expect(byStatus.get('DELIVERED')).toBe(4);
    expect(byStatus.get('CANCELLED')).toBe(1);
    expect(byStatus.get('SHIPPING')).toBe(1);
  });
});

/* ─────────────────────── ส่งออกไฟล์ ─────────────────────── */

describe('GET /api/admin/analytics/export', () => {
  const range = 'from=2099-03-09&to=2099-03-13';

  it('ไฟล์ Excel เป็นไฟล์ zip จริง (xlsx) และตั้งชื่อตามช่วงที่เลือก', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/export?${range}&format=xlsx`)
      .buffer(true)
      .parse(binaryParser)
      .set(auth(admin.token));

    expect(response.status).toBe(200);
    expect(response.headers['content-disposition']).toContain(
      'analytics_2099-03-09_to_2099-03-13.xlsx',
    );

    const buffer = response.body as Buffer;
    // ลายเซ็นของไฟล์ zip — xlsx ที่เปิดได้จริงต้องขึ้นต้นด้วย PK\x03\x04
    expect(buffer[0]).toBe(0x50);
    expect(buffer[1]).toBe(0x4b);
  });

  it('ไฟล์ CSV มี UTF-8 BOM (ไม่งั้นภาษาไทยเพี้ยนใน Excel บน Windows)', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/export?${range}&format=csv`)
      .buffer(true)
      .parse(binaryParser)
      .set(auth(admin.token));

    expect(response.status).toBe(200);

    const buffer = response.body as Buffer;
    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);

    const text = buffer.toString('utf8');
    // CSV เก็บได้ชีตเดียว → ได้เฉพาะตารางรายวัน และวันที่ต้องตัดตามเวลาไทยแล้ว
    expect(text).toContain('2099-03-10,1000,1');
    expect(text).toContain('2099-03-11,0,0');
    expect(text).toContain('ช่วงเวลา,ยอดขาย (บาท),จำนวนคำสั่งซื้อ');
  });

  it('ต้องมีสิทธิ์ analytics:read จึงจะดาวน์โหลดได้', async () => {
    const response = await request(app)
      .get(`/api/admin/analytics/export?${range}`)
      .set(auth(employee.token));

    expect(response.status).toBe(403);
  });
});
