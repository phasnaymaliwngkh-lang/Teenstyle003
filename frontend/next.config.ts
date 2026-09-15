import path from "node:path";

import { config as loadEnv } from "dotenv";
import type { NextConfig } from "next";

/**
 * Next โหลด .env เฉพาะในโฟลเดอร์ frontend/ เท่านั้น
 * แต่โปรเจกต์นี้เก็บ env ของทั้งระบบไว้ที่ .env ของ root (backend และ Prisma ใช้ร่วมกัน)
 * จึงโหลดจาก root ที่นี่ เพื่อให้ DATABASE_URL / AUTH_SECRET / GOOGLE_* มีค่าในฝั่ง server
 *
 * ไฟล์นี้รันในโปรเซสเดียวกับ dev server และ next start จึงส่งต่อถึง Server Component ได้
 * ค่าใน frontend/.env.local ยังชนะค่าจาก root เพราะ Next โหลดทีหลังและเราไม่ override
 */
loadEnv({ path: path.resolve(process.cwd(), "..", ".env"), quiet: true });

const nextConfig: NextConfig = {
  // ให้ build ล้มถ้า type ผิด — ห้ามปิด (UNIVERSAL RULE #7, #38)
  typescript: {
    ignoreBuildErrors: false,
  },
  // หมายเหตุ Next 16: ไม่มี key `eslint` ใน next.config แล้ว (next lint ถูกถอดออก)
  // การ lint รันแยกด้วย `npm run lint --workspace frontend` ผ่าน ESLint flat config

  // ไม่ส่ง header ที่บอกว่าใช้ framework อะไร (STEP 28)
  poweredByHeader: false,

  /**
   * Prisma ต้องรันเป็น Node module จริง ห้ามให้ bundler รวมเข้า bundle
   * (มี WASM query compiler + driver adapter ที่ bundle ไม่ได้)
   * Auth.js ใช้ Prisma adapter จึงต้องประกาศ @teenstyle/database ไว้ที่นี่
   */
  serverExternalPackages: ["@teenstyle/database", "@prisma/client", "@prisma/adapter-pg", "pg"],

  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // รูปโปรไฟล์จากบัญชี Google (แสดงบน navbar)
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      /**
       * รูปสินค้าที่ seed ไว้ตอนนี้ชี้ไป Unsplash
       * ถ้าไม่ประกาศ host ที่นี่ next/image จะ error ตอน render
       * STEP 47 จะย้ายรูปไป Cloudinary แล้วเปลี่ยน host ตรงนี้
       */
      { protocol: "https", hostname: "images.unsplash.com" },
    ],
  },

  /**
   * ส่งต่อคำขอของ **เบราว์เซอร์** ไป backend ผ่านโดเมนของ frontend (STEP deploy)
   *
   * ทำไมต้องมี: ถ้าเบราว์เซอร์ยิงไป backend คนละโดเมนตรง ๆ Chrome/Safari จะบล็อก
   * cookie แบบ third-party → ตะกร้า สั่งซื้อ จ่ายเงิน และทุกการแก้ข้อมูลหลังบ้านพังหมด
   * เมื่อคำขอวิ่งผ่านโดเมนเดียวกัน cookie เป็น first-party จึงถูกส่งไปตามปกติ
   *
   * ⚠️ **ห้ามใช้ prefix `/api`** เพราะ Next เป็นเจ้าของ `/api/auth/*` (Auth.js)
   *    และ `/api/cart/merge` อยู่แล้ว — ถ้าทับกัน การล็อกอินจะพัง
   * ⚠️ ปิดอยู่โดยปริยาย (ไม่ตั้ง env = ไม่มี rewrite) ตอน dev จึงยิงตรงไป :4000 เหมือนเดิม
   */
  async rewrites() {
    const prefix = process.env.NEXT_PUBLIC_API_PROXY_PATH;
    const target = process.env.NEXT_PUBLIC_API_URL;

    if (!prefix || !target) return [];

    return [
      {
        source: `${prefix.replace(/\/$/, "")}/:path*`,
        destination: `${target.replace(/\/$/, "")}/:path*`,
      },
    ];
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          // จำกัดสิทธิ์อุปกรณ์ — camera เปิดไว้เพราะ STEP 17 ต้องสแกน barcode/QR
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
