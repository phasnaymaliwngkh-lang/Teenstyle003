import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma, type Prisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import {
  aliasesOf,
  canonicalTargetType,
  diffFields,
  actionLabelOf,
} from '../src/models/admin-log.model.ts';

/**
 * Integration test ของ Audit log (STEP 27)
 *
 * วางข้อมูลทดสอบไว้ที่ **ปี 2098** เพื่อไม่ให้ชนกับ log จริงที่มีอยู่แล้วในฐานข้อมูล
 * (ตอนเริ่ม STEP 27 มี 123 แถวจากงานก่อนหน้า) — ทุกการยืนยันจึงจำกัดช่วงวันไว้เสมอ
 *
 * สิ่งที่ต้องพิสูจน์
 *   - **กรองด้วยชนิดข้อมูลแล้วต้องได้แถวที่เขียนด้วยชื่อเก่าด้วย**
 *     (`KNOWLEDGE_ARTICLE` กับ `KnowledgeArticle` คือเรื่องเดียวกัน)
 *     ถ้าพลาดข้อนี้ คนอ่านจะเชื่อว่า "ไม่มีใครแตะของชิ้นนี้" ทั้งที่มี
 *   - **แถวที่เจ้าของถูกลบบัญชีแล้วต้องยังแสดง** ไม่ใช่หายไปจากประวัติ
 *   - ตัวเลือกในตัวกรองมาจากข้อมูลจริงในช่วงที่เลือก
 *   - เทียบก่อน/หลังเป็นช่อง ๆ ให้ (ไม่ใช่โยน JSON สองก้อนให้คนอ่านเอง)
 *   - **ไม่มีทางสร้าง แก้ หรือลบ log ผ่าน API**
 *   - ต้องมีสิทธิ์ `log:read` จริงในฐานข้อมูล
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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
const createdLogIds: string[] = [];

let admin: TestUser;
let employee: TestUser;
let customer: TestUser;
/** บัญชีที่จะถูกลบระหว่างเทสต์ เพื่อตรวจว่า log ยังอยู่ */
let leaver: TestUser;

const RANGE = 'from=2098-05-01&to=2098-05-31';
const PRODUCT_ID = '01a00000-0000-7000-8000-00000000c0de';
const ARTICLE_ID = '01a00000-0000-7000-8000-00000000abcd';

async function createTestUser(role: string, tag: string): Promise<TestUser> {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role as 'CUSTOMER' } });
  const email = `test-log-${tag}-${suffix}@teenstyle.test`;

  const user = await prisma.user.create({
    data: { email, name: `ประวัติ ${tag}`, roleId: roleRow.id, status: 'ACTIVE' },
  });
  createdUserIds.push(user.id);

  const token = `test-session-${randomUUID()}`;
  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });

  return { id: user.id, email, token };
}

async function createLog(input: {
  userId: string | null;
  action: string;
  targetType: string;
  targetId: string | null;
  at: string;
  before?: Prisma.InputJsonObject;
  after?: Prisma.InputJsonObject;
  ip?: string;
}): Promise<string> {
  const row = await prisma.adminLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      createdAt: new Date(input.at),
      ...(input.before ? { before: input.before } : {}),
      ...(input.after ? { after: input.after } : {}),
      ...(input.ip ? { ipAddress: input.ip } : {}),
    },
    select: { id: true },
  });

  createdLogIds.push(row.id);
  return row.id;
}

beforeAll(async () => {
  admin = await createTestUser('ADMIN', 'admin');
  employee = await createTestUser('EMPLOYEE', 'employee');
  customer = await createTestUser('CUSTOMER', 'customer');
  leaver = await createTestUser('EMPLOYEE', 'leaver');

  await createLog({
    userId: admin.id,
    action: 'product.update',
    targetType: 'Product',
    targetId: PRODUCT_ID,
    at: '2098-05-10T10:00:00+07:00',
    before: { name: 'เสื้อเก่า', status: 'DRAFT', price: 590 },
    after: { name: 'เสื้อใหม่', status: 'ACTIVE', price: 590 },
    ip: '203.0.113.9',
  });

  // ⚠️ สองแถวนี้คือ "เรื่องเดียวกัน" แต่เขียน targetType ไว้คนละแบบ
  await createLog({
    userId: admin.id,
    action: 'knowledge.update',
    targetType: 'KnowledgeArticle',
    targetId: ARTICLE_ID,
    at: '2098-05-11T09:00:00+07:00',
    after: { title: 'นโยบายใหม่' },
  });
  await createLog({
    userId: admin.id,
    action: 'knowledge.update',
    targetType: 'KNOWLEDGE_ARTICLE',
    targetId: ARTICLE_ID,
    at: '2098-05-12T09:00:00+07:00',
    after: { title: 'นโยบายเก่ากว่า' },
  });

  // แถวของคนที่จะถูกลบบัญชีทีหลัง
  await createLog({
    userId: leaver.id,
    action: 'customer.status.update',
    targetType: 'User',
    targetId: customer.id,
    at: '2098-05-13T15:00:00+07:00',
    before: { status: 'ACTIVE' },
    after: { status: 'SUSPENDED', reason: 'ทดสอบประวัติ' },
  });

  // นอกช่วงที่เทสต์ query — ใช้ยืนยันว่าตัวกรองช่วงวันทำงานจริง
  await createLog({
    userId: admin.id,
    action: 'product.delete',
    targetType: 'Product',
    targetId: PRODUCT_ID,
    at: '2098-07-01T10:00:00+07:00',
    before: { name: 'เสื้อใหม่' },
    after: { deleted: true },
  });
});

afterAll(async () => {
  if (createdLogIds.length > 0) {
    await prisma.adminLog.deleteMany({ where: { id: { in: createdLogIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }

  await disconnectDatabase();
});

/* ─────────────────────── ฟังก์ชันล้วน ─────────────────────── */

describe('เครื่องมือของ audit log', () => {
  it('รวมชื่อเก่าทุกแบบของชนิดเดียวกัน', () => {
    expect(aliasesOf('KnowledgeArticle')).toEqual(['KnowledgeArticle', 'KNOWLEDGE_ARTICLE']);
    expect(aliasesOf('Order')).toEqual(['Order', 'ORDER']);
  });

  it('แปลงชื่อเก่าเป็นชื่อมาตรฐาน และไม่เดาค่าที่ไม่รู้จัก', () => {
    expect(canonicalTargetType('KNOWLEDGE_ARTICLE')).toBe('KnowledgeArticle');
    expect(canonicalTargetType('PRODUCT')).toBe('Product');
    expect(canonicalTargetType('Product')).toBe('Product');
    expect(canonicalTargetType('อะไรไม่รู้')).toBeNull();
    expect(canonicalTargetType(null)).toBeNull();
  });

  it('action ที่ไม่รู้จักแสดงชื่อดิบ ไม่ใช่ซ่อนหรือเดาความหมาย', () => {
    expect(actionLabelOf('product.create')).toBe('เพิ่มสินค้าใหม่');
    expect(actionLabelOf('something.brand.new')).toBe('something.brand.new');
  });

  it('เทียบก่อน/หลังแล้วได้เฉพาะช่องที่เปลี่ยนจริง', () => {
    const changes = diffFields(
      { name: 'เก่า', price: 100, status: 'DRAFT' },
      { name: 'ใหม่', price: 100, status: 'ACTIVE' },
    );

    expect(changes).toEqual([
      { field: 'name', before: 'เก่า', after: 'ใหม่' },
      { field: 'status', before: 'DRAFT', after: 'ACTIVE' },
    ]);
  });

  it('ช่องที่มีเฉพาะใน after นับว่าเปลี่ยน (เพิ่มค่าใหม่)', () => {
    expect(diffFields({ a: 1 }, { a: 1, b: 2 })).toEqual([
      { field: 'b', before: null, after: '2' },
    ]);
  });

  it('⚠️ ช่องที่ไม่มีใน after ต้องไม่ถูกรายงานว่าถูกล้างค่า', () => {
    // `product.update` เก็บ before เป็นสแนปช็อตหลายช่อง แต่ after เก็บเฉพาะช่องที่แก้
    // การเทียบแบบเดิมรายงานว่า "ชื่อสินค้าถูกล้าง" ทั้งที่ไม่มีใครแตะชื่อ (เจอจริงตอน STEP 27)
    expect(diffFields({ name: 'กางเกงคาร์โก้', price: 790 }, { minimumStock: 6 })).toEqual([
      { field: 'minimumStock', before: null, after: '6' },
    ]);
    expect(diffFields({ a: 1, b: 2 }, { a: 1 })).toEqual([]);
  });

  it('ล้างค่าจริงต้องบันทึก null ไว้ใน after ถึงจะนับว่าเปลี่ยน', () => {
    expect(diffFields({ note: 'เดิม' }, { note: null })).toEqual([
      { field: 'note', before: 'เดิม', after: null },
    ]);
  });

  it('บันทึกที่เทียบเป็นช่อง ๆ ไม่ได้ คืนรายการว่าง (ไม่แกล้งทำเป็นเทียบได้)', () => {
    expect(diffFields(null, null)).toEqual([]);
    expect(diffFields('ข้อความล้วน', 'อีกข้อความ')).toEqual([]);
  });
});

/* ─────────────────────── สิทธิ์ ─────────────────────── */

describe('สิทธิ์ของหน้าประวัติ', () => {
  it('ลูกค้าทั่วไปเข้าไม่ได้', async () => {
    const response = await request(app).get('/api/admin/logs').set(auth(customer.token));
    expect(response.status).toBe(403);
  });

  it('พนักงานเข้าไม่ได้ — log มี IP และเหตุผลที่แอดมินกรอกไว้', async () => {
    const response = await request(app).get('/api/admin/logs').set(auth(employee.token));
    expect(response.status).toBe(403);
  });

  it('ยังไม่ล็อกอิน → 401', async () => {
    const response = await request(app).get('/api/admin/logs');
    expect(response.status).toBe(401);
  });
});

/* ─────────────────────── อ่านอย่างเดียว ─────────────────────── */

describe('audit log แก้ไม่ได้', () => {
  it('ไม่มี endpoint สร้าง แก้ หรือลบ log', async () => {
    const post = await request(app).post('/api/admin/logs').set(auth(admin.token)).send({
      action: 'product.delete',
      targetType: 'Product',
    });
    const patch = await request(app)
      .patch(`/api/admin/logs/${createdLogIds[0]}`)
      .set(auth(admin.token))
      .send({ action: 'อะไรก็ได้' });
    const remove = await request(app)
      .delete(`/api/admin/logs/${createdLogIds[0]}`)
      .set(auth(admin.token));

    expect(post.status).toBe(404);
    expect(patch.status).toBe(404);
    expect(remove.status).toBe(404);

    // ของจริงต้องไม่ถูกแตะ
    const still = await prisma.adminLog.count({ where: { id: { in: createdLogIds } } });
    expect(still).toBe(createdLogIds.length);
  });
});

/* ─────────────────────── รายการ ─────────────────────── */

describe('GET /api/admin/logs', () => {
  it('คืนรายการเรียงใหม่ไปเก่า พร้อมคำอธิบายภาษาไทยและช่องที่เปลี่ยน', async () => {
    const response = await request(app)
      .get(`/api/admin/logs?${RANGE}&limit=100`)
      .set(auth(admin.token));

    expect(response.status).toBe(200);

    const items = response.body.data.items as Array<{
      action: string;
      actionLabel: string;
      createdAt: string;
      changes: unknown[];
    }>;

    expect(items.length).toBe(4);
    expect(new Date(items[0]!.createdAt).getTime()).toBeGreaterThan(
      new Date(items[items.length - 1]!.createdAt).getTime(),
    );

    const productLog = items.find((item) => item.action === 'product.update')!;
    expect(productLog.actionLabel).toBe('แก้ไขข้อมูลสินค้า');
    expect(productLog.changes).toEqual([
      { field: 'name', before: 'เสื้อเก่า', after: 'เสื้อใหม่' },
      { field: 'status', before: 'DRAFT', after: 'ACTIVE' },
    ]);
  });

  it('⚠️ กรองตามชนิดข้อมูลแล้วได้แถวที่เขียนด้วยชื่อเก่าด้วย', async () => {
    const response = await request(app)
      .get(`/api/admin/logs?${RANGE}&targetType=KnowledgeArticle&limit=100`)
      .set(auth(admin.token));

    expect(response.status).toBe(200);
    // มีสองแถว เขียนไว้คนละชื่อ — ต้องได้ครบทั้งคู่
    expect(response.body.data.total).toBe(2);

    const raws = (response.body.data.items as Array<{ rawTargetType: string }>).map(
      (item) => item.rawTargetType,
    );
    expect(raws.sort()).toEqual(['KNOWLEDGE_ARTICLE', 'KnowledgeArticle']);

    // แต่ชนิดที่แสดงต้องเป็นชื่อเดียวกันทั้งคู่
    for (const item of response.body.data.items) {
      expect(item.targetType).toBe('KnowledgeArticle');
      expect(item.targetTypeLabel).toBe('คลังความรู้ AI');
    }
  });

  it('กรองตามกลุ่มของการกระทำ', async () => {
    const response = await request(app)
      .get(`/api/admin/logs?${RANGE}&group=product&limit=100`)
      .set(auth(admin.token));

    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].action).toBe('product.update');
  });

  it('กรองตามช่วงวัน — รายการนอกช่วงต้องไม่ติดมา', async () => {
    const inRange = await request(app)
      .get(`/api/admin/logs?${RANGE}&group=product&limit=100`)
      .set(auth(admin.token));
    const wider = await request(app)
      .get('/api/admin/logs?from=2098-05-01&to=2098-07-31&group=product&limit=100')
      .set(auth(admin.token));

    expect(inRange.body.data.total).toBe(1);
    expect(wider.body.data.total).toBe(2);
  });

  it('กรองตามรายการที่ถูกแก้ (targetId)', async () => {
    const response = await request(app)
      .get(`/api/admin/logs?${RANGE}&targetId=${ARTICLE_ID}&limit=100`)
      .set(auth(admin.token));

    expect(response.body.data.total).toBe(2);
  });

  it('ค้นด้วยอีเมลของผู้ทำรายการได้', async () => {
    const response = await request(app)
      .get(`/api/admin/logs?${RANGE}&q=${encodeURIComponent(leaver.email)}&limit=100`)
      .set(auth(admin.token));

    expect(response.body.data.total).toBe(1);
    expect(response.body.data.items[0].action).toBe('customer.status.update');
  });

  it('สร้างลิงก์ไปหน้าที่มีจริง และเป็น null เมื่อยังไม่มีหน้ารายตัว', async () => {
    const response = await request(app)
      .get(`/api/admin/logs?${RANGE}&limit=100`)
      .set(auth(admin.token));

    const items = response.body.data.items as Array<{ action: string; link: string | null }>;

    expect(items.find((item) => item.action === 'product.update')!.link).toBe(
      `/admin/products/${PRODUCT_ID}`,
    );
    expect(items.find((item) => item.action === 'customer.status.update')!.link).toBe(
      `/admin/customers/${customer.id}`,
    );
    // คลังความรู้ยังไม่มีหน้ารายบทความ → ต้องเป็น null ไม่ใช่ลิงก์ที่พาไป 404
    expect(items.find((item) => item.action === 'knowledge.update')!.link).toBeNull();
  });

  it('ช่วงยาวเกิน 366 วัน → 422', async () => {
    const response = await request(app)
      .get('/api/admin/logs?from=2096-01-01&to=2098-01-01')
      .set(auth(admin.token));

    expect(response.status).toBe(422);
  });
});

/* ─────────────────────── ตัวกรอง ─────────────────────── */

describe('GET /api/admin/logs/filters', () => {
  it('ตัวเลือกมาจากข้อมูลจริงในช่วงที่เลือก ไม่ใช่รายการคงที่', async () => {
    const response = await request(app)
      .get(`/api/admin/logs/filters?${RANGE}`)
      .set(auth(admin.token));

    expect(response.status).toBe(200);

    const actions = (response.body.data.actions as Array<{ value: string }>).map(
      (item) => item.value,
    );

    expect(actions).toContain('product.update');
    expect(actions).toContain('knowledge.update');
    // นอกช่วง — ต้องไม่โผล่เป็นตัวเลือก ไม่งั้นกดแล้วได้หน้าว่าง
    expect(actions).not.toContain('product.delete');
  });

  it('⚠️ ชนิดข้อมูลถูกยุบชื่อเก่าเข้ากับชื่อใหม่ ไม่โผล่สองอัน', async () => {
    const response = await request(app)
      .get(`/api/admin/logs/filters?${RANGE}`)
      .set(auth(admin.token));

    const knowledge = (
      response.body.data.targetTypes as Array<{ value: string; count: number }>
    ).filter((item) => item.value === 'KnowledgeArticle');

    expect(knowledge).toHaveLength(1);
    expect(knowledge[0]!.count).toBe(2);
  });

  it('รายชื่อผู้ทำรายการมีจำนวนครั้งของแต่ละคน', async () => {
    const response = await request(app)
      .get(`/api/admin/logs/filters?${RANGE}`)
      .set(auth(admin.token));

    const actors = response.body.data.actors as Array<{ userId: string; count: number }>;
    const adminEntry = actors.find((item) => item.userId === admin.id)!;

    expect(adminEntry.count).toBe(3);
  });
});

/* ─────────────────────── ประวัติของของชิ้นเดียว ─────────────────────── */

describe('GET /api/admin/logs/target/:targetType/:targetId', () => {
  it('คืนทุกครั้งที่ของชิ้นนี้ถูกแตะ รวมรายการนอกช่วงวันด้วย', async () => {
    const response = await request(app)
      .get(`/api/admin/logs/target/Product/${PRODUCT_ID}`)
      .set(auth(admin.token));

    expect(response.status).toBe(200);
    expect(response.body.data.total).toBe(2);
    expect(response.body.data.truncated).toBe(false);
  });

  it('รวมแถวที่เขียนชนิดด้วยชื่อเก่าด้วย', async () => {
    const response = await request(app)
      .get(`/api/admin/logs/target/KnowledgeArticle/${ARTICLE_ID}`)
      .set(auth(admin.token));

    expect(response.body.data.total).toBe(2);
  });

  it('ชนิดข้อมูลที่ไม่รู้จัก → 422', async () => {
    const response = await request(app)
      .get(`/api/admin/logs/target/NotAThing/${PRODUCT_ID}`)
      .set(auth(admin.token));

    expect(response.status).toBe(422);
  });
});

/* ─────────────────────── บัญชีที่ถูกลบ ─────────────────────── */

describe('บัญชีผู้ทำรายการถูกลบไปแล้ว', () => {
  it('⚠️ log ยังอยู่และยังแสดง — ไม่ใช่หายไปจากประวัติ', async () => {
    const before = await request(app)
      .get(`/api/admin/logs?${RANGE}&limit=100`)
      .set(auth(admin.token));
    expect(before.body.data.total).toBe(4);

    // ลบบัญชีพนักงานคนนั้น (FK เป็น onDelete: SetNull)
    await prisma.session.deleteMany({ where: { userId: leaver.id } });
    await prisma.user.delete({ where: { id: leaver.id } });

    const after = await request(app)
      .get(`/api/admin/logs?${RANGE}&limit=100`)
      .set(auth(admin.token));

    expect(after.body.data.total).toBe(4);

    const orphan = (
      after.body.data.items as Array<{
        action: string;
        actor: { id: string | null; email: string };
      }>
    ).find((item) => item.action === 'customer.status.update')!;

    expect(orphan.actor.id).toBeNull();
    expect(orphan.actor.email).toBe('(บัญชีถูกลบแล้ว)');
  });

  it('ยังอยู่ในรายชื่อผู้ทำรายการของตัวกรอง', async () => {
    const response = await request(app)
      .get(`/api/admin/logs/filters?${RANGE}`)
      .set(auth(admin.token));

    const orphan = (
      response.body.data.actors as Array<{ userId: string | null; email: string }>
    ).find((item) => item.userId === null);

    expect(orphan).toBeDefined();
    expect(orphan!.email).toBe('(บัญชีถูกลบแล้ว)');
  });
});

/* ─────────────────────── ส่งออกไฟล์ ─────────────────────── */

describe('GET /api/admin/logs/export', () => {
  it('CSV มี UTF-8 BOM และมีช่องที่เปลี่ยนเป็นข้อความอ่านออก', async () => {
    const response = await request(app)
      .get(`/api/admin/logs/export?${RANGE}&format=csv`)
      .buffer(true)
      .parse(binaryParser)
      .set(auth(admin.token));

    expect(response.status).toBe(200);

    const buffer = response.body as Buffer;
    expect(buffer[0]).toBe(0xef);
    expect(buffer[1]).toBe(0xbb);
    expect(buffer[2]).toBe(0xbf);

    const text = buffer.toString('utf8');
    expect(text).toContain('แก้ไขข้อมูลสินค้า');
    expect(text).toContain('เสื้อเก่า');
    expect(text).toContain('เสื้อใหม่');
  });

  it('พนักงานดาวน์โหลดไม่ได้', async () => {
    const response = await request(app)
      .get(`/api/admin/logs/export?${RANGE}`)
      .set(auth(employee.token));

    expect(response.status).toBe(403);
  });
});
