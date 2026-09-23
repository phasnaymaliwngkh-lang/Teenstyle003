/**
 * Notification DTO (STEP 24)
 *
 * ⚠️ **แถวที่ `userId = null` คือประกาศถึง "พนักงาน" ไม่ใช่ถึงลูกค้า**
 *    ตอนนี้มีที่เดียวคือการเตือนสต็อกของ STEP 16 (`LOW_STOCK`)
 *    ซึ่งบอกยอดในคลังและยอดที่ถูกจอง — เป็นข้อมูลภายในร้าน
 *    → **ฟีดของลูกค้าห้ามอ่านแถว `userId = null` เด็ดขาด** ต้องกรอง `userId = ตัวเอง` เสมอ
 *    (ตารางนี้ยังไม่มีคอลัมน์บอกกลุ่มผู้รับ การประกาศถึงลูกค้าทุกคนจึงยังทำไม่ได้ — ดู CLAUDE.md)
 *
 * ⚠️ **ห้ามสร้างแถวของช่องทางที่ส่งไม่ได้จริง** (EMAIL/PUSH) ดู [config/notification.ts](../config/notification.ts)
 *    แถวที่มีอยู่ทุกแถวจึงเป็น `IN_APP` ที่ "ส่งถึงแล้ว" จริงตั้งแต่วินาทีที่บันทึก
 */

export type NotificationType =
  | 'ORDER_CREATED'
  | 'PAYMENT_SUCCESS'
  | 'PAYMENT_FAILED'
  | 'SHIPPING'
  | 'DELIVERED'
  | 'LOW_STOCK'
  | 'PROMOTION'
  | 'PRICE_DROP'
  | 'WISHLIST_UPDATE'
  | 'SYSTEM'
  | 'ORDER_UPDATE'
  | 'ORDER_CANCELLED'
  | 'REVIEW_UPDATE';

/** หมวดที่ใช้กรองบนหน้าเว็บ — ย่อจาก type ให้เหลือเท่าที่ลูกค้าเข้าใจ */
export type NotificationGroup = 'ORDER' | 'PRICE' | 'REVIEW' | 'OTHER';

export interface NotificationDto {
  id: string;
  type: NotificationType;
  group: NotificationGroup;
  title: string;
  body: string;
  /**
   * ลิงก์ปลายทางที่คำนวณจาก `data` ที่ฝั่ง server
   *
   * คิดที่นี่ที่เดียวเพื่อไม่ให้หน้าเว็บต้องรู้โครงของ `data` ของทุก type
   * null = ไม่มีหน้าให้ไป (เช่นข้อมูลอ้างอิงถูกลบไปแล้ว) — **ห้ามเดาลิงก์**
   */
  link: string | null;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationListDto {
  items: NotificationDto[];
  /** จำนวนที่ยังไม่อ่านทั้งหมด — นับจากทั้งฟีด ไม่ใช่แค่หน้าปัจจุบัน */
  unreadCount: number;
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** แถวที่ service select มาให้ */
export interface NotificationRow {
  id: string;
  type: string;
  title: string;
  body: string;
  data: unknown;
  readAt: Date | null;
  createdAt: Date;
}

const GROUP_OF: Record<NotificationType, NotificationGroup> = {
  ORDER_CREATED: 'ORDER',
  PAYMENT_SUCCESS: 'ORDER',
  PAYMENT_FAILED: 'ORDER',
  SHIPPING: 'ORDER',
  DELIVERED: 'ORDER',
  PRICE_DROP: 'PRICE',
  WISHLIST_UPDATE: 'PRICE',
  PROMOTION: 'PRICE',
  ORDER_UPDATE: 'ORDER',
  ORDER_CANCELLED: 'ORDER',
  REVIEW_UPDATE: 'REVIEW',
  LOW_STOCK: 'OTHER',
  SYSTEM: 'OTHER',
};

/** type ทั้งหมดที่อยู่ในหมวดหนึ่ง — ใช้แปลงตัวกรองของหน้าเว็บเป็นเงื่อนไขคิวรี */
export function typesInGroup(group: NotificationGroup): NotificationType[] {
  return (Object.keys(GROUP_OF) as NotificationType[]).filter((type) => GROUP_OF[type] === group);
}

/** อ่านค่า string จาก `data` อย่างปลอดภัย — แถวเก่าอาจไม่มีฟิลด์ที่โค้ดใหม่คาดไว้ */
function readString(data: unknown, key: string): string | null {
  if (typeof data !== 'object' || data === null) return null;

  const value = (data as Record<string, unknown>)[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * ปลายทางของการแจ้งเตือนแต่ละแบบ
 *
 * ⚠️ ไม่มีข้อมูลพอ = คืน `null` ไม่ใช่เดาเส้นทาง — ลิงก์ที่พาไป 404
 *    แย่กว่าการ์ดที่กดไม่ได้ (กฎเดียวกับ STEP 4 ข้อ 2 เรื่อง `NavItem` ที่ไม่มี `href`)
 */
export function resolveNotificationLink(type: NotificationType, data: unknown): string | null {
  switch (type) {
    case 'ORDER_CREATED':
    case 'ORDER_UPDATE':
    case 'ORDER_CANCELLED':
    case 'PAYMENT_SUCCESS':
    case 'PAYMENT_FAILED':
    case 'SHIPPING':
    case 'DELIVERED': {
      const orderNumber = readString(data, 'orderNumber');
      return orderNumber === null ? null : `/account/orders/${orderNumber}`;
    }

    case 'REVIEW_UPDATE':
      // รีวิวที่ถูกซ่อน/ไม่อนุมัติไม่มีหน้าสาธารณะให้ดู — พาไปที่หน้ารีวิวของตัวเองเสมอ
      return '/account/reviews';

    case 'PRICE_DROP':
    case 'WISHLIST_UPDATE':
    case 'PROMOTION': {
      const slug = readString(data, 'productSlug');
      return slug === null ? null : `/product/${slug}`;
    }

    case 'LOW_STOCK':
      // ของพนักงาน — ไม่โผล่ในฟีดลูกค้า แต่แมปไว้ให้ครบ ไม่ให้กลายเป็นลิงก์ผิด
      return '/admin/alerts';

    case 'SYSTEM': {
      // SYSTEM ใช้กับหลายเรื่อง จึงดูจาก data ว่าอ้างถึงอะไร
      const orderNumber = readString(data, 'orderNumber');
      if (orderNumber !== null) return `/account/orders/${orderNumber}`;

      return readString(data, 'reviewId') === null ? null : '/account/reviews';
    }

    default:
      return null;
  }
}

export function toNotificationDto(row: NotificationRow): NotificationDto {
  const type = row.type as NotificationType;

  return {
    id: row.id,
    type,
    group: GROUP_OF[type] ?? 'OTHER',
    title: row.title,
    body: row.body,
    link: resolveNotificationLink(type, row.data),
    isRead: row.readAt !== null,
    createdAt: row.createdAt.toISOString(),
    readAt: row.readAt?.toISOString() ?? null,
  };
}
