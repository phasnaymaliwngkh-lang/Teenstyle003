import { randomUUID } from 'node:crypto';

import { getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';

/**
 * Integration test ของคิวบริการลูกค้าฝั่งเจ้าหน้าที่ (STEP 20) — เพิ่มตอน STEP 37
 *
 * ทำไมต้องมีไฟล์นี้: ตอน STEP 37 วัด coverage แล้วพบว่า
 * `services/admin-support.service.ts` **ไม่ถูกเทสต์แตะเลยแม้แต่บรรทัดเดียว (0%)**
 * ทั้งที่เป็นที่เดียวที่เจ้าหน้าที่พิมพ์ข้อความ "ในนามร้าน" ส่งถึงลูกค้า
 * และ `ai-cs.test.ts` ที่มีอยู่ทดสอบแค่ฟังก์ชันล้วน (fallback engine + validator)
 * ไม่ได้แตะฐานข้อมูลหรือ HTTP เลย
 *
 * สิ่งที่ต้องพิสูจน์:
 *   - RBAC: ลูกค้าเข้าคิวไม่ได้ · ดูได้ (`ai:read`) กับจัดการได้ (`ai:handoff`) แยกกันจริง
 *   - บทสนทนาของ AI Stylist ต้องไม่หลุดเข้ามาในคิวบริการลูกค้า (กรองด้วย type จริง)
 *   - ข้อความของเจ้าหน้าที่บันทึกด้วย role `AGENT` และ **ไปถึงจอลูกค้า** (กฎ STEP 20 ข้อ 5)
 *   - ทุกการกระทำเขียน AdminLog ในทรานแซกชันเดียวกัน (กฎ STEP 20 ข้อ 7)
 *   - ลูกค้าคนอื่นอ่านบทสนทนานี้ไม่ได้ (กฎ STEP 20 ข้อ 2 — เคยเป็นช่องโหว่จริง)
 */
const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);

let staff = { id: '', token: '' };
let customer = { id: '', token: '' };
let outsider = { id: '', token: '' };

const createdConversationIds: string[] = [];
const createdUserIds: string[] = [];

async function createUser(role: 'CUSTOMER' | 'ADMIN', label: string) {
  const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
  const user = await prisma.user.create({
    data: { email: `test-support-${label}-${suffix}@teenstyle.test`, roleId: roleRow.id },
  });
  const token = `test-session-${randomUUID()}`;

  await prisma.session.create({
    data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 3_600_000) },
  });
  createdUserIds.push(user.id);

  return { id: user.id, token };
}

const asStaff = () => ({ Authorization: `Bearer ${staff.token}` });
const asCustomer = () => ({ Authorization: `Bearer ${customer.token}` });
const asOutsider = () => ({ Authorization: `Bearer ${outsider.token}` });

/** สร้างบทสนทนาของลูกค้าไว้ตรง ๆ — เทสต์นี้ตรวจฝั่งเจ้าหน้าที่ ไม่ได้ตรวจตัว AI */
async function makeConversation(
  options: {
    type?: 'CUSTOMER_SERVICE' | 'STYLIST';
    status?: 'ACTIVE' | 'ESCALATED' | 'CLOSED';
    userId?: string;
  } = {},
): Promise<string> {
  const conversation = await prisma.aIConversation.create({
    data: {
      type: options.type ?? 'CUSTOMER_SERVICE',
      status: options.status ?? 'ESCALATED',
      userId: options.userId ?? customer.id,
      title: 'ของยังไม่ถึงเลยครับ',
      escalatedAt: new Date(),
      lastMessageAt: new Date(),
      messages: {
        create: [
          { role: 'USER', content: 'สั่งไปสามวันแล้วของยังไม่ถึงเลยครับ' },
          { role: 'SYSTEM', content: 'กำลังส่งต่อให้เจ้าหน้าที่' },
        ],
      },
    },
  });

  createdConversationIds.push(conversation.id);

  return conversation.id;
}

async function logsFor(conversationId: string) {
  return prisma.adminLog.findMany({
    where: { targetType: 'AIConversation', targetId: conversationId },
    orderBy: { createdAt: 'asc' },
  });
}

beforeAll(async () => {
  staff = await createUser('ADMIN', 'staff');
  customer = await createUser('CUSTOMER', 'owner');
  outsider = await createUser('CUSTOMER', 'outsider');
});

afterAll(async () => {
  await prisma.adminLog.deleteMany({
    where: { targetType: 'AIConversation', targetId: { in: createdConversationIds } },
  });
  await prisma.aIChatMessage.deleteMany({
    where: { conversationId: { in: createdConversationIds } },
  });
  await prisma.aIConversation.deleteMany({ where: { id: { in: createdConversationIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
});

describe('คิวบริการลูกค้า — สิทธิ์ (STEP 37)', () => {
  it('ไม่ได้ล็อกอิน เข้าคิวไม่ได้', async () => {
    const response = await request(app).get('/api/admin/support/conversations');

    expect(response.status).toBe(401);
  });

  it('ลูกค้าเข้าคิวของเจ้าหน้าที่ไม่ได้ — ในนั้นมีชื่อและอีเมลของลูกค้าคนอื่น', async () => {
    const response = await request(app).get('/api/admin/support/conversations').set(asCustomer());

    expect(response.status).toBe(403);
  });

  it('ลูกค้าตอบในนามเจ้าหน้าที่ไม่ได้ — ไม่งั้นปั้นข้อความในนามร้านได้', async () => {
    const id = await makeConversation();
    const response = await request(app)
      .post(`/api/admin/support/conversations/${id}/messages`)
      .set(asCustomer())
      .send({ message: 'ร้านยินดีคืนเงินให้ 100%' });

    expect(response.status).toBe(403);

    const messages = await prisma.aIChatMessage.findMany({ where: { conversationId: id } });

    expect(messages.some((message) => message.role === 'AGENT')).toBe(false);
  });

  /**
   * กฎเดียวกับ STEP 17 ข้อ 8 / STEP 21 ข้อ 8: แยกสิทธิ์ดูกับสิทธิ์ลงมือ
   * ด่านนี้ต้องอยู่ที่ระบบสิทธิ์ในฐานข้อมูล ไม่ใช่ hard-code ตามบทบาท
   */
  it('ถอนสิทธิ์ ai:handoff ในฐานข้อมูลแล้ว ต้องตอบลูกค้าไม่ได้ทันที แต่ยังดูคิวได้', async () => {
    const id = await makeConversation();
    const role = await prisma.role.findUniqueOrThrow({ where: { name: 'ADMIN' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: 'ai:handoff' } });

    try {
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { disconnect: { id: permission.id } } },
      });

      const blocked = await request(app)
        .post(`/api/admin/support/conversations/${id}/messages`)
        .set(asStaff())
        .send({ message: 'สวัสดีครับ' });
      const stillReadable = await request(app)
        .get('/api/admin/support/conversations')
        .set(asStaff());

      expect(blocked.status).toBe(403);
      expect(stillReadable.status).toBe(200);
    } finally {
      // คืนสิทธิ์ให้ฐานข้อมูลเสมอ แม้เทสต์จะล้ม
      await prisma.role.update({
        where: { id: role.id },
        data: { permissions: { connect: { id: permission.id } } },
      });
    }
  });
});

describe('คิวบริการลูกค้า — ขอบเขตของคิว (STEP 37)', () => {
  it('บทสนทนาของ AI Stylist ต้องไม่โผล่ในคิวบริการลูกค้า', async () => {
    const stylistId = await makeConversation({ type: 'STYLIST' });
    const response = await request(app).get('/api/admin/support/conversations').set(asStaff());

    expect(response.status).toBe(200);
    expect(response.body.data.items.some((item: { id: string }) => item.id === stylistId)).toBe(
      false,
    );
  });

  it('เปิดรายละเอียดบทสนทนาของ AI Stylist จากคิวนี้ต้องได้ 404 ไม่ใช่เนื้อหา', async () => {
    const stylistId = await makeConversation({ type: 'STYLIST' });
    const response = await request(app)
      .get(`/api/admin/support/conversations/${stylistId}`)
      .set(asStaff());

    expect(response.status).toBe(404);
  });

  it('ตัวเลขข้างแท็บสถานะต้องตรงกับจำนวนที่กรองได้จริง', async () => {
    await makeConversation({ status: 'ESCALATED' });
    const all = await request(app).get('/api/admin/support/conversations').set(asStaff());
    const escalated = await request(app)
      .get('/api/admin/support/conversations?status=ESCALATED')
      .set(asStaff());

    expect(all.body.data.counts.escalated).toBe(escalated.body.data.total);
    expect(
      escalated.body.data.items.every((item: { status: string }) => item.status === 'ESCALATED'),
    ).toBe(true);
  });
});

describe('คิวบริการลูกค้า — เจ้าหน้าที่ลงมือ (STEP 37)', () => {
  it('กดรับเรื่องแล้วเคสเป็นของคนนั้น พร้อมบอกลูกค้าว่ามีคนเข้ามาช่วยแล้ว', async () => {
    const id = await makeConversation();
    const response = await request(app)
      .post(`/api/admin/support/conversations/${id}/assign`)
      .set(asStaff())
      .send({});

    expect(response.status).toBe(200);

    const detail = await request(app).get(`/api/admin/support/conversations/${id}`).set(asStaff());

    expect(detail.body.data.assignedTo.id).toBe(staff.id);
    expect(
      detail.body.data.messages.some(
        (message: { role: string; content: string }) =>
          message.role === 'SYSTEM' && message.content.includes('เข้าร่วมการสนทนา'),
      ),
    ).toBe(true);

    const logs = await logsFor(id);

    expect(logs.map((log) => log.action)).toContain('support.ticket.assign');
    expect(logs[0]!.userId).toBe(staff.id);
  });

  it('ข้อความของเจ้าหน้าที่บันทึกเป็น role AGENT ไม่ใช่ ASSISTANT — ลูกค้าต้องแยกออกว่าคุยกับคน', async () => {
    const id = await makeConversation();
    const response = await request(app)
      .post(`/api/admin/support/conversations/${id}/messages`)
      .set(asStaff())
      .send({ message: 'ตรวจให้แล้วครับ พัสดุอยู่ที่ศูนย์คัดแยก คาดว่าถึงพรุ่งนี้' });

    expect(response.status).toBe(200);
    expect(response.body.data.message.role).toBe('AGENT');

    const logs = await logsFor(id);

    expect(logs.map((log) => log.action)).toContain('support.ticket.reply');
  });

  /**
   * กฎ STEP 20 ข้อ 5: ฝั่งลูกค้าต้องดึงข้อความใหม่เองระหว่าง ESCALATED
   * ถ้าคำตอบของเจ้าหน้าที่ไม่ออกมาทาง `/api/ai/cs/history` ลูกค้าจะไม่เห็นเลย
   */
  it('คำตอบของเจ้าหน้าที่ต้องไปถึงจอลูกค้าผ่านประวัติของลูกค้าเอง', async () => {
    const id = await makeConversation();

    await request(app)
      .post(`/api/admin/support/conversations/${id}/messages`)
      .set(asStaff())
      .send({ message: 'ขอเลขที่คำสั่งซื้อด้วยครับ' });

    const history = await request(app).get('/api/ai/cs/history').set(asCustomer());

    expect(history.status).toBe(200);
    expect(
      history.body.data.messages.some(
        (message: { content: string }) => message.content === 'ขอเลขที่คำสั่งซื้อด้วยครับ',
      ),
    ).toBe(true);
  });

  it('ลูกค้าคนอื่นต้องไม่เห็นบทสนทนานี้ในประวัติของตัวเอง', async () => {
    const id = await makeConversation();

    await request(app)
      .post(`/api/admin/support/conversations/${id}/messages`)
      .set(asStaff())
      .send({ message: 'ข้อความที่ไม่ควรหลุดไปหาคนอื่น' });

    const history = await request(app).get('/api/ai/cs/history').set(asOutsider());

    expect(history.status).toBe(200);
    expect(JSON.stringify(history.body.data)).not.toContain('ข้อความที่ไม่ควรหลุดไปหาคนอื่น');
  });

  it('ปิดเคสแล้วต้องบอกลูกค้าในบทสนทนา และบันทึกสถานะก่อน/หลังไว้ในประวัติการแก้ไข', async () => {
    const id = await makeConversation({ status: 'ESCALATED' });
    const response = await request(app)
      .patch(`/api/admin/support/conversations/${id}/status`)
      .set(asStaff())
      .send({ status: 'CLOSED' });

    expect(response.status).toBe(200);

    const detail = await request(app).get(`/api/admin/support/conversations/${id}`).set(asStaff());

    expect(detail.body.data.status).toBe('CLOSED');
    expect(
      detail.body.data.messages.some(
        (message: { role: string; content: string }) =>
          message.role === 'SYSTEM' && message.content.includes('ปิดเรียบร้อย'),
      ),
    ).toBe(true);

    const statusLog = (await logsFor(id)).find((log) => log.action === 'support.ticket.status');

    expect(statusLog).toBeDefined();
    expect(statusLog!.before).toMatchObject({ status: 'ESCALATED' });
    expect(statusLog!.after).toMatchObject({ status: 'CLOSED' });
  });

  it('ข้อความเปล่าตอบกลับไม่ได้ และต้องไม่เขียนอะไรลงบทสนทนา', async () => {
    const id = await makeConversation();
    const response = await request(app)
      .post(`/api/admin/support/conversations/${id}/messages`)
      .set(asStaff())
      .send({ message: '   ' });

    expect(response.status).toBe(422);

    const messages = await prisma.aIChatMessage.findMany({ where: { conversationId: id } });

    expect(messages.some((message) => message.role === 'AGENT')).toBe(false);
  });

  it('สถานะที่ไม่มีในระบบเปลี่ยนไม่ได้', async () => {
    const id = await makeConversation();
    const response = await request(app)
      .patch(`/api/admin/support/conversations/${id}/status`)
      .set(asStaff())
      .send({ status: 'DELETED' });

    expect(response.status).toBe(422);
  });

  it('บทสนทนาที่ไม่มีจริง ทุกการกระทำต้องได้ 404 ไม่ใช่ 500', async () => {
    const missing = randomUUID();

    const detail = await request(app)
      .get(`/api/admin/support/conversations/${missing}`)
      .set(asStaff());
    const assign = await request(app)
      .post(`/api/admin/support/conversations/${missing}/assign`)
      .set(asStaff())
      .send({});
    const reply = await request(app)
      .post(`/api/admin/support/conversations/${missing}/messages`)
      .set(asStaff())
      .send({ message: 'สวัสดีครับ' });

    expect([detail.status, assign.status, reply.status]).toEqual([404, 404, 404]);
  });
});
