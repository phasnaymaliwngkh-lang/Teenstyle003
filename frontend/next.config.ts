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
