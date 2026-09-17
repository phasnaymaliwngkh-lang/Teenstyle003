import { getPrisma, type Prisma } from '@teenstyle/database';
import OpenAI from 'openai';

import { env } from '../config/env.ts';
import type { ProductCardDto } from '../models/product.model.ts';
import { PRODUCT_CARD_SELECT, toProductCards } from './product.service.ts';
import type { StylistPreferences } from '../validators/ai.validator.ts';

export interface StylistOwner {
  userId?: string;
  sessionId?: string;
}

export interface StylistMessageDto {
  id: string;
  role: 'USER' | 'ASSISTANT';
  content: string;
  referencedProducts: ProductCardDto[];
  createdAt: Date;
}

export interface StylistChatResponse {
  conversationId: string;
  message: StylistMessageDto;
  suggestedPrompts: string[];
}

export interface StylistHistoryResponse {
  conversationId: string | null;
  messages: StylistMessageDto[];
}

/**
 * Prompt แนะนำเบื้องต้นสำหรับช่วยให้ลูกค้าเริ่มต้นบทสนทนาได้ง่าย
 */
const DEFAULT_SUGGESTED_PROMPTS = [
  'แนะนำชุดมินิมอลไปคาเฟ่ วันสบาย ๆ งบไม่เกิน 1,500 บาท',
  'อยากได้ลุคสตรีทแวร์เท่ ๆ ใส่เที่ยวสยาม',
  'ช่วยแมตช์ชุดโทนสีเอิร์ธโทน เรียบหรูดูดี',
  'แนะนำเสื้อยืดโอเวอร์ไซซ์ใส่คู่กับกางเกงยีนส์',
];

/**
 * System prompt หลักสำหรับ AI Stylist
 */
const STYLIST_SYSTEM_PROMPT = `
คุณคือ "TEENSTYLE AI Stylist" ที่ปรึกษาและสไตลิสต์แฟชั่นสำหรับวัยรุ่นและคนรุ่นใหม่
บุคลิกภาพ: สดใส เป็นมิตร มีสไตล์ สนุกสนาน และเชี่ยวชาญเรื่องการแมตช์เสื้อผ้า โทนสี และเทรนด์แฟชั่นวัยรุ่น (Streetwear, Minimal, Y2K, Korean, Vintage)

กฎเหล็กสูงสุด (MANDATORY UNIVERSAL INVARIANT):
1. แนะนำเฉพาะสินค้าที่มีอยู่จริงในระบบ TEENSTYLE โดยต้องเรียกเครื่องมือ search_catalog เท่านั้น
2. ห้ามแต่งชื่อสินค้า ห้ามสมมุติรหัสสินค้า หรือตั้งราคาขึ้นเองเด็ดขาด
3. ถ้าค้นหาแล้วไม่พบสินค้าที่ตรงเงื่อนไขแบบ 100% ให้บอกลูกค้าตรง ๆ อย่างสุภาพ แล้วนำเสนอสินค้าใกล้เคียงที่มีสต็อกจริงในร้านแทน
4. อธิบายเหตุผลในการแมตช์ชุดอย่างมืออาชีพ เช่น ความเข้ากันของโทนสี สัดส่วนเสื้อผ้า หรือโอกาสในการสวมใส่
5. สรุปคำแนะนำเป็นภาษาไทยที่กระชับ อ่านง่าย และใช้ emoji ประกอบอย่างพอเหมาะ
`.trim();

/**
 * เครื่องมือ Tool calling สำหรับค้นหาสินค้าจริงจากฐานข้อมูล
 */
const STYLIST_TOOLS: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_catalog',
      description:
        'ค้นหาสินค้าแฟชั่นจริงที่มีจำหน่ายและมีสต็อกในคลังของ TEENSTYLE ตามเงื่อนไขต่าง ๆ เช่น คำค้นหา, หมวดหมู่, สไตล์, โทนสี, และช่วงราคา',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'คำค้นหา เช่น เสื้อยืด, ยีนส์, ฮู้ดดี้, แจ็คเก็ต, เสื้อเชิ้ต, กางเกงขาสั้น',
          },
          categorySlug: {
            type: 'string',
            description: 'slug หมวดหมู่ เช่น tops, bottoms, outerwear, accessories',
          },
          style: {
            type: 'string',
            description: 'สไตล์แฟชั่น เช่น minimal, streetwear, y2k, vintage, korean, casual',
          },
          color: {
            type: 'string',
            description: 'โทนสี เช่น ดำ, ขาว, น้ำตาล, ครีม, ฟ้า, เขียว, เอิร์ธโทน, พาสเทล',
          },
          maxPrice: {
            type: 'number',
            description: 'ราคาสูงสุดที่ต้องการ (บาท)',
          },
          minPrice: {
            type: 'number',
            description: 'ราคาต่ำสุดที่ต้องการ (บาท)',
          },
        },
      },
    },
  },
];

/**
 * ค้นหาสินค้าจริงจากฐานข้อมูลสำหรับ AI Stylist
 * กรองเฉพาะสินค้าที่สถานะ ACTIVE, ยังไม่ถูกลบ, และมีสต็อกขายได้จริง
 */
export async function searchProductsForStylist(params: {
  query?: string;
  categorySlug?: string;
  style?: string;
  color?: string;
  maxPrice?: number;
  minPrice?: number;
  limit?: number;
}): Promise<ProductCardDto[]> {
  const prisma = getPrisma();
  const limit = Math.min(params.limit ?? 6, 12);

  const where: Prisma.ProductWhereInput = {
    deletedAt: null,
    status: 'ACTIVE',
    totalStock: { gt: 0 },
  };

  const andConditions: Prisma.ProductWhereInput[] = [];

  if (params.categorySlug) {
    andConditions.push({
      category: { slug: { equals: params.categorySlug.toLowerCase().trim() } },
    });
  }

  if (params.maxPrice !== undefined && params.maxPrice > 0) {
    andConditions.push({
      OR: [
        { salePrice: { lte: params.maxPrice } },
        { AND: [{ salePrice: null }, { price: { lte: params.maxPrice } }] },
      ],
    });
  }

  if (params.minPrice !== undefined && params.minPrice > 0) {
    andConditions.push({
      OR: [
        { salePrice: { gte: params.minPrice } },
        { AND: [{ salePrice: null }, { price: { gte: params.minPrice } }] },
      ],
    });
  }

  if (params.color) {
    const colorTerm = params.color.trim();
    andConditions.push({
      variants: {
        some: {
          isActive: true,
          color: {
            OR: [
              { name: { contains: colorTerm, mode: 'insensitive' } },
              { slug: { contains: colorTerm, mode: 'insensitive' } },
            ],
          },
        },
      },
    });
  }

  if (params.query || params.style) {
    const rawSearch = [params.query, params.style].filter(Boolean).join(' ').trim();
    if (rawSearch) {
      const keywords = rawSearch.split(/\s+/).filter(Boolean);
      const orClauses: Prisma.ProductWhereInput[] = [];

      for (const kw of keywords) {
        orClauses.push({ name: { contains: kw, mode: 'insensitive' } });
        orClauses.push({ description: { contains: kw, mode: 'insensitive' } });
        orClauses.push({ tags: { has: kw.toLowerCase() } });
      }

      andConditions.push({ OR: orClauses });
    }
  }

  if (andConditions.length > 0) {
    where.AND = andConditions;
  }

  let rows = await prisma.product.findMany({
    where,
    select: PRODUCT_CARD_SELECT,
    orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
    take: limit,
  });

  // ถ้าเงื่อนไขแน่นเกินไปจนไม่พบสินค้า ให้ผ่อนเงื่อนไขหาของที่ใกล้เคียงที่สุดในร้าน
  if (rows.length === 0 && andConditions.length > 1) {
    rows = await prisma.product.findMany({
      where: { deletedAt: null, status: 'ACTIVE', totalStock: { gt: 0 } },
      select: PRODUCT_CARD_SELECT,
      orderBy: [{ viewCount: 'desc' }, { createdAt: 'desc' }],
      take: 4,
    });
  }

  const cards = await toProductCards(rows);
  // Universal Invariant: แนะนำเฉพาะสินค้าที่ยังมีพร้อมขายจริงเท่านั้น
  return cards.filter((item) => item.stockStatus !== 'OUT_OF_STOCK');
}

/**
 * Intelligent Catalog Matcher (Fallback Engine)
 * ทำงานเมื่อไม่มี OpenAI API key หรือระบบภายนอกขัดข้อง
 * วิเคราะห์ความต้องการของผู้ใช้และค้นหาสินค้าจริงจากฐานข้อมูล
 */
export async function runFallbackStylist(
  message: string,
  preferences?: StylistPreferences,
): Promise<{ replyText: string; products: ProductCardDto[]; model: string }> {
  const lowerMsg = message.toLowerCase();

  // วิเคราะห์สไตล์
  let detectedStyle = preferences?.style;
  if (!detectedStyle) {
    if (lowerMsg.includes('minimal') || lowerMsg.includes('มินิมอล') || lowerMsg.includes('เรียบ')) {
      detectedStyle = 'minimal';
    } else if (lowerMsg.includes('street') || lowerMsg.includes('สตรีท') || lowerMsg.includes('ฮิปฮอป')) {
      detectedStyle = 'streetwear';
    } else if (lowerMsg.includes('y2k') || lowerMsg.includes('วายทูเค')) {
      detectedStyle = 'y2k';
    } else if (lowerMsg.includes('vintage') || lowerMsg.includes('วินเทจ') || lowerMsg.includes('ย้อนยุค')) {
      detectedStyle = 'vintage';
    } else if (lowerMsg.includes('korean') || lowerMsg.includes('เกาหลี') || lowerMsg.includes('โอปป้า')) {
      detectedStyle = 'korean';
    }
  }

  // วิเคราะห์โทนสี
  let detectedColor = preferences?.color;
  if (!detectedColor) {
    if (lowerMsg.includes('ดำ') || lowerMsg.includes('black')) detectedColor = 'ดำ';
    else if (lowerMsg.includes('ขาว') || lowerMsg.includes('white')) detectedColor = 'ขาว';
    else if (lowerMsg.includes('เอิร์ธโทน') || lowerMsg.includes('earth tone') || lowerMsg.includes('น้ำตาล') || lowerMsg.includes('ครีม')) detectedColor = 'ครีม';
    else if (lowerMsg.includes('พาสเทล') || lowerMsg.includes('pastel') || lowerMsg.includes('ชมพู') || lowerMsg.includes('ฟ้า')) detectedColor = 'พาสเทล';
  }

  // วิเคราะห์งบประมาณ
  let detectedMaxBudget = preferences?.maxBudget;
  if (!detectedMaxBudget) {
    const budgetMatch = lowerMsg.match(/(?:งบ|ไม่เกิน|ราคา)\s*([0-9,]+)/);
    if (budgetMatch && budgetMatch[1]) {
      const num = Number(budgetMatch[1].replace(/,/g, ''));
      if (!Number.isNaN(num) && num > 0) detectedMaxBudget = num;
    }
  }

  // ค้นหาสินค้าจริงจากคลัง
  const products = await searchProductsForStylist({
    query: message,
    style: detectedStyle,
    color: detectedColor,
    maxPrice: detectedMaxBudget,
    limit: 4,
  });

  let replyText = '';

  if (products.length > 0) {
    const styleLabel = detectedStyle ? `สไตล์ ${detectedStyle}` : 'ลุคที่คุณต้องการ';
    const colorLabel = detectedColor ? ` โทนสี ${detectedColor}` : '';
    const budgetLabel = detectedMaxBudget ? ` ในงบประมาณไม่เกิน ${detectedMaxBudget.toLocaleString('th-TH')} บาท` : '';

    replyText = `สวัสดีครับ! สไตลิสต์คัดสรรชุดสำหรับ **${styleLabel}**${colorLabel}${budgetLabel} มาให้คุณแล้วครับ ✨\n\n`;

    const first = products[0];
    const second = products[1];
    const third = products[2];

    if (first && second) {
      replyText += `💡 **ทริคการแมตช์ชุด:**\n`;
      replyText += `• แนะนำให้เลือกชิ้นหลักเป็น **"${first.name}"** แมตช์คู่กับ **"${second.name}"** เพื่อให้ได้สัดส่วนที่ลงตัวและดูทันสมัย\n`;
      if (third) {
        replyText += `• เพิ่มความโดดเด่นด้วย **"${third.name}"** เข้ามาเสริมเลเยอร์ให้ลุคดูมีมิติยิ่งขึ้นครับ\n`;
      }
    } else if (first) {
      replyText += `ไอเทมชิ้นโปรดที่แนะนำคือ **"${first.name}"** ที่ตอบโจทย์การแต่งตัวได้หลากหลายโอกาสครับ\n`;
    }

    replyText += `\n📦 *สินค้าทั้งหมดที่แนะนำมีสต็อกจริงและพร้อมจัดส่ง คุณสามารถกดดูรายละเอียดหรือเลือกไซซ์ใส่ตะกร้าได้ทันทีครับ!*`;
  } else {
    replyText = `ขออภัยด้วยนะครับ สไตลิสต์ค้นหาในระบบแล้วยังไม่พบสินค้าที่ตรงกับเงื่อนไข "${message}" แบบพอดี 100%\n\nลองปรับเงื่อนไข เช่น ขยายช่วงงบประมาณ หรือเลือกดูสไตล์ยอดนิยมอื่น ๆ ของทางร้านดูนะครับ 😊`;
  }

  return {
    replyText,
    products,
    model: 'teenstyle-catalog-matcher-v1',
  };
}

/**
 * เรียก OpenAI เพื่อสร้างคำตอบของ AI Stylist พร้อม Tool Calling
 */
async function callOpenAIStylist(
  conversationHistory: { role: 'user' | 'assistant'; content: string }[],
  userMessage: string,
  preferences?: StylistPreferences,
): Promise<{ replyText: string; products: ProductCardDto[]; model: string; tokensUsed?: number }> {
  if (!env.OPENAI_API_KEY) {
    return runFallbackStylist(userMessage, preferences);
  }

  const openai = new OpenAI({ apiKey: env.OPENAI_API_KEY });
  const model = env.OPENAI_MODEL || 'gpt-4o-mini';

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: STYLIST_SYSTEM_PROMPT },
  ];

  // นำเข้าประวัติการคุยล่าสุดไม่เกิน 8 ข้อความเพื่อคุม Context Window
  for (const item of conversationHistory.slice(-8)) {
    messages.push({ role: item.role, content: item.content });
  }

  // ข้อความใหม่ของผู้ใช้ พร้อมบริบทความชอบถ้ามี
  let augmentedPrompt = userMessage;
  if (preferences && Object.values(preferences).some(Boolean)) {
    augmentedPrompt += `\n[ข้อมูลเสริมจากผู้ใช้: สไตล์=${preferences.style ?? '-'}, โอกาส=${preferences.occasion ?? '-'}, สี=${preferences.color ?? '-'}, งบสูงสุด=${preferences.maxBudget ?? '-'} บาท, ไซซ์=${preferences.size ?? '-'}]`;
  }
  messages.push({ role: 'user', content: augmentedPrompt });

  const referencedProductsMap = new Map<string, ProductCardDto>();

  try {
    const response = await openai.chat.completions.create({
      model,
      messages,
      tools: STYLIST_TOOLS,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 800,
    });

    const choice = response.choices[0];
    const assistantMessage = choice?.message;

    // ตรวจสอบว่าโมเดลต้องการเรียก Tool เพื่อค้นหาสินค้าหรือไม่
    if (assistantMessage?.tool_calls && assistantMessage.tool_calls.length > 0) {
      messages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.type === 'function' && toolCall.function.name === 'search_catalog') {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(toolCall.function.arguments);
          } catch {
            args = {};
          }

          const foundProducts = await searchProductsForStylist({
            query: typeof args.query === 'string' ? args.query : undefined,
            categorySlug: typeof args.categorySlug === 'string' ? args.categorySlug : undefined,
            style: typeof args.style === 'string' ? args.style : undefined,
            color: typeof args.color === 'string' ? args.color : undefined,
            maxPrice: typeof args.maxPrice === 'number' ? args.maxPrice : undefined,
            minPrice: typeof args.minPrice === 'number' ? args.minPrice : undefined,
            limit: 6,
          });

          for (const prod of foundProducts) {
            referencedProductsMap.set(prod.id, prod);
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(
              foundProducts.map((p) => ({
                id: p.id,
                name: p.name,
                category: p.category.name,
                brand: p.brand?.name ?? null,
                price: p.price,
                salePrice: p.salePrice,
                stockStatus: p.stockStatus,
              })),
            ),
          });
        }
      }

      // ส่งผลลัพธ์จาก Tool กลับให้ OpenAI สร้างคำแนะนำสรุป
      const secondResponse = await openai.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        max_tokens: 800,
      });

      const finalReply = secondResponse.choices[0]?.message?.content ?? 'สไตลิสต์จัดเตรียมสินค้าแนะนำไว้ให้ด้านล่างนี้ครับ';

      return {
        replyText: finalReply,
        products: Array.from(referencedProductsMap.values()),
        model,
        tokensUsed:
          (response.usage?.total_tokens ?? 0) + (secondResponse.usage?.total_tokens ?? 0),
      };
    }

    // กรณีโมเดลตอบกลับโดยตรงโดยไม่เรียก Tool (เช่น ตอบคำถามทักทายหรือคำถามทั่วไป)
    return {
      replyText: assistantMessage?.content ?? 'สวัสดีครับ มีสไตล์การแต่งตัวแบบไหนที่อยากให้สไตลิสต์ช่วยแนะนำไหมครับ?',
      products: [],
      model,
      tokensUsed: response.usage?.total_tokens ?? 0,
    };
  } catch (error) {
    console.error('OpenAI Stylist API error, falling back to catalog matcher:', error);
    return runFallbackStylist(userMessage, preferences);
  }
}

/**
 * ดึงหรือสร้าง AIConversation สำหรับผู้ใช้หรือ Guest
 */
async function resolveStylistConversation(
  owner: StylistOwner,
  conversationId?: string,
) {
  const prisma = getPrisma();

  if (conversationId) {
    const existing = await prisma.aIConversation.findUnique({
      where: { id: conversationId },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 20,
        },
      },
    });

    if (existing) {
      // ตรวจสอบความเป็นเจ้าของ (IDOR Protection)
      if (owner.userId && existing.userId === owner.userId) return existing;
      if (!owner.userId && owner.sessionId && existing.sessionId === owner.sessionId) return existing;
    }
  }

  // ค้นหาบทสนทนา ACTIVE ล่าสุดของผู้ใช้
  const activeWhere: Prisma.AIConversationWhereInput = {
    type: 'STYLIST',
    status: 'ACTIVE',
    ...(owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId }),
  };

  const latestActive = await prisma.aIConversation.findFirst({
    where: activeWhere,
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
        take: 20,
      },
    },
  });

  if (latestActive) {
    return latestActive;
  }

  // สร้างบทสนทนาใหม่
  return prisma.aIConversation.create({
    data: {
      type: 'STYLIST',
      status: 'ACTIVE',
      userId: owner.userId ?? null,
      sessionId: owner.userId ? null : (owner.sessionId ?? null),
      title: 'AI Stylist Consultation',
    },
    include: {
      messages: true,
    },
  });
}

/**
 * ส่งข้อความคุยกับ AI Stylist และรับคำแนะนำพร้อมสินค้าจริง
 */
export async function sendStylistMessage(
  owner: StylistOwner,
  message: string,
  conversationId?: string,
  preferences?: StylistPreferences,
): Promise<StylistChatResponse> {
  const prisma = getPrisma();
  const conversation = await resolveStylistConversation(owner, conversationId);

  // เตรียมประวัติข้อความเดิม
  const history = conversation.messages.map((m) => ({
    role: (m.role === 'USER' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: m.content,
  }));

  // รันการประมวลผล Stylist
  const { replyText, products, model, tokensUsed } = await callOpenAIStylist(
    history,
    message,
    preferences,
  );

  const productIds = products.map((p) => p.id);

  // บันทึกข้อความผู้ใช้และข้อความผู้ช่วยใน Transaction เดียวกัน
  const [, assistantMessage] = await prisma.$transaction([
    prisma.aIChatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: message,
      },
    }),
    prisma.aIChatMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content: replyText,
        referencedProductIds: productIds,
        model,
        tokensUsed: tokensUsed ?? null,
      },
    }),
    prisma.aIConversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      },
    }),
  ]);

  return {
    conversationId: conversation.id,
    message: {
      id: assistantMessage.id,
      role: 'ASSISTANT',
      content: assistantMessage.content,
      referencedProducts: products,
      createdAt: assistantMessage.createdAt,
    },
    suggestedPrompts: DEFAULT_SUGGESTED_PROMPTS,
  };
}

/**
 * ดึงประวัติการสนทนาของ AI Stylist
 */
export async function getStylistHistory(
  owner: StylistOwner,
): Promise<StylistHistoryResponse> {
  const prisma = getPrisma();

  const where: Prisma.AIConversationWhereInput = {
    type: 'STYLIST',
    status: 'ACTIVE',
    ...(owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId }),
  };

  const conversation = await prisma.aIConversation.findFirst({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      messages: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!conversation || conversation.messages.length === 0) {
    return {
      conversationId: conversation?.id ?? null,
      messages: [],
    };
  }

  // รวบรวม referencedProductIds ทั้งหมดที่ต้องโหลดข้อมูลสินค้าจริง
  const allProductIds = Array.from(
    new Set(conversation.messages.flatMap((m) => m.referencedProductIds)),
  );

  const productCardMap = new Map<string, ProductCardDto>();
  if (allProductIds.length > 0) {
    const rows = await prisma.product.findMany({
      where: { id: { in: allProductIds } },
      select: PRODUCT_CARD_SELECT,
    });
    const cards = await toProductCards(rows);
    for (const card of cards) {
      productCardMap.set(card.id, card);
    }
  }

  const messages: StylistMessageDto[] = conversation.messages.map((m) => ({
    id: m.id,
    role: m.role as 'USER' | 'ASSISTANT',
    content: m.content,
    referencedProducts: m.referencedProductIds
      .map((id) => productCardMap.get(id))
      .filter((p): p is ProductCardDto => Boolean(p)),
    createdAt: m.createdAt,
  }));

  return {
    conversationId: conversation.id,
    messages,
  };
}

/**
 * รีเซ็ตบทสนทนาเดิมเพื่อเริ่มคุยใหม่
 */
export async function resetStylistConversation(
  owner: StylistOwner,
): Promise<{ success: boolean }> {
  const prisma = getPrisma();

  const where: Prisma.AIConversationWhereInput = {
    type: 'STYLIST',
    status: 'ACTIVE',
    ...(owner.userId ? { userId: owner.userId } : { sessionId: owner.sessionId }),
  };

  await prisma.aIConversation.updateMany({
    where,
    data: {
      status: 'CLOSED',
    },
  });

  return { success: true };
}
