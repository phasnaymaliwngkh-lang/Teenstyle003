import type { DefaultSession } from "next-auth";

import type { RoleName } from "@/lib/permissions";

/**
 * เพิ่มฟิลด์ของเราเข้า type ของ Session
 * ค่าเหล่านี้ถูกเติมใน callback `session` ของ src/lib/auth.ts
 */
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: RoleName;
      /** key ของสิทธิ์ เช่น "product:create" — ใช้ซ่อน/แสดง UI เท่านั้น */
      permissions: string[];
      status: string;
      loyaltyTier: string;
      points: number;
    } & DefaultSession["user"];
  }
}
