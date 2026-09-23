import { getPrisma, type Prisma } from '@teenstyle/database';

import { ApiError } from '../utils/api-error.ts';
import { writeAdminLog } from '../models/admin-log.model.ts';

export interface AdminActor {
  id: string;
  name?: string | null;
  email?: string | null;
  ip?: string;
  userAgent?: string;
}

export interface SupportTicketSummaryDto {
  id: string;
  title: string | null;
  status: 'ACTIVE' | 'ESCALATED' | 'CLOSED';
  escalatedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  user: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
  } | null;
  assignedTo: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  messageCount: number;
  lastMessage: {
    role: string;
    content: string;
    createdAt: Date;
  } | null;
}

export interface SupportTicketDetailDto {
  id: string;
  title: string | null;
  summary: string | null;
  status: 'ACTIVE' | 'ESCALATED' | 'CLOSED';
  escalatedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  user: {
    id: string;
    name: string | null;
    email: string;
    phone: string | null;
  } | null;
  assignedTo: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  messages: Array<{
    id: string;
    role: 'USER' | 'ASSISTANT' | 'AGENT' | 'SYSTEM';
    content: string;
    referencedProductIds: string[];
    createdAt: Date;
  }>;
}

/**
 * ดึงรายการคำร้อง / การสนทนา Customer Service สำหรับเจ้าหน้าที่
 */
export async function listSupportConversations(params: {
  status?: 'ACTIVE' | 'ESCALATED' | 'CLOSED';
  page?: number;
  limit?: number;
}): Promise<{
  items: SupportTicketSummaryDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  counts: {
    all: number;
    escalated: number;
    active: number;
    closed: number;
  };
}> {
  const prisma = getPrisma();
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(Math.max(1, params.limit ?? 20), 50);
  const skip = (page - 1) * limit;

  const baseWhere: Prisma.AIConversationWhereInput = {
    type: 'CUSTOMER_SERVICE',
  };

  const where: Prisma.AIConversationWhereInput = {
    ...baseWhere,
    ...(params.status ? { status: params.status } : {}),
  };

  const [total, rows, escalatedCount, activeCount, closedCount] = await Promise.all([
    prisma.aIConversation.count({ where }),
    prisma.aIConversation.findMany({
      where,
      orderBy: [{ escalatedAt: 'desc' }, { lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
        _count: { select: { messages: true } },
      },
    }),
    prisma.aIConversation.count({ where: { ...baseWhere, status: 'ESCALATED' } }),
    prisma.aIConversation.count({ where: { ...baseWhere, status: 'ACTIVE' } }),
    prisma.aIConversation.count({ where: { ...baseWhere, status: 'CLOSED' } }),
  ]);

  const items: SupportTicketSummaryDto[] = rows.map((r) => {
    const lastMsg = r.messages[0];
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      escalatedAt: r.escalatedAt,
      lastMessageAt: r.lastMessageAt,
      createdAt: r.createdAt,
      user: r.user,
      assignedTo: r.assignedTo,
      messageCount: r._count.messages,
      lastMessage: lastMsg
        ? {
            role: lastMsg.role,
            content: lastMsg.content,
            createdAt: lastMsg.createdAt,
          }
        : null,
    };
  });

  return {
    items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
    counts: {
      all: escalatedCount + activeCount + closedCount,
      escalated: escalatedCount,
      active: activeCount,
      closed: closedCount,
    },
  };
}

/**
 * ดึงรายละเอียดการสนทนา Customer Service พร้อมข้อความทั้งหมด
 */
export async function getSupportConversationDetail(id: string): Promise<SupportTicketDetailDto> {
  const prisma = getPrisma();

  const conversation = await prisma.aIConversation.findFirst({
    where: { id, type: 'CUSTOMER_SERVICE' },
    include: {
      user: { select: { id: true, name: true, email: true, phone: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      messages: { orderBy: { createdAt: 'asc' } },
    },
  });

  if (!conversation) {
    throw ApiError.notFound('ไม่พบการสนทนาฝ่ายบริการลูกค้านี้');
  }

  return {
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary,
    status: conversation.status,
    escalatedAt: conversation.escalatedAt,
    lastMessageAt: conversation.lastMessageAt,
    createdAt: conversation.createdAt,
    user: conversation.user,
    assignedTo: conversation.assignedTo,
    messages: conversation.messages.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      referencedProductIds: m.referencedProductIds,
      createdAt: m.createdAt,
    })),
  };
}

/**
 * เจ้าหน้าที่กดรับเคส (Assign Support Agent)
 */
export async function assignSupportAgent(
  id: string,
  actor: AdminActor,
): Promise<{ success: boolean; assignedTo: { id: string; name: string | null } }> {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.aIConversation.findFirst({
      where: { id, type: 'CUSTOMER_SERVICE' },
    });

    if (!existing) {
      throw ApiError.notFound('ไม่พบการสนทนานี้');
    }

    const updated = await tx.aIConversation.update({
      where: { id },
      data: {
        assignedToId: actor.id,
        status: 'ESCALATED', // เมื่อคนดูแลแล้วจะคงสถานะประสานงานไว้
        lastMessageAt: new Date(),
      },
      include: {
        assignedTo: { select: { id: true, name: true } },
      },
    });

    const agentName = actor.name || 'เจ้าหน้าที่ TEENSTYLE';
    await tx.aIChatMessage.create({
      data: {
        conversationId: id,
        role: 'SYSTEM',
        content: `${agentName} ได้เข้าร่วมการสนทนาและพร้อมช่วยเหลือคุณแล้วครับ`,
      },
    });

    await writeAdminLog(tx, {
      actor,
      action: 'support.ticket.assign',
      targetType: 'AIConversation',
      targetId: id,
      before: { assignedToId: existing.assignedToId },
      after: { assignedToId: actor.id },
    });

    return {
      success: true,
      assignedTo: {
        id: actor.id,
        name: updated.assignedTo?.name ?? null,
      },
    };
  });
}

/**
 * เจ้าหน้าที่ส่งข้อความตอบกลับลูกค้า (Human Agent Reply)
 */
export async function sendAgentReply(
  id: string,
  actor: AdminActor,
  content: string,
): Promise<{ success: boolean; message: SupportTicketDetailDto['messages'][number] }> {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.aIConversation.findFirst({
      where: { id, type: 'CUSTOMER_SERVICE' },
    });

    if (!existing) {
      throw ApiError.notFound('ไม่พบการสนทนานี้');
    }

    // หากยังไม่ได้ assign ให้ assign ผู้ตอบทันที
    const assignedToId = existing.assignedToId || actor.id;

    await tx.aIConversation.update({
      where: { id },
      data: {
        assignedToId,
        lastMessageAt: new Date(),
      },
    });

    const createdMsg = await tx.aIChatMessage.create({
      data: {
        conversationId: id,
        role: 'AGENT',
        content,
      },
    });

    await writeAdminLog(tx, {
      actor,
      action: 'support.ticket.reply',
      targetType: 'AIConversation',
      targetId: id,
      after: { messageId: createdMsg.id, length: content.length },
    });

    return {
      success: true,
      message: {
        id: createdMsg.id,
        role: createdMsg.role,
        content: createdMsg.content,
        referencedProductIds: createdMsg.referencedProductIds,
        createdAt: createdMsg.createdAt,
      },
    };
  });
}

/**
 * เปลี่ยนสถานะการสนทนา (Active, Escalated, Closed)
 */
export async function updateSupportStatus(
  id: string,
  actor: AdminActor,
  status: 'ACTIVE' | 'ESCALATED' | 'CLOSED',
): Promise<{ success: boolean; status: string }> {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const existing = await tx.aIConversation.findFirst({
      where: { id, type: 'CUSTOMER_SERVICE' },
    });

    if (!existing) {
      throw ApiError.notFound('ไม่พบการสนทนานี้');
    }

    await tx.aIConversation.update({
      where: { id },
      data: {
        status,
        lastMessageAt: new Date(),
      },
    });

    if (status === 'CLOSED') {
      await tx.aIChatMessage.create({
        data: {
          conversationId: id,
          role: 'SYSTEM',
          content:
            'บทสนทนานี้ได้รับการปิดเรียบร้อยแล้ว หากมีข้อสงสัยเพิ่มเติมสามารถเริ่มการสนทนาใหม่ได้ตลอดเวลาครับ ขอบคุณที่ใช้บริการ TEENSTYLE 💜',
        },
      });
    }

    await writeAdminLog(tx, {
      actor,
      action: 'support.ticket.status',
      targetType: 'AIConversation',
      targetId: id,
      before: { status: existing.status },
      after: { status },
    });

    return {
      success: true,
      status,
    };
  });
}
