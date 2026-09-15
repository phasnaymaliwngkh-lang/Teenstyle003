# 01 — Architecture

## ภาพรวม

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (Chrome)                                                    │
└───────────────┬──────────────────────────────────────────────────────┘
                │ HTTPS
        ┌───────▼─────────────────────┐
        │  frontend — Next.js :3000   │  Customer site + Admin dashboard
        │  App Router · Tailwind v4   │  Auth.js session (STEP 3)
        └───────┬─────────────────────┘
                │ REST (fetch, NEXT_PUBLIC_API_URL)
        ┌───────▼─────────────────────┐
        │  backend — Express 5 :4000  │  ⭐ ชั้นเดียวที่แตะ database / secret
        │  validate → authz → service │
        └──┬────────────┬─────────┬───┘
           │            │         │
   ┌───────▼──┐  ┌──────▼────┐  ┌─▼──────────┐
   │PostgreSQL│  │   Redis   │  │ OpenAI API │
   │ (Prisma) │  │cache+jobs │  │  (STEP 19) │
   └──────────┘  └───────────┘  └────────────┘
```

**กฎเหล็ก:** frontend ไม่ต่อ database และไม่ถือ secret ใด ๆ ทุกอย่างผ่าน backend
AI ก็เช่นกัน — frontend คุยกับ `/api/ai` ของเรา ไม่เคยเรียก OpenAI ตรง

## Tech Stack (เวอร์ชันที่ติดตั้งจริงใน STEP 1)

| ชั้น         | เทคโนโลยี                                       | เวอร์ชัน                    |
| ------------ | ----------------------------------------------- | --------------------------- |
| Frontend     | Next.js (App Router)                            | 16.3.5                      |
|              | React                                           | 19.2.8                      |
|              | Tailwind CSS                                    | v4                          |
|              | Zustand / React Hook Form / Zod / Framer Motion | 5 / 7 / 4 / 13              |
| Backend      | Express                                         | 5.2.1                       |
|              | Zod, Helmet, CORS, express-rate-limit, pino     | —                           |
| Database     | PostgreSQL                                      | 17 (Docker)                 |
|              | Prisma ORM                                      | **7.10.0**                  |
| Runtime      | Node.js                                         | ≥ 20.9 (dev เครื่องนี้ v24) |
| Cache / Jobs | Redis + BullMQ                                  | STEP 34 / 52                |

## โครงสร้าง monorepo (npm workspaces)

```
web003/                       root — scripts รวม, .env, docker-compose
├── frontend/                 Next.js
│   └── src/
│       ├── app/              App Router (route, layout, page)
│       ├── components/       ui/ (shadcn) · layout/ · shared/
│       ├── features/         แยกตาม domain: products, cart, checkout, ai, admin …
│       ├── hooks/            custom React hooks
│       ├── lib/              api client, utils(cn), env ฝั่ง client
│       ├── services/         ฟังก์ชันเรียก REST API ต่อ resource
│       ├── store/            Zustand store (cart, ui)
│       ├── types/            type ที่ใช้ร่วมกัน
│       └── utils/            ฟังก์ชันช่วยที่ไม่ผูกกับ React
├── backend/
│   └── src/
│       ├── routes/           กำหนด path + ต่อ middleware
│       ├── controllers/      อ่าน request → เรียก service → ส่ง response
│       ├── services/         business logic + database transaction
│       ├── validators/       Zod schema ตรวจ input
│       ├── middlewares/      auth, rbac, error, rate limit, request id
│       ├── models/           แปลง Prisma model → response ที่ปลอดภัย
│       ├── jobs/             BullMQ worker (STEP 52)
│       ├── config/           env ที่ validate แล้ว
│       └── utils/            ApiError, response helper, logger
└── database/                 @teenstyle/database
    ├── prisma/schema.prisma
    ├── prisma.config.ts      ⚠️ DATABASE_URL อยู่ที่นี่ (Prisma 7)
    ├── migrations/
    ├── generated/prisma/     client ที่ generate (TypeScript, gitignored)
    ├── seed/
    └── src/index.ts          PrismaClient singleton
```

## การไหลของ request (รูปแบบที่ทุก endpoint ต้องทำตาม)

```
request
  → requestId            ใส่ X-Request-Id เพื่อไล่ log
  → helmet / cors        security header + origin ที่อนุญาต
  → rate limit           กัน brute force / abuse
  → express.json         parse body (จำกัด 1mb)
  → route
      → middleware auth       ตรวจ session            (STEP 3)
      → middleware rbac       ตรวจ role/permission    (STEP 3)
      → validator (Zod)       ตรวจ input              → 422 ถ้าผิด
      → controller            ไม่มี business logic
      → service               logic + prisma + transaction
  → response { success, message, data }
  → errorHandler         แปลงทุก error เป็น { success:false, message, errorCode }
```

## เหตุผลของการตัดสินใจสำคัญ

### ทำไม backend แยกจาก Next.js (ไม่ใช้ Route Handler ล้วน)

Master Prompt กำหนด Express + Node เป็น backend และการแยกทำให้:
frontend deploy บน Vercel ได้โดยไม่ต้องแบก DB connection · scale แยกกันได้ ·
background job / webhook / cron อยู่ที่เดียว · มีขอบเขตชัดว่า secret อยู่ฝั่งไหน

### ทำไม Prisma 7 ต้องตั้งค่าต่างจาก tutorial

Prisma 7 ย้าย connection URL ออกจาก `schema.prisma` ไป `prisma.config.ts`,
บังคับใช้ driver adapter (`@prisma/adapter-pg`) และ generate client เป็น **TypeScript source**
ผลคือทั้ง `database` และ `backend` ต้องเป็น ESM และ `tsconfig` ต้องเปิด
`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`
รายละเอียดและตารางเทียบกับ Prisma 6 อยู่ที่ [database/README.md](../database/README.md)

### ลำดับ build ที่ห้ามสลับ

```
prisma generate (database)  →  tsc (database)  →  tsc (backend)  →  next build (frontend)
```

`npm run build` ที่ root ทำตามลำดับนี้ให้แล้ว
