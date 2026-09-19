/**
 * Review DTO + กฎการแปลงข้อมูล (STEP 23)
 *
 * ⚠️ **ตัวเลขดาวทุกตัวนับจากรีวิวที่อนุมัติแล้วเท่านั้น** — รีวิวที่ยังรอตรวจสอบ
 *    ถูกซ่อน หรือถูกปฏิเสธ ต้องไม่มีผลกับคะแนนเฉลี่ยที่ลูกค้าคนอื่นเห็น
 *    (กฎเดียวกับ STEP 13 ข้อ 6 และ STEP 21 ข้อ 4: ตัวเลขบนหน้าเว็บต้องอธิบายที่มาได้)
 *
 * ⚠️ **ไม่ส่งชื่อเต็ม อีเมล หรือรูปโปรไฟล์ของผู้รีวิวออกหน้าร้าน**
 *    หน้าสินค้าเปิดให้ทุกคนดู การเอาชื่อเต็มจากบัญชี Google ไปแปะไว้
 *    คือการเปิดเผยข้อมูลส่วนตัวที่ลูกค้าไม่ได้ตั้งใจให้เปิด
 */

export type ReviewStatus = 'PENDING' | 'APPROVED' | 'HIDDEN' | 'REJECTED';

export type ReviewSort = 'newest' | 'helpful' | 'rating-desc' | 'rating-asc';

/** เหตุผลว่าทำไมรีวิวได้/ไม่ได้ — หน้าเว็บเอาไปอธิบายผู้ใช้ตรง ๆ */
export type ReviewEligibilityReason = 'OK' | 'NOT_PURCHASED' | 'NOT_DELIVERED' | 'ALREADY_REVIEWED';

export interface ReviewAuthorDto {
  /** ชื่อที่ย่อแล้ว เช่น "สมชาย ก." — ไม่ใช่ชื่อเต็ม */
  displayName: string;
  /** ตัวอักษรแรกไว้ทำ avatar โดยไม่ต้องใช้รูปโปรไฟล์จริง */
  initial: string;
}

export interface ReviewDto {
  id: string;
  rating: number;
  title: string | null;
  comment: string;
  /** รูปที่ลูกค้าแนบ — ตอนนี้ว่างเสมอ เพราะระบบอัปโหลดรูปเป็นงานของ STEP 47 */
  images: string[];
  /** ซื้อจริงจากร้านนี้หรือไม่ — คำนวณจากคำสั่งซื้อ ไม่ใช่ค่าที่ client ส่งมา */
  isVerifiedPurchase: boolean;
  helpfulCount: number;
  /** ผู้ที่กำลังดูเคยกด "มีประโยชน์" กับรีวิวนี้แล้วหรือยัง (ไม่ล็อกอิน = false) */
  votedHelpful: boolean;
  /** true = รีวิวของผู้ที่กำลังดูเอง → หน้าเว็บแสดงปุ่มแก้ไข/ลบ และสถานะให้เจ้าของเห็น */
  isMine: boolean;
  /** คนอื่นเห็นเฉพาะ APPROVED — ค่าอื่นจะโผล่ได้เฉพาะกับรีวิวของตัวเอง */
  status: ReviewStatus;
  author: ReviewAuthorDto;
  createdAt: string;
  updatedAt: string;
}

/** รีวิวของตัวเอง (หน้า /account/reviews) — มีข้อมูลที่เจ้าของเท่านั้นที่ควรเห็น */
export interface MyReviewDto extends ReviewDto {
  product: {
    id: string;
    name: string;
    slug: string | null;
    image: { url: string; alt: string } | null;
  };
  /** หมายเหตุจากร้านตอนซ่อน/ปฏิเสธ — บอกเจ้าของว่าทำไม */
  adminNote: string | null;
  orderNumber: string | null;
}

export interface RatingBucketDto {
  rating: number;
  count: number;
  /** สัดส่วนของดาวนี้เทียบกับรีวิวที่อนุมัติทั้งหมด ปัดเป็นจำนวนเต็ม */
  percent: number;
}

export interface ReviewSummaryDto {
  /** จำนวนรีวิวที่อนุมัติแล้ว — ตัวเลขที่ลูกค้าคนอื่นเห็น */
  total: number;
  /** คะแนนเฉลี่ย ทศนิยม 1 ตำแหน่ง · 0 เมื่อยังไม่มีรีวิว (ห้ามเดาค่ากลางให้) */
  average: number;
  /** เรียงจาก 5 ดาวลงมา 1 ดาว เสมอ — ครบทุกช่องแม้ count เป็น 0 */
  distribution: RatingBucketDto[];
}

export interface ReviewListDto {
  items: ReviewDto[];
  summary: ReviewSummaryDto;
  /**
   * รีวิวของผู้ที่กำลังดู แม้จะยังไม่อนุมัติ
   *
   * แยกออกมาต่างหากเพราะรีวิวที่ยัง PENDING ต้องไม่ปนอยู่ในรายการสาธารณะ
   * แต่เจ้าของต้องเห็นว่าเขียนไปแล้วและกำลังรอตรวจสอบ ไม่งั้นจะเข้าใจว่าเขียนไม่สำเร็จ
   */
  myReview: ReviewDto | null;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReviewEligibilityDto {
  productId: string;
  canReview: boolean;
  reason: ReviewEligibilityReason;
  /** คำสั่งซื้อที่ใช้ยืนยันว่าซื้อจริง — null เมื่อยังรีวิวไม่ได้ */
  orderNumber: string | null;
  /** id ของรีวิวเดิม เมื่อ reason = ALREADY_REVIEWED */
  existingReviewId: string | null;
}

/** แถวในคิวตรวจรีวิวของหลังบ้าน */
export interface AdminReviewDto extends ReviewDto {
  product: { id: string; name: string; slug: string | null };
  /** หลังบ้านเห็นชื่อจริงได้ เพราะต้องตรวจสอบและติดต่อกลับได้ */
  customer: { id: string; name: string | null; email: string };
  orderNumber: string | null;
  adminNote: string | null;
  deletedAt: string | null;
}

export interface AdminReviewListDto {
  items: AdminReviewDto[];
  /** จำนวนรีวิวแยกตามสถานะ — ใช้กับแท็บ และต้องตรงกับผลกรองจริง */
  counts: Record<ReviewStatus, number>;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * ย่อชื่อผู้รีวิวให้เหลือ "ชื่อ + อักษรแรกของนามสกุล"
 *
 * ไม่มีชื่อในระบบ (ผู้ใช้ที่ยังไม่เคยตั้งชื่อ) → ใช้คำกลาง ๆ
 * **ห้ามเดาชื่อ หรือเอาอีเมลมาแสดงแทน** เพราะอีเมลเป็นข้อมูลติดต่อส่วนตัว
 */
export function toDisplayName(name: string | null): string {
  const trimmed = (name ?? '').trim();
  if (trimmed.length === 0) return 'ลูกค้า TeenStyle';

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!;

  return `${parts[0]} ${parts[parts.length - 1]!.charAt(0)}.`;
}

/** ตัวอักษรแรกสำหรับ avatar — ใช้แทนรูปโปรไฟล์จริงเพื่อไม่ให้ข้อมูลส่วนตัวหลุด */
export function toInitial(displayName: string): string {
  return displayName.charAt(0).toUpperCase();
}

/**
 * สรุปคะแนนจากจำนวนรีวิวแต่ละดาว
 *
 * รับมาเป็น "ดาวไหนมีกี่รีวิว" (ผลของ `groupBy` ที่กรอง APPROVED แล้ว)
 * เพื่อให้คะแนนเฉลี่ยกับกราฟแท่งมาจากตัวเลขชุดเดียวกันเสมอ — คิดแยกกันเมื่อไรก็เพี้ยนเมื่อนั้น
 */
export function summarizeRatings(countByRating: Map<number, number>): ReviewSummaryDto {
  let total = 0;
  let weighted = 0;

  for (let rating = 1; rating <= 5; rating += 1) {
    const count = countByRating.get(rating) ?? 0;
    total += count;
    weighted += count * rating;
  }

  const distribution: RatingBucketDto[] = [];
  for (let rating = 5; rating >= 1; rating -= 1) {
    const count = countByRating.get(rating) ?? 0;
    distribution.push({
      rating,
      count,
      percent: total === 0 ? 0 : Math.round((count / total) * 100),
    });
  }

  return {
    total,
    // ยังไม่มีรีวิว = 0 ไม่ใช่ 3 หรือ 5 — หน้าเว็บต้องแสดงว่า "ยังไม่มีรีวิว"
    average: total === 0 ? 0 : Math.round((weighted / total) * 10) / 10,
    distribution,
  };
}
