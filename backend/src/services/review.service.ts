import { getPrisma, type Prisma } from '@teenstyle/database';

import {
  summarizeRatings,
  toDisplayName,
  toInitial,
  type AdminReviewDto,
  type AdminReviewListDto,
  type MyReviewDto,
  type ReviewDto,
  type ReviewEligibilityDto,
  type ReviewListDto,
  type ReviewSort,
  type ReviewStatus,
  type ReviewSummaryDto,
} from '../models/review.model.ts';
import { ApiError } from '../utils/api-error.ts';

/**
 * รีวิวสินค้า (STEP 23)
 *
 * **กฎที่ห้ามละเมิด**
 *
 * 1. **รีวิวได้เฉพาะคนที่ซื้อและได้รับของแล้วจริง** — ต้องมีคำสั่งซื้อของตัวเองที่
 *    `status = DELIVERED` และมีสินค้าชิ้นนั้นอยู่ในคำสั่งซื้อ
 *    `isVerifiedPurchase` และ `orderId` คำนวณที่ server จากฐานข้อมูล **ไม่ใช่ค่าที่ client ส่งมา**
 * 2. **หนึ่งคนรีวิวได้ครั้งเดียวต่อสินค้า** — ซื้อซ้ำหลายครั้งก็ยังรีวิวได้ครั้งเดียว
 *    ไม่งั้นคนเดียวดันคะแนนเฉลี่ยของสินค้าได้ตามจำนวนครั้งที่ซื้อ
 *    (unique `[userId, productId, orderId]` ของฐานข้อมูลกันไม่ได้ เพราะ `orderId` เป็น NULL ได้
 *    และ PostgreSQL ถือว่า NULL ไม่ซ้ำกับ NULL — ด่านจริงจึงอยู่ที่นี่)
 * 3. **รีวิวใหม่เป็น `PENDING` เสมอ** — หน้าร้านแสดงเฉพาะ `APPROVED`
 *    client เปลี่ยนสถานะเองไม่ได้ ต้องผ่านคนที่มีสิทธิ์ `review:moderate`
 * 4. **แก้รีวิวแล้วต้องกลับไปรอตรวจใหม่** — ไม่งั้นเขียนข้อความสุภาพให้ผ่านก่อน
 *    แล้วค่อยแก้เป็นอย่างอื่นทีหลังได้
 * 5. **คะแนนเฉลี่ยนับจาก `APPROVED` เท่านั้น** และนับจากทั้งหมด ไม่ใช่แค่หน้าปัจจุบัน
 */

const APPROVED_WHERE = {
  status: 'APPROVED',
  deletedAt: null,
} as const satisfies Prisma.ReviewWhereInput;

const REVIEW_SELECT = {
  id: true,
  rating: true,
  title: true,
  comment: true,
  images: true,
  isVerifiedPurchase: true,
  status: true,
  helpfulCount: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
  user: { select: { name: true } },
} as const satisfies Prisma.ReviewSelect;

type ReviewRow = Prisma.ReviewGetPayload<{ select: typeof REVIEW_SELECT }>;

interface ViewerContext {
  viewerId?: string | undefined;
  /** id ของรีวิวที่ผู้ดูคนนี้เคยกด "มีประโยชน์" ไว้ */
  votedReviewIds: Set<string>;
}

function toReviewDto(row: ReviewRow, viewer: ViewerContext): ReviewDto {
  const displayName = toDisplayName(row.user?.name ?? null);

  return {
    id: row.id,
    rating: row.rating,
    title: row.title,
    comment: row.comment,
    images: row.images,
    isVerifiedPurchase: row.isVerifiedPurchase,
    helpfulCount: row.helpfulCount,
    votedHelpful: viewer.votedReviewIds.has(row.id),
    isMine: viewer.viewerId !== undefined && row.userId === viewer.viewerId,
    status: row.status as ReviewStatus,
    author: { displayName, initial: toInitial(displayName) },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** ผู้ดูคนนี้เคยกด "มีประโยชน์" กับรีวิวไหนบ้าง — ยิงครั้งเดียวต่อหน้า ไม่ใช่ต่อรีวิว */
async function loadVotedReviewIds(
  viewerId: string | undefined,
  reviewIds: string[],
): Promise<Set<string>> {
  if (!viewerId || reviewIds.length === 0) return new Set();

  const rows = await getPrisma().reviewHelpfulVote.findMany({
    where: { userId: viewerId, reviewId: { in: reviewIds } },
    select: { reviewId: true },
  });

  return new Set(rows.map((row) => row.reviewId));
}

function orderByOf(sort: ReviewSort): Prisma.ReviewOrderByWithRelationInput[] {
  switch (sort) {
    case 'helpful':
      return [{ helpfulCount: 'desc' }, { createdAt: 'desc' }];
    case 'rating-desc':
      return [{ rating: 'desc' }, { createdAt: 'desc' }];
    case 'rating-asc':
      return [{ rating: 'asc' }, { createdAt: 'desc' }];
    default:
      return [{ createdAt: 'desc' }];
  }
}

/**
 * สรุปคะแนนของสินค้าหนึ่งชิ้น
 *
 * นับด้วย `groupBy` ครั้งเดียวแล้วให้ [review.model.ts](../models/review.model.ts)
 * คิดทั้งค่าเฉลี่ยและกราฟแท่งจากตัวเลขชุดเดียวกัน — ถ้าแยกกันคิดเมื่อไร สองค่านี้จะไม่ตรงกัน
 */
async function summarizeProduct(productId: string): Promise<ReviewSummaryDto> {
  const grouped = await getPrisma().review.groupBy({
    by: ['rating'],
    where: { productId, ...APPROVED_WHERE },
    _count: { _all: true },
  });

  const countByRating = new Map<number, number>();
  for (const row of grouped) {
    countByRating.set(row.rating, row._count._all);
  }

  return summarizeRatings(countByRating);
}

export interface ProductReviewQuery {
  page: number;
  limit: number;
  sort: ReviewSort;
  /** กรองเฉพาะดาวที่เลือก — null = ทุกดาว */
  rating: number | null;
}

/**
 * รีวิวของสินค้าหนึ่งชิ้นสำหรับหน้าร้าน
 *
 * ⚠️ รีวิวของผู้ที่กำลังดูถูกดึงออกจากรายการสาธารณะแล้วส่งแยกเป็น `myReview`
 *    เพื่อไม่ให้ขึ้นซ้ำสองที่ และเพื่อให้เจ้าของเห็นรีวิวที่ยัง `PENDING` ของตัวเองได้
 *    (คนอื่นยังไม่เห็นจนกว่าจะอนุมัติ)
 */
export async function listProductReviews(
  slug: string,
  query: ProductReviewQuery,
  viewerId?: string,
): Promise<ReviewListDto> {
  const prisma = getPrisma();

  const product = await prisma.product.findFirst({
    where: { slug, deletedAt: null, status: 'ACTIVE' },
    select: { id: true },
  });

  if (!product) {
    throw ApiError.notFound('ไม่พบสินค้าชิ้นนี้');
  }

  const listWhere: Prisma.ReviewWhereInput = {
    productId: product.id,
    ...APPROVED_WHERE,
    ...(query.rating !== null ? { rating: query.rating } : {}),
    // รีวิวของตัวเองแสดงแยกด้านบน จึงไม่ต้องอยู่ในรายการนี้อีก
    ...(viewerId ? { userId: { not: viewerId } } : {}),
  };

  const [summary, total, rows, myRow] = await Promise.all([
    summarizeProduct(product.id),
    prisma.review.count({ where: listWhere }),
    prisma.review.findMany({
      where: listWhere,
      orderBy: orderByOf(query.sort),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: REVIEW_SELECT,
    }),
    viewerId
      ? prisma.review.findFirst({
          where: { productId: product.id, userId: viewerId, deletedAt: null },
          select: REVIEW_SELECT,
        })
      : Promise.resolve(null),
  ]);

  const votedReviewIds = await loadVotedReviewIds(
    viewerId,
    rows.map((row) => row.id),
  );
  const viewer: ViewerContext = { viewerId, votedReviewIds };

  return {
    items: rows.map((row) => toReviewDto(row, viewer)),
    summary,
    myReview: myRow ? toReviewDto(myRow, viewer) : null,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// สิทธิ์ในการรีวิว
// ─────────────────────────────────────────────────────────────────────────────

interface EligibleOrder {
  id: string;
  orderNumber: string;
}

/**
 * ดูว่าผู้ใช้คนนี้รีวิวสินค้าแต่ละชิ้นได้หรือยัง
 *
 * ใช้สองคิวรีไม่ว่าจะถามกี่สินค้า (หน้าคำสั่งซื้อถามทีเดียวทั้งใบ)
 *
 * ⚠️ เกณฑ์คือ **ได้รับของแล้ว** (`DELIVERED`) ไม่ใช่แค่จ่ายเงินแล้ว
 *    คนที่ยังไม่ได้ของไม่มีทางรู้ว่าของเป็นอย่างไร รีวิวจึงยังไม่ใช่ความจริง
 */
export async function getReviewEligibility(
  userId: string,
  productIds: string[],
): Promise<ReviewEligibilityDto[]> {
  if (productIds.length === 0) return [];

  const prisma = getPrisma();

  const [orderItems, existingReviews] = await Promise.all([
    prisma.orderItem.findMany({
      where: { productId: { in: productIds }, order: { userId, deletedAt: null } },
      select: {
        productId: true,
        order: { select: { id: true, orderNumber: true, status: true, deliveredAt: true } },
      },
    }),
    prisma.review.findMany({
      where: { userId, productId: { in: productIds }, deletedAt: null },
      select: { id: true, productId: true },
    }),
  ]);

  const reviewByProduct = new Map(existingReviews.map((row) => [row.productId, row.id]));

  /** คำสั่งซื้อที่ส่งถึงแล้ว (เก่าสุดก่อน) และคำสั่งซื้อที่ยังไม่ถึง แยกกันคนละถัง */
  const deliveredByProduct = new Map<string, { order: EligibleOrder; at: number }>();
  const pendingProducts = new Set<string>();

  for (const item of orderItems) {
    if (item.productId === null) continue;

    if (item.order.status !== 'DELIVERED') {
      pendingProducts.add(item.productId);
      continue;
    }

    const at = item.order.deliveredAt?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const current = deliveredByProduct.get(item.productId);
    if (!current || at < current.at) {
      deliveredByProduct.set(item.productId, {
        order: { id: item.order.id, orderNumber: item.order.orderNumber },
        at,
      });
    }
  }

  return productIds.map((productId) => {
    const existingReviewId = reviewByProduct.get(productId) ?? null;
    if (existingReviewId !== null) {
      return {
        productId,
        canReview: false,
        reason: 'ALREADY_REVIEWED' as const,
        orderNumber: null,
        existingReviewId,
      };
    }

    const delivered = deliveredByProduct.get(productId);
    if (delivered) {
      return {
        productId,
        canReview: true,
        reason: 'OK' as const,
        orderNumber: delivered.order.orderNumber,
        existingReviewId: null,
      };
    }

    return {
      productId,
      canReview: false,
      // ซื้อแล้วแต่ของยังไม่ถึง กับยังไม่เคยซื้อ ต้องบอกคนละอย่าง
      reason: pendingProducts.has(productId)
        ? ('NOT_DELIVERED' as const)
        : ('NOT_PURCHASED' as const),
      orderNumber: null,
      existingReviewId: null,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// เขียน / แก้ / ลบ รีวิวของตัวเอง
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateReviewInput {
  productId: string;
  rating: number;
  title?: string | undefined;
  comment: string;
}

/**
 * เขียนรีวิวใหม่
 *
 * ⚠️ client ส่งได้แค่ `productId` + ดาว + หัวข้อ + ข้อความ
 *    `orderId`, `isVerifiedPurchase` และ `status` ตั้งที่ server ทั้งหมด
 *    (แพตเทิร์นเดียวกับ STEP 10: ค่าที่มีผลต่อความน่าเชื่อถือห้ามรับจาก client)
 */
export async function createReview(
  userId: string,
  input: CreateReviewInput,
): Promise<{ review: MyReviewDto; needsApproval: boolean }> {
  const prisma = getPrisma();

  const product = await prisma.product.findFirst({
    where: { id: input.productId, deletedAt: null },
    select: { id: true },
  });

  if (!product) {
    throw ApiError.notFound('ไม่พบสินค้าชิ้นนี้');
  }

  const [eligibility] = await getReviewEligibility(userId, [input.productId]);

  if (eligibility?.reason === 'ALREADY_REVIEWED') {
    throw ApiError.conflict('คุณรีวิวสินค้าชิ้นนี้ไปแล้ว — แก้ไขรีวิวเดิมได้ที่หน้ารีวิวของฉัน');
  }

  if (!eligibility?.canReview || eligibility.orderNumber === null) {
    throw ApiError.forbidden(
      eligibility?.reason === 'NOT_DELIVERED'
        ? 'รีวิวได้หลังจากได้รับสินค้าแล้ว — คำสั่งซื้อของคุณยังอยู่ระหว่างจัดส่ง'
        : 'รีวิวได้เฉพาะสินค้าที่คุณสั่งซื้อและได้รับแล้วเท่านั้น',
    );
  }

  // อ่าน orderId จากคำสั่งซื้อที่ตรวจแล้ว — ไม่ใช่ค่าที่ client แนบมา
  const order = await prisma.order.findFirst({
    where: { orderNumber: eligibility.orderNumber, userId },
    select: { id: true },
  });

  const data = {
    orderId: order?.id ?? null,
    rating: input.rating,
    title: input.title?.trim() || null,
    comment: input.comment.trim(),
    isVerifiedPurchase: order !== null,
    status: 'PENDING',
  } as const;

  /**
   * เคยรีวิวแล้วลบทิ้ง → เขียนทับแถวเดิม ไม่ใช่สร้างแถวใหม่
   *
   * ⚠️ unique `[userId, productId, orderId]` ของฐานข้อมูลยังจองแถวที่ soft delete ไว้อยู่
   *    ถ้าสร้างใหม่ตรง ๆ จะชน P2002 แล้วลูกค้าที่ลบรีวิวตัวเองจะเขียนใหม่ไม่ได้ตลอดไป
   *    (เจอจริงตอนเขียนเทสต์ของ STEP 23) · เขียนทับแถวเดิมได้ผลเดียวกันและ
   *    ทำให้เหลือ **หนึ่งแถวต่อหนึ่งคนต่อหนึ่งสินค้า** เสมอ
   */
  const softDeleted = await prisma.review.findFirst({
    where: { userId, productId: input.productId, deletedAt: { not: null } },
    select: { id: true },
  });

  try {
    if (softDeleted) {
      const revived = await prisma.review.update({
        where: { id: softDeleted.id },
        // ล้างร่องรอยของรีวิวเดิมให้หมด — หมายเหตุของร้านและยอดโหวตพูดถึงข้อความที่ไม่มีแล้ว
        data: { ...data, deletedAt: null, adminNote: null, helpfulCount: 0 },
        select: MY_REVIEW_SELECT,
      });

      await prisma.reviewHelpfulVote.deleteMany({ where: { reviewId: softDeleted.id } });

      return { review: toMyReviewDto(revived), needsApproval: true };
    }

    const created = await prisma.review.create({
      data: { productId: input.productId, userId, ...data },
      select: MY_REVIEW_SELECT,
    });

    return { review: toMyReviewDto(created), needsApproval: true };
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'P2002') {
      throw ApiError.conflict('คุณรีวิวสินค้าชิ้นนี้ไปแล้ว');
    }
    throw err;
  }
}

export interface UpdateReviewInput {
  rating?: number | undefined;
  title?: string | null | undefined;
  comment?: string | undefined;
}

/**
 * แก้รีวิวของตัวเอง
 *
 * ⚠️ **แก้แล้วกลับไปรอตรวจใหม่เสมอ** ไม่งั้นเขียนข้อความสุภาพให้ผ่านก่อน
 *    แล้วแก้เป็นอย่างอื่นทีหลังได้โดยไม่มีใครตรวจ
 *    และล้าง `adminNote` เดิมทิ้ง เพราะหมายเหตุนั้นพูดถึงข้อความเก่าที่ไม่มีแล้ว
 */
export async function updateOwnReview(
  userId: string,
  reviewId: string,
  input: UpdateReviewInput,
): Promise<{ review: MyReviewDto; needsApproval: boolean }> {
  const prisma = getPrisma();

  // กรอง userId เสมอ — ไม่เจอคืน 404 ไม่ใช่ 403 เพื่อไม่บอกใบ้ว่ามีรีวิวนั้นอยู่จริง
  const existing = await prisma.review.findFirst({
    where: { id: reviewId, userId, deletedAt: null },
    select: { id: true },
  });

  if (!existing) {
    throw ApiError.notFound('ไม่พบรีวิวนี้ในรายการรีวิวของคุณ');
  }

  const data: Prisma.ReviewUpdateInput = { status: 'PENDING', adminNote: null };
  if (input.rating !== undefined) data.rating = input.rating;
  if (input.comment !== undefined) data.comment = input.comment.trim();
  if (input.title !== undefined) data.title = input.title?.trim() || null;

  const updated = await prisma.review.update({
    where: { id: reviewId },
    data,
    select: MY_REVIEW_SELECT,
  });

  return { review: toMyReviewDto(updated), needsApproval: true };
}

/**
 * ลบรีวิวของตัวเอง — soft delete เพื่อให้ยังตรวจย้อนหลังได้ว่าเคยมีอะไรเขียนไว้
 * ลบแล้วเขียนใหม่ได้ (เงื่อนไข "หนึ่งคนหนึ่งรีวิว" นับเฉพาะรีวิวที่ยังไม่ถูกลบ)
 */
export async function deleteOwnReview(
  userId: string,
  reviewId: string,
): Promise<{ deleted: boolean }> {
  const { count } = await getPrisma().review.updateMany({
    where: { id: reviewId, userId, deletedAt: null },
    data: { deletedAt: new Date() },
  });

  if (count === 0) {
    throw ApiError.notFound('ไม่พบรีวิวนี้ในรายการรีวิวของคุณ');
  }

  return { deleted: true };
}

const MY_REVIEW_SELECT = {
  ...REVIEW_SELECT,
  adminNote: true,
  order: { select: { orderNumber: true } },
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      deletedAt: true,
      status: true,
      images: { where: { isMain: true }, select: { url: true, alt: true }, take: 1 },
    },
  },
} as const satisfies Prisma.ReviewSelect;

type MyReviewRow = Prisma.ReviewGetPayload<{ select: typeof MY_REVIEW_SELECT }>;

function toMyReviewDto(row: MyReviewRow): MyReviewDto {
  const base = toReviewDto(row, { viewerId: row.userId, votedReviewIds: new Set() });
  const image = row.product.images[0];
  // สินค้าที่ถูกซ่อน/ลบแล้วไม่มีหน้าให้เปิด — ส่ง slug เป็น null ดีกว่าลิงก์ไป 404
  const visible = row.product.deletedAt === null && row.product.status === 'ACTIVE';

  return {
    ...base,
    product: {
      id: row.product.id,
      name: row.product.name,
      slug: visible ? row.product.slug : null,
      image: image ? { url: image.url, alt: image.alt } : null,
    },
    adminNote: row.adminNote,
    orderNumber: row.order?.orderNumber ?? null,
  };
}

export interface MyReviewsQuery {
  page: number;
  limit: number;
}

/** รีวิวทั้งหมดของตัวเอง — เห็นทุกสถานะ รวมที่ยังรอตรวจสอบ */
export async function listMyReviews(
  userId: string,
  query: MyReviewsQuery,
): Promise<{
  items: MyReviewDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}> {
  const prisma = getPrisma();
  const where: Prisma.ReviewWhereInput = { userId, deletedAt: null };

  const [total, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: MY_REVIEW_SELECT,
    }),
  ]);

  return {
    items: rows.map(toMyReviewDto),
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// โหวตว่ารีวิวมีประโยชน์
// ─────────────────────────────────────────────────────────────────────────────

/**
 * กด/ยกเลิก "รีวิวนี้มีประโยชน์"
 *
 * ⚠️ หนึ่งคนหนึ่งเสียงต่อรีวิว บังคับด้วย unique `[reviewId, userId]` ของฐานข้อมูล
 *    ตัวนับเดินด้วย `{ increment: 1 }` ในทรานแซกชันเดียวกับการเขียนแถวโหวต
 *    ถ้านับด้วยการอ่านค่าเดิมมาบวก ยอดจะตกหล่นเมื่อมีคนกดพร้อมกัน (กฎเดียวกับ STEP 21 ข้อ 6)
 *
 * กดซ้ำไม่ error — คืนสถานะปัจจุบันเฉย ๆ เพราะผลลัพธ์ที่ผู้ใช้ต้องการเกิดขึ้นแล้ว
 */
export async function setReviewHelpful(
  userId: string,
  reviewId: string,
  helpful: boolean,
): Promise<{ helpfulCount: number; votedHelpful: boolean }> {
  const prisma = getPrisma();

  const review = await prisma.review.findFirst({
    where: { id: reviewId, ...APPROVED_WHERE },
    select: { id: true, userId: true, helpfulCount: true },
  });

  if (!review) {
    throw ApiError.notFound('ไม่พบรีวิวนี้');
  }

  if (review.userId === userId) {
    throw ApiError.badRequest('กดว่ารีวิวของตัวเองมีประโยชน์ไม่ได้');
  }

  return prisma.$transaction(async (tx) => {
    if (helpful) {
      const already = await tx.reviewHelpfulVote.findUnique({
        where: { reviewId_userId: { reviewId, userId } },
        select: { id: true },
      });

      if (already) {
        return { helpfulCount: review.helpfulCount, votedHelpful: true };
      }

      await tx.reviewHelpfulVote.create({ data: { reviewId, userId } });
      const updated = await tx.review.update({
        where: { id: reviewId },
        data: { helpfulCount: { increment: 1 } },
        select: { helpfulCount: true },
      });

      return { helpfulCount: updated.helpfulCount, votedHelpful: true };
    }

    const removed = await tx.reviewHelpfulVote.deleteMany({ where: { reviewId, userId } });

    if (removed.count === 0) {
      return { helpfulCount: review.helpfulCount, votedHelpful: false };
    }

    const updated = await tx.review.update({
      where: { id: reviewId },
      data: { helpfulCount: { decrement: 1 } },
      select: { helpfulCount: true },
    });

    return { helpfulCount: updated.helpfulCount, votedHelpful: false };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// หลังบ้าน — ตรวจรีวิว
// ─────────────────────────────────────────────────────────────────────────────

export interface ReviewActor {
  id?: string | undefined;
  ip?: string | undefined;
  userAgent?: string | undefined;
}

export interface AdminReviewQuery {
  status: ReviewStatus | null;
  rating: number | null;
  q: string | null;
  page: number;
  limit: number;
}

const ADMIN_REVIEW_SELECT = {
  ...MY_REVIEW_SELECT,
  deletedAt: true,
  user: { select: { id: true, name: true, email: true } },
} as const satisfies Prisma.ReviewSelect;

type AdminReviewRow = Prisma.ReviewGetPayload<{ select: typeof ADMIN_REVIEW_SELECT }>;

function toAdminReviewDto(row: AdminReviewRow): AdminReviewDto {
  const displayName = toDisplayName(row.user?.name ?? null);

  return {
    id: row.id,
    rating: row.rating,
    title: row.title,
    comment: row.comment,
    images: row.images,
    isVerifiedPurchase: row.isVerifiedPurchase,
    helpfulCount: row.helpfulCount,
    votedHelpful: false,
    isMine: false,
    status: row.status as ReviewStatus,
    author: { displayName, initial: toInitial(displayName) },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    product: {
      id: row.product.id,
      name: row.product.name,
      slug: row.product.deletedAt === null ? row.product.slug : null,
    },
    customer: {
      id: row.user?.id ?? '',
      name: row.user?.name ?? null,
      email: row.user?.email ?? '',
    },
    orderNumber: row.order?.orderNumber ?? null,
    adminNote: row.adminNote,
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

const ALL_STATUSES: ReviewStatus[] = ['PENDING', 'APPROVED', 'HIDDEN', 'REJECTED'];

/**
 * คิวตรวจรีวิวของหลังบ้าน
 *
 * ⚠️ ตัวเลขข้างแท็บสถานะต้องนับด้วยเงื่อนไขค้นหาชุดเดียวกับรายการ (ยกเว้นตัวสถานะเอง)
 *    ไม่งั้นกดแท็บแล้วจำนวนที่เห็นไม่ตรงกับเลขบนแท็บ (บทเรียนจาก STEP 12/14)
 *
 * ไม่รวมรีวิวที่ลูกค้าลบเอง — ของพวกนั้นไม่ได้อยู่หน้าร้านแล้วและไม่มีอะไรให้ตัดสิน
 * ประวัติยังตรวจย้อนหลังได้จาก `AdminLog` และแถวที่ยังอยู่ในฐานข้อมูล
 */
export async function adminListReviews(query: AdminReviewQuery): Promise<AdminReviewListDto> {
  const prisma = getPrisma();

  const searchWhere: Prisma.ReviewWhereInput = {
    deletedAt: null,
    ...(query.rating !== null ? { rating: query.rating } : {}),
    ...(query.q
      ? {
          OR: [
            { comment: { contains: query.q, mode: 'insensitive' } },
            { title: { contains: query.q, mode: 'insensitive' } },
            { product: { name: { contains: query.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };

  const where: Prisma.ReviewWhereInput = {
    ...searchWhere,
    ...(query.status !== null ? { status: query.status } : {}),
  };

  const [total, rows, grouped] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      // ใหม่สุดขึ้นก่อน · หน้าเว็บเปิดที่แท็บ "รอตรวจสอบ" อยู่แล้ว จึงเห็นงานค้างก่อนเสมอ
      orderBy: [{ createdAt: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      select: ADMIN_REVIEW_SELECT,
    }),
    prisma.review.groupBy({
      by: ['status'],
      where: searchWhere,
      _count: { _all: true },
    }),
  ]);

  const counts = Object.fromEntries(ALL_STATUSES.map((status) => [status, 0])) as Record<
    ReviewStatus,
    number
  >;
  for (const row of grouped) {
    counts[row.status as ReviewStatus] = row._count._all;
  }

  return {
    items: rows.map(toAdminReviewDto),
    counts,
    total,
    page: query.page,
    limit: query.limit,
    totalPages: Math.ceil(total / query.limit) || 1,
  };
}

/**
 * อนุมัติ / ซ่อน / ปฏิเสธรีวิว
 *
 * ⚠️ เขียน `AdminLog` ในทรานแซกชันเดียวกับการเปลี่ยนสถานะ (กฎเดียวกับ STEP 13/14/15/21)
 *    รีวิวคือข้อความของลูกค้าที่ร้านเอาลงได้ จึงต้องตรวจย้อนหลังได้เสมอว่าใครเอาลงเพราะอะไร
 */
export async function adminModerateReview(
  reviewId: string,
  input: { status: ReviewStatus; adminNote?: string | null | undefined },
  actor: ReviewActor = {},
): Promise<AdminReviewDto> {
  const prisma = getPrisma();

  return prisma.$transaction(async (tx) => {
    const before = await tx.review.findFirst({
      where: { id: reviewId, deletedAt: null },
      select: ADMIN_REVIEW_SELECT,
    });

    if (!before) {
      throw ApiError.notFound('ไม่พบรีวิวนี้');
    }

    const updated = await tx.review.update({
      where: { id: reviewId },
      data: {
        status: input.status,
        ...(input.adminNote !== undefined ? { adminNote: input.adminNote?.trim() || null } : {}),
      },
      select: ADMIN_REVIEW_SELECT,
    });

    const after = toAdminReviewDto(updated);

    await tx.adminLog.create({
      data: {
        userId: actor.id ?? null,
        action: 'review.moderate',
        targetType: 'Review',
        targetId: reviewId,
        before: toAdminReviewDto(before) as unknown as Prisma.InputJsonValue,
        after: after as unknown as Prisma.InputJsonValue,
        ipAddress: actor.ip,
        userAgent: actor.userAgent,
      },
    });

    return after;
  });
}
