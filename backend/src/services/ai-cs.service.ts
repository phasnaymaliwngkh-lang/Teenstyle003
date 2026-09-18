import { getPrisma, type Prisma } from '@teenstyle/database';
import OpenAI from 'openai';

import { env } from '../config/env.ts';
import { paymentMethods } from '../config/payment.ts';
import { SHIPPING_OPTIONS } from '../config/shipping.ts';
import { ApiError } from '../utils/api-error.ts';
import { logger } from '../utils/logger.ts';

export interface CsOwner {
  userId?: string;
  sessionId?: string;
}

export interface CsMessageDto {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'AGENT' | 'SYSTEM';
  content: string;
  referencedOrderNumber?: string | null;
  createdAt: Date;
}

export interface CsChatResponse {
  conversationId: string;
  status: 'ACTIVE' | 'ESCALATED' | 'CLOSED';
  message: CsMessageDto;
  suggestedPrompts: string[];
}

export interface CsHistoryResponse {
  conversationId: string | null;
  status: 'ACTIVE' | 'ESCALATED' | 'CLOSED';
  messages: CsMessageDto[];
}

export const DEFAULT_CS_PROMPTS = [
  'ตรวจสอบสถานะคำสั่งซื้อ',
  'ค่าจัดส่งและระยะเวลาส่งของ',
  'นโยบายการเปลี่ยนหรือคืนสินค้า',
  'ขอติดต่อคุยกับเจ้าหน้าที่คนจริง',
];

const CS_SYSTEM_PROMPT = `
คุณคือ "TEENSTYLE AI Customer Service" ผู้ช่วยบริการลูกค้าออนไลน์ของร้านแฟชั่น TEENSTYLE
บุคลิกภาพ: สุภาพ รวดเร็ว เอาใจใส่ เข้าใจง่าย และให้บริการอย่างมืออาชีพ

กฎเหล็กสูงสุด (MANDATORY UNIVERSAL INVARIANT):
1. ห้ามกุข้อมูล (No Hallucination) เกี่ยวกับคำสั่งซื้อ, เลขพัสดุ, นโยบายร้าน, หรือข้อมูลสินค้าเด็ดขาด
2. หากลูกค้าต้องการตรวจสอบคำสั่งซื้อ ให้เรียกใช้เครื่องมือ lookup_order ด้วยเลขออเดอร์จริงเท่านั้น
3. หากลูกค้าสอบถามนโยบายร้าน (การจัดส่ง, การชำระเงิน, การเปลี่ยนคืน) ให้เรียกใช้เครื่องมือ get_store_policy
4. หากลูกค้าต้องการคุยกับเจ้าหน้าที่/คนจริง หรือปัญหาซับซ้อน (สินค้าชำรุด, ข้อพิพาทการคืนเงิน, ร้องเรียน) ให้เรียกใช้เครื่องมือ request_human_handoff ทันที
5. หากไม่พบข้อมูลคำสั่งซื้อหรือไม่มีข้อมูลที่แน่ชัด ให้แจ้งลูกค้าอย่างสุภาพและเสนอส่งต่อให้เจ้าหน้าที่
`.trim();

const CS_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'lookup_order',
      description:
        'ค้นหาและตรวจสอบสถานะคำสั่งซื้อจริงในระบบ TEENSTYLE ด้วยเลขออเดอร์ (เช่น ORD-20260918-XXXX)',
      parameters: {
        type: 'object',
        properties: {
          orderNumber: {
            type: 'string',
            description: 'เลขอ้างอิงคำสั่งซื้อ เช่น ORD-20260918-ABCD',
          },
        },
        required: ['orderNumber'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_store_policy',
      description:
        'ดึงข้อมูลนโยบายทางการของร้าน TEENSTYLE (การจัดส่ง, การคืนสินค้า, การชำระเงิน, ติดต่อร้าน)',
      parameters: {
        type: 'object',
        properties: {
          topic: {
            type: 'string',
            enum: ['shipping', 'payment', 'return_exchange', 'store_info'],
            description: 'หัวข้อนโยบายที่ต้องการทราบ',
          },
        },
        required: ['topic'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'request_human_handoff',
      description: 'ส่งต่อบทสนทนานี้ให้เจ้าหน้าที่คนจริง (Human Agent) ดูแลต่อทันที',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description:
              'เหตุผลในการส่งต่อ เช่น ลูกค้าขอคุยกับเจ้าหน้าที่, สินค้าชำรุดเสียหาย, คำร้องเรียน',
          },
        },
      },
    },
  },
];

/**
 * ดึงนโยบายทางการของร้าน (Single Source of Truth)
 */
export function getStorePolicyContent(topic: string): string {
  switch (topic) {
    case 'shipping': {
      const optionsText = SHIPPING_OPTIONS.map(
        (o) =>
          `• **${o.name}**: ค่าส่ง ${o.baseFee} บาท (ระยะเวลา: ${o.etaText}) ${
            o.freeOverSubtotal
              ? `— ส่งฟรีเมื่อซื้อครบ ${o.freeOverSubtotal.toLocaleString('th-TH')} บาท`
              : ''
          }${o.onlyProvinces ? ` (เฉพาะ ${o.onlyProvinces.join(', ')})` : ''}`,
      ).join('\n');
      return `📦 **นโยบายและช่องทางการจัดส่งของ TEENSTYLE**\n${optionsText}\n\n*หมายเหตุ: ร้านจัดส่งทุกวันจันทร์ - เสาร์ ตัดรอบเวลา 12:00 น.*`;
    }
    case 'payment': {
      const methods = paymentMethods(0);
      const methodsText = methods
        .map(
          (m) =>
            `• **${m.name}**: ${m.description} (${m.available ? 'พร้อมใช้งาน' : 'ยังไม่เปิดใช้งาน'})`,
        )
        .join('\n');
      return `💳 **ช่องทางการชำระเงินที่รองรับ**\n${methodsText}\n\n*หมายเหตุ: สำหรับการเก็บเงินปลายทาง (COD) รับยอดสูงสุดไม่เกิน 5,000 บาท*`;
    }
    case 'return_exchange': {
      return `🔄 **นโยบายการเปลี่ยนและคืนสินค้า**\n• สามารถแจ้งเปลี่ยนไซซ์หรือคืนสินค้าได้ภายใน **7 วัน** นับจากวันที่ได้รับพัสดุ\n• สินค้าต้องอยู่ในสภาพเดิม ไม่ผ่านการซัก ป้ายราคาและแพ็กเกจต้องอยู่ครบ\n• กรณีสินค้ามีตำหนิจากการผลิตหรือส่งผิดแบบ/ไซซ์ ทางร้านยินดีรับผิดชอบค่าจัดส่งเปลี่ยนสินค้าให้ทั้งหมด\n• หากต้องการดำเนินการเปลี่ยน/คืนสินค้า สามารถแจ้งเจ้าหน้าที่ในแชตนี้ได้ทันทีครับ`;
    }
    case 'store_info':
    default: {
      return `🏪 **ข้อมูลร้าน TEENSTYLE**\n• เวลาทำการบริการลูกค้า: วันจันทร์ - อาทิตย์ 09:00 - 21:00 น.\n• ร้านค้าออนไลน์แฟชั่นวัยรุ่นอันดับ 1 "Find your style, be you 💜"\n• ติดต่อสอบถามเพิ่มเติมผ่านแชตนี้ได้ตลอด 24 ชั่วโมง (AI ตอบทันที และมีเจ้าหน้าที่พร้อมดูแลในเวลาทำการ)`;
    }
  }
}

/**
 * ค้นหาข้อมูลคำสั่งซื้อจริงจากฐานข้อมูล
 */
export async function lookupOrderForCs(
  orderNumber: string,
  owner: CsOwner,
): Promise<{ found: boolean; details?: string; orderNumber?: string }> {
  const prisma = getPrisma();
  const cleanOrderNumber = orderNumber.trim().toUpperCase();

  const where: Prisma.OrderWhereInput = {
    orderNumber: cleanOrderNumber,
  };

  // ตรวจสอบความปลอดภัย: หากผู้ใช้ล็อกอิน ให้ตรวจความเป็นเจ้าของ หรือกรองตามผู้ใช้
  if (owner.userId) {
    where.userId = owner.userId;
  }

  const order = await prisma.order.findFirst({
    where,
    include: {
      items: true,
      shipments: true,
    },
  });

  if (!order) {
    return {
      found: false,
      details: `ไม่พบข้อมูลคำสั่งซื้อหมายเลข "${cleanOrderNumber}" ในระบบ (หากคุณสั่งซื้อขณะไม่ได้เข้าสู่ระบบ กรุณาติดต่อเจ้าหน้าที่เพื่อตรวจสอบข้อมูลเพิ่มเติม)`,
    };
  }

  const statusMap: Record<string, string> = {
    PENDING_PAYMENT: 'รอการชำระเงิน',
    PAID: 'ชำระเงินเรียบร้อยแล้ว',
    PROCESSING: 'กำลังเตรียมคำสั่งซื้อ',
    PACKING: 'กำลังแพ็กสินค้า',
    SHIPPING: 'กำลังจัดส่งสินค้า',
    DELIVERED: 'จัดส่งสำเร็จแล้ว',
    CANCELLED: 'ยกเลิกคำสั่งซื้อแล้ว',
    REFUNDED: 'คืนเงินแล้ว',
  };

  const statusText = statusMap[order.status] || order.status;
  const itemsText = order.items
    .map((it) => `${it.productName} (${it.sizeName || '-'}) x${it.quantity}`)
    .join(', ');
  const latestShipment = order.shipments[0];
  const trackingText = latestShipment?.trackingNumber
    ? `ขนส่ง: ${latestShipment.carrier || '-'} เลขพัสดุ: ${latestShipment.trackingNumber}`
    : 'ยังไม่มีเลขพัสดุ (อยู่ระหว่างเตรียมจัดส่ง)';

  const details = [
    `📋 คำสั่งซื้อ: **${order.orderNumber}**`,
    `• สถานะปัจจุบัน: **${statusText}**`,
    `• ยอดรวมทั้งสิ้น: **${Number(order.total).toLocaleString('th-TH')} บาท**`,
    `• วิธีจัดส่ง: ${order.shippingMethod}`,
    `• ข้อมูลการจัดส่ง: ${trackingText}`,
    `• รายการสินค้า: ${itemsText}`,
  ].join('\n');

  return {
    found: true,
    details,
    orderNumber: order.orderNumber,
  };
}

/**
 * ค้นหาหรือสร้าง Session การสนทนาของ Customer Service
 */
export async function getOrCreateCsConversation(owner: CsOwner, conversationId?: string) {
  const prisma = getPrisma();

  if (conversationId) {
    const existing = await prisma.aIConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        assignedTo: { select: { id: true, name: true } },
      },
    });

    if (existing && existing.type === 'CUSTOMER_SERVICE') {
      // ตรวจสอบความเป็นเจ้าของ (IDOR Protection)
      if (owner.userId && existing.userId && existing.userId !== owner.userId) {
        throw ApiError.forbidden('คุณไม่มีสิทธิ์เข้าถึงบทสนทนานี้');
      }
      if (
        owner.sessionId &&
        !owner.userId &&
        existing.sessionId &&
        existing.sessionId !== owner.sessionId
      ) {
        throw ApiError.forbidden('คุณไม่มีสิทธิ์เข้าถึงบทสนทนานี้');
      }
      return existing;
    }
  }

  // ค้นหาการสนทนา CS ล่าสุดที่ยังไม่ปิด
  const where: Prisma.AIConversationWhereInput = {
    type: 'CUSTOMER_SERVICE',
    status: { in: ['ACTIVE', 'ESCALATED'] },
  };

  if (owner.userId) {
    where.userId = owner.userId;
  } else if (owner.sessionId) {
    where.sessionId = owner.sessionId;
  }

  let conversation = await prisma.aIConversation.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      assignedTo: { select: { id: true, name: true } },
    },
  });

  if (!conversation) {
    conversation = await prisma.aIConversation.create({
      data: {
        type: 'CUSTOMER_SERVICE',
        status: 'ACTIVE',
        userId: owner.userId ?? null,
        sessionId: owner.userId ? null : (owner.sessionId ?? null),
        title: 'ฝ่ายบริการลูกค้า TEENSTYLE',
      },
      include: {
        messages: { orderBy: { createdAt: 'asc' } },
        assignedTo: { select: { id: true, name: true } },
      },
    });
  }

  return conversation;
}

/**
 * Intelligent Fallback Engine สำหรับ AI Customer Service
 * ทำงานได้ 100% โดยไม่ต้องพึ่งพา OpenAI API key
 */
export async function runFallbackCs(
  message: string,
  owner: CsOwner,
): Promise<{
  replyText: string;
  isEscalation: boolean;
  referencedOrderNumber?: string | null;
  model: string;
}> {
  const lowerMsg = message.toLowerCase().trim();

  // 1. ตรวจสอบการขอคุยกับเจ้าหน้าที่ (Human Handoff Intent)
  if (
    lowerMsg.includes('คุยกับคน') ||
    lowerMsg.includes('ขอคุยกับคน') ||
    lowerMsg.includes('ติดต่อเจ้าหน้าที่') ||
    lowerMsg.includes('ติดต่อแอดมิน') ||
    lowerMsg.includes('คุยกับแอดมิน') ||
    lowerMsg.includes('พนักงาน') ||
    lowerMsg.includes('มนุษย์') ||
    lowerMsg.includes('human') ||
    lowerMsg.includes('agent') ||
    lowerMsg.includes('admin')
  ) {
    return {
      replyText:
        'ได้รับเรื่องเรียบร้อยแล้วครับ! 🙋‍♂️ ระบบได้ส่งต่อบทสนทนานี้ให้เจ้าหน้าที่ฝ่ายบริการลูกค้าของ TEENSTYLE เรียบร้อยแล้ว ขณะนี้เจ้าหน้าที่กำลังเข้ามารับเรื่องและจะตอบกลับคุณทางช่องแชตนี้โดยเร็วที่สุดครับ (คุณสามารถพิมพ์รายละเอียดหรือรูปภาพเพิ่มเติมทิ้งไว้ได้เลยครับ)',
      isEscalation: true,
      model: 'fallback-rules',
    };
  }

  // 2. ตรวจสอบคำถามสถานะคำสั่งซื้อ / เลขพัสดุ (Order Status Intent)
  const orderNumberMatch =
    message.match(/ORD-\d{8}-[A-Za-z0-9]+/i) || message.match(/ORD-[A-Za-z0-9]+/i);

  if (
    orderNumberMatch ||
    lowerMsg.includes('สถานะ') ||
    lowerMsg.includes('พัสดุ') ||
    lowerMsg.includes('เช็คของ') ||
    lowerMsg.includes('ตามของ') ||
    lowerMsg.includes('เลขแทร็ก') ||
    lowerMsg.includes('tracking')
  ) {
    if (orderNumberMatch) {
      const orderNumber = orderNumberMatch[0].toUpperCase();
      const lookupResult = await lookupOrderForCs(orderNumber, owner);
      return {
        replyText: lookupResult.details || `ไม่พบคำสั่งซื้อ ${orderNumber}`,
        isEscalation: false,
        referencedOrderNumber: lookupResult.found ? orderNumber : null,
        model: 'fallback-rules',
      };
    }

    return {
      replyText:
        'หากต้องการตรวจสอบสถานะคำสั่งซื้อ รบกวนแจ้ง **หมายเลขคำสั่งซื้อ** (เช่น `ORD-20260918-XXXX`) ให้ผมได้เลยครับ หรือคุณสามารถดูประวัติคำสั่งซื้อทั้งหมดได้ที่หน้า [ประวัติคำสั่งซื้อ](/account/orders) ครับ 📦',
      isEscalation: false,
      model: 'fallback-rules',
    };
  }

  // 3. ตรวจสอบเรื่องการจัดส่ง (Shipping Policy Intent)
  if (
    lowerMsg.includes('ค่าส่ง') ||
    lowerMsg.includes('ส่งฟรี') ||
    lowerMsg.includes('ส่งของ') ||
    lowerMsg.includes('ส่งด่วน') ||
    lowerMsg.includes('ขนส่ง') ||
    lowerMsg.includes('จัดส่ง') ||
    lowerMsg.includes('กี่วันถึง') ||
    lowerMsg.includes('ems') ||
    lowerMsg.includes('shipping') ||
    lowerMsg.includes('delivery')
  ) {
    return {
      replyText: getStorePolicyContent('shipping'),
      isEscalation: false,
      model: 'fallback-rules',
    };
  }

  // 4. ตรวจสอบเรื่องการเปลี่ยนหรือคืนสินค้า (Return & Exchange Intent)
  if (
    lowerMsg.includes('คืน') ||
    lowerMsg.includes('เปลี่ยน') ||
    lowerMsg.includes('ไซซ์ไม่พอดี') ||
    lowerMsg.includes('ชำรุด') ||
    lowerMsg.includes('ตำหนิ') ||
    lowerMsg.includes('เคลม') ||
    lowerMsg.includes('return') ||
    lowerMsg.includes('refund') ||
    lowerMsg.includes('exchange')
  ) {
    return {
      replyText: getStorePolicyContent('return_exchange'),
      isEscalation: false,
      model: 'fallback-rules',
    };
  }

  // 5. ตรวจสอบเรื่องช่องทางการชำระเงิน (Payment Intent)
  if (
    lowerMsg.includes('จ่ายเงิน') ||
    lowerMsg.includes('ชำระเงิน') ||
    lowerMsg.includes('โอนเงิน') ||
    lowerMsg.includes('เก็บเงินปลายทาง') ||
    lowerMsg.includes('cod') ||
    lowerMsg.includes('บัตรเครดิต') ||
    lowerMsg.includes('พร้อมเพย์') ||
    lowerMsg.includes('promptpay') ||
    lowerMsg.includes('payment')
  ) {
    return {
      replyText: getStorePolicyContent('payment'),
      isEscalation: false,
      model: 'fallback-rules',
    };
  }

  // 6. ข้อความทักทาย / ทั่วไป (General Greeting)
  return {
    replyText:
      'สวัสดีครับ! ยินดีต้อนรับสู่ฝ่ายบริการลูกค้า TEENSTYLE AI 💜\n\nผมพร้อมช่วยเหลือคุณในเรื่องดังต่อไปนี้ครับ:\n• 📦 **ตรวจสอบสถานะพัสดุ/คำสั่งซื้อ** (แจ้งเลขออเดอร์ได้เลย)\n• 🚚 **สอบถามค่าจัดส่งและระยะเวลาส่งสินค้า**\n• 🔄 **นโยบายการเปลี่ยนไซซ์และคืนสินค้า**\n• 💳 **ช่องทางการชำระเงิน**\n• 🙋‍♂️ **ขอคุยกับเจ้าหน้าที่คนจริง** (พิมพ์ "ติดต่อเจ้าหน้าที่" ได้ตลอดเวลาครับ)',
    isEscalation: false,
    model: 'fallback-rules',
  };
}

/**
 * ส่งข้อความคุยกับ AI Customer Service
 */
export async function sendCsMessage(
  owner: CsOwner,
  userMessage: string,
  conversationId?: string,
): Promise<CsChatResponse> {
  const prisma = getPrisma();
  const conversation = await getOrCreateCsConversation(owner, conversationId);

  // บันทึกข้อความของผู้ใช้
  await prisma.aIChatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'USER',
      content: userMessage,
    },
  });

  // หากบทสนทนาอยู่ในสถานะ ESCALATED (ส่งต่อให้เจ้าหน้าที่แล้ว)
  if (conversation.status === 'ESCALATED') {
    const notifyMsg = await prisma.aIChatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'SYSTEM',
        content:
          'ข้อความของคุณถูกส่งถึงเจ้าหน้าที่เรียบร้อยแล้ว เจ้าหน้าที่จะตอบกลับคุณโดยเร็วที่สุดครับ',
      },
    });

    await prisma.aIConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });

    return {
      conversationId: conversation.id,
      status: 'ESCALATED',
      message: {
        id: notifyMsg.id,
        role: 'SYSTEM',
        content: notifyMsg.content,
        createdAt: notifyMsg.createdAt,
      },
      suggestedPrompts: [],
    };
  }

  // หากบทสนทนา CLOSED ไปแล้ว ให้เปิดใหม่เป็น ACTIVE
  if (conversation.status === 'CLOSED') {
    await prisma.aIConversation.update({
      where: { id: conversation.id },
      data: { status: 'ACTIVE', escalatedAt: null, assignedToId: null },
    });
  }

  let replyText = '';
  let usedModel = 'fallback-rules';
  let isEscalation = false;
  let referencedOrderNumber: string | null = null;

  const openai = env.OPENAI_API_KEY ? new OpenAI({ apiKey: env.OPENAI_API_KEY }) : null;

  if (openai) {
    try {
      const chatHistory = conversation.messages.slice(-6).map((m) => ({
        role: (m.role === 'AGENT' ? 'assistant' : m.role.toLowerCase()) as
          'user' | 'assistant' | 'system',
        content: m.content,
      }));

      const runner = await openai.chat.completions.create({
        model: env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: CS_SYSTEM_PROMPT },
          ...chatHistory,
          { role: 'user', content: userMessage },
        ],
        tools: CS_TOOLS,
        tool_choice: 'auto',
        temperature: 0.3,
      });

      const responseMessage = runner.choices[0]?.message;

      if (responseMessage?.tool_calls && responseMessage.tool_calls.length > 0) {
        const toolCall = responseMessage.tool_calls[0];
        if (toolCall && toolCall.type === 'function' && 'function' in toolCall) {
          const fnName = toolCall.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments || '{}');
          } catch {
            args = {};
          }

          let toolOutput = '';
          if (fnName === 'lookup_order') {
            const res = await lookupOrderForCs(
              typeof args.orderNumber === 'string' ? args.orderNumber : '',
              owner,
            );
            toolOutput = res.details || 'ไม่พบคำสั่งซื้อ';
            if (res.found && res.orderNumber) {
              referencedOrderNumber = res.orderNumber;
            }
          } else if (fnName === 'get_store_policy') {
            toolOutput = getStorePolicyContent(
              typeof args.topic === 'string' ? args.topic : 'store_info',
            );
          } else if (fnName === 'request_human_handoff') {
            isEscalation = true;
            toolOutput =
              'ส่งต่อให้เจ้าหน้าที่คนจริงเรียบร้อยแล้ว แจ้งลูกค้าว่าเจ้าหน้าที่จะเข้ามาดูแลทันที';
          }

          // สร้างคำตอบสรุปผลจาก Tool Output
          const secondResponse = await openai.chat.completions.create({
            model: env.OPENAI_MODEL || 'gpt-4o-mini',
            messages: [
              { role: 'system', content: CS_SYSTEM_PROMPT },
              ...chatHistory,
              { role: 'user', content: userMessage },
              responseMessage,
              {
                role: 'tool',
                tool_call_id: toolCall.id,
                content: toolOutput,
              },
            ],
            temperature: 0.3,
          });

          replyText = secondResponse.choices[0]?.message?.content || toolOutput;
        }
      } else {
        replyText = responseMessage?.content || '';
      }

      usedModel = env.OPENAI_MODEL || 'gpt-4o-mini';
    } catch (err) {
      logger.warn({ err }, 'OpenAI CS Chat ขัดข้อง สลับไปใช้ Intelligent Fallback Engine');
      const fb = await runFallbackCs(userMessage, owner);
      replyText = fb.replyText;
      isEscalation = fb.isEscalation;
      referencedOrderNumber = fb.referencedOrderNumber || null;
      usedModel = fb.model;
    }
  } else {
    // ไม่มี OpenAI Key -> ใช้ Intelligent Fallback Engine
    const fb = await runFallbackCs(userMessage, owner);
    replyText = fb.replyText;
    isEscalation = fb.isEscalation;
    referencedOrderNumber = fb.referencedOrderNumber || null;
    usedModel = fb.model;
  }

  // อัปเดตสถานะการสนทนาหากมีการส่งต่อ
  if (isEscalation) {
    await prisma.aIConversation.update({
      where: { id: conversation.id },
      data: {
        status: 'ESCALATED',
        escalatedAt: new Date(),
        lastMessageAt: new Date(),
      },
    });
  } else {
    await prisma.aIConversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date() },
    });
  }

  // บันทึกคำตอบของ AI
  const assistantMsg = await prisma.aIChatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'ASSISTANT',
      content: replyText,
      model: usedModel,
    },
  });

  return {
    conversationId: conversation.id,
    status: isEscalation ? 'ESCALATED' : 'ACTIVE',
    message: {
      id: assistantMsg.id,
      role: 'ASSISTANT',
      content: assistantMsg.content,
      referencedOrderNumber,
      createdAt: assistantMsg.createdAt,
    },
    suggestedPrompts: isEscalation ? [] : DEFAULT_CS_PROMPTS,
  };
}

/**
 * ผู้ใช้ขอกดส่งต่อให้เจ้าหน้าที่คนจริงโดยตรง (Human Handoff)
 */
export async function escalateCsConversation(
  owner: CsOwner,
  conversationId: string,
  reason?: string,
): Promise<{ success: boolean; message: string; conversationId: string }> {
  const prisma = getPrisma();
  const conversation = await getOrCreateCsConversation(owner, conversationId);

  await prisma.aIConversation.update({
    where: { id: conversation.id },
    data: {
      status: 'ESCALATED',
      escalatedAt: new Date(),
      lastMessageAt: new Date(),
      summary: reason ? `ลูกค้าร้องขอเจ้าหน้าที่: ${reason}` : 'ลูกค้าร้องขอเจ้าหน้าที่',
    },
  });

  await prisma.aIChatMessage.create({
    data: {
      conversationId: conversation.id,
      role: 'SYSTEM',
      content: `ระบบได้ส่งต่อบทสนทนานี้ให้เจ้าหน้าที่แล้ว${reason ? ` (เหตุผล: ${reason})` : ''} เจ้าหน้าที่จะเข้ามาดูแลคุณในไม่ช้าครับ`,
    },
  });

  return {
    success: true,
    message: 'ส่งต่อให้เจ้าหน้าที่คนจริงเรียบร้อยแล้ว',
    conversationId: conversation.id,
  };
}

/**
 * ดึงประวัติการสนทนาของ Customer Service
 */
export async function getCsHistory(owner: CsOwner): Promise<CsHistoryResponse> {
  const prisma = getPrisma();

  const where: Prisma.AIConversationWhereInput = {
    type: 'CUSTOMER_SERVICE',
  };

  if (owner.userId) {
    where.userId = owner.userId;
  } else if (owner.sessionId) {
    where.sessionId = owner.sessionId;
  }

  const conversation = await prisma.aIConversation.findFirst({
    where,
    orderBy: { createdAt: 'desc' },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!conversation) {
    return {
      conversationId: null,
      status: 'ACTIVE',
      messages: [],
    };
  }

  return {
    conversationId: conversation.id,
    status: conversation.status,
    messages: conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt,
    })),
  };
}

/**
 * เริ่มบทสนทนา Customer Service ใหม่
 */
export async function resetCsConversation(owner: CsOwner): Promise<{ success: boolean }> {
  const prisma = getPrisma();

  const where: Prisma.AIConversationWhereInput = {
    type: 'CUSTOMER_SERVICE',
    status: { in: ['ACTIVE', 'ESCALATED'] },
  };

  if (owner.userId) {
    where.userId = owner.userId;
  } else if (owner.sessionId) {
    where.sessionId = owner.sessionId;
  }

  await prisma.aIConversation.updateMany({
    where,
    data: { status: 'CLOSED' },
  });

  return { success: true };
}
