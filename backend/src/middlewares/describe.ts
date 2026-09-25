import type { RequestHandler } from 'express';

/**
 * ป้ายบอก "หน้าที่" ของ middleware เพื่อให้สร้างแผนผัง API จากตัว router จริงได้ (STEP 29)
 *
 * ทำไมต้องมี
 *   แผนผัง endpoint ที่เขียนด้วยมือจะเพี้ยนจากความจริงในวันที่ใครเพิ่ม/ย้าย route แล้วลืมแก้รายการ
 *   ซึ่งอันตรายกว่าไม่มีแผนผังเลย เพราะคนอ่านจะเชื่อว่า "เส้นทางนี้ไม่ต้องมีสิทธิ์"
 *   ทางแก้คืออ่านจาก Express router จริง แต่ middleware ที่มาจาก factory เป็นฟังก์ชันไม่มีชื่อ
 *   (`requirePermission('x')` คืน arrow function) จึงเดาจากชื่อไม่ได้ — ต้องติดป้ายไว้ตอนสร้าง
 *
 * เก็บใน WeakMap ไม่ใช่ property ของฟังก์ชัน เพื่อให้ไม่มีทางหลุดออกไปกับ response
 * และไม่ไปชนกับ property ที่ไลบรารีอื่นใส่ไว้
 */
export type MiddlewareDescriptor = {
  /** `required` = ต้องล็อกอิน · `optional` = แนบผู้ใช้ให้ถ้ามี session แต่ไม่บังคับ */
  auth?: 'required' | 'optional';
  /** บทบาทที่อนุญาต (จาก `requireRole` / `requireStaff`) */
  roles?: readonly string[];
  /** สิทธิ์ที่ต้องมีครบทุกตัว (จาก `requirePermission`) */
  permissions?: readonly string[];
  /** ตรวจ Origin กัน CSRF */
  csrf?: true;
  /** จำกัดความถี่แบบเข้มกว่าปกติ */
  rateLimit?: 'strict';
  /** รับไฟล์อัปโหลด (multer) — ชื่อ field ที่รับ */
  upload?: string;
};

const DESCRIPTORS = new WeakMap<object, MiddlewareDescriptor>();

/** ติดป้ายให้ middleware แล้วคืนตัวเดิมกลับไป (ใช้ห่อค่าที่ return จาก factory ได้ตรง ๆ) */
export function describeMiddleware<T extends RequestHandler>(
  handler: T,
  descriptor: MiddlewareDescriptor,
): T {
  DESCRIPTORS.set(handler, descriptor);
  return handler;
}

/** อ่านป้ายของ middleware — คืน undefined ถ้าไม่ได้ติดป้ายไว้ (เช่น controller หรือ middleware ของไลบรารี) */
export function middlewareDescriptorOf(handler: unknown): MiddlewareDescriptor | undefined {
  if (typeof handler !== 'function') return undefined;
  return DESCRIPTORS.get(handler as unknown as object);
}
