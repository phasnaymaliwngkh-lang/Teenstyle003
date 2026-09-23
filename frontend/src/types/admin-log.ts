/**
 * Type ของ Audit log (STEP 27) — ต้องตรงกับ DTO ฝั่ง backend
 *   backend/src/models/admin-log.model.ts
 *   backend/src/services/admin-log.service.ts
 */

export const LOG_TARGET_TYPES = [
  "Product",
  "Inventory",
  "Order",
  "Review",
  "User",
  "KnowledgeArticle",
  "AIConversation",
] as const;

export type LogTargetType = (typeof LOG_TARGET_TYPES)[number];

export const LOG_ACTION_GROUPS = [
  "product",
  "inventory",
  "order",
  "review",
  "knowledge",
  "support",
  "customer",
] as const;

export type LogActionGroup = (typeof LOG_ACTION_GROUPS)[number];

export interface FieldChange {
  field: string;
  before: string | null;
  after: string | null;
}

export interface AdminLogEntry {
  id: string;
  action: string;
  actionLabel: string;
  group: LogActionGroup | null;
  targetType: LogTargetType | null;
  targetTypeLabel: string;
  /** ค่าดิบที่เก็บไว้จริง — ต่างจาก `targetType` ได้ถ้าเป็นแถวที่เขียนด้วยชื่อเก่า */
  rawTargetType: string | null;
  targetId: string | null;
  /** null = ยังไม่มีหน้ารายตัวให้เปิด (backend ไม่เดาลิงก์ให้) */
  link: string | null;
  actor: {
    id: string | null;
    name: string | null;
    /** "(บัญชีถูกลบแล้ว)" เมื่อบัญชีผู้ทำรายการถูกลบไปแล้ว */
    email: string;
    role: string | null;
  };
  changes: FieldChange[];
  before: unknown;
  after: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

export interface AdminLogListResult {
  items: AdminLogEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  range: { from: string; to: string };
}

export interface AdminLogFilters {
  actions: { value: string; label: string; count: number }[];
  groups: { value: LogActionGroup; label: string; count: number }[];
  targetTypes: { value: LogTargetType; label: string; count: number }[];
  actors: { userId: string | null; name: string | null; email: string; count: number }[];
  total: number;
  range: { from: string; to: string };
}

export interface TargetHistoryResult {
  items: AdminLogEntry[];
  total: number;
  /** true = มีมากกว่าที่ส่งมา (จำกัดไว้ 200 แถว) */
  truncated: boolean;
}
