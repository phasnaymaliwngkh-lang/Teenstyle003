import { PrismaAdapter } from "@auth/prisma-adapter";
import { getPrisma } from "@teenstyle/database";
import NextAuth, { type NextAuthConfig } from "next-auth";
import type { Adapter, AdapterUser } from "next-auth/adapters";
import Google from "next-auth/providers/google";

import type { RoleName } from "./permissions";

/**
 * TEENSTYLE AI — Authentication (STEP 3)
 *
 * Auth.js v5 + Google OAuth + session เก็บในฐานข้อมูล (ไม่ใช่ JWT)
 *
 * เหตุผลที่เลือก session แบบฐานข้อมูล
 *   1. เพิกถอนได้ทันที — admin ระงับบัญชี แล้ว session ที่ค้างอยู่ใช้ต่อไม่ได้
 *   2. backend (Express) ตรวจ session จากตาราง Session เดียวกันได้ ไม่ต้องแชร์ secret
 *      หรือถอดรหัส JWT ของ Auth.js เอง (ลดจุดที่พลาดเรื่องความปลอดภัย)
 *
 * หมายเหตุสถาปัตยกรรม: ชั้น Auth.js นี้เป็นข้อยกเว้นเดียวที่ Next.js แตะฐานข้อมูลโดยตรง
 * (เพราะ Prisma adapter ต้องเขียนตาราง User/Account/Session) — โค้ดนี้รันฝั่ง server เท่านั้น
 * ส่วนการอนุญาตสิทธิ์ของ API ทั้งหมดยังตรวจที่ backend
 */

const prisma = getPrisma();

/** ตรวจว่าตั้งค่า Google OAuth ครบหรือยัง — ใช้ให้หน้า /signin แจ้งเตือนแทนที่จะพัง */
export const isGoogleConfigured = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

export const isAuthSecretConfigured = Boolean(process.env.AUTH_SECRET);

/**
 * ห่อ PrismaAdapter เพื่อบังคับว่าผู้ใช้ใหม่ต้องได้บทบาท CUSTOMER
 * (schema กำหนด User.roleId เป็น required แต่ adapter เดิมไม่รู้จักฟิลด์นี้)
 */
function createAdapter(): Adapter {
  // cast จำเป็น: adapter ประกาศ type ไว้กับ PrismaClient ของ @prisma/client
  // แต่ Prisma 7 generate client ไปที่ database/generated/prisma (ดู database/README.md)
  const base = PrismaAdapter(prisma as unknown as Parameters<typeof PrismaAdapter>[0]);

  return {
    ...base,
    async createUser(data: AdapterUser) {
      const customerRole = await prisma.role.findUnique({ where: { name: "CUSTOMER" } });
      if (!customerRole) {
        throw new Error(
          'ไม่พบบทบาท CUSTOMER ในฐานข้อมูล — รัน "npm run db:seed" ก่อนเข้าสู่ระบบครั้งแรก',
        );
      }

      // ไม่ใช้ data.id ที่ Auth.js สร้างมา — ปล่อยให้ Prisma สร้าง uuid(7) ตาม schema
      const created = await prisma.user.create({
        data: {
          email: data.email,
          emailVerified: data.emailVerified,
          name: data.name ?? null,
          image: data.image ?? null,
          roleId: customerRole.id,
        },
      });

      return created as unknown as AdapterUser;
    },
  };
}

export const authConfig: NextAuthConfig = {
  adapter: createAdapter(),
  session: { strategy: "database", maxAge: 30 * 24 * 60 * 60 }, // 30 วัน
  // จำเป็นเมื่อรันเองนอก Vercel — Auth.js เชื่อ host จาก AUTH_URL
  trustHost: true,
  pages: {
    signIn: "/signin",
    error: "/signin",
  },
  providers: isGoogleConfigured
    ? [
        Google({
          clientId: process.env.GOOGLE_CLIENT_ID,
          clientSecret: process.env.GOOGLE_CLIENT_SECRET,
          // ขอเท่าที่จำเป็น (STEP 53 — ห้ามเก็บข้อมูลที่ไม่จำเป็น)
          authorization: {
            params: { scope: "openid email profile", prompt: "select_account" },
          },
          /**
           * จำเป็นต้องเปิด เพราะผู้ใช้ที่ถูกสร้างไว้ก่อนแล้วในฐานข้อมูล (เช่น admin จาก seed
           * หรือพนักงานที่ admin สร้างให้ใน STEP 25) ยังไม่มีแถวใน Account
           * ถ้าปิดไว้ Auth.js จะ throw OAuthAccountNotLinked แล้วล็อกอินไม่ได้เลย
           * (ดู @auth/core/lib/actions/callback/handle-login.js บรรทัด ~231)
           *
           * ที่เรียกว่า "dangerous" คือกรณี provider ไม่ยืนยันความเป็นเจ้าของอีเมล
           * ซึ่งจะทำให้ยึดบัญชีคนอื่นได้ — โปรเจกต์นี้ปิดช่องนั้นด้วย 2 อย่าง:
           *   1. มี provider เดียวคือ Google ซึ่งยืนยันอีเมลให้เสมอ
           *   2. callback signIn ด้านล่างปฏิเสธถ้า profile.email_verified ไม่เป็น true
           */
          allowDangerousEmailAccountLinking: true,
        }),
      ]
    : [],
  callbacks: {
    /** กันคนที่ถูกระงับบัญชีเข้าสู่ระบบ + บังคับว่า Google ต้องยืนยันอีเมลแล้ว */
    async signIn({ user, account, profile }) {
      if (!user.email) return false;

      /**
       * ด่านที่ทำให้ allowDangerousEmailAccountLinking ปลอดภัย
       * ถ้าอีเมลยังไม่ถูกยืนยัน จะผูกเข้าบัญชีที่มีอยู่แล้วไม่ได้
       */
      if (account?.provider === "google") {
        const emailVerified = (profile as { email_verified?: boolean } | undefined)?.email_verified;
        if (emailVerified !== true) return false;
      }

      const existing = await prisma.user.findUnique({
        where: { email: user.email },
        select: { status: true, deletedAt: true },
      });

      if (!existing) return true; // ผู้ใช้ใหม่ — createUser จะให้บทบาท CUSTOMER
      if (existing.deletedAt) return false;
      return existing.status === "ACTIVE";
    },

    /** แนบบทบาทและสิทธิ์เข้า session เพื่อให้ UI และ DAL ใช้ตรวจได้ */
    async session({ session, user }) {
      const record = await prisma.user.findUnique({
        where: { id: user.id },
        select: {
          status: true,
          loyaltyTier: true,
          points: true,
          role: {
            select: {
              name: true,
              permissions: { select: { key: true } },
            },
          },
        },
      });

      session.user.id = user.id;
      session.user.role = (record?.role.name ?? "CUSTOMER") as RoleName;
      session.user.permissions = record?.role.permissions.map((p) => p.key) ?? [];
      session.user.status = record?.status ?? "ACTIVE";
      session.user.loyaltyTier = record?.loyaltyTier ?? "MEMBER";
      session.user.points = record?.points ?? 0;

      return session;
    },
  },
  events: {
    /**
     * บันทึกเวลาเข้าสู่ระบบล่าสุด (ใช้ในหน้า Customer Management — STEP 25)
     * และเติมข้อมูลโปรไฟล์จาก Google ให้บัญชีที่ถูก "ผูก" เข้ามา
     *
     * ทำไมต้องเติมที่นี่: Auth.js เรียก adapter.createUser เฉพาะผู้ใช้ใหม่
     * บัญชีที่มีอยู่ก่อนแล้ว (เช่น admin จาก seed) จะไม่ได้ name/image จาก Google เลย
     * เราเติมเฉพาะช่องที่ยังว่าง — ไม่เขียนทับค่าที่ผู้ใช้หรือ admin ตั้งไว้เอง
     */
    async signIn({ user, account, profile }) {
      if (!user.id) return;

      const current = await prisma.user.findUnique({
        where: { id: user.id },
        select: { name: true, image: true, emailVerified: true },
      });

      const googleProfile = profile as
        { name?: string; picture?: string; email_verified?: boolean } | undefined;

      await prisma.user.update({
        where: { id: user.id },
        data: {
          lastLoginAt: new Date(),
          ...(current?.name ? {} : { name: googleProfile?.name ?? null }),
          ...(current?.image ? {} : { image: googleProfile?.picture ?? null }),
          // Google ยืนยันอีเมลมาแล้ว (callback signIn บังคับ email_verified = true)
          ...(current?.emailVerified || account?.provider !== "google"
            ? {}
            : { emailVerified: new Date() }),
        },
      });
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
