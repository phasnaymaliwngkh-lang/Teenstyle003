import { randomUUID } from 'node:crypto';

import { disconnectDatabase, getPrisma } from '@teenstyle/database';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.ts';
import { env } from '../src/config/index.ts';
import { AI_SESSION_COOKIE } from '../src/controllers/ai-stylist.controller.ts';

/**
 * Integration test ของ AI Stylist (STEP 19)
 *
 * สิ่งที่ต้องพิสูจน์:
 *   1. สร้างบทสนทนาและส่งข้อความครั้งแรกได้ทั้ง Guest และ Authenticated User
 *   2. Universal Invariant: สินค้าที่แนะนำต้องมีอยู่จริงในฐานข้อมูล และต้องมีสต็อกพร้อมขาย (No Hallucination)
 *   3. ประวัติการสนทนา (History) มีทั้งข้อความของผู้ใช้และ AI พร้อมข้อมูลการ์ดสินค้าที่อ้างอิง
 *   4. Session Isolation: Guest ต่างคนกันหรือ User คนละคนกันไม่สามารถเห็นแชตของกันและกันได้
 *   5. การรีเซ็ตบทสนทนา (Reset) ปิดห้องเดิมและสร้างห้องใหม่เมื่อมีข้อความถัดไป
 *   6. การตรวจสอบความถูกต้องของข้อมูล (Validation) ปฏิเสธข้อความว่างหรือยาวเกินกำหนด
 */

const app = createApp();
const prisma = getPrisma();

const suffix = randomUUID().slice(0, 8);
let testUserId = '';
let testUserToken = '';
const createdConversationIds: string[] = [];

beforeAll(async () => {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'CUSTOMER' } });
  const user = await prisma.user.create({
    data: {
      email: `test-ai-stylist-${suffix}@teenstyle.test`,
      roleId: role.id,
      status: 'ACTIVE',
    },
  });
  testUserId = user.id;

  testUserToken = `test-ai-session-${randomUUID()}`;
  await prisma.session.create({
    data: {
      sessionToken: testUserToken,
      userId: testUserId,
      expires: new Date(Date.now() + 60 * 60 * 1000),
    },
  });
});

afterAll(async () => {
  if (createdConversationIds.length > 0) {
    await prisma.aIConversation.deleteMany({
      where: { id: { in: createdConversationIds } },
    });
  }

  // ลบการสนทนาของ testUserId
  await prisma.aIConversation.deleteMany({
    where: { userId: testUserId },
  });

  await prisma.session.deleteMany({
    where: { userId: testUserId },
  });

  await prisma.user.deleteMany({
    where: { id: testUserId },
  });

  await disconnectDatabase();
});

const origin = env.CORS_ORIGIN[0] || 'http://localhost:3000';

const asUser = () => ({
  Authorization: `Bearer ${testUserToken}`,
  Origin: origin,
});

describe('STEP 19: AI Stylist — ผู้ช่วยเลือกชุดและสไตล์ส่วนบุคคล', () => {
  describe('Guest Session & Initial State', () => {
    it('GET /api/ai/stylist/history สำหรับ guest ใหม่ คืน messages ว่าง และตั้ง cookie session id', async () => {
      const res = await request(app).get('/api/ai/stylist/history').expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.messages).toEqual([]);

      // ต้องมี Set-Cookie สำหรับ ai-session-id
      const rawCookies = res.headers['set-cookie'];
      const cookieList = Array.isArray(rawCookies)
        ? rawCookies
        : typeof rawCookies === 'string'
          ? [rawCookies]
          : [];
      const hasAiCookie = cookieList.some((c: string) => c.includes(AI_SESSION_COOKIE));
      expect(hasAiCookie).toBe(true);
    });

    it('POST /api/ai/stylist/chat ปฏิเสธข้อความว่าง (Validation error 422)', async () => {
      const res = await request(app)
        .post('/api/ai/stylist/chat')
        .set('Origin', origin)
        .send({ message: '   ' })
        .expect(422);

      expect(res.body.success).toBe(false);
    });
  });

  describe('Chat & Product Recommendations (No Hallucination Invariant)', () => {
    let guestSessionCookie = '';
    let conversationId = '';

    it('Guest ส่งข้อความขอแนะนำชุดมินิมอล → AI ตอบกลับพร้อมแนะนำสินค้าจริงจากคลัง', async () => {
      const res = await request(app)
        .post('/api/ai/stylist/chat')
        .set('Origin', origin)
        .send({
          message: 'ช่วยแนะนำชุดสไตล์ Minimal ไปคาเฟ่โทนสีครีม งบไม่เกิน 2,000 บาทหน่อยครับ',
          preferences: {
            style: 'minimal',
            color: 'ครีม',
            maxBudget: 2000,
          },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.conversationId).toBeDefined();
      conversationId = res.body.data.conversationId;
      createdConversationIds.push(conversationId);

      const msg = res.body.data.message;
      expect(msg.role).toBe('ASSISTANT');
      expect(msg.content).toBeTruthy();
      expect(Array.isArray(msg.referencedProducts)).toBe(true);
      expect(Array.isArray(res.body.data.suggestedPrompts)).toBe(true);

      // บันทึก cookie ของ guest ไว้ใช้ในเทสถัดไป
      const rawCookies = res.headers['set-cookie'];
      const cookieList = Array.isArray(rawCookies)
        ? rawCookies
        : typeof rawCookies === 'string'
          ? [rawCookies]
          : [];
      if (cookieList.length > 0) {
        const match = cookieList.find((c: string) => c.includes(AI_SESSION_COOKIE));
        if (match) guestSessionCookie = match.split(';')[0] || '';
      }

      // Universal Invariant: สินค้าที่แนะนำทุกชิ้นต้องมีอยู่จริงในฐานข้อมูล
      if (msg.referencedProducts.length > 0) {
        for (const prod of msg.referencedProducts) {
          expect(prod.id).toBeDefined();
          expect(prod.name).toBeDefined();
          expect(prod.price).toBeGreaterThan(0);
          expect(prod.stockStatus).not.toBe('OUT_OF_STOCK');

          const dbProd = await prisma.product.findUnique({
            where: { id: prod.id },
          });
          expect(dbProd).not.toBeNull();
          expect(dbProd?.status).toBe('ACTIVE');
          expect(dbProd?.deletedAt).toBeNull();
        }
      }

      // ตรวจสอบใน DB ว่า AIChatMessage มีการบันทึก referencedProductIds ตรงกัน
      const assistantInDb = await prisma.aIChatMessage.findFirst({
        where: { conversationId, role: 'ASSISTANT' },
      });
      expect(assistantInDb).not.toBeNull();
      expect(assistantInDb?.referencedProductIds).toEqual(
        msg.referencedProducts.map((p: { id: string }) => p.id),
      );
    });

    it('GET /api/ai/stylist/history ของ Guest เดิม คืนประวัติครบทั้ง USER และ ASSISTANT', async () => {
      const res = await request(app)
        .get('/api/ai/stylist/history')
        .set('Cookie', guestSessionCookie)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.conversationId).toBe(conversationId);

      const messages = res.body.data.messages;
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages[0].role).toBe('USER');
      expect(messages[1].role).toBe('ASSISTANT');
      expect(messages[1].content).toBeTruthy();
    });

    it('Guest อื่นไม่สามารถเห็นประวัติของ Guest คนแรก (Session Isolation)', async () => {
      const otherGuestSession = `ai-guest-${randomUUID()}`;
      const res = await request(app)
        .get('/api/ai/stylist/history')
        .set('Cookie', `${AI_SESSION_COOKIE}=${otherGuestSession}`)
        .expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.messages).toEqual([]);
    });
  });

  describe('Authenticated User Flow', () => {
    let userConvId = '';

    it('User ที่ล็อกอินส่งข้อความ → ระบบผูก userId กับ AIConversation', async () => {
      const res = await request(app)
        .post('/api/ai/stylist/chat')
        .set(asUser())
        .send({
          message: 'ขอลุคสตรีทแวร์เท่ ๆ หน่อยครับ',
          preferences: { style: 'streetwear' },
        })
        .expect(200);

      expect(res.body.success).toBe(true);
      userConvId = res.body.data.conversationId;
      createdConversationIds.push(userConvId);

      const convInDb = await prisma.aIConversation.findUnique({
        where: { id: userConvId },
      });
      expect(convInDb).not.toBeNull();
      expect(convInDb?.userId).toBe(testUserId);
      expect(convInDb?.sessionId).toBeNull();
      expect(convInDb?.type).toBe('STYLIST');
      expect(convInDb?.status).toBe('ACTIVE');
    });

    it('User ดึงประวัติการคุย คืนข้อความของตัวเอง', async () => {
      const res = await request(app).get('/api/ai/stylist/history').set(asUser()).expect(200);

      expect(res.body.success).toBe(true);
      expect(res.body.data.conversationId).toBe(userConvId);
      expect(res.body.data.messages.length).toBeGreaterThanOrEqual(2);
    });

    it('POST /api/ai/stylist/reset ปิดบทสนทนาเดิม → ข้อความใหม่สร้างห้องใหม่', async () => {
      // 1. Reset บทสนทนาเดิม
      const resetRes = await request(app).post('/api/ai/stylist/reset').set(asUser()).expect(200);

      expect(resetRes.body.success).toBe(true);

      // ตรวจสอบใน DB ว่าสถานะกลายเป็น CLOSED
      const oldConv = await prisma.aIConversation.findUnique({
        where: { id: userConvId },
      });
      expect(oldConv?.status).toBe('CLOSED');

      // 2. ส่งข้อความใหม่หลัง reset
      const newChatRes = await request(app)
        .post('/api/ai/stylist/chat')
        .set(asUser())
        .send({ message: 'เริ่มคุยใหม่ อยากได้ชุดไปเที่ยวทะเล' })
        .expect(200);

      const newConvId = newChatRes.body.data.conversationId;
      expect(newConvId).not.toBe(userConvId);
      createdConversationIds.push(newConvId);

      // 3. ดึง history จะคืนเฉพาะของห้องใหม่
      const historyRes = await request(app)
        .get('/api/ai/stylist/history')
        .set(asUser())
        .expect(200);

      expect(historyRes.body.data.conversationId).toBe(newConvId);
      expect(historyRes.body.data.messages.length).toBe(2);
    });
  });
});
