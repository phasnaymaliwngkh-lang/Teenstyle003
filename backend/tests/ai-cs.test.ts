import { describe, expect, it } from 'vitest';

import {
  DEFAULT_CS_PROMPTS,
  getStorePolicyContent,
  runFallbackCs,
} from '../src/services/ai-cs.service.ts';
import {
  adminSupportReplySchema,
  adminSupportStatusSchema,
  csChatSchema,
  csEscalateSchema,
} from '../src/validators/ai-cs.validator.ts';

describe('AI Customer Service (STEP 20)', () => {
  describe('Intelligent Fallback Engine & Intent Parsing', () => {
    it('ระบุ intent การขอคุยกับเจ้าหน้าที่ (Human Handoff) และตั้งค่า isEscalation เป็น true', async () => {
      const handoffMessages = [
        'ขอคุยกับคนหน่อยครับ',
        'ติดต่อเจ้าหน้าที่ได้ที่ไหน',
        'แอดมินอยู่ไหม ขอคุยกับแอดมิน',
        'ต้องการคุยกับพนักงาน',
        'Can I talk to a human agent please',
      ];

      for (const msg of handoffMessages) {
        const result = await runFallbackCs(msg, { sessionId: 'test-session-1' });
        expect(result.isEscalation).toBe(true);
        expect(result.replyText).toContain('เจ้าหน้าที่');
      }
    });

    it('ระบุ intent เรื่องการจัดส่ง (Shipping Policy) ได้อย่างถูกต้อง', async () => {
      const shippingMessages = [
        'ค่าส่งเท่าไหร่',
        'ซื้อกี่บาทถึงส่งฟรี',
        'จัดส่งกี่วันถึง',
        'มีส่งด่วนไหม',
      ];

      for (const msg of shippingMessages) {
        const result = await runFallbackCs(msg, { sessionId: 'test-session-1' });
        expect(result.isEscalation).toBe(false);
        expect(result.replyText).toContain('จัดส่ง');
        expect(result.replyText).toContain('ส่งธรรมดา');
        expect(result.replyText).toContain('1,000');
      }
    });

    it('ระบุ intent เรื่องการเปลี่ยนหรือคืนสินค้า (Return & Exchange) ได้อย่างถูกต้อง', async () => {
      const returnMessages = [
        'คืนของได้ไหม',
        'สั่งมาแล้วไซซ์ไม่พอดีขอเปลี่ยนได้ไหม',
        'เสื้อมีตำหนิเคลมยังไง',
        'นโยบายคืนสินค้าเป็นอย่างไร',
      ];

      for (const msg of returnMessages) {
        const result = await runFallbackCs(msg, { sessionId: 'test-session-1' });
        expect(result.isEscalation).toBe(false);
        expect(result.replyText).toContain('7 วัน');
        expect(result.replyText).toContain('เปลี่ยน');
      }
    });

    it('ระบุ intent เรื่องช่องทางการชำระเงิน (Payment) ได้อย่างถูกต้อง', async () => {
      const paymentMessages = [
        'มีเก็บเงินปลายทางไหม',
        'ชำระเงินยังไงได้บ้าง',
        'จ่ายผ่านบัตรเครดิตหรือพร้อมเพย์ได้ไหม',
      ];

      for (const msg of paymentMessages) {
        const result = await runFallbackCs(msg, { sessionId: 'test-session-1' });
        expect(result.isEscalation).toBe(false);
        expect(result.replyText).toContain('ชำระเงิน');
        expect(result.replyText).toContain('ปลายทาง');
      }
    });

    it('ตอบข้อความทักทายทั่วไปพร้อมเมนูช่วยเหลือแนะนำ', async () => {
      const result = await runFallbackCs('สวัสดีครับ', { sessionId: 'test-session-1' });
      expect(result.isEscalation).toBe(false);
      expect(result.replyText).toContain('TEENSTYLE AI');
      expect(result.replyText).toContain('ตรวจสอบสถานะพัสดุ');
    });

    it('แจ้งเตือนขอเลขออเดอร์หากถามเรื่องพัสดุแต่ยังไม่ได้ระบุเลข', async () => {
      const result = await runFallbackCs('พัสดุถึงไหนแล้ว', { sessionId: 'test-session-1' });
      expect(result.isEscalation).toBe(false);
      expect(result.replyText).toContain('หมายเลขคำสั่งซื้อ');
      expect(result.replyText).toContain('ORD-');
    });
  });

  describe('Single Source of Truth Store Policies', () => {
    it('นโยบายการจัดส่งดึงจาก SHIPPING_OPTIONS จริงของระบบ', () => {
      const content = getStorePolicyContent('shipping');
      expect(content).toContain('ส่งธรรมดา');
      expect(content).toContain('ส่งด่วน');
      expect(content).toContain('50 บาท');
      expect(content).toContain('120 บาท');
    });

    it('นโยบายการชำระเงินมีข้อกำหนด COD สูงสุด 5,000 บาท', () => {
      const content = getStorePolicyContent('payment');
      expect(content).toContain('5,000 บาท');
      expect(content).toContain('COD');
    });

    it('มีชุดคำถามแนะนำตั้งต้น (Default Prompts) 4 ข้อ', () => {
      expect(DEFAULT_CS_PROMPTS.length).toBeGreaterThanOrEqual(4);
      expect(DEFAULT_CS_PROMPTS).toContain('ตรวจสอบสถานะคำสั่งซื้อ');
      expect(DEFAULT_CS_PROMPTS).toContain('ขอติดต่อคุยกับเจ้าหน้าที่คนจริง');
    });
  });

  describe('Zod Validation for CS & Support', () => {
    it('csChatSchema: ตรวจสอบความถูกต้องของข้อความ', () => {
      // ผ่าน
      expect(csChatSchema.safeParse({ message: 'สวัสดี' }).success).toBe(true);
      expect(
        csChatSchema.safeParse({
          message: 'สอบถามสินค้า',
          conversationId: 'c7b3a88c-7c5c-4932-a52b-9c64be70d5f1',
        }).success,
      ).toBe(true);

      // ข้อความว่าง -> ล้มเหลว
      const emptyRes = csChatSchema.safeParse({ message: '   ' });
      expect(emptyRes.success).toBe(false);

      // รหัสการสนทนาไม่ใช่ UUID -> ล้มเหลว
      const invalidUuid = csChatSchema.safeParse({
        message: 'สวัสดี',
        conversationId: 'invalid-id-123',
      });
      expect(invalidUuid.success).toBe(false);
    });

    it('csEscalateSchema: บังคับระบุ conversationId ที่เป็น UUID', () => {
      expect(
        csEscalateSchema.safeParse({
          conversationId: 'c7b3a88c-7c5c-4932-a52b-9c64be70d5f1',
          reason: 'ต้องการเปลี่ยนที่อยู่จัดส่ง',
        }).success,
      ).toBe(true);

      expect(csEscalateSchema.safeParse({ conversationId: 'abc' }).success).toBe(false);
    });

    it('adminSupportReplySchema: ตรวจสอบข้อความตอบกลับของเจ้าหน้าที่', () => {
      expect(
        adminSupportReplySchema.safeParse({ message: 'สวัสดีครับ ทางร้านยินดีดูแลครับ' }).success,
      ).toBe(true);
      expect(adminSupportReplySchema.safeParse({ message: '' }).success).toBe(false);
    });

    it('adminSupportStatusSchema: ยอมรับเฉพาะ ACTIVE, ESCALATED, CLOSED', () => {
      expect(adminSupportStatusSchema.safeParse({ status: 'ACTIVE' }).success).toBe(true);
      expect(adminSupportStatusSchema.safeParse({ status: 'ESCALATED' }).success).toBe(true);
      expect(adminSupportStatusSchema.safeParse({ status: 'CLOSED' }).success).toBe(true);
      expect(adminSupportStatusSchema.safeParse({ status: 'PENDING' }).success).toBe(false);
    });
  });
});
