# CLAUDE.md — TEENSTYLE AI

> **Find your style, be you 💜**
> Full Stack Fashion E-Commerce สำหรับวัยรุ่น — Next.js + Express + PostgreSQL + Prisma + OpenAI

โปรเจกต์นี้เดินตาม **Master Prompt STEP 1–55** ทำทีละ STEP แล้วหยุดรอคำสั่งถัดไป
สถานะปัจจุบัน: **STEP 1–31 เสร็จแล้ว** — ครบวงจรทั้งฝั่งลูกค้าและร้าน:
หน้าร้าน → ตะกร้า → checkout → ชำระเงิน (COD จริง · Stripe รอใส่ key) → ติดตามคำสั่งซื้อ → รีวิวสินค้า → แจ้งเตือนในบัญชี
→ **บัญชีของฉัน: ข้อมูลส่วนตัว + สมุดที่อยู่**
→ **หลังบ้าน: ภาพรวมร้าน + รายงานยอดขาย + จัดการคำสั่งซื้อ + จัดการสินค้า + คลังสินค้า + แจ้งเตือนสต็อก + บาร์โค้ด/QR + นำเข้า/ส่งออก (CSV, Excel) + ตรวจรีวิว + จัดการลูกค้า + ประวัติการแก้ไข (Audit)**
→ **AI: AI Stylist (STEP 19) · AI Customer Service + Human Handoff (STEP 20) · AI Knowledge Base / FAQ (STEP 21)**
ทุกตัวมี Intelligent Fallback Engine ทำงานได้เต็มรูปแบบแม้ไม่มี `OPENAI_API_KEY`
→ ดู [docs/02-step-progress.md](docs/02-step-progress.md) · **endpoint ทุกเส้นทางอยู่ที่ [docs/09-api-reference.md](docs/09-api-reference.md)**

## ⚠️ อ่านก่อน: ไฟล์เก่าที่ root ไม่ใช่ส่วนหนึ่งของแอป

`index.html` · `style.css` · `script.js` · `assets/` ที่ root คือ **Landing Page prototype แบบสตัติก**
จากงานก่อนหน้า (vanilla HTML/CSS/JS, mock AI, ข้อมูลสินค้าใน `PRODUCTS` ของ `script.js`)

- เก็บไว้เป็น**อ้างอิงด้านดีไซน์** (สี, layout, โครง section, โทนข้อความ) เท่านั้น
- **ไม่ถูก build ไม่ถูก deploy** และ prettier ไม่แตะ (อยู่ใน `.prettierignore`)
- แอปจริงอยู่ใน `frontend/` `backend/` `database/`
- ห้ามนำ mock data ใน `script.js` มาใช้เป็นข้อมูลของแอปจริง — แอปจริงต้องดึงจาก PostgreSQL

## โครงสร้าง (npm workspaces, root = `web003/`)

```
web003/
├── frontend/     Next.js 16 · React 19 · Tailwind v4 · shadcn-ready   :3000
├── backend/      Express 5 · TypeScript ESM                            :4000
├── database/     @teenstyle/database — Prisma 7 schema/migrations/seed
├── docker/       Dockerfile ของ frontend + backend
├── docs/         เอกสารทั้งหมด (อ่าน 00 ก่อน)
└── index.html …  prototype เก่า (ดูหัวข้อด้านบน)
```

## คำสั่งที่ใช้บ่อย (รันจาก root เสมอ)

```bash
npm install              # ติดตั้งทุก workspace
npm run dev              # db:sync + backend :4000 + frontend :3000
npm run build            # db:sync → tsc backend → next build
npm run typecheck        # tsc ทั้ง 3 workspace — ต้องผ่านก่อน commit
npm run lint             # eslint backend + frontend
npm test                 # vitest ของ backend + frontend

npm run db:sync          # prisma generate + build database (รันหลังแก้ schema ทุกครั้ง)
npm run db:migrate       # prisma migrate dev (ต้องมี Postgres รันอยู่)
npm run db:seed
npm run db:studio

node scripts/audit-responsive.mjs   # ตรวจ responsive ทุกหน้าด้วย Chrome จริง (ต้องเปิด dev ไว้ก่อน)

npm run docker:up:infra  # เปิดแค่ Postgres + Redis (แนะนำตอน dev)
npm run docker:config    # validate compose ไม่ต้องเปิด daemon
```

## ⚠️ Prisma 7 — ต่างจาก tutorial ส่วนใหญ่

| เรื่อง           | Prisma 6 (ที่เจอใน tutorial)          | **Prisma 7 (โปรเจกต์นี้)**                                          |
| ---------------- | ------------------------------------- | ------------------------------------------------------------------- |
| connection URL   | `url = env("DATABASE_URL")` ใน schema | `datasource.url` ใน `database/prisma.config.ts`                     |
| generator        | `prisma-client-js`                    | `prisma-client` + ต้องระบุ `output`                                 |
| generated client | JS + .d.ts ใน node_modules            | **TypeScript source** ที่เราคอมไพล์เอง                              |
| สร้าง client     | `new PrismaClient()`                  | `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` |
| โหลด `.env`      | อัตโนมัติ                             | โหลดเองใน `prisma.config.ts`                                        |

ผลที่ตามมา: `database` และ `backend` เป็น **ESM** (`"type": "module"`) และ tsconfig เปิด
`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`
→ **import ภายใน backend/database ต้องลงท้ายด้วย `.ts`** เช่น `import { env } from './config/index.ts'`
(frontend เป็น bundler resolution ไม่ต้องใส่นามสกุล)

ใช้ Prisma จาก backend: `import { getPrisma, checkDatabaseHealth } from '@teenstyle/database'`
รายละเอียด: [database/README.md](database/README.md)

## ⚠️ Next 16 — breaking changes ที่ต้องรู้

- **Turbopack เป็น default** ทั้ง dev และ build
- **Async Request APIs**: `params`, `searchParams`, `cookies()`, `headers()` ต้อง `await`
- **`middleware.ts` เปลี่ยนชื่อเป็น `proxy.ts`** ← สำคัญกับ STEP 3 (route protection)
- **`next lint` ถูกถอด** และ **`next.config` ไม่มี key `eslint`** แล้ว — lint รันแยกผ่าน ESLint flat config
- ห้าม setState แบบ synchronous ใน `useEffect` (กฎ `react-hooks/set-state-in-effect`) —
  ตั้ง initial state ให้ถูก แล้ว setState ใน callback/event เท่านั้น
- เอกสารฉบับเต็มอยู่ใน `node_modules/next/dist/docs/` — **อ่านก่อนเขียนโค้ด Next ใหม่**
  (`01-app/02-guides/upgrading/version-16.md`)

## Authentication + RBAC (STEP 3 — สร้างแล้ว)

Auth.js v5 (`next-auth@5.0.0-beta.32`) + Google OAuth + **session เก็บในฐานข้อมูล** (ไม่ใช่ JWT)

| ชั้น               | ไฟล์                                                 | หน้าที่                                                                     |
| ------------------ | ---------------------------------------------------- | --------------------------------------------------------------------------- |
| config             | [frontend/src/lib/auth.ts](frontend/src/lib/auth.ts) | provider, adapter, callback ที่แนบ role + permissions                       |
| **ตรวจสิทธิ์จริง** | [frontend/src/lib/dal.ts](frontend/src/lib/dal.ts)   | `getSession` `requireUser` `requireStaff` `requireRole` `requirePermission` |
| optimistic         | [frontend/src/proxy.ts](frontend/src/proxy.ts)       | ดูแค่ว่ามี cookie ไหม + ใส่ header `x-pathname`                             |
| backend            | `middlewares/authenticate.ts` · `authorize.ts`       | อ่าน session จากตาราง `Session` เดียวกัน                                    |

**กฎที่ห้ามละเมิด**

1. **`proxy.ts` ห้ามยิงฐานข้อมูล** และห้ามเป็นด่านเดียว — มันรันทุก request รวม prefetch
   การตรวจจริงต้องอยู่ใน layout/page ผ่าน DAL และที่ backend
2. **ห้ามให้ `proxy.ts` จัดเส้นทางตามสถานะล็อกอิน** — cookie ที่ค้างอยู่แต่ session ถูกลบแล้ว
   จะทำให้เกิด redirect loop (เคยเกิดจริงระหว่าง `/signin` ↔ `/after-signin`)
   ถ้าต้องเด้งคนที่ล็อกอินแล้ว ให้ทำในหน้า (ที่อ่าน DB ได้) เสมอ
3. **API ที่ต้องล็อกอินให้เรียกจาก Server Component** ด้วย `apiFetchAsUser()` ใน `lib/api-server.ts`
   (session cookie เป็น httpOnly · production คนละโดเมนจึงต้องส่งต่อเป็น `Authorization: Bearer`)
4. **สิทธิ์อยู่ในฐานข้อมูล** (Role ↔ Permission) ห้าม hard-code รายการสิทธิ์ในโค้ด
   `session.user.permissions` ใช้ซ่อน/แสดงปุ่มเท่านั้น — ไม่ใช่การป้องกัน
5. หน้าแรกหลังล็อกอิน: `CUSTOMER → /account` · `EMPLOYEE|ADMIN|SUPER_ADMIN → /admin`
   ตัดสินที่ `/after-signin` (ตอนกด signIn ยังไม่รู้บทบาท)
6. **`frontend/.env.local` ต้องมีเฉพาะ `NEXT_PUBLIC_*`** — Next โหลดทีหลัง root `.env`
   ถ้าประกาศ `AUTH_SECRET=` ว่างไว้จะทับค่าจริงแล้วเกิด `MissingSecret` (เคยเกิดจริง)
7. **`allowDangerousEmailAccountLinking: true` จำเป็น — ห้ามปิด**
   ผู้ใช้ที่ถูกสร้างไว้ก่อน (admin จาก seed, พนักงานที่ admin สร้างให้) ยังไม่มีแถวใน `Account`
   ถ้าปิด Auth.js จะ throw `OAuthAccountNotLinked` แล้วล็อกอินไม่ได้เลย
   ความปลอดภัยมาจาก callback `signIn` ที่บังคับ `profile.email_verified === true`
   → **ถ้าเพิ่ม provider อื่นที่ไม่ยืนยันอีเมล ต้องทบทวนเรื่องนี้ใหม่**
8. **seed ห้ามใส่ `name`/`image` สมมติ** — เพราะเราไม่เขียนทับค่าที่มีอยู่
   ถ้า seed ใส่ชื่อปลอมไว้ ชื่อจริงจาก Google จะไม่ถูกเติมตลอดไป

## Layout (STEP 4 — สร้างแล้ว)

ใช้ **route group** แยก chrome ของหน้าร้านกับหลังบ้าน (ชื่อในวงเล็บไม่มีผลกับ URL)

```
app/
├── layout.tsx              html · body · fonts · metadata (root)
├── (storefront)/
│   ├── layout.tsx          Navbar + Footer
│   ├── page.tsx            /
│   ├── shop/ product/[slug]/   ← ของจริงแล้ว (STEP 6)
│   ├── looks/ looks/[slug]/    ← ของจริงแล้ว (STEP 7–8)
│   ├── cart/ checkout/ checkout/success/   ← ของจริงแล้ว (STEP 9–11 · success = แผงชำระเงิน)
│   ├── account/orders/ account/orders/[orderNumber]/   ← ประวัติ + ติดตาม (STEP 12)
│   ├── account/profile/    ข้อมูลส่วนตัว (STEP 25 · ต้องล็อกอิน)
│   ├── account/addresses/  สมุดที่อยู่ (STEP 25 · ต้องล็อกอิน)
│   ├── account/reviews/    รีวิวของฉัน ทุกสถานะ (STEP 23 · ต้องล็อกอิน)
│   ├── account/notifications/  การแจ้งเตือนของฉัน (STEP 24 · ต้องล็อกอิน)
│   ├── ai-stylist          ผู้ช่วยเลือกชุดและสไตล์ (STEP 19)
│   ├── customer-service faq    ← AI CS + คลังความรู้ (STEP 20–21)
│   ├── wishlist            รายการที่ถูกใจ (STEP 22 · ต้องล็อกอิน)
│   ├── about search        ← placeholder (ComingSoon)
│   └── account forbidden unauthorized
├── admin/
│   ├── layout.tsx          แถบ admin + requireStaff() ป้องกันทุกหน้าใต้ /admin
│   ├── page.tsx            ภาพรวมร้าน (STEP 13)
│   ├── orders/ orders/[orderNumber]/   จัดการคำสั่งซื้อ (STEP 13)
│   ├── products/ products/new/ products/[productId]/   จัดการสินค้า (STEP 14)
│   ├── inventory/ inventory/movements/ inventory/[variantId]/   คลังสินค้า (STEP 15)
│   ├── alerts/             แจ้งเตือนสต็อก (STEP 16)
│   ├── barcodes/ barcodes/labels/   สแกนบาร์โค้ด + พิมพ์ป้าย (STEP 17)
│   ├── import-export/      นำเข้าและส่งออกสินค้า/สต็อก/คำสั่งซื้อ (STEP 18)
│   ├── reviews/            คิวตรวจรีวิวสินค้า (STEP 23)
│   ├── customers/ customers/[userId]/   จัดการลูกค้าและบัญชีผู้ใช้ (STEP 25)
│   ├── analytics/          รายงานยอดขาย + ส่งออก CSV/Excel (STEP 26)
│   └── logs/               ประวัติการแก้ไขหลังบ้าน (STEP 27)
├── signin/ after-signin/   อยู่นอกกลุ่ม — ไม่มี navbar (หน้าโฟกัสเดียว)
└── api/auth/[...nextauth]/
```

**กฎ**

1. **เมนูทั้งหมดอยู่ที่ [nav-config.ts](frontend/src/components/layout/nav-config.ts) ที่เดียว**
   navbar, mobile menu และ footer อ่านจากไฟล์นี้ — ห้ามเขียนรายการเมนูซ้ำในคอมโพเนนต์
2. **`NavItem` ที่ไม่มี `href` = ยังไม่มีหน้านั้น** footer จะแสดงเป็นข้อความ + ป้าย STEP
   **ห้ามใส่ `href` ไปยังเส้นทางที่ยังไม่มีหน้า** (จะกลายเป็นลิงก์ไป 404)
3. **หน้าใหม่ที่ต้องมี navbar ให้สร้างใน `(storefront)/`** · หน้าหลังบ้านใน `admin/`
4. **`requireStaff()` อยู่ที่ `admin/layout.tsx` แล้ว** — หน้าย่อยใต้ /admin ไม่ต้องจำใส่เอง
   แต่ถ้าต้องการสิทธิ์เฉพาะ ให้เรียก `requirePermission()` เพิ่มในหน้านั้น
5. **ห้าม setState ใน `useEffect` เพื่อ reset state ตาม path** — ใช้แพตเทิร์นปรับ state ระหว่าง render
   (ดูตัวอย่างใน [mobile-menu.tsx](frontend/src/components/layout/mobile-menu.tsx)) ไม่งั้นติดกฎ `react-hooks/set-state-in-effect`
6. **รูปจากภายนอกต้องประกาศใน `images.remotePatterns`** ของ `next.config.ts` ก่อนใช้กับ `next/image`
   (ปัจจุบันมี `lh3.googleusercontent.com` สำหรับรูปโปรไฟล์ Google)

⚠️ **ผลข้างเคียงที่ต้องจัดการใน STEP 33/34:** navbar อ่าน session จึงทำให้ทุกหน้าในหน้าร้าน
เป็น dynamic (`ƒ`) ไม่ถูก prerender เป็น static อีก → ตอนทำ SEO/Performance ให้พิจารณา
Partial Prerendering หรือย้าย UserMenu ไปอยู่ใน Suspense boundary เพื่อให้โครงหน้าเป็น static ได้

## Design tokens

ประกาศใน `@theme` ของ [frontend/src/app/globals.css](frontend/src/app/globals.css) (Tailwind v4 CSS-first)
**ใช้ token เท่านั้น ห้าม hardcode ค่าสี**

| Token                                   | ค่า                               | ใช้ตอนไหน                         |
| --------------------------------------- | --------------------------------- | --------------------------------- |
| `--color-brand`                         | `#7C3AED`                         | สี Brand หลัก, ปุ่ม, link active  |
| `--color-brand-light`                   | `#8B5CF6`                         | ปลายอ่อนของ gradient              |
| `--color-brand-soft`                    | `#A78BFA`                         | ไอคอน, เส้นขอบ accent             |
| `--color-brand-dark`                    | `#5B21B6`                         | ข้อความบนพื้นอ่อน                 |
| `--color-lilac` / `--color-lilac-50`    | `#EDE9FE` / `#F7F5FF`             | พื้นหลัง highlight / พื้น section |
| `--color-ink` / `--color-ink-soft`      | `#111114` / `#2B2B33`             | ข้อความหลัก / รอง                 |
| `--color-muted` / `--color-muted-light` | `#6B7280` / `#9CA3AF`             | ข้อความรอง / caption              |
| `--color-line`                          | `#E9E7F0`                         | เส้นคั่น, border                  |
| `--color-success/warning/danger`        | `#16A34A` / `#D97706` / `#DC2626` | สถานะ                             |
| `--radius-card` / `--radius-pill`       | `20px` / `999px`                  | radius                            |
| `--shadow-soft/lift/float/brand`        | soft shadow                       | การ์ด / hover / overlay / ปุ่ม    |

**คลาสช่วย:** `.btn-brand` (ปุ่ม purple gradient + hover lift) · `.text-brand-gradient` (ข้อความไล่สี)
**Font:** `Plus Jakarta Sans` (หัวข้อ/EN) + `Noto Sans Thai` (เนื้อหาไทย) ผ่าน `next/font` → `--font-sans` / `--font-thai`

**Visual direction:** Modern · Minimal · Fashion · Clean · Premium · Teen Friendly · Responsive
Rounded cards · soft shadows · smooth animation · white space เยอะ · ธีมสว่างเท่านั้น (ไม่ทำ dark mode)

## Conventions

### Backend

- ชั้นงาน: `routes` → `middlewares (auth/rbac)` → `validators (Zod)` → `controllers` → `services` → Prisma
- **controller ห้ามมี business logic** — อยู่ใน service เท่านั้น
- โยน error ด้วย `ApiError.badRequest()` / `.notFound()` / `.forbidden()` … จาก `utils/api-error.ts`
  แล้วให้ `errorHandler` แปลงเป็น response — **ห้าม `res.status().json()` ตรงเพื่อส่ง error**
- ส่งผลลัพธ์ผ่าน `sendSuccess(res, data, message, status)` ทุกครั้ง
- ห้าม `console.log` ใน backend (eslint บังคับ) — ใช้ `logger` จาก `utils/logger.ts`
- ชื่อไฟล์: `*.route.ts` `*.controller.ts` `*.service.ts` `*.validator.ts` `*.model.ts`

### Frontend

- คอมโพเนนต์ **ห้าม `fetch` ตรง** — เรียกผ่าน `src/services/*.service.ts` ซึ่งใช้ `apiFetch` จาก `src/lib/api.ts`
- Server Component เป็นค่าเริ่มต้น ใส่ `"use client"` เฉพาะที่ต้องมี state/effect/event
- ของกลางอยู่ `components/` · ของเฉพาะ domain อยู่ `features/<domain>/`
- ใช้ `cn()` จาก `src/lib/utils.ts` รวม class ทุกครั้งที่มี conditional class
- env ฝั่ง client อ่านผ่าน `publicEnv` ใน `src/lib/env.ts` เท่านั้น

### Response shape (ห้ามเปลี่ยน)

```jsonc
{ "success": true,  "message": "สำเร็จ", "data": { } }
{ "success": false, "message": "...", "errorCode": "NOT_FOUND", "details": [] }
```

`errorCode` ที่มี: `BAD_REQUEST` `UNAUTHORIZED` `FORBIDDEN` `NOT_FOUND` `CONFLICT`
`VALIDATION_ERROR` `TOO_MANY_REQUESTS` `INTERNAL_ERROR` `SERVICE_UNAVAILABLE`

## กฎที่ห้ามละเมิด (จาก UNIVERSAL DEVELOPMENT RULES)

1. **ใช้ database จริงเท่านั้น** — ห้าม mock data แทนระบบจริง
2. **ห้าม hard-code secret** — ทุกค่าผ่าน env · frontend ห้ามแตะ server secret · `NEXT_PUBLIC_*` ใส่ secret ไม่ได้
3. **AI ห้ามแต่ง** Product / Price / Stock / SKU / Order / Shipping Status / Policy — ต้องดึงจาก backend
   ถ้าไม่พบข้อมูล ให้ตอบว่าไม่พบ แล้วแนะนำให้ติดต่อเจ้าหน้าที่
4. **Stock ห้ามติดลบ** — ใช้ database transaction + atomic operation + กัน race condition และ duplicate deduction
5. **ราคาและ stock เชื่อฝั่ง server เท่านั้น** — ห้ามเชื่อค่าจาก client
6. **Order ห้ามซ้ำ · Payment ห้าม process ซ้ำ · Webhook ต้องมี idempotency**
7. **ห้ามเก็บ raw card data**
8. **TypeScript strict** — `npm run typecheck` ต้องผ่านก่อนถือว่าเสร็จ
9. **ทุก API ต้อง validate input** (Zod) และ endpoint สำคัญต้องตรวจ authentication + permission
10. **ทุกหน้า async ต้องมี loading / empty / error / retry** — ดูตัวอย่างที่
    [frontend/src/components/shared/system-status.tsx](frontend/src/components/shared/system-status.tsx)
11. **ทุกหน้า responsive** ไม่มี horizontal overflow (เช็คถึง 360px) · touch target ≥ 44px
    → วัดจริงด้วย `node scripts/audit-responsive.mjs` (ดูหัวข้อ **Responsive (STEP 31)**)
12. **Accessibility:** focus ring มองเห็นได้, ปุ่มไอคอนต้องมี `aria-label`, ทุก form ต้องมี label,
    `aria-live` สำหรับเนื้อหาที่เปลี่ยนเอง, เคารพ `prefers-reduced-motion`
    รายละเอียดที่เคยพลาดจริงและต้องเช็คทุกครั้ง อยู่ที่หัวข้อ **Accessibility — จุดที่พลาดบ่อย** ด้านล่าง
13. **แก้ error สำคัญให้จบก่อนสร้าง feature ใหม่**

## ทุกครั้งที่ทำ STEP เสร็จ ต้องทำ 3 อย่างนี้ตามลำดับ

**1. รายงาน:** Files Created · Files Modified · Dependencies Added · Database Changes · API Changes ·
Environment Variables · วิธี Run · วิธี Test · Errors Found · Errors Fixed · Remaining Tasks
**2. อัปเดต** [docs/02-step-progress.md](docs/02-step-progress.md) (+ CLAUDE.md ถ้ามีกฎใหม่)
**3. commit & push ขึ้น GitHub** — ผู้ใช้สั่งไว้ว่า **ทุก STEP ที่เสร็จต้อง push ทุกครั้ง**

```powershell
# git อยู่ที่ C:\Program Files\Git\cmd (ไม่อยู่ใน PATH ของ shell ที่ Claude ใช้)
$env:Path = "$env:Path;C:\Program Files\Git\cmd"
git add -A
# ข้อความ commit หลายบรรทัด (หรือมีภาษาไทย) ให้เขียนเป็นไฟล์แล้วใช้ -F
[System.IO.File]::WriteAllText($msgPath, $message, (New-Object System.Text.UTF8Encoding($false)))
git commit -F $msgPath
git push
```

⚠️ **ห้ามส่งข้อความ commit ที่มี `"` ผ่าน `-m` หรือ here-string** — PowerShell 5.1 re-quote
argument ของ native exe พลาด ทำให้ข้อความถูกตัดกลางแล้ว git อ่านส่วนที่เหลือเป็น pathspec
(`error: pathspec '…' did not match any file(s)`) · ใช้ `git commit -F <ไฟล์>` เสมอเมื่อข้อความ
มีหลายบรรทัด มีเครื่องหมายคำพูด หรือมีภาษาไทย (เจอจริงตอนปิด STEP 14)

remote: `origin` → https://github.com/phasnaymaliwngkh-lang/Teenstyle003.git (branch `main`)

**กฎของการ commit**

1. **ตรวจก่อน commit ว่าไม่มี secret หลุด** — `git status` แล้วดูว่า `.env` / `frontend/.env.local`
   ไม่อยู่ในรายการ (ทั้งคู่ถูก ignore อยู่แล้ว · ยืนยันด้วย `git check-ignore -v .env frontend/.env.local`)
   ถ้าเพิ่ม env var ใหม่ ให้ใส่ **ชื่อ** ลง `.env.example` ห้ามใส่ค่าจริง
2. **commit เฉพาะตอน typecheck / lint / test ผ่านหมดแล้ว** — ห้าม push โค้ดที่ build ไม่ผ่าน
3. **หนึ่ง STEP = หนึ่ง commit** ข้อความขึ้นต้นด้วย `STEP <n>:` เพื่อให้ไล่ประวัติตาม Master Prompt ได้
4. **ห้าม `push --force`** และห้าม commit ไฟล์ชั่วคราวที่สร้างไว้ตรวจงาน (`tmp-*`) — ลบก่อนเสมอ
5. ถ้า push แล้วติดเรื่องยืนยันตัวตน ดูหัวข้อ git ในส่วน "ข้อควรระวังเรื่องเครื่องมือ" ด้านล่าง

**จากนั้นหยุด รอคำสั่ง STEP ถัดไป**

## สภาพแวดล้อมจริงของเครื่องนี้ (สำคัญ — อย่าเดา)

- **ฐานข้อมูล: PostgreSQL 18.6 ติดตั้งในเครื่องแล้ว** (service `postgresql-x64-18`, port 5432, `scram-sha-256`)
  ใช้ตัวนี้ ไม่ได้ใช้ Docker · ลืมรหัส postgres ให้รัน `scripts/reset-pg-password.ps1` แบบ Administrator
- **Docker ใช้ไม่ได้**: Windows Home ไม่มี Hyper-V → Docker Desktop ต้องใช้ WSL2 แต่ **WSL ยังไม่ติดตั้ง**
  `docker ps` คืน 500 · `docker-compose.yml` เก็บไว้ใช้กับเครื่องอื่น/หลังติดตั้ง WSL
  ถ้าจะเปิด Docker Postgres ทีหลัง ต้องเปลี่ยน `POSTGRES_PORT` เพราะ 5432 ถูกใช้อยู่
- **ยังไม่มี Redis** — STEP 34/52 ต้องหาทางอื่น (Upstash/Memurai) หรือรอ WSL

## Data fetching + 4 สถานะ (STEP 5 — สร้างแล้ว)

หน้าแรกดึงข้อมูลจริงจาก REST API ทุก section — โครงที่ใช้ซ้ำได้:

```
Server Component (section)
  └─ services/catalog.service.ts   ← ชั้นเดียวที่เรียก API (มี revalidate + tags)
       └─ lib/api.ts (apiFetch)    ← แปลง error เป็น ApiClientError เสมอ
```

**ทุก section ที่ดึงข้อมูลต้องมี 4 สถานะ** — ใช้ชิ้นส่วนจาก
[components/shared/section.tsx](frontend/src/components/shared/section.tsx):

| สถานะ   | วิธีทำ                                                                    |
| ------- | ------------------------------------------------------------------------- |
| Loading | `<Suspense fallback={<SectionLoading />}>` ห่อ section ใน page            |
| Error   | `try/catch` ใน section → `<SectionError>` (มีปุ่ม Retry + `role="alert"`) |
| Empty   | `<SectionEmpty>` — ไม่มีปุ่ม Retry เพราะไม่ใช่ข้อผิดพลาด                  |
| Success | เนื้อหาจริง                                                               |

**กฎ**

1. **section หนึ่งพังต้องไม่ทำให้ทั้งหน้าพัง** — จับ error ใน section เอง ไม่ปล่อยขึ้น error.tsx
2. **ห้ามเดาข้อมูลแทนผู้ใช้** — "สินค้าขายดี" นับจาก `OrderItem` จริงเท่านั้น
   ยังไม่มีคำสั่งซื้อ = แสดง Empty State พร้อมอธิบายเหตุผล **ห้ามสลับไปใช้เกณฑ์อื่นเงียบ ๆ**
3. **ราคา/สต็อกคำนวณที่ backend** (`models/product.model.ts`) — frontend แสดงผลเท่านั้น
   `Decimal` ของ Prisma ต้องแปลงเป็น number ที่ชั้น DTO ไม่งั้นกลายเป็น string ใน JSON
4. **รูปจากภายนอกต้องอยู่ใน `images.remotePatterns`** ก่อนใช้ `next/image`
   (รูปสินค้าที่ seed ไว้เป็น URL ของ Unsplash)

### ⚠️ stale-while-revalidate ทำให้ error state ไม่โผล่ (ตั้งใจ)

`revalidate: 60` ทำให้ Next เก็บผลลัพธ์ไว้ที่ **`.next/dev/cache/fetch-cache`** (dev)
เมื่อ API ล่ม Next จะ **เสิร์ฟข้อมูลเดิมต่อ** แล้ว revalidate เบื้องหลังแบบเงียบ ๆ
(เห็น `ECONNREFUSED` ใน log แต่หน้าเว็บยังแสดงข้อมูลปกติ)

นี่เป็นพฤติกรรมที่ดีสำหรับผู้ใช้ — API ล่มชั่วคราวเว็บไม่ล่มตาม
แต่ **เวลาทดสอบ error state ต้องใช้ cache key ที่ยังไม่มีใน cache** (เช่นเปลี่ยนค่า `limit`)
ไม่ใช่แค่ปิด backend แล้วรีเฟรช เพราะจะยังเห็นข้อมูลเดิม

**การแก้ข้อมูลในฐานข้อมูลแล้วอยากเห็นผลทันที:** ลบ `frontend/.next/dev/cache/fetch-cache` ไม่พอ
เพราะ dev server ถือ cache ไว้ใน memory ด้วย — ต้องรอครบ 60 วินาทีแล้วยิง 2 ครั้ง
(ครั้งแรกได้ของเก่า + trigger revalidate, ครั้งที่สองได้ของใหม่) หรือรีสตาร์ต dev server

### ⚠️ `<Suspense>` / `loading.tsx` ทำให้ `notFound()` คืน HTTP 200 (STEP 6 — ทดลองยืนยันแล้ว)

Next จะ commit HTTP status ตอนเริ่ม stream ไบต์แรกออกไป ถ้า shell ถูก flush ไปก่อน
`notFound()` ที่เกิดทีหลัง **แสดงหน้า not-found ให้ผู้ใช้เห็นได้ แต่ status เป็น 200**
(soft 404 → search engine เข้าใจผิดว่าหน้านี้มีอยู่)

ผลทดลองบน `/product/[slug]` เครื่องนี้:

| โครงหน้า                                              | status ของ slug ที่ไม่มีจริง |
| ----------------------------------------------------- | ---------------------------- |
| มี `loading.tsx` (หรือห่อ `<Suspense>` ที่ระดับ page) | **200** ❌                   |
| `await` ข้อมูลหลักที่ระดับ page ตรง ๆ                 | **404** ✅                   |

เรียก `notFound()` ใน `generateMetadata` ก็ยังได้ 200 (Next 16 stream metadata — ลองกับ UA ของ Googlebot แล้วเช่นกัน)

**กฎ:** หน้าที่ต้องตอบ 404 ได้จริง (รายละเอียดสินค้า/คำสั่งซื้อ/หมวดหมู่) ให้ `await` ข้อมูลที่ใช้ตัดสิน 404
ที่ระดับ page **และห้ามมี `loading.tsx` ในโฟลเดอร์นั้น** — ส่วน Loading state ให้ไปอยู่กับ section รองที่
`<Suspense>` ได้ (เช่น "สินค้าที่เกี่ยวข้อง") ซึ่งไม่มีผลต่อ status

## Product System (STEP 6 — สร้างแล้ว)

```
/shop            → filter/sort/search/paginate ทั้งหมดอยู่ใน query string
/product/[slug]  → gallery + เลือกสี/ไซซ์/จำนวน + ตรวจสต็อกที่ server
```

**Backend** (`services/shop.service.ts`)

- ราคาที่ต้องจ่ายจริงคือ `COALESCE("salePrice","price")` — กรองและเรียงต้องใช้นิพจน์นี้
  จึงต้องเขียน raw SQL ด้วย `Prisma.sql` (Prisma ยังเรียงตามนิพจน์ไม่ได้)
- `ORDER BY` มาจาก **whitelist เท่านั้น** (`orderByFragment`) — ห้ามต่อสตริงจาก query ของผู้ใช้
- นับยอดรวมด้วย `count(*) OVER ()` ในคิวรีเดียว (ไม่ยิง count แยก)
- `getShopFilters` ต้องนับด้วยเงื่อนไขเดียวกับการค้นหา (รวมหมวดย่อย) ไม่งั้นเลขข้างตัวกรอง
  จะไม่ตรงกับผลจริง — มี test เทียบทุกหมวดกันเรื่องนี้

**กฎเรื่องสต็อกที่ห้ามละเมิด**

1. `available = quantity − reservedQuantity` คำนวณที่ server เท่านั้น และ **ห้ามติดลบ** (`Math.max(0, …)`)
2. ค่าที่ส่งไปหน้าเว็บใช้ **จำกัด input ล่วงหน้า** เพื่อ UX เท่านั้น
   ก่อน "เพิ่มลงตะกร้า" ต้องยิง `POST /api/products/availability` ทุกครั้ง (`cache: "no-store"`)
   แล้ว **เชื่อคำตอบของ server** ไม่ใช่ค่าที่ถืออยู่ฝั่ง client
3. ปุ่มซื้อต้องปิดเมื่อ `available === 0` และ quantity ต้องอยู่ในช่วง `1..available` เสมอ
4. STEP 9 (ตะกร้า) / STEP 10 (checkout) / STEP 11 (payment) **ต้องตรวจซ้ำด้วยตรรกะเดียวกันนี้อีก**
   — การตรวจที่หน้าสินค้าไม่ใช่ด่านสุดท้าย

**ทดสอบสถานะ Out of Stock กับข้อมูลจริง** (อย่าแก้ `quantity` ของ seed)
ให้ตั้ง `reservedQuantity = quantity` ชั่วคราวผ่าน SQL แล้วคืนเป็น 0 ทีหลัง —
ไม่แตะยอดในคลังจริง ไม่ขัด CHECK `reserved <= quantity` และย้อนกลับได้ครบ

### ⚠️ `Product.totalStock` ไม่ใช่ "จำนวนที่ซื้อได้" (เจอตอน STEP 7 · ปิดหนี้ตอน STEP 15)

มีสองนิยามที่ต่างกันและห้ามสับสน:

| ค่า                                            | ความหมาย                            | ใช้ตอนไหน                              |
| ---------------------------------------------- | ----------------------------------- | -------------------------------------- |
| `Product.totalStock`                           | cache ของ `SUM(Inventory.quantity)` | บอก "ของที่มีอยู่ในคลัง" ให้หลังบ้านดู |
| `SUM(GREATEST(quantity − reservedQuantity,0))` | ของที่ **ขายได้จริง**               | **ทุกการตัดสินใจว่าขายได้/ไม่ได้**     |

**แหล่งความจริงเดียวคือ [backend/src/models/availability.ts](backend/src/models/availability.ts)**
— `AVAILABLE_STOCK_SQL` (ใช้ในคิวรีที่ alias ตาราง Product เป็น `p`) และ
`getAvailableStockByProduct()` (ใช้กับ Prisma) ทั้งสองทางต้องให้คำตอบเดียวกัน

**กฎ**

1. **ห้ามใช้ `totalStock` ตัดสินว่าสินค้าขายได้หรือไม่** — เดิม `/shop` ใช้ `p."totalStock" > 0`
   ทำให้โฆษณาว่า "พร้อมส่ง" ทั้งที่ของถูกจองไปหมด (แก้แล้วใน STEP 15)
2. **การ์ดสินค้าต้องสร้างผ่าน `toProductCards()`** ใน `services/product.service.ts` เท่านั้น
   ห้ามเรียก `toProductCard()` ตรง ๆ — mapper บังคับให้ส่งค่าความพร้อมขายเป็นพารามิเตอร์
   จึงลืมไม่ได้ (ถ้าลืมจะ error ตอนคอมไพล์ ไม่ใช่แสดงผลผิดเงียบ ๆ)
3. `resolveStockStatus()` รับ **จำนวนที่ขายได้จริง** ไม่ใช่ `totalStock`
4. ที่ใช้ค่าถูกต้องแล้วทั้งหมด: หน้าแรก · `/shop` (ทั้งการ์ดและตัวกรอง) · หน้ารายละเอียดสินค้า ·
   `POST /api/products/availability` · ลุคทั้งหมด · ตะกร้า · dashboard (ของหมด/สต็อกต่ำ) ·
   รายการสินค้าและคลังในหลังบ้าน

> ถ้าแคตตาล็อกโตจนการ join Inventory ทุกครั้งช้าเกินไป ทางแก้คือเพิ่มคอลัมน์ cache
> `availableStock` ที่อัปเดต **ในทรานแซกชันเดียวกับการจอง/ตัด/คืนสต็อก** (งานของ STEP 34)
> ห้ามแก้ด้วยการกลับไปอ่าน `totalStock`

## Look Ideas (STEP 7–8 — สร้างแล้ว)

```
/looks          → กรองตามสไตล์ (หลายอันได้) · ค้นหา · เรียง 5 แบบ · แบ่งหน้า · "ซื้อครบชุดได้"
/looks/[slug]   → เลือกสี/ไซซ์ทุกชิ้น → ตรวจ "ซื้อทั้งชุด" ที่ server ครั้งเดียว
```

- ตรรกะอยู่ที่ [look.service.ts](backend/src/services/look.service.ts) (raw SQL `LOOK_STATS`
  คำนวณราคารวม/จำนวนชิ้น/ความพร้อมขายต่อลุค) + mapper ที่ [look.model.ts](backend/src/models/look.model.ts)
- **หน้าแรกและหน้า /looks ใช้ service + mapper + การ์ดชุดเดียวกัน** ตัวเลขจึงตรงกันเสมอ
  (`listFeaturedLooks` ย้ายจาก catalog.service มาอยู่ที่ look.service แล้ว)
- `allItemsAvailable` = ชิ้นครบตามที่ลุคจัดไว้ **และ** ทุกชิ้นซื้อได้จริง — SQL กับ TS ต้องให้คำตอบเดียวกัน
  (มี test เทียบตรง ๆ) เพราะ STEP 8 จะใช้ค่านี้กับปุ่ม "ซื้อทั้งชุด"
- การ์ดลุคขยายดูสินค้าในลุคด้วย `<details>` (ไม่ต้องมี JS) และลิงก์ไปทั้งหน้าลุคและหน้าสินค้าจริง

**กฎของ "ซื้อทั้งชุด" (STEP 8) — ห้ามละเมิด**

1. `POST /api/looks/:slug/availability` เป็น **ด่านจริง**: client ส่งได้แค่ `variantId` + `quantity`
   ราคาทุกบาทและสต็อกอ่านจากฐานข้อมูล — ฟิลด์ราคาที่ client แนบมาถูก Zod ตัดทิ้ง (มี test ยืนยัน)
2. ต้องตรวจว่า **variant อยู่ในลุคนี้จริง** (`NOT_IN_LOOK`) ไม่งั้นผู้ใช้ยัด variant อื่นมาคิดราคาชุดได้
3. ต้องเลือกครบทุกชิ้นที่ลุคจัดไว้ ไม่งั้น `purchasable = false` + บอกว่าขาดชิ้นไหน (`missingProducts`)
4. `totalPrice` รวมเฉพาะรายการที่ซื้อได้จริง — ห้ามโชว์ยอดที่เก็บเงินไม่ได้
5. ปุ่มบนหน้าเว็บยืนยันแค่ "ผลตรวจ" **ยังไม่บันทึกตะกร้า** จนกว่า STEP 9 จะต่อของจริง
   และ STEP 9/10/11 ต้องเรียกตรรกะเดียวกันนี้ตรวจซ้ำอีก

**ของกลางที่ใช้ซ้ำได้ (สร้างตอน STEP 7)**

| ไฟล์                                                                              | ใช้ทำอะไร                                                  |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| [lib/query-params.ts](frontend/src/lib/query-params.ts)                           | `createQueryHelpers(basePath, filterKeys)` — filter ใน URL |
| [components/shared/pagination.tsx](frontend/src/components/shared/pagination.tsx) | แบ่งหน้าแบบลิงก์ รับ `hrefFor` จากผู้เรียก                 |
| [features/products/lib/variant.ts](frontend/src/features/products/lib/variant.ts) | เลือก variant จากสี/ไซซ์ (หน้าสินค้า + ซื้อทั้งชุด)        |

## Cart (STEP 9 — สร้างแล้ว)

```
/cart                      → รายการ · แก้จำนวน · ติ๊กเลือก · สรุปยอด (Server Component)
POST /api/cart/items       → เพิ่ม (เพิ่มซ้ำ = บวกจำนวนในแถวเดิม)
PATCH /api/cart/items/:id  → แก้จำนวน · PATCH …/select → ติ๊กเลือก · DELETE → ลบ
POST /api/cart/looks/:slug → เพิ่มทั้งลุค (ตรวจว่า variant อยู่ในลุคนั้นจริง)
POST /api/cart/merge       → รวมตะกร้า guest เข้าบัญชี (ต้องล็อกอิน · idempotent)
```

**เจ้าของตะกร้า** — `Cart` มีเจ้าของได้แบบเดียวเท่านั้น (CHECK `Cart_owner_exclusive`)

| แบบ         | ตัวระบุ                                    | อายุ                 |
| ----------- | ------------------------------------------ | -------------------- |
| ล็อกอินแล้ว | `Cart.userId` (จาก session / Bearer)       | ไม่หมดอายุ           |
| guest       | cookie `cart-token` httpOnly (43 ตัวอักษร) | 30 วัน (`expiresAt`) |

**กฎที่ห้ามละเมิด**

1. **ราคาทุกบาทคำนวณที่ server จากฐานข้อมูล** — client ส่งได้แค่ `variantId` + `quantity`
   `CartItem.addedPrice` เก็บไว้ **เพื่อเตือนว่าราคาเปลี่ยน** เท่านั้น ห้ามใช้คิดเงิน
2. **ห้ามเกินจำนวนที่ซื้อได้จริง** — ตรวจในทรานแซกชันเดียวกับการเขียน (คืน 409 พร้อมบอกว่าเพิ่มได้อีกเท่าไร)
   และมี CHECK `CartItem_quantity_range` (1–99) เป็นด่านสุดท้าย
3. **หนึ่ง variant = หนึ่งแถวต่อตะกร้า** (unique `[cartId, variantId]`) — กันรายการซ้ำและกดปุ่มรัว ๆ
4. **ทุก mutation ตรวจว่ารายการอยู่ในตะกร้าของผู้เรียกเอง** (`findOwnedItem`) — ไม่เจอคืน 404 ไม่ใช่ 403
   (ไม่บอกใบ้ว่ามี id นั้นอยู่จริง)
5. **ทุก mutation ผ่าน `verifyOrigin`** — production ใช้ `SameSite=None` จึงต้องตรวจ Origin เองกัน CSRF
6. **ตะกร้าห้าม cache** — ทุกคำขอใช้ `cache: "no-store"` ทั้งฝั่ง client และ Server Component
7. **ค่าจัดส่งเป็น `null` ไม่ใช่ 0** จนกว่าจะรู้ที่อยู่ (STEP 10/44) · ส่วนลดเป็น 0 จนกว่าจะมีคูปอง (STEP 41)
   → UI แสดงว่า "คำนวณตอนชำระเงิน" **ห้ามใส่เลขสมมติให้หน้าดูครบ**
8. **ตะกร้าไม่ใช่การจองของ** — การจอง/ตัดสต็อกจริงเกิดตอนสั่งซื้อ (STEP 10/11) จึงต้องตรวจสต็อกซ้ำที่ checkout

**การรวมตะกร้าตอนล็อกอิน**

```
signIn → /after-signin (รู้บทบาท) → /api/cart/merge?next=<landing> → landing
```

`/api/cart/merge` ของ **Next** เป็น Route Handler เพราะหลังรวมเสร็จต้องลบ cookie `cart-token`
ของเบราว์เซอร์ — Next แก้ cookie ได้เฉพาะใน Route Handler / Server Action ไม่ใช่ตอน render หน้า
(`Set-Cookie` ที่ backend ส่งกลับมาถึงแค่ Next ไม่ถึงเบราว์เซอร์ เพราะเป็น fetch server-to-server)
· `next` รับเฉพาะ path ภายใน (กัน open redirect — ทดสอบแล้วทั้ง `https://evil…` และ `//evil…`)

**กฎราคาอยู่ที่ [pricing.ts](backend/src/models/pricing.ts) ที่เดียว** — `resolveProductPrice` /
`resolveVariantPrice` (เดิมเขียนซ้ำ 4 ที่ เสี่ยงแก้ไม่ครบแล้วราคาที่โชว์ไม่ตรงกับที่คิดเงิน)

## Checkout / Order (STEP 10 — สร้างแล้ว)

```
/checkout          → ที่อยู่ + วิธีจัดส่ง + สรุปยอด (ต้องล็อกอิน)
/checkout/success  → ยืนยันคำสั่งซื้อ อ่านจาก backend ด้วยเลขออเดอร์
GET  /api/checkout/summary   POST /api/orders   GET /api/orders/:orderNumber
```

**กฎที่ห้ามละเมิด**

1. **client ส่งได้แค่ `addressId`/`newAddress` + `shippingMethod` + `customerNote` + `idempotencyKey`**
   ราคา ยอดรวม ค่าจัดส่ง และรายการสินค้า อ่านจากตะกร้า+ฐานข้อมูลที่ server ทั้งหมด
   (มี test ส่ง `subtotal: 1` และ `items: [ของปลอม]` มาแล้วยืนยันว่าถูกเมิน)
2. **จองสต็อกแบบ atomic ด้วย SQL เดียว** — ห้ามอ่านแล้วค่อยเขียน:
   ```sql
   UPDATE "Inventory" SET "reservedQuantity" = "reservedQuantity" + $q
    WHERE "variantId" = $id AND "quantity" - "reservedQuantity" >= $q
   ```
   `rowCount = 0` → ของไม่พอ → throw แล้วทรานแซกชัน rollback ทั้งก้อน
   (ทดสอบแล้ว: สองคนแย่งชิ้นสุดท้ายพร้อมกัน สำเร็จรายเดียว · reserved ไม่เคยเกิน quantity)
3. **STEP 10 จองสต็อก ไม่ตัดสต็อก** — `quantity` ไม่เปลี่ยน ยังไม่มี `InventoryMovement`
   การตัดสต็อกจริง + movement เกิดตอนชำระเงินสำเร็จ (STEP 11)
4. **`idempotencyKey` (unique) กันออเดอร์ซ้ำ** — client สร้าง UUID ครั้งเดียวต่อการเปิดหน้า checkout
   ยิงซ้ำด้วยคีย์เดิม → คืนออเดอร์เดิม (200 ไม่ใช่ 201) ไม่จองสต็อกเพิ่ม
5. **snapshot ทุกอย่างที่ลูกค้าเห็น** ลง `OrderItem` (ชื่อ/SKU/สี/ไซซ์/รูป/ราคา) และ `Order.addressSnapshot`
   ประวัติต้องไม่เปลี่ยนเมื่อสินค้าหรือที่อยู่ถูกแก้ภายหลัง
6. **ค่าจัดส่งมาจาก [config/shipping.ts](backend/src/config/shipping.ts) ที่เดียว** — ทั้งตัวเลขที่โชว์และที่คิดเงิน
   ใช้ `calculateShippingFee` ตัวเดียวกัน (STEP 44 จะย้ายไปเป็นข้อมูลใน DB ให้ admin แก้)
   กฎจำกัดพื้นที่ (`onlyProvinces`) ถูกส่งไปให้ฟอร์มตรวจสด ๆ **และ server ตรวจซ้ำตอนสั่งซื้อ**
7. **ออเดอร์ของคนอื่นดูไม่ได้** — `getOrderByNumber` กรอง `userId` เสมอ (ไม่เจอ = 404)
8. หน้า `/checkout` ยังไม่ล็อกอิน → เด้งไป
   `/signin?callbackUrl=/api/cart/merge?next=/checkout` เพื่อให้ตะกร้า guest ถูกรวมเข้าบัญชีก่อน

## Payment (STEP 11 — สร้างแล้ว)

```
GET  /api/payments/methods            → ช่องทางที่เปิดใช้จริง (+เหตุผลถ้าปิด)
GET  /api/orders/:n/payment           → สถานะ + กำหนดชำระ + ประวัติการจ่าย
POST /api/orders/:n/pay   { provider } → COD: ยืนยันทันที · STRIPE: คืน url ของ Stripe
POST /api/orders/:n/cancel            → ยกเลิกออเดอร์ที่ยังไม่จ่าย + คืนของเข้าคลัง
POST /api/payments/webhook/stripe     → **raw body + ตรวจลายเซ็น** (ไม่ผ่าน auth/CSRF)
```

**วงจรสต็อกทั้งระบบ** (กฎกลาง — [inventory.service.ts](backend/src/services/inventory.service.ts))

| เหตุการณ์            | `quantity`  | `reservedQuantity` | InventoryMovement |
| -------------------- | ----------- | ------------------ | ----------------- |
| สั่งซื้อ (STEP 10)   | คงเดิม      | **+ จำนวน**        | ไม่มี             |
| ชำระเงินสำเร็จ / COD | **− จำนวน** | − จำนวน            | `STOCK_OUT` 1 แถว |
| ยกเลิก / หมดเวลา     | คงเดิม      | − จำนวน            | ไม่มี             |

**กฎที่ห้ามละเมิด**

1. **ห้ามทำหน้าชำระเงินปลอม** — ช่องทางที่ยังตั้งค่าไม่ครบต้องถูก **ปิด** พร้อมบอกเหตุผลจาก server
   (`paymentMethods()` ใน [config/payment.ts](backend/src/config/payment.ts)) ห้ามมีปุ่มที่ทำให้ "จ่ายแล้ว" เอง
2. **`paymentStatus = PAID` เปลี่ยนได้จากทางเดียวเท่านั้น**: webhook ของ Stripe ที่ลายเซ็นถูกต้อง
   COD ตั้งเป็น `PROCESSING` + `PENDING` (เงินได้ตอนส่ง) — **ห้ามตั้ง PAID ให้ COD**
3. **ห้ามเก็บ raw card data** — `Payment.rawPayload` เก็บได้แค่ sessionId/ยอด/สกุล/สถานะ (มี test ตรวจ)
4. **Webhook idempotent 3 ชั้น**: event id ซ้ำ → ตรวจพบ · เปลี่ยนสถานะเฉพาะเมื่อยัง `PENDING_PAYMENT`
   · ตัดสต็อกกันซ้ำด้วย `InventoryMovement.idempotencyKey = order:<id>:deduct:<variantId>`
5. **raw body เท่านั้น** — `app.ts` mount `express.raw()` ให้ `/api/payments/webhook` ก่อน `express.json()`
   ถ้า parse ก่อน ลายเซ็นจะไม่ตรงทุกครั้ง
6. **ห้ามคืนของของออเดอร์ที่จ่ายแล้ว** — `releaseReservationForOrder` ต้องถูกกันด้วยการเช็คสถานะก่อนเรียก
7. ออเดอร์ที่ไม่จ่ายเกิน `PAYMENT_WINDOW_MINUTES` (ค่าเริ่มต้น 24 ชม.) → `expireOverdueOrders()`
   ยกเลิกและคืนของ · **STEP 52 ต้องทำให้รันอัตโนมัติ** (ตอนนี้ยังต้องเรียกเอง)

## Order Tracking (STEP 12 — สร้างแล้ว)

```
/account/orders                  → ประวัติ + กรองตามสถานะ + แบ่งหน้า
/account/orders/[orderNumber]    → ไทม์ไลน์ + พัสดุ + รายการ + แผงชำระเงิน (STEP 11)
GET /api/orders?status=&page=&limit=
```

**กฎ**

1. **ไทม์ไลน์สร้างจาก timestamp ที่บันทึกไว้จริง** (`paidAt`, `processedAt`, `packedAt`, `shippedAt`,
   `deliveredAt`, `cancelledAt`, `refundedAt`) — ขั้นที่ยังไม่เกิดต้องเป็น `at: null`
   **ห้ามเดาเวลาที่จะส่งถึง** (เวลาคาดการณ์อยู่ใน `Shipment.estimatedDelivery` ที่ร้านกรอกเอง — STEP 44)
2. **ออเดอร์ที่ยกเลิก/คืนเงิน** แสดงเฉพาะขั้นที่เกิดขึ้นจริง + ปิดท้ายด้วยการยกเลิก
   ไม่โชว์ "ได้รับสินค้า" ที่ไม่มีทางเกิดอีก
3. **ยังไม่มีใบจัดส่ง → `shipments: []` และ `trackingNumber: null`** · UI บอกว่ายังไม่มีข้อมูลพัสดุ
   **ห้ามสร้างเลขพัสดุปลอม**
4. ทุก query กรอง `userId` — ออเดอร์ของคนอื่นได้ **404** (ไม่ใช่ 403 เพื่อไม่บอกใบ้ว่ามีอยู่จริง)
5. ตัวเลขข้างแท็บสถานะมาจาก `groupBy` จริง และมี test เทียบกับผลกรองทุกสถานะ

⚠️ **`InventoryMovement.referenceId` ไม่มี FK ไปที่ `Order`** — ลบออเดอร์แล้ว movement ไม่หายตาม
เทสต์ที่ยืนยัน COD ต้องลบ movement ของตัวเองใน `afterAll` ไม่งั้นเหลือ orphan
และทำให้เทสต์ไฟล์อื่นที่นับ movement เพี้ยน (เจอจริงตอน STEP 12)
**การนับ movement ในเทสต์ต้องกรองด้วย `referenceId` ของออเดอร์นั้น ไม่ใช่ด้วย `variantId`**

## Admin (STEP 13 — สร้างแล้ว)

```
/admin                        → ภาพรวมร้าน (ต้องมีสิทธิ์ analytics:read)
/admin/orders                 → รายการ + ค้นหา + กรอง (order:read)
/admin/orders/[orderNumber]   → รายละเอียด + ฟอร์มเปลี่ยนสถานะ (order:update)
GET /api/admin/overview · GET /api/admin/orders · PATCH /api/admin/orders/:n/status
```

**state machine ของสถานะ** ([admin-order.service.ts](backend/src/services/admin-order.service.ts))

```
PENDING_PAYMENT → CANCELLED
PAID → PROCESSING → PACKING → SHIPPING → DELIVERED
PAID / PROCESSING / PACKING → CANCELLED
DELIVERED / CANCELLED / REFUNDED → (จบ)
```

**กฎที่ห้ามละเมิด**

1. **ข้ามขั้นไม่ได้** — เส้นทางที่อนุญาตอยู่ใน `ALLOWED_TRANSITIONS` และตรวจที่ server
   (`allowedNextStatuses` ที่ส่งไปให้ UI เป็นเพียงการซ่อนปุ่ม ไม่ใช่การป้องกัน)
2. **เปลี่ยนเป็น SHIPPING ต้องมี carrier + trackingNumber จริง** → ระบบสร้างแถว `Shipment`
   **ห้ามสร้างเลขพัสดุสมมติ**
3. **สต็อกต้องตรงกับสถานะ**: ยกเลิกออเดอร์ที่ยังไม่ตัดสต็อก → คืนของที่จอง ·
   ยกเลิกออเดอร์ที่ตัดแล้ว → `restockForOrder` (movement `RETURN`, idempotent,
   และรับคืนได้เฉพาะรายการที่เคยมี movement `STOCK_OUT` จริง)
4. **COD: กด DELIVERED = ได้รับเงิน** จึงตั้ง `paymentStatus = PAID` ตอนนั้น
   ก่อนหน้านั้นห้ามตั้ง PAID
5. **ทุกการเปลี่ยนสถานะเขียน `AdminLog`** (userId · before · after · ip · userAgent)
   ในทรานแซกชันเดียวกับการเปลี่ยนข้อมูล
6. **ตัวเลขหน้า dashboard ต้องมาจากฐานข้อมูลจริง** — ยอดขายนับเฉพาะ `paymentStatus = PAID`
   (COD ที่ยังไม่เก็บเงินแยกเป็น `pendingCodAmount`) · ไม่มีข้อมูลก็แสดง 0/ว่าง
   **ห้ามใส่กราฟหรือยอดตัวอย่าง**
7. คืนเงิน (`REFUNDED`) ไม่อยู่ในหลังบ้านนี้ — ต้องทำผ่านระบบคืนเงิน STEP 43

## Product Management (STEP 14 — สร้างแล้ว)

```
/admin/products              → รายการ + ค้นหา + กรองสถานะ/สต็อกต่ำ (product:read)
/admin/products/new          → สร้างสินค้า + ตัวเลือก + รูป (product:create)
/admin/products/[productId]  → แก้ไข · จัดการตัวเลือก · ลบ (product:update / product:delete)
GET|POST /api/admin/products · GET /api/admin/products/options
GET|PATCH|DELETE /api/admin/products/:productId
POST /api/admin/products/:productId/variants · PATCH …/variants/:variantId
```

**กฎที่ห้ามละเมิด**

1. **สต็อกเดินผ่าน `InventoryMovement` เท่านั้น** — endpoint สินค้า **ห้ามเขียน `Inventory.quantity` ตรง ๆ**
   ตอนสร้าง variant ส่ง `initialStock` ได้ ซึ่งระบบบันทึกเป็น movement `STOCK_IN` จริง
   (key `variant:<id>:initial-stock`) + อัปเดต cache `Product.totalStock` ในทรานแซกชันเดียวกัน
   `updateVariantSchema` **ไม่มีฟิลด์จำนวนโดยเจตนา** — ส่ง `quantity` มาจะถูกตัดทิ้งแล้วกลายเป็นคำขอว่าง (422)
   การปรับยอด/รับเข้าภายหลังเป็นงานของ STEP 15
2. **ลบ = soft delete** (`deletedAt` + `status=ARCHIVED` + ปิดทุก variant) — หน้าร้านหายทันที
   แต่ `OrderItem` ยังอ้างอิงได้ · **ลบไม่ได้ถ้ามี `reservedQuantity > 0`** (409) ต้องเคลียร์ออเดอร์ก่อน
   UI ต้องบอกตรง ๆ ว่าเป็นการซ่อน ไม่ใช่ลบถาวร
3. **ราคาลดของ variant ตั้งได้เฉพาะเมื่อ variant กำหนด `price` ของตัวเองด้วย** (`assertVariantPriceShape`)
   เพราะกฎราคาใน [pricing.ts](backend/src/models/pricing.ts) ถือว่า variant ที่ `price = null`
   ใช้ราคา **และโปรโมชัน** ของสินค้าแม่ → salePrice ลอย ๆ จะไม่มีผลกับเงินที่เก็บจริง
   ส่ง `salePrice: null` / `price: null` = ล้างค่า (ต่างจากไม่ส่งมาเลย = ไม่แก้)
4. **เปิดขาย (ACTIVE) ต้องมีรูป ≥ 1 และ variant ที่ `isActive` ≥ 1** · `publishedAt` ตั้งครั้งแรกครั้งเดียว
5. **รูปรับได้เฉพาะ https + โฮสต์ใน [config/media.ts](backend/src/config/media.ts)**
   ซึ่งต้องตรงกับ `images.remotePatterns` ของ `next.config.ts` · ฟอร์มอ่านรายการนี้จาก API ไม่ฮาร์ดโค้ด
6. **PATCH ส่งเฉพาะฟิลด์ที่เปลี่ยน** (`toUpdateInput` diff กับค่าเดิม) ไม่เขียนทับทั้งก้อน
   · ตั้งแต่ STEP 17 `updateVariantSchema` รับ `barcode` ด้วย (`null` = ล้างค่า) และเพราะ
   `barcode` เป็นคอลัมน์ unique การอัปเดต variant จึงต้องผ่าน `rethrowUnique` เพื่อให้เลขซ้ำ
   กลายเป็น 409 ไม่ใช่ 500
7. **กรอง "สต็อกต่ำ" ต้องกรองก่อนนับและก่อนแบ่งหน้า** (`findLowStockProductIds` — raw SQL
   เพราะ Prisma เทียบสองคอลัมน์ไม่ได้) ไม่งั้นจำนวนที่แสดงไม่ตรงกับแถวที่เห็น
8. **ทุกการสร้าง/แก้/ลบเขียน `AdminLog`** (before/after/ip/userAgent) ในทรานแซกชันเดียวกัน

## Inventory / Stock (STEP 15 — สร้างแล้ว)

```
/admin/inventory              → รายการสต็อกต่อตัวเลือก + สรุปทั้งคลัง (inventory:read)
/admin/inventory/movements    → ประวัติการเคลื่อนไหวทั้งร้าน (inventory:read)
/admin/inventory/[variantId]  → ฟอร์มปรับ + ประวัติของตัวเลือกนั้น (inventory:adjust)
GET  /api/admin/inventory · /api/admin/inventory/movements · /api/admin/inventory/:variantId
POST /api/admin/inventory/:variantId/adjust   { type, quantity | countedQuantity, reason, idempotencyKey }
```

**3 ตัวเลขที่ต้องแยกกันให้เห็นเสมอ** — การยุบเป็นตัวเดียวคือต้นเหตุของบั๊กเรื่องสต็อกทุกครั้ง

| ตัวเลข     | ที่มา                            | ความหมาย                                |
| ---------- | -------------------------------- | --------------------------------------- |
| ของในคลัง  | `Inventory.quantity`             | ของที่อยู่ในคลังจริง                    |
| จองไว้     | `Inventory.reservedQuantity`     | ของในออเดอร์ที่ยังไม่จบ — **แตะไม่ได้** |
| ขายได้จริง | `quantity − reserved` (ไม่ติดลบ) | ที่หน้าร้านใช้ตัดสินใจ                  |

**กฎที่ห้ามละเมิด**

1. **ห้ามเขียน `Inventory.quantity` โดยไม่มี `InventoryMovement` คู่กันในทรานแซกชันเดียว**
   พร้อมอัปเดต cache `Product.totalStock` → ผลรวมของ movement ต้องอธิบายยอดในคลังได้ตลอดเวลา
   **ไม่มี endpoint ใดตั้งค่าจำนวนตรง ๆ** มีแค่ "รับเข้าเท่าไร / ตัดออกเท่าไร / นับได้เท่าไร"
2. **ทุกรายการต้องมี `reason`** (≥ 3 ตัวอักษร) + `userId` + AdminLog — ของที่หายต้องมีคนรับผิดชอบ
3. **ห้ามลดยอดจนต่ำกว่าของที่ลูกค้าจองไว้** เงื่อนไขอยู่ใน SQL เดียวกับการอัปเดต:
   ```sql
   UPDATE "Inventory" SET "quantity" = "quantity" + $delta, "updatedAt" = now()
    WHERE "variantId" = $id AND "quantity" + $delta >= "reservedQuantity"
   RETURNING "quantity" AS after
   ```
   ไม่มีแถวกลับมา → 409 (กัน race condition ได้จริง และกันติดลบโดยปริยายเพราะ reserved ≥ 0)
   ⚠️ `updatedAt` ต้องเซ็ตเอง — `@updatedAt` ของ Prisma **ไม่ทำงานกับ raw SQL**
4. **`ADJUSTMENT` รับยอดที่นับได้ (`countedQuantity`) ไม่ใช่ผลต่าง** — คนนับของกรอกจำนวนที่เห็น
   แล้วให้ระบบคำนวณผลต่างเอง · นับได้เท่าเดิม (delta = 0) → **400** ไม่เขียน movement
   (และ CHECK `InventoryMovement_quantity_positive` ก็ไม่ยอมให้เขียน 0 อยู่แล้ว)
5. **`InventoryMovement.quantity` เป็นบวกเสมอ** (CHECK) — ทิศทางอ่านจาก `quantityBefore/After`
   DTO คำนวณ `delta = after − before` ให้ ห้ามเดาทิศทางจาก `type` ที่ฝั่ง UI
6. **กดปุ่มซ้ำต้องไม่คูณสอง** — `idempotencyKey` (`adjust:<uuid>`) unique ที่ฐานข้อมูล
   client สร้าง UUID ครั้งเดียวต่อการเปิดฟอร์ม แล้วสร้างใหม่หลังบันทึกสำเร็จ
7. **ประวัติเป็น append-only** แก้/ลบย้อนหลังไม่ได้ — บันทึกผิดต้องปรับกลับด้วยรายการใหม่
8. **สิทธิ์ `inventory:read` กับ `inventory:adjust` แยกกัน** (EMPLOYEE มีทั้งคู่ตาม seed)
   มี test ที่ถอนสิทธิ์ในฐานข้อมูลแล้วยืนยันว่าปรับไม่ได้ทันที — พิสูจน์ว่าไม่ได้ hard-code ตามบทบาท

## Stock Alert (STEP 16 — สร้างแล้ว)

```
/admin/alerts   → รายการที่ต้องเติมสต็อก + ปุ่มตรวจทั้งร้าน + รับทราบ (inventory:read)
ป้ายกระดิ่งบนแถบ /admin แสดงจำนวนที่ยังไม่รับทราบ (features/admin/components/alert-bell.tsx)
GET   /api/admin/stock-alerts?severity=
POST  /api/admin/stock-alerts/scan            (inventory:adjust)
PATCH /api/admin/stock-alerts/:notificationId/ack   (inventory:adjust)
```

**สถาปัตยกรรม: แยก "สถานะ" ออกจาก "การแจ้ง"** — เข้าใจข้อนี้ก่อนแก้อะไรในไฟล์นี้

| ชิ้นส่วน           | หน้าที่                                 | เก็บที่ไหน                    |
| ------------------ | --------------------------------------- | ----------------------------- |
| สถานะเตือน         | `available <= minimumStock` **คำนวณสด** | ไม่เก็บ — คิดจาก Inventory    |
| "เคยบอกร้านไปแล้ว" | กันแจ้งซ้ำทุกครั้งที่มีคนสั่งซื้อ       | แถว `Notification` ที่ยังเปิด |

ผลคือ **ไม่มีทางมีการเตือนที่ไม่จริง** (ของกลับมาเต็ม = หายจากรายการทันที ไม่ต้องรอ job มาล้าง)

**กฎที่ห้ามละเมิด**

1. **เตือนเฉพาะของที่ขายอยู่จริง** — สินค้า `ACTIVE` + ตัวเลือก `isActive` + ยังไม่ถูกลบ
   ถ้าเตือนของฉบับร่าง/ของที่เลิกขาย แอดมินจะจมกับ noise แล้วเลิกอ่านการแจ้งเตือนทั้งหมด
2. **ใช้จำนวนที่ขายได้จริง** (`quantity − reserved`) → **ของที่ถูกจองจนหมดต้องเตือน**
   เพราะขายต่อไม่ได้แล้วจริง ๆ แม้ของยังกองอยู่ในคลัง
3. **แย่ลงเตือนใหม่ · ดีขึ้นไม่เตือน** — เหลือน้อย → หมด = ปิดรายการเดิมแล้วแจ้งใหม่ ·
   หมด → เหลือน้อย = เงียบ (ใช้ `SEVERITY_RANK` เทียบ ไม่ใช่เทียบว่า "ต่างจากเดิมไหม")
4. **`readAt` คือกุญแจกันแจ้งซ้ำ** — ปิดได้ 2 ทาง: คนกดรับทราบ หรือระบบปิดเพราะของกลับมาปกติ
   จึงบันทึก `closedBy` / `closedReason` ลง `data` ไว้ ไม่ให้ประวัติกำกวม
5. **"รับทราบ" ไม่ได้แก้ปัญหาสต็อก** — ของก็ยังเหลือน้อย จึงยังอยู่ในรายการเตือนสด
   UI ต้องบอกให้ชัด ไม่งั้นแอดมินเข้าใจว่ากดแล้วเรื่องจบ
6. **ห้ามสร้างแถวแจ้งเตือนของช่องทางที่ส่งไม่ได้จริง** — SMTP ยังไม่ได้ตั้งค่า
   → **ไม่สร้างแถว channel EMAIL เลย** และหน้าเว็บบอกเหตุผลตรง ๆ
   (ดู [config/notification.ts](backend/src/config/notification.ts) · การส่งจริงคือ STEP 50)
7. **ตรวจเตือนต้องเรียกหลังทรานแซกชัน commit แล้วเท่านั้น** ผ่าน `scanAlertsAfterStockChange()`
   ซึ่งกลืน error ไว้เอง — **การแจ้งเตือนล้มต้องไม่ทำให้การขายล้ม**
   จุดที่ต่อสายไว้แล้ว: ปรับสต็อก · สร้างออเดอร์ (จองของ) · ชำระเงินสำเร็จ (COD + Stripe) ·
   ยกเลิกโดยลูกค้า/ร้าน · หมดเวลาชำระเงิน · webhook ที่คืนของ
8. **ป้ายกระดิ่งอ่านค่าไม่ได้ → แสดงกระดิ่งเปล่า ห้ามใส่ 0** เพราะ 0 หมายถึง "ไม่มีปัญหา"
   ซึ่งเป็นการโกหกเมื่อความจริงคือ "ยังไม่รู้"

⚠️ การตรวจ**ตามกำหนดเวลา** (ไม่ต้องมีคนกด) ยังไม่มี — `runStockAlertScan()` ถูกเรียกจาก
ปุ่มในหน้าและจากทุกจุดที่สต็อกขยับ **STEP 52 ต้องเพิ่ม job ให้รันเอง** (เหมือน `expireOverdueOrders()`)

## Barcode / QR (STEP 17 — สร้างแล้ว)

```
/admin/barcodes          → สแกน/พิมพ์บาร์โค้ดหรือ SKU แล้วเจอของชิ้นนั้น (product:read)
/admin/barcodes/labels   → แผ่นป้ายบาร์โค้ด/QR สำหรับพิมพ์ (product:read)
GET  /api/admin/barcodes/lookup?code=
GET  /api/admin/barcodes/labels?productId=|variantId=&symbology=auto|code128|qrcode&copies=
POST /api/admin/barcodes/assign   { variantId }        (product:update)
```

**สองค่าที่ต้องไม่สับสน**

| ค่า                      | ที่มา                                | ใช้ตอนไหน                                  |
| ------------------------ | ------------------------------------ | ------------------------------------------ |
| `ProductVariant.sku`     | ร้านตั้งเอง (บังคับมี)               | รหัสภายในร้าน · พิมพ์เป็น Code 128 ได้เสมอ |
| `ProductVariant.barcode` | GTIN 8/12/13 หลักที่ check digit ถูก | สแกนที่เคาน์เตอร์/POS (EAN-8/UPC-A/EAN-13) |

**กฎที่ห้ามละเมิด**

1. **ห้ามสร้างหรือรับบาร์โค้ดที่ check digit ผิด** — เครื่องสแกนตรวจ check digit ทุกครั้ง
   เลขที่ไม่ผ่านสแกนไม่ติด การเก็บไว้คือการหลอกร้านว่าใช้งานได้
   กฎเลขอยู่ที่ [database/src/gtin.ts](database/src/gtin.ts) **ที่เดียว** (re-export ผ่าน
   `@teenstyle/database`) เพราะ seed และ backend ต้องใช้ชุดเดียวกัน
2. **บาร์โค้ดที่ร้านออกเองใช้ prefix `20`** ซึ่ง GS1 สงวนไว้ให้ใช้ภายในองค์กร
   **ห้ามสวม prefix ของประเทศ/บริษัทอื่น** (เช่น 88x = GS1 Taiwan, 885 = ไทย)
   เพราะเป็นการใช้เลขที่ไม่ใช่ของร้าน — เดิม seed เคยสร้างเลข `88…` จาก hash
   ซึ่งทั้งสวม prefix คนอื่นและ check digit ไม่ผ่าน (แก้แล้วใน STEP 17)
3. **ค่าที่เข้ารหัสอ่านจากฐานข้อมูลเท่านั้น** — client ส่งได้แค่ `variantId` / `productId` /
   โค้ดที่สแกนมา · ฟิลด์อย่างชื่อสินค้า ราคา หรือ `encodedValue` ที่ client แนบมาถูก Zod ตัดทิ้ง
   (มี test ยืนยัน) ไม่งั้นป้ายจะไม่ตรงกับของจริง
4. **ไม่มีบาร์โค้ด ≠ กุเลขให้** — ตัวเลือกที่ยังไม่มี GTIN ป้ายจะใช้ Code 128 ของ SKU
   และบอกบนหน้าเว็บว่ากำลังใช้อะไร (`encodes` = `GTIN` / `SKU` / `PRODUCT_URL`)
5. **ออกเลขให้แล้วห้ามเขียนทับ** — `assign` ตอบ 409 ถ้ามีเลขอยู่แล้ว เพราะเลขเดิมอาจพิมพ์
   ติดกับสินค้าไปแล้ว การเปลี่ยนเงียบ ๆ ทำให้ของในร้านสแกนไม่ตรงระบบ
   (จะเปลี่ยนต้องล้างค่าเดิมด้วย `barcode: null` ที่หน้าจัดการสินค้าก่อน)
   ความไม่ซ้ำมาจาก unique index ของฐานข้อมูล · การสุ่มใหม่ 5 ครั้งเป็นแค่การลดโอกาสชน
6. **สแกนไม่เจอ = ตอบว่าไม่เจอ (404)** — ไม่มี LIKE ไม่ตัดตัวอักษรท้ายให้
   การ "เดาให้" ในงานคลังหมายถึงไปปรับสต็อกผิดตัว · ของที่ลบแล้วสแกนไม่เจอด้วย
7. **`labels` เป็น GET ไม่ใช่ POST** — หน้าแผ่นป้ายเป็น Server Component ที่เรียก backend
   แบบ server-to-server ซึ่ง **ไม่มี header `Origin`** → `verifyOrigin` จะบล็อก POST
   แบบนั้นตอน production (endpoint ที่หน้า Server Component ต้องเรียกเองให้ทำเป็น GET)
8. **แยกสิทธิ์ดูกับสิทธิ์ออกเลข** — สแกน/พิมพ์ป้าย = `product:read` (EMPLOYEE มี) ·
   ออกบาร์โค้ด = `product:update` (ADMIN ขึ้นไป) · มี test ที่ถอนสิทธิ์ในฐานข้อมูลแล้วยืนยัน
9. **SVG วาดที่ backend** (`bwip-js` = port ของ BWIPP) แล้วส่งมาเป็นสตริง
   ฝั่งหน้าเว็บแปลงเป็น data URL ใส่ `<img>` — **ห้ามใช้ `dangerouslySetInnerHTML`**
   (SVG ใน `<img>` รันสคริปต์ไม่ได้ จึงไม่ต้องไปเชื่อว่าไลบรารี escape ให้ครบ)
10. **ขนาดป้ายใช้หน่วย mm** — บาร์โค้ดที่เล็กเกินไปสแกนไม่ติด · Code 128 ต้องมี quiet zone
    (`paddingwidth: 10`) ไม่งั้นอ่านไม่ติดแม้ภาพจะดูถูกต้อง
11. **ยังไม่รองรับการสแกนด้วยกล้อง** — `BarcodeDetector` ยังไม่มีบน Chrome/Windows
    จึงไม่ทำปุ่มกล้องที่กดแล้วไม่เกิดอะไร และ **บอกไว้ในหน้าเว็บตรง ๆ**
    เครื่องสแกน USB/บลูทูธใช้ได้เลยเพราะทำงานเหมือนคีย์บอร์ด (ฟอร์ม GET จึงพอ ไม่ต้องมี JS)

### ⚠️ วิธีทดสอบว่า "ป้ายสแกนได้จริง" (ไม่ใช่แค่ดูรูปแล้วเดา)

เทสต์ **ถอดรหัสกลับ**: [backend/tests/helpers/barcode-decode.ts](backend/tests/helpers/barcode-decode.ts)
อ่าน `bwipjs.raw()` (ลำดับความกว้างแถบ) แล้วถอด EAN-13 ด้วยตาราง L/G/R + ตาราง parity
ของหลักแรก **ที่มาจากมาตรฐาน ไม่ได้ลอกจากไลบรารี** → ยืนยันกับบาร์โค้ดจริงที่เผยแพร่แล้ว
(`4006381333931`, `036000291452`, `96385074`) และกับเลขที่ระบบออกให้เอง

ส่วน Code 128 ตรวจ 3 อย่าง: start code ตรงมาตรฐาน (B = `211214`, C = `211232`) ·
stop = `2331112` · และ **สัญลักษณ์ของสตริงทั้งก้อน = สัญลักษณ์ของตัวอักษรแต่ละตัวต่อกัน**

⚠️ **Code 128 สลับไป subset C เองเมื่อเจอตัวเลขติดกัน 4 หลัก** (บีบ 2 หลักเป็น 1 สัญลักษณ์)
เครื่องสแกนถอดได้ข้อความเดิม แต่จำนวนสัญลักษณ์จะไม่เท่าจำนวนตัวอักษร
→ เทสต์ที่เทียบสัญลักษณ์ต่อตัวอักษรต้องใช้ค่าที่ไม่มีตัวเลขติดกัน (SKU ในเทสต์จึงเป็นตัวอักษรล้วน)

### ⚠️ `.partial()` ของ Zod 4 ไม่ลบ `.default()` (เจอจริงตอน STEP 14)

`updateProductSchema.parse({})` คืน `{ status: 'DRAFT', minimumStock: 5, tags: [] }`
เพราะ `.partial()` ห่อ `ZodOptional` ไว้ **นอก** `ZodDefault` ค่า default จึงยังถูกเติมให้ทุกคำขอ
→ ถ้าไม่แก้ การ PATCH แค่ชื่อสินค้าจะ **ปิดการขายสินค้าและลบ tag ทิ้งเงียบ ๆ**

**กฎ: schema ที่จะเอาไป `.partial()` ห้ามมี `.default()`** — ย้าย default ไปไว้ใน schema ของการ "สร้าง"
เท่านั้น (ดู `productCore` + `createProductSchema`) และมี test ยืนยันว่า PATCH ชื่อแล้วสถานะ/tag ไม่ขยับ

### ⚠️ ข้อความ error ของ Zod ต้องใส่ที่ระดับชนิดด้วย ไม่ใช่แค่ใน `.min()` (เจอตอน STEP 15)

`z.string().min(3, 'ข้อความไทย')` ครอบแค่กรณี "สั้นเกินไป" — ถ้า **ไม่ส่งฟิลด์นั้นมาเลย**
Zod จะรายงาน `invalid_type` แล้วตอบข้อความดิบ `expected string, received undefined`
ซึ่งหลุดไปถึงหน้าจอผู้ใช้ → ต้องเขียนเป็น `z.string({ message: 'ข้อความไทย' }).min(3, '…')`
(ดู `reason` ใน [inventory.validator.ts](backend/src/validators/inventory.validator.ts) · มี test กันถอยหลัง)

**ตั้งค่า Stripe:** [docs/07-payment-setup.md](docs/07-payment-setup.md) (มี `stripe listen` + บัตรทดสอบ)
**ทดสอบ webhook ได้โดยไม่มีบัญชี Stripe** — เทสต์เซ็นลายเซ็นเอง (HMAC ของ `timestamp.body`)
โดยตั้ง `STRIPE_WEBHOOK_SECRET` ปลอมใน `tests/setup.ts`

⚠️ `.env` มีบรรทัด placeholder ว่าง เช่น `STRIPE_SECRET_KEY=` → `config/env.ts` แปลงค่าว่างเป็น
`undefined` ด้วย `optionalSecret` **ห้ามเปลี่ยนกลับเป็น `z.string().optional()` เฉย ๆ** ไม่งั้น backend
จะล้มตอน boot เพราะ validation ไม่ผ่าน (เจอจริงตอน STEP 11)

หน้ารายการใหม่ (เช่น `/search` ใน STEP 45) ให้สร้าง `features/<x>/lib/query.ts` ผูก base path ของตัวเอง
**ห้าม copy ตรรกะ query string ไปไว้ในโฟลเดอร์ feature ซ้ำอีก**

## AI Customer Service + Human Handoff (STEP 20 — สร้างแล้ว)

```
/customer-service        → แชตกับ AI · กดขอคุยกับเจ้าหน้าที่ (guest ก็ใช้ได้)
/admin/support           → คิวเคส · กดรับเรื่อง · ตอบในนาม AGENT · ปิด/เปิดเคส (ai:read / ai:handoff)
GET  /api/ai/cs/history   POST /api/ai/cs/chat · /cs/escalate · /cs/reset
GET  /api/admin/support/conversations[/:id]
POST /api/admin/support/conversations/:id/assign · /messages   PATCH …/status
```

**เจ้าของบทสนทนา** — `AIConversation` เป็นของได้แบบเดียว: `userId` (ล็อกอิน) หรือ `sessionId` (guest)

**กฎที่ห้ามละเมิด**

1. **ตัวระบุ guest อ่านจาก cookie `ai-session-id` (httpOnly) เท่านั้น**
   **ห้ามรับ session id จาก header/body/query ที่ client ส่งมาเอง** — เดิม `resolveOwner` อ่าน
   header `x-session-id` ก่อน cookie ทำให้ใครก็สวมเป็น guest คนอื่นได้ (แก้แล้ว)
2. **ตรวจความเป็นเจ้าของแบบ "ต้องตรงกัน" ห้ามเขียนแบบ falsy short-circuit**
   `existing.userId && existing.userId !== owner.userId` **หลุด** เมื่ออีกฝั่งเป็น `null`
   → ผู้ใช้ที่ล็อกอินอ่านบทสนทนา guest ได้ และ guest อ่านบทสนทนาของผู้ใช้ได้ (เคยเกิดจริง)
   ใช้ `ownsCsConversation()` ที่เทียบตรง ๆ · ไม่ใช่ของเราคืน **404 ไม่ใช่ 403**
3. **ห้ามสร้าง `where` ที่ไม่มีตัวระบุเจ้าของ** — `csOwnerWhere()` โยน error เมื่อไม่มีทั้งคู่
   ไม่งั้น `findFirst` หยิบบทสนทนาของคนอื่นมา และ `updateMany` ไปปิดเคสของคนอื่น
4. **`lookupOrderForCs` ต้องมี `userId` เสมอ** — `Order.userId` เป็น non-nullable
   guest จึงไม่มีทางเป็นเจ้าของออเดอร์ → ปฏิเสธตั้งแต่ต้นทาง ไม่ใช่แค่ "ไม่กรอง"
   (เดิมไม่กรองตอนเป็น guest = เดาเลขออเดอร์แล้วเห็นยอดเงิน/รายการ/เลขพัสดุของคนอื่น)
5. **ฝั่งลูกค้าต้องดึงข้อความใหม่เองระหว่าง `ESCALATED`** — backend ตอบแค่ SYSTEM ack
   ไม่ได้ส่งประวัติชุดใหม่กลับมา **ถ้าไม่ดึง คำตอบของเจ้าหน้าที่จะไม่ขึ้นบนจอลูกค้าเลย**
   (ยังไม่มี realtime push — ถ้าจะทำ SSE/WebSocket เป็นงานของ STEP 52)
6. **"เริ่มการสนทนาใหม่" ของลูกค้าปิดได้เฉพาะเคส `ACTIVE`** — เคสที่ `ESCALATED` เป็นของเจ้าหน้าที่แล้ว
   ถ้าลูกค้าปิดเองได้ เรื่องที่ค้างจะหายจากคิวโดยไม่มีใครรู้
7. **ทุกการกระทำของเจ้าหน้าที่เขียน `AdminLog` ในทรานแซกชันเดียวกัน** (assign · reply · status)

## AI Knowledge Base / FAQ (STEP 21 — สร้างแล้ว)

```
/faq                → ค้นหา · ถาม AI · อ่านบทความ · โหวตมีประโยชน์
/admin/knowledge    → จัดการบทความ (ดู = ai:read · แก้/ลบ/รีเซ็ต = ai:knowledge:manage)
GET  /api/ai/knowledge/articles[/:slug] · /categories
POST /api/ai/knowledge/ask · /articles/:id/helpful     (ทั้งคู่ strictRateLimiter)
GET|POST|PUT|DELETE /api/admin/knowledge/articles…
```

**กฎที่ห้ามละเมิด**

1. **ห้ามพิมพ์ตัวเลขนโยบายลงในบทความตรง ๆ** — ค่าจัดส่ง ยอดส่งฟรี ช่องทางชำระเงิน
   ยอดสูงสุด COD จำนวนวันเปลี่ยนคืน เวลาทำการ ช่องทางติดต่อ ต้องประกอบจาก
   [config/shipping.ts](backend/src/config/shipping.ts) · [config/payment.ts](backend/src/config/payment.ts) ·
   **[config/store.ts](backend/src/config/store.ts)** เท่านั้น
   บทความคือสิ่งที่ AI หยิบไปตอบลูกค้าในฐานะ "นโยบายของร้าน" — ตัวเลขไม่ตรง = โกหกลูกค้าเรื่องเงิน
   (ตอนปิด STEP 21 บทความระบุ ส่งฟรี 999 · EMS 70 · Same-day 120 · **ค่าธรรมเนียม COD 20 บาทที่ระบบไม่เคยเก็บ**
   และเบอร์โทรสมมติ `02-999-8888` — ไม่ตรงกับระบบสักค่าเดียว)
   มี test ใน `ai-knowledge.test.ts` เทียบทุกจำนวนเงินในบทความกับ config ตรง ๆ
2. **ช่องทางติดต่อที่ยังไม่มีจริงตั้งเป็น `null`** ใน `STORE_CONTACT_CHANNELS` แล้วมันจะหายจากทั้ง
   บทความและ Policy Engine เอง — **ห้ามใส่เบอร์/อีเมลสมมติให้หน้าดูครบ**
   (แพตเทิร์นเดียวกับ STEP 16 ข้อ 6: ไม่สร้างช่องทางที่ส่งจริงไม่ได้)
3. **`getStorePolicyContent()` กับบทความต้องอ่านจากแหล่งเดียวกัน** — ห้ามให้ฝ่ายใดฝ่ายหนึ่ง
   พิมพ์ค่าเอง ไม่งั้นลูกค้าถามคำถามเดียวกันสองทางแล้วได้คนละคำตอบ (เคยเกิดจริงเรื่องเวลาทำการและเวลาตัดรอบ)
4. **สถิติตั้งต้นของบทความต้องเป็น 0** — `viewCount` / `helpfulCount` / `notHelpfulCount`
   เดิม seed ใส่เลขสวย ๆ ไว้ (342 วิว · 89 โหวต) ซึ่งเป็นตัวเลขที่ไม่เคยเกิดขึ้น
   และไปโผล่บนหน้า `/admin/knowledge` ให้แอดมินใช้ตัดสินใจ (กฎเดียวกับ STEP 13 ข้อ 6)
5. **บทความเก็บใน PostgreSQL** (`KnowledgeArticle` + `KnowledgeFaq`) ไม่ใช่ไฟล์
   `INITIAL_KNOWLEDGE_ARTICLES` เป็น**ข้อมูลตั้งต้น**เท่านั้น — `ensureSeeded()` ใส่ให้อัตโนมัติ
   ครั้งแรกที่ตารางยังว่าง และ `adminResetDefaults()` ใช้กลับไปเริ่มใหม่
   เดิมเก็บเป็น JSON ที่ commit ลง git แล้วพังหลายทาง: แค่เปิดอ่านบทความ (`viewCount + 1`)
   ก็ทำให้ working tree สกปรก · `npm test` เขียนทับไฟล์จริง · ไฟล์ที่ค้างค่าเก่า **บังหน้า**
   ข้อมูลตั้งต้นที่แก้ใหม่จนแก้โค้ดแล้วเว็บยังตอบค่าเดิม · และ redeploy บน container แล้วหายทั้งหมด
6. **ตัวนับ `viewCount` / `helpfulCount` ต้องใช้ `{ increment: 1 }` ของ Prisma**
   ห้ามอ่านค่าเดิมมาบวกแล้วเขียนกลับ — คนเปิดอ่านพร้อมกันแล้วยอดจะตกหล่น
7. **ทุกการสร้าง/แก้/ลบ/รีเซ็ต เขียน `AdminLog` ในทรานแซกชันเดียวกัน** (กฎเดียวกับ STEP 14/15)
8. **สิทธิ์ต้องเป็นของโดเมน AI ไม่ใช่ `product:*`** — คนที่แก้ข้อมูลสินค้าได้
   ไม่ควรแก้นโยบายร้านที่ AI เอาไปตอบลูกค้าในฐานะความจริงได้ด้วย
9. **endpoint ที่เรียก OpenAI และ endpoint ที่เพิ่มตัวนับต้องมี `strictRateLimiter`**
   (`/knowledge/ask` · `/cs/chat` · `/stylist/chat` · `/articles/:id/helpful`)
   เปิดให้ guest ใช้ + หนึ่งคำขอมีค่าใช้จ่ายจริง = ยิงรัวได้แปลว่าบิลบานได้

⚠️ **การให้คะแนนความเกี่ยวข้องยังทำใน TypeScript** (ดึงบทความที่ผ่านตัวกรองมาให้คะแนนทั้งชุด)
เพราะต้องรองรับทั้งไทยและอังกฤษ และคลังความรู้มีขนาดหลักสิบบทความ
ถ้าโตถึงหลักพัน ให้ย้ายไปใช้ full-text search ของ Postgres (`to_tsvector` + ดัชนี GIN)

## Wishlist (STEP 22 — สร้างแล้ว)

```
/wishlist            → รายการที่ถูกใจ · เรียง 4 แบบ · กรองเฉพาะที่ราคาลด · แบ่งหน้า (ต้องล็อกอิน)
ปุ่มหัวใจที่ /product/[slug]   → เก็บไว้ดูทีหลัง
GET    /api/wishlist?page=&limit=&sort=&onlyPriceDrop=
GET    /api/wishlist/contains?productIds=a,b,c
POST   /api/wishlist/items            { productId }
DELETE /api/wishlist/items/:productId
PATCH  /api/wishlist/items/:productId/notify   { notifyOnPriceDrop }
```

**กฎที่ห้ามละเมิด**

1. **ต้องล็อกอินทุก endpoint** — `Wishlist.userId` เป็น non-nullable ไม่มีแบบ guest
   (ต่างจากตะกร้าที่ guest ใช้ cookie ได้) · สิทธิ์ `wishlist:manage` ตรวจจากฐานข้อมูล
   หน้าเว็บที่ยังไม่ล็อกอินเด้งไป `/signin?callbackUrl=/wishlist` — **ไม่ต้องแวะ `/api/cart/merge`**
   เพราะไม่มีรายการที่ถูกใจของ guest ให้รวม
2. **`priceWhenAdded` อ่านจากฐานข้อมูลตอนกด** — client ส่งได้แค่ `productId`
   ค่านี้มีไว้ **เทียบว่าราคาลดหรือยังเท่านั้น ห้ามใช้คิดเงิน** (กฎเดียวกับ `CartItem.addedPrice`)
   และ **กดถูกใจซ้ำห้ามเขียนทับค่าเดิม** ไม่งั้นส่วนลดที่สะสมมาหายไป
3. **ป้าย "ราคาลด" คำนวณสดทุกครั้ง** จาก `priceWhenAdded` เทียบกับราคาปัจจุบันของ `pricing.ts`
   ไม่เก็บเป็นคอลัมน์ · แจ้งเฉพาะตอนถูกลง (แพงขึ้นไม่แจ้ง)
4. **ห้ามเดาตัวเลือกให้ลูกค้า** — ปุ่ม "เพิ่มลงตะกร้า" โผล่เฉพาะเมื่อ backend ยืนยันว่ามี variant
   ที่ **ซื้อได้จริงเพียงตัวเดียว** (`quickAddVariantId`) · หลายสี/ไซซ์ต้องพาไปเลือกที่หน้าสินค้า
   และการเพิ่มยังผ่านการตรวจสต็อกของ `/api/cart/items` อีกชั้นอยู่ดี
5. **การ์ดสินค้าสร้างผ่าน `toProductCards()`** เท่านั้น — สถานะสต็อกจึงเป็น "จำนวนที่ขายได้จริง"
   ไม่ใช่ `totalStock` (กฎ STEP 15)
6. **ยังไม่มีการส่งอีเมลแจ้งเตือนจริง** — สวิตช์ `notifyOnPriceDrop` บันทึกความต้องการไว้เฉย ๆ
   เพราะ SMTP ยังไม่ได้ตั้งค่า **หน้าเว็บต้องบอกตรง ๆ** ว่าป้ายบนหน้านี้คือช่องทางเดียวที่ใช้ได้
   (แพตเทิร์นเดียวกับ STEP 16 ข้อ 6) · การส่งจริงเป็นงานของ STEP 24/50
7. **สถานะ "ถูกใจแล้วหรือยัง" ไม่ใส่ลงใน `/api/products/:slug`** — endpoint สินค้าเป็นของสาธารณะ
   ที่แคชร่วมกันทุกคน ถ้าเอาข้อมูลรายบุคคลไปใส่จะแคชไม่ได้อีกเลย
   ใช้ `/api/wishlist/contains` แยกต่างหาก แล้วให้ Server Component ส่งค่าเริ่มต้นลงไปที่ปุ่ม

⚠️ **การเรียง `price-drop` และตัวกรอง `onlyPriceDrop` ทำใน TypeScript** เพราะต้องเทียบกับราคา
ปัจจุบันที่คิดจากกฎใน `pricing.ts` (`salePrice ?? price`) ไม่ใช่คอลัมน์เดียว · และยอดสรุป
(ราคาลดกี่ชิ้น/ของหมดกี่ชิ้น) ต้องนับจากทั้งชุดไม่ใช่แค่หน้าปัจจุบัน
ถ้ารายการโตมากค่อยย้ายไปเขียนเป็น SQL แบบเดียวกับ `/shop`

## Reviews (STEP 23 — สร้างแล้ว)

```
/product/[slug]#reviews   → คะแนนเฉลี่ย · กราฟแท่งตามดาว · กรองตามดาว · เรียง 4 แบบ · เขียน/แก้รีวิว
/account/reviews          → รีวิวของฉันทุกสถานะ (รวมที่ถูกซ่อน/ไม่อนุมัติ) · แก้ · ลบ
/admin/reviews            → คิวตรวจรีวิว: อนุมัติ / ซ่อน / ไม่อนุมัติ (review:moderate)
GET    /api/products/:slug/reviews?page=&limit=&sort=&rating=    (guest อ่านได้ · attachUser)
GET    /api/reviews/me · /api/reviews/eligibility?productIds=a,b,c
POST   /api/reviews                    { productId, rating, title?, comment }
PATCH|DELETE /api/reviews/:reviewId
PATCH  /api/reviews/:reviewId/helpful  { helpful }
GET    /api/admin/reviews?status=&rating=&q=   PATCH /api/admin/reviews/:id/status
```

**กฎที่ห้ามละเมิด**

1. **รีวิวได้เฉพาะคนที่ซื้อ _และได้รับของแล้ว_** — ต้องมีคำสั่งซื้อของตัวเองที่ `status = DELIVERED`
   และมีสินค้าชิ้นนั้นอยู่ในใบนั้นจริง · `orderId` และ `isVerifiedPurchase` **คำนวณที่ server**
   client ส่งได้แค่ `productId` + ดาว + หัวข้อ + ข้อความ (มี test ที่ยัด `status`/`orderId` ของคนอื่นมาแล้วถูกเมิน)
   เกณฑ์คือ _ได้รับของ_ ไม่ใช่ _จ่ายเงินแล้ว_ — คนที่ยังไม่ได้ของไม่มีทางรู้ว่าของเป็นอย่างไร
2. **หนึ่งคนรีวิวได้ครั้งเดียวต่อสินค้า** (ไม่ใช่ครั้งเดียวต่อคำสั่งซื้อ) — ซื้อซ้ำ 3 ครั้งแล้วรีวิวได้ 3 ฉบับ
   แปลว่าคนเดียวดันคะแนนเฉลี่ยได้ตามจำนวนครั้งที่ซื้อ
   ⚠️ unique `[userId, productId, orderId]` ของฐานข้อมูล **กันเรื่องนี้ไม่ได้** เพราะ `orderId` เป็น NULL ได้
   และ PostgreSQL ถือว่า NULL ไม่ซ้ำกับ NULL — ด่านจริงอยู่ใน `review.service.ts`
3. **รีวิวใหม่เป็น `PENDING` เสมอ · หน้าร้านแสดงเฉพาะ `APPROVED`** — client ตั้งสถานะเองไม่ได้
   **แก้รีวิวแล้วกลับไปรอตรวจใหม่ทุกครั้ง** ไม่งั้นเขียนสุภาพให้ผ่านก่อนแล้วค่อยแก้เป็นอย่างอื่นทีหลังได้
   (ล้าง `adminNote` เดิมด้วย เพราะหมายเหตุนั้นพูดถึงข้อความที่ไม่มีแล้ว)
4. **คะแนนเฉลี่ยและกราฟแท่งนับจาก `APPROVED` เท่านั้น และคิดจาก `groupBy` ชุดเดียวกัน**
   (`summarizeRatings` ใน [review.model.ts](backend/src/models/review.model.ts))
   ยังไม่มีรีวิว → `average = 0` และหน้าเว็บต้องเขียนว่า **"ยังไม่มีรีวิว" ห้ามโชว์ 0.0 ดาว**
   เพราะ 0 ดาวแปลว่า "แย่มาก" ไม่ใช่ "ยังไม่มีข้อมูล" (กฎเดียวกับป้ายกระดิ่งของ STEP 16 ข้อ 8)
5. **หน้าร้านไม่ส่งชื่อเต็ม อีเมล หรือรูปโปรไฟล์ของผู้รีวิวออกไป** — ย่อเป็น "สมชาย ก." ด้วย
   `toDisplayName()` และใช้ตัวอักษรแรกทำ avatar · หลังบ้านเห็นชื่อ/อีเมลจริงได้เพราะต้องติดต่อกลับ
   (มี test ตรวจว่า response ของหน้าร้านไม่มีอีเมลและไม่มีนามสกุลเต็ม)
6. **โหวต "มีประโยชน์" หนึ่งคนหนึ่งเสียง** — ตาราง `ReviewHelpfulVote` unique `[reviewId, userId]`
   (เพิ่มใน migration `20260920021500_add_review_helpful_vote`) · ตัวนับใช้ `{ increment: 1 }`
   ในทรานแซกชันเดียวกับแถวโหวต · **กดของตัวเองไม่ได้** · กดซ้ำ/ยกเลิกซ้ำไม่ error และยอดไม่ติดลบ
   ถ้าไม่มีตารางนี้ ลำดับ "มีประโยชน์มากสุด" ปั่นได้ด้วยคนเดียว
7. **ลบรีวิวเป็น soft delete และ "เขียนใหม่" = เขียนทับแถวเดิม**
   ⚠️ unique ของฐานข้อมูลยังจองแถวที่ `deletedAt` ไว้อยู่ ถ้า `create` ตรง ๆ จะชน P2002
   แล้วคนที่ลบรีวิวตัวเองจะเขียนใหม่ไม่ได้ตลอดไป (เจอจริงตอนเขียนเทสต์)
   → `createReview` มองหาแถวที่ถูกลบก่อนเสมอ แล้ว update ทับ พร้อมล้าง `adminNote` และยอดโหวต
8. **`review:moderate` ไม่ใช่ `product:update`** — คนที่แก้ข้อมูลสินค้าได้ ไม่ควรเอาความเห็นลูกค้าลงได้ด้วย
   (แพตเทิร์นเดียวกับ STEP 21 ข้อ 8) · **ซ่อน/ไม่อนุมัติต้องกรอกเหตุผล** ซึ่งเขียนลง `AdminLog`
   ในทรานแซกชันเดียวกัน และแสดงให้เจ้าของรีวิวเห็นที่ `/account/reviews`
9. **`strictRateLimiter` ที่ POST/PATCH รีวิวและการโหวต** — สองอย่างนี้สร้างเนื้อหาสาธารณะ
   และขยับตัวเลขที่คนอื่นใช้ตัดสินใจซื้อ ยิงรัวได้แปลว่าปั่นได้

⚠️ **ยังไม่มีการแนบรูปในรีวิว** — คอลัมน์ `Review.images` มีอยู่แต่ส่งกลับเป็น `[]` เสมอ
เพราะยังไม่มีระบบอัปโหลด (STEP 47) · **ห้ามแก้ด้วยการรับ URL จาก client**
เพราะจะกลายเป็นช่องให้แปะรูปจากที่ไหนก็ได้โดยร้านตรวจไม่ได้

⚠️ **รีวิวของผู้ที่กำลังดูถูกดึงออกจากรายการสาธารณะ** แล้วส่งแยกเป็น `myReview`
เพื่อไม่ให้ขึ้นซ้ำสองที่ และให้เจ้าของเห็นรีวิว `PENDING` ของตัวเองได้ (คนอื่นยังไม่เห็น)
→ `summary.total` (นับทั้งหมดที่อนุมัติ) กับ `totalPages` (นับเฉพาะรายการที่แสดง) เป็นคนละเลขโดยเจตนา

⚠️ **หน้าสินค้ายิงรีวิวสองแบบ**: ล็อกอินแล้วใช้ `apiFetchAsUser` + `no-store` (ต้องรู้ว่าเป็นใคร)
ยังไม่ล็อกอินใช้ `apiFetch` + `revalidate: 60` ซึ่งแคชได้ → **อนุมัติรีวิวแล้ว guest อาจเห็นช้าถึง 60 วินาที**
เป็นพฤติกรรมที่ตั้งใจ (ดูหัวข้อ stale-while-revalidate ด้านบน) เวลาทดสอบให้เปลี่ยน query ให้ cache key ใหม่

## Notifications (STEP 24 — สร้างแล้ว)

```
/account/notifications   → ฟีดการแจ้งเตือนของตัวเอง · กรองตามหมวด/ยังไม่อ่าน · กดอ่าน · อ่านทั้งหมด
กระดิ่งบน navbar          → จำนวนที่ยังไม่อ่าน (เฉพาะคนที่ล็อกอิน)
GET   /api/notifications?page=&limit=&unreadOnly=&group=
GET   /api/notifications/unread-count
PATCH /api/notifications/:notificationId/read   ·   PATCH /api/notifications/read-all
```

**กฎที่ห้ามละเมิด**

1. **ฟีดของลูกค้ากรอง `userId = ตัวเอง` เสมอ — ห้ามอ่านแถว `userId = null`**
   แถวที่ไม่มีเจ้าของคือประกาศถึง **พนักงาน** (การเตือนสต็อกของ STEP 16) ซึ่งบอกยอดในคลัง
   และยอดที่ลูกค้าคนอื่นจองไว้ เอาไปแสดงให้ลูกค้าคือการเปิดข้อมูลภายในร้าน (มี test ยืนยัน)
   ⚠️ **การประกาศถึงลูกค้าทุกคนจึงยังทำไม่ได้** เพราะตารางไม่มีคอลัมน์บอกกลุ่มผู้รับ
   จะทำต้องเพิ่มคอลัมน์ก่อน **ห้ามใช้ `userId = null` แทน** เพราะจะปนกับประกาศของพนักงานทันที
2. **สร้างเฉพาะช่องทางที่ส่งได้จริง** — ตอนนี้คือ `IN_APP` เท่านั้น (`status = SENT` ทันทีที่บันทึก)
   **ยังไม่สร้างแถว `EMAIL` แม้ตั้งค่า SMTP แล้ว** เพราะยังไม่มีตัวส่งจริง (STEP 50)
   แถวที่บันทึกว่าส่งแล้วแต่ไม่มีใครส่งคือการโกหกตัวเอง (กฎเดียวกับ STEP 16 ข้อ 6)
   → หน้าเว็บบอกตรง ๆ ว่ายังไม่มีอีเมล/push
3. **client สร้างหรือแก้เนื้อหาการแจ้งเตือนไม่ได้เลย** — มีแค่ "ทำเครื่องหมายว่าอ่านแล้ว"
   ไม่มี `POST /api/notifications` โดยเจตนา (มี test ยืนยัน) ไม่งั้นใครก็ปั้นข้อความในนามร้านได้
4. **เรียกหลังทรานแซกชัน commit แล้วเท่านั้น ผ่าน `notifySafely()`** ซึ่งกลืน error เอง
   **การแจ้งเตือนล้มต้องไม่ทำให้การขาย/การชำระเงิน/การเปลี่ยนสถานะที่บันทึกไปแล้วกลายเป็น error**
   (แพตเทิร์นเดียวกับ `scanAlertsAfterStockChange` ของ STEP 16 ข้อ 7)
5. **ห้ามแจ้งซ้ำเรื่องเดิม** — `notifyOnce()` เทียบกับแถวที่มีอยู่ด้วยคีย์ใน `data`
   (เช่น `{ orderId, event: 'SHIPPING' }`) เพราะ webhook ของ Stripe ยิงซ้ำได้ และแอดมินกดปุ่มซ้ำได้
6. **ไม่แจ้งทุกขั้นของคำสั่งซื้อ** — `PROCESSING` / `PACKING` เป็นงานภายในร้าน
   แจ้งเฉพาะสิ่งที่ลูกค้ารู้สึกได้: รับออเดอร์ · จ่ายเงินสำเร็จ/ไม่สำเร็จ · ส่งของ (พร้อมเลขพัสดุจริง) ·
   ของถึง · ยกเลิก · ผลตรวจรีวิว · ราคาที่ถูกใจลดลง
   ยิงทุกครั้งที่พนักงานกดปุ่มจะกลายเป็น noise แล้วลูกค้าเลิกอ่านทั้งหมด
7. **COD ไม่แจ้งว่า "ชำระเงินสำเร็จ" ตอนยืนยันคำสั่งซื้อ** — เงินยังไม่ได้รับ (กฎ STEP 11 ข้อ 2)
   ใช้ `ORDER_UPDATE` แทน · ใบเสร็จจริงแจ้งตอนกด `DELIVERED` ซึ่งเป็นจุดที่ได้เงิน (กฎ STEP 13 ข้อ 4)
8. **ราคาลด: แจ้งซ้ำเฉพาะเมื่อถูกลงกว่าครั้งที่แจ้งไปแล้ว** (เก็บ `data.notifiedPrice` ไว้เทียบ)
   ขึ้นแล้วลงกลับมาที่เดิมต้องเงียบ (แพตเทิร์นเดียวกับ STEP 16 ข้อ 3: แย่ลงเตือนใหม่ · ดีขึ้นไม่เตือน)
   · เคารพสวิตช์ `notifyOnPriceDrop` ของ STEP 22 · แจ้งเฉพาะสินค้าที่ยังเปิดขายอยู่
9. **กระดิ่งอ่านจำนวนไม่ได้ → แสดงกระดิ่งเปล่า ห้ามใส่ 0** (กฎเดียวกับ STEP 16 ข้อ 8)
   และ **ห่อด้วย `<Suspense>` ใน navbar เสมอ** เพราะ navbar อยู่ทุกหน้า
10. **ลิงก์ปลายทางคำนวณที่ backend** (`resolveNotificationLink`) ไม่ใช่เดาจาก `type` ที่หน้าเว็บ
    ข้อมูลไม่พอ = `link: null` แล้วแสดงเป็นการ์ดที่กดไม่ได้ **ห้ามสร้างลิงก์ที่พาไป 404**

⚠️ **`NotificationType` ถูกเพิ่ม 3 ค่าใน STEP 24** (`ORDER_UPDATE` · `ORDER_CANCELLED` · `REVIEW_UPDATE`,
migration `20260923013000_add_notification_types`) เพราะการยัดทุกอย่างลง `SYSTEM`
ทำให้กรองตามหมวดแยกไม่ออกว่าเรื่องไหนเกี่ยวกับคำสั่งซื้อ — **ความหมายต้องอยู่ใน enum ที่ query ได้
ไม่ใช่ซ่อนอยู่ใน JSON**

⚠️ **ยังไม่มีการส่งแบบ realtime** — ฟีดอ่านตอนเปิดหน้าเท่านั้น ไม่มี SSE/WebSocket
(เหมือนฝั่งลูกค้าของ STEP 20) และ **ยังไม่มี job ตามเวลา** — `expireOverdueOrders()` ที่สร้าง
การแจ้งเตือน "หมดเวลาชำระเงิน" ยังต้องเรียกเอง (งานของ STEP 52)

## Customer Management (STEP 25 — สร้างแล้ว)

```
/account/profile     → แก้ชื่อ เบอร์โทร วันเกิด · ปิด/เปิดการแนะนำแบบ personalized
/account/addresses   → สมุดที่อยู่: เพิ่ม · แก้ · ตั้งค่าเริ่มต้น · ลบ (สูงสุด 20 แห่ง)
/admin/customers            → รายการบัญชีผู้ใช้ + ค้นหา + กรองสถานะ/บทบาท/ระดับ (customer:read)
/admin/customers/[userId]   → ข้อมูล ยอดซื้อจริง ที่อยู่ คำสั่งซื้อล่าสุด + ระงับ/เปลี่ยนบทบาท

GET|PATCH /api/users/me/profile
GET|POST  /api/users/me/addresses
PATCH|DELETE /api/users/me/addresses/:addressId   ·   PATCH …/:addressId/default
GET   /api/admin/customers?q=&status=&role=&tier=&sort=&page=&limit=
GET   /api/admin/customers/:userId
PATCH /api/admin/customers/:userId/status  { status, reason }   (customer:update)
PATCH /api/admin/customers/:userId/role    { role, reason }     (user:role:manage)
```

**กฎที่ห้ามละเมิด**

1. **ลูกค้าแก้ได้แค่ข้อมูลที่ตัวเองกรอก** — `name` · `phone` · `birthDate` · `allowPersonalization`
   **`email` แก้ไม่ได้** เพราะเป็นตัวระบุตัวตนของบัญชี Google ที่ callback `signIn` ใช้ผูกบัญชี
   (ดูเหตุผลของ `allowDangerousEmailAccountLinking`) · `role` `status` `points` `loyaltyTier`
   `totalSpent` **ไม่อยู่ในสคีมาของ PATCH เลย** ส่งมาก็ถูก Zod ตัดทิ้ง (มี test ยัดมาแล้วยืนยัน)
   · **รูปโปรไฟล์ยังเปลี่ยนเองไม่ได้** — รับ URL จาก client = แปะรูปจากที่ไหนก็ได้ (STEP 47)
2. **ยอดซื้อในหลังบ้านนับจากตาราง `Order` จริงทุกครั้ง — ห้ามอ่านคอลัมน์ `User.totalSpent`**
   คอลัมน์นั้นเป็น cache ที่ยังไม่มีใครเขียน (เป็น 0 ทุกคน · จะมาพร้อมระบบแต้ม STEP 42)
   เอามาแสดงคือบอกร้านว่าลูกค้าทุกคนไม่เคยซื้ออะไรเลย
   (ปัญหาชนิดเดียวกับ `Product.totalStock` ที่ไม่ใช่ "จำนวนที่ขายได้จริง" — STEP 15)
   · "ยอดที่ได้รับ" นับเฉพาะ `paymentStatus = PAID` · COD ที่ยังไม่เก็บเงินแยกช่อง (STEP 13 ข้อ 6)
   · มี test ที่ตั้ง `totalSpent = 999999` ไว้หลอก แล้วยืนยันว่าเลขนั้นไม่โผล่ใน response
3. **ห้ามแก้บัญชีของตัวเอง** (ทั้งสถานะและบทบาท) → **400**
   ระงับตัวเองคือการล็อกตัวเองออกจากร้าน · ลดบทบาทตัวเองคือการทิ้งกุญแจ
4. **แตะได้แค่บัญชีที่บทบาทต่ำกว่าตัวเอง** (SUPER_ADMIN แตะได้ทุกคนยกเว้นตัวเอง) → ไม่ผ่านคืน **403**
   ไม่งั้น ADMIN คนหนึ่งระงับ ADMIN อีกคนได้ แล้วแย่งกันล็อกออก
   · **ตั้งบทบาทได้ไม่เกินระดับตัวเอง** — ถ้า ADMIN ตั้งใครเป็น ADMIN ได้
   ก็เท่ากับยกระดับสิทธิ์ตัวเองผ่านบัญชีที่ตั้งขึ้นมา (privilege escalation)
   ⚠️ ด่านนี้อยู่ใน **service** ไม่ใช่แค่ middleware — มี test ที่ให้สิทธิ์ `user:role:manage`
   กับ ADMIN ชั่วคราวในฐานข้อมูลแล้วยืนยันว่ายังตั้งบทบาท ADMIN ให้ใครไม่ได้อยู่ดี
5. **ระงับ/แบน = ลบ `Session` ทั้งหมดของบัญชีนั้นในทรานแซกชันเดียวกัน**
   `dal.ts` และ `findUserBySessionToken` ตรวจ `status` อยู่แล้ว แต่การลบแถวทำให้การเพิกถอน
   ไม่ต้องพึ่งว่าโค้ดที่เขียนเพิ่มในอนาคตจะจำตรวจ (defence in depth) · ปลดระงับ **ไม่ลบ** session
6. **เปลี่ยนบทบาทแล้วมีผลทันที ไม่ต้องเพิกถอน session** — ทั้ง callback `session` ของ Auth.js
   และ backend อ่าน role + permissions จากฐานข้อมูลใหม่ทุกคำขอ ไม่ได้ฝังไว้ใน token
   (มี test เลื่อนลูกค้าเป็น EMPLOYEE แล้วยิงหลังบ้านด้วย token เดิมได้ทันที)
7. **ทุกการเปลี่ยนสถานะ/บทบาทต้องกรอก `reason`** และเขียน `AdminLog` ในทรานแซกชันเดียวกัน
   ทั้งตอนระงับ **และตอนปลดระงับ** — การให้คนกลับเข้ามาก็ต้องอธิบายย้อนหลังได้เหมือนกัน
8. **ไม่มี endpoint ลบลูกค้า** — การลบข้อมูลส่วนบุคคลมีผลทางกฎหมายและต้องจัดการข้อมูล
   ที่ผูกอยู่ (คำสั่งซื้อ ใบเสร็จ) ด้วย เป็นงานของ STEP 53 · เครื่องมือที่ใช้ตัดคนออกจากร้านคือการระงับบัญชี
9. **ลบที่อยู่เป็น soft delete** เพราะ `Order.shippingAddressId` ยังอ้างถึงแถวนั้น ·
   **ลบอันที่เป็นค่าเริ่มต้นแล้วต้องเลื่อนอันอื่นขึ้นมาแทนในทรานแซกชันเดียวกัน**
   ไม่งั้นบัญชีจะมีที่อยู่อยู่แต่ไม่มีค่าเริ่มต้น แล้ว checkout เลือกไม่แน่นอน
   · **หนึ่งบัญชีมีค่าเริ่มต้นได้อันเดียว** — ตั้งอันใหม่ต้องปลดอันเดิมพร้อมกัน
   · ปลดด้วย `isDefault: false` **ไม่ได้** (400) ต้องตั้งอันอื่นแทน
10. **แก้ที่อยู่ไม่เปลี่ยนปลายทางของคำสั่งซื้อที่สั่งไปแล้ว** — ออเดอร์ใช้ `Order.addressSnapshot`
    ที่ถ่ายไว้ตอนสั่ง (STEP 10 ข้อ 5) · **หน้าเว็บต้องบอกเรื่องนี้ตรง ๆ** ไม่งั้นลูกค้าเข้าใจว่า
    แก้แล้วของที่กำลังส่งจะเปลี่ยนที่ส่งตาม แล้วของไปถึงที่เดิม (มี test ยืนยันว่า snapshot ไม่ขยับ)
11. **ทุก mutation ของที่อยู่กรอง `userId` ของผู้เรียก** — ไม่ใช่ของเราคืน **404 ไม่ใช่ 403**
    (ไม่บอกใบ้ว่ามี id นั้นอยู่จริง · แพตเทิร์นเดียวกับตะกร้า STEP 9 ข้อ 4)
    และ `/api/users/*` ทั้งหมดผ่าน `verifyOrigin` กัน CSRF
12. **แยกสิทธิ์สามระดับ**: ดู = `customer:read` (EMPLOYEE มี) · ระงับ = `customer:update` (ADMIN ขึ้นไป)
    · เปลี่ยนบทบาท = `user:role:manage` (SUPER_ADMIN เท่านั้นตาม seed)
    คนที่ตอบแชตลูกค้าได้ไม่ควรตัดลูกค้าออกจากร้านได้ และคนที่ตัดลูกค้าออกได้ไม่ควรแต่งตั้ง
    ผู้ดูแลคนใหม่ได้ (แพตเทิร์นเดียวกับ STEP 17 ข้อ 8 และ STEP 21 ข้อ 8)

⚠️ **ยังไม่มีการเรียงลูกค้าตามยอดซื้อโดยเจตนา** — ยอดซื้อไม่ใช่คอลัมน์ในตาราง `User`
การเรียงต้องทำ **ก่อนแบ่งหน้า** ไม่ใช่เรียงเฉพาะ 20 แถวที่หยิบมา (บั๊กชนิดเดียวกับตัวกรอง
"สต็อกต่ำ" ของ STEP 14 ข้อ 7) → อันดับลูกค้าเป็นงานของรายงาน STEP 26 และหน้าเว็บบอกไว้ตรง ๆ

⚠️ **หน้า `/admin/customers` แสดงบัญชีทุกบทบาท** เพราะเป็นที่เดียวที่เปลี่ยนบทบาทได้
ตัวเลขสรุปจึงแยก "ลูกค้า" (role = CUSTOMER) ออกจาก "ทีมงาน" ให้ชัด
· **แก้ตอน STEP 25: ตัวเลข "ลูกค้า" บน dashboard เดิมนับผู้ใช้ทุกแถว** จึงรวมบัญชีพนักงานเข้าไปด้วย
ตอนนี้กรอง `role.name = 'CUSTOMER'` แล้ว (กฎ STEP 13 ข้อ 6: ตัวเลขต้องตรงกับความจริง)

⚠️ **วันเกิดเก็บเป็นคอลัมน์ `@db.Date`** — Prisma คืนค่าเป็นเที่ยงคืน **UTC**
แปลงกลับต้องใช้ `toISOString().slice(0, 10)` เท่านั้น **ห้ามใช้ `toLocaleDateString()` หรือ `getDate()`**
ไม่งั้นเครื่องที่อยู่โซนเวลา +07:00 จะแสดงวันเลื่อนไปหนึ่งวัน (มี test เทียบค่าที่กรอกกับค่าที่อ่านกลับ)

## Analytics (STEP 26 — สร้างแล้ว)

```
/admin/analytics   → เลือกช่วงวัน · กราฟยอดขาย · KPI เทียบช่วงก่อนหน้า · อันดับสินค้า/ลูกค้า
                     · แยกตามหมวดหมู่/ช่องทางจ่าย/วิธีส่ง · ดาวน์โหลด CSV/Excel  (analytics:read)

GET /api/admin/analytics/summary?from=&to=&granularity=day|week|month
GET /api/admin/analytics/products?from=&to=&sort=revenue|quantity|orders&page=&limit=
GET /api/admin/analytics/customers?from=&to=&sort=revenue|orders&page=&limit=
GET /api/admin/analytics/breakdown?from=&to=
GET /api/admin/analytics/export?from=&to=&format=csv|xlsx
```

### ⚠️ โซนเวลา — กับดักที่ทำให้รายงานผิดทั้งแผ่นโดยไม่มีอะไรฟ้อง

**คอลัมน์เวลาของโปรเจกต์นี้เป็น `timestamp without time zone`**
(`DateTime` ของ Prisma map เป็น `timestamp(3)` บน PostgreSQL ถ้าไม่ระบุ `@db.Timestamptz`)
ค่าที่เก็บคือ **หน้าปัดเวลา UTC** ไม่ใช่จุดเวลาที่มีโซนติดมาด้วย → ตามมาด้วยกฎ 3 ข้อ

1. **ตัดวันต้องแปลงสองทอด** `col AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok'`
   ทอดเดียวแปลผิดทาง (แปลว่า "ถือว่าเลขนี้เป็นเวลาไทย") · ไม่แปลงเลยคือตัดวันแบบ UTC
   ซึ่งทำให้ยอดขายช่วง **00:00–07:00 น. ตกไปอยู่ "เมื่อวาน" ทุกวัน**
2. **ห้ามใส่ `Date` ลงใน `$queryRaw` ตรง ๆ** — Prisma ผูกชนิดไม่ตรง แล้ว PostgreSQL
   ตีความด้วย `TimeZone` ของ session ทำให้จุดเวลาเลื่อนตามโซนของเครื่องที่รัน
   ให้ผ่าน `utcTs()` ใน [models/analytics.model.ts](backend/src/models/analytics.model.ts) เสมอ
   (คิวรีที่ผ่าน Prisma แบบมี type เช่น `aggregate` / `findMany` ไม่มีปัญหานี้)
3. **อันตรายที่สุด: บนเซิร์ฟเวอร์ที่ `TimeZone` เป็น UTC โค้ดแบบผิดจะให้ผลถูก**
   บั๊กจึงผ่าน CI แล้วไปโผล่ตอน deploy — เจอจริงตอนเขียน STEP 26 บนเครื่องที่ตั้งเป็น Asia/Bangkok
   มี test ที่สร้างออเดอร์ "ได้เงินตี 2 ครึ่งตามเวลาไทย" แล้วยืนยันว่าอยู่ในวันที่ถูก

โซนเวลาเป็นค่าเดียวที่ [config/store.ts](backend/src/config/store.ts) (`STORE_TIME_ZONE`)
**ฝั่ง TypeScript ห้ามฮาร์ดโค้ด `+07:00`** แม้ไทยไม่มี DST — ใช้ `zonedDayStart/End()` ที่อ่านค่านี้
👉 ถ้าวันหนึ่งเปลี่ยน schema ไปใช้ `@db.Timestamptz` ต้องกลับมาแก้ข้อ 1 และ 2 พร้อมกัน

**กฎอื่นที่ห้ามละเมิด**

1. **"ยอดขาย" = เงินที่ได้รับจริง** (`paymentStatus = PAID` และไม่ถูกยกเลิก/คืนเงิน)
   และ **ตัดรอบตาม `paidAt` ไม่ใช่ `createdAt`** — รายงานตอบว่า "เดือนนี้ร้านได้เงินเท่าไร"
   ไม่ใช่ "มีคนกดสั่งกี่ใบ" · สำคัญมากกับ COD ที่ได้เงินตอนส่งถึง (สั่งเดือนหนึ่ง ได้เงินอีกเดือน)
   ส่วนตาราง `ordersByStatus` นับ "ใบที่สร้าง" จึงใช้ `createdAt` — **หน้าเว็บต้องเขียนกำกับ**
   ว่าเป็นคนละเกณฑ์ ไม่งั้นคนอ่านเอาไปบวกกับยอดขาย
2. **ช่วงที่ไม่มีคำสั่งซื้อต้องเป็นจุด 0 ในกราฟ ไม่ใช่หายไป** (`fillSeries`)
   `GROUP BY` คืนเฉพาะช่วงที่มีแถว — กราฟที่ข้ามวันยอด 0 จะดูเหมือนขายได้ต่อเนื่อง
   และ **ไม่มียอดขายเลย = บอกตรง ๆ ว่าไม่มี** ไม่ใช่วาดแท่งเตี้ย ๆ ให้ดูเหมือนมีข้อมูล
3. **ช่วงก่อนหน้าเป็น 0 → `changePercent` เป็น `null` ไม่ใช่ 0 หรือ +100%**
   "จาก 0 เป็น 5,000" ไม่มีเปอร์เซ็นต์ที่มีความหมาย · หน้าเว็บแสดงว่า "ไม่มีข้อมูลให้เทียบ"
   (กฎเดียวกับป้ายกระดิ่ง STEP 16 ข้อ 8 และ "ยังไม่มีรีวิว" STEP 23 ข้อ 4)
4. **การเรียงอันดับต้องเรียงก่อนแบ่งหน้า** จึงทำใน SQL ทั้งหมด (`count(*) OVER ()` นับทั้งชุด)
   เรียงเฉพาะแถวในหน้าปัจจุบันคืออันดับปลอมที่ผู้ใช้จับไม่ได้
   — **นี่คือหนี้ที่ STEP 25 กันไว้ให้ STEP 26 ทำ** (ดู STEP 14 ข้อ 7 เรื่องตัวกรองสต็อกต่ำ)
5. **ยอดตามบิล (`Order.total`) กับยอดเฉพาะสินค้า (`OrderItem.lineTotal`) ไม่เท่ากันโดยธรรมชาติ**
   ต่างกันที่ค่าจัดส่งลบส่วนลดท้ายบิล · ส่ง 4 ค่าไปให้หน้าเว็บอธิบาย
   **ไม่ใช่ตัวเลขที่ต้องไล่ "แก้ให้ตรงกัน"** · ยอดตามหมวดหมู่ต้องใช้ `lineTotal`
   เพราะหนึ่งใบมีได้หลายหมวด ค่าจัดส่งหารลงหมวดไม่ได้
6. **จัดกลุ่มสินค้าด้วย `productId` เท่านั้น ห้ามใส่ `productName` ลง `GROUP BY`**
   `productName` เป็น snapshot ตอนสั่ง — สินค้าที่เปลี่ยนชื่อกลางช่วงจะแตกเป็นสองแถวแล้วอันดับเพี้ยน
   ชื่อที่แสดงใช้ชื่อ**ปัจจุบัน**จากตาราง `Product` และถอยไปใช้ snapshot เมื่อสินค้าหายจากระบบ
   · แถวที่ `productId` เป็น null ถูกยุบเป็นกลุ่มเดียว จึงต้องบอกว่าเป็นยอดรวม
   **ห้ามหยิบชื่อใดชื่อหนึ่งในกลุ่มมาแสดงเป็นชื่อของทั้งกลุ่ม**
7. **สิทธิ์ `analytics:read` (ADMIN ขึ้นไป) ไม่ใช่ `customer:read`** — ยอดขายทั้งร้าน
   และอันดับลูกค้ารายคนเป็นข้อมูลเชิงธุรกิจ พนักงานหน้าร้านไม่ควรเห็น
   (ต่างจาก `customer:read` ที่ EMPLOYEE มี เพราะต้องใช้ตอบคำถามลูกค้า)
8. **ทุก endpoint เป็น GET** เพราะหน้ารายงานเป็น Server Component ที่เรียกแบบ server-to-server
   ซึ่งไม่มี header `Origin` → `verifyOrigin` จะบล็อก POST (บทเรียนจาก STEP 17 ข้อ 7)
9. **ไฟล์ที่ส่งออกต้องมาจากฟังก์ชันเดียวกับที่หน้าเว็บใช้** ห้ามเขียนคิวรีชุดใหม่สำหรับไฟล์
   ไม่งั้นวันหนึ่งไฟล์กับหน้าจอจะไม่ตรงกันแล้วไม่มีใครรู้ว่าอันไหนถูก
   (ปัญหาเดียวกับนโยบายสองชุดที่เจอตอน STEP 21)
10. **ช่วงเวลาจำกัดไม่เกิน 366 วันต่อครั้ง** กันคิวรีที่กวาดทั้งตาราง · ข้อความบอกเหตุผลจริง
    ผ่าน `details` ของ response และหน้าเว็บอ่านด้วย `errorMessageOf()` ไม่ใช่ `.message`
    (ข้อความรวม "ข้อมูลที่ส่งมาไม่ถูกต้อง" ไม่บอกผู้ใช้ว่าต้องแก้อะไร — บทเรียนจาก STEP 15)

⚠️ **ชื่อชีตของ Excel ยาวได้ไม่เกิน 31 ตัวอักษร** — ยาวกว่านั้น ExcelJS ตัดท้ายทิ้งเงียบ ๆ
(เจอจริงตอนตรวจ STEP 26: ชื่อชีต "ลูกค้าที่ซื้อมากที่สุด 50 อันดับ" โดนตัดจนตัวสุดท้ายหาย)
· **CSV เก็บได้ชีตเดียว** จึงได้เฉพาะตารางรายช่วงเวลา — บอกไว้บนปุ่มดาวน์โหลดแล้ว

⚠️ **กราฟวาดด้วย SVG ตรง ๆ ไม่ใช้ไลบรารีกราฟ** — เป็น Server Component จึงไม่ต้องส่ง JS
ไปให้เบราว์เซอร์เลย · SVG เป็นภาพประกอบ (`aria-hidden`) และมี **ตารางข้อมูลจริงคู่กัน**
ที่ซ่อนด้วย `sr-only` เพื่อให้ screen reader อ่านตัวเลขได้ครบ ไม่ใช่ได้ยินแค่ "รูปภาพ"

⚠️ **ยังไม่มีการเรียงตามกำไร** เพราะระบบยังไม่เก็บต้นทุนสินค้า (ไม่มีคอลัมน์ต้นทุน)
การเดาต้นทุนเพื่อให้มีตัวเลขกำไรคือการโกหกร้านเรื่องเงิน — ต้องเพิ่มฟิลด์ต้นทุนก่อน

## Admin Logs / Audit (STEP 27 — สร้างแล้ว)

```
/admin/logs   → ประวัติการแก้ไขหลังบ้าน · กรองตามหมวด/ชนิดข้อมูล/ผู้ทำรายการ/ช่วงวัน
                · เห็นว่าช่องไหนเปลี่ยนจากอะไรเป็นอะไร · ส่งออก CSV/Excel   (log:read)

GET /api/admin/logs?q=&group=&action=&targetType=&targetId=&userId=&from=&to=&page=&limit=
GET /api/admin/logs/filters?from=&to=
GET /api/admin/logs/target/:targetType/:targetId
GET /api/admin/logs/export?...&format=csv|xlsx
```

**ตัวเขียน log มีที่เดียว: [`writeAdminLog()`](backend/src/models/admin-log.model.ts)**
ทุก service เรียกผ่านฟังก์ชันนี้ **ห้ามเรียก `tx.adminLog.create()` ตรง ๆ อีก**

### ⚠️ หนี้ที่ STEP 27 ต้องมาแก้ — `targetType` เคยถูกเขียนสองแบบ

ตรวจข้อมูลจริงตอนเริ่ม STEP 27 เจอชื่อของ **เรื่องเดียวกัน** ถูกเขียนไว้คนละแบบ:
`KnowledgeArticle` 64 แถว vs `KNOWLEDGE_ARTICLE` 5 แถว · `PRODUCT`/`INVENTORY`/`ORDER` (ตัวใหญ่)
ปนกับ `User`/`Review` (ตัวผสม) — ถ้าตัวกรองเทียบตรง ๆ **แถวอีกครึ่งจะหายไปเงียบ ๆ**
ซึ่งอันตรายกว่าไม่มีหน้า audit เลย เพราะคนอ่านจะเชื่อว่า "ไม่มีใครแตะของชิ้นนี้"

วิธีแก้ที่ใช้ (ทำครบทั้งสามข้อ อย่าทำแค่ข้อเดียว)

1. **ไม่แก้ข้อมูลเก่า** — audit log เป็น append-only การ UPDATE ย้อนหลังทำลายคุณค่าของมันทั้งหมด
2. **มาตรฐานตอนเขียน** — `writeAdminLog()` รับ `targetType` เป็น union พิมพ์ผิดแล้วคอมไพล์ไม่ผ่าน
3. **รวมชื่อเก่าตอนอ่าน** — ตัวกรองใช้ `aliasesOf()` แปลงเป็นรายการชื่อทั้งหมด
   (ทดสอบกับข้อมูลจริง: กรอง "คลังความรู้ AI" ได้ครบ 91 แถว = 76 ชื่อใหม่ + 15 ชื่อเก่า)

### ⚠️ `before` กับ `after` ต้องมีคีย์ชุดเดียวกัน ไม่งั้นประวัติพูดสิ่งที่ไม่จริง

`product.update` เคยเก็บ `before` เป็นสแนปช็อตคงที่ (ชื่อ · slug · SKU · ราคา · สถานะ)
แต่ `after` เก็บเฉพาะช่องที่ผู้ใช้ส่งมาแก้ → หน้าประวัติรายงานว่า
**"ชื่อสินค้าถูกล้างเป็นค่าว่าง"** ทั้งที่ไม่มีใครแตะชื่อเลย (เจอตอนตรวจกับแอปจริง)

แก้สองชั้น

- **`diffFields()`**: ช่องที่ **ไม่มีใน `after`** = "ไม่ได้ถูกรายงาน" **ไม่ใช่ "ถูกล้างค่า"**
  การล้างค่าจริงต้องบันทึก `null` ไว้ใน `after` อย่างชัดเจน
- **ตัวเขียน**: `product.update` เก็บค่าเดิมเฉพาะช่องที่ถูกแก้จริง ประวัติจึงอ่านว่า "จาก X เป็น Y"
  → **เขียน log ใหม่ที่ไหนก็ตาม ให้ `before` มีคีย์เดียวกับ `after` เสมอ**

**กฎอื่นที่ห้ามละเมิด**

1. **อ่านอย่างเดียว** — ไม่มี endpoint สร้าง แก้ หรือลบ log (มี test ยืนยันว่า POST/PATCH/DELETE ได้ 404)
   audit log ที่แก้ได้คือ audit log ที่เชื่อไม่ได้ (แพตเทิร์นเดียวกับประวัติสต็อก STEP 15 ข้อ 7)
2. **เขียนในทรานแซกชันเดียวกับการเปลี่ยนข้อมูลเสมอ** (`writeAdminLog` รับ `tx` ไม่ใช่ prisma)
   ไม่งั้นมีกรณีข้อมูลเปลี่ยนแล้วแต่ log ไม่ถูกเขียน = ช่องว่างที่ตรวจย้อนหลังไม่ได้
3. **แถวที่ผู้ทำรายการถูกลบบัญชีแล้วต้องยังแสดง** — FK เป็น `onDelete: SetNull`
   แสดงว่า **"(บัญชีถูกลบแล้ว)"** ไม่ใช่ซ่อนแถวหรือปล่อยว่าง · การซ่อนคือการทำให้ประวัติหาย
   (ข้อมูลจริงตอนนี้เป็นแบบนี้เกือบทั้งหมด เพราะเป็นบัญชีทดสอบที่ถูกลบไปแล้ว)
   · `actor.id` เป็น `null` ได้โดยเจตนา — **ห้ามใส่ค่าปลอมเพื่อให้ช่องไม่ว่าง**
4. **ตัวเลือกในตัวกรองมาจากข้อมูลจริงในช่วงที่เลือก** ไม่ใช่รายการคงที่ในโค้ด
   โชว์ตัวเลือกที่ไม่มีข้อมูล = คนกดแล้วได้หน้าว่างแล้วคิดว่าระบบพัง
   · และต้องยุบชื่อเก่าเข้าชื่อใหม่ ไม่งั้น "คลังความรู้ AI" โผล่สองอันด้วยเลขคนละตัว
5. **`action` ที่ไม่มีคำอธิบายให้แสดงชื่อดิบ** ไม่ใช่ซ่อนทิ้งหรือเดาความหมาย
   (`inventory.*` สร้างชื่อจาก enum `InventoryMovementType` — เพิ่มค่าใน enum ต้องมาเพิ่ม label ด้วย)
6. **ลิงก์ไปของชิ้นนั้นคำนวณที่ backend** และเป็น `null` เมื่อยังไม่มีหน้ารายตัว
   **ห้ามเดาลิงก์** (กฎเดียวกับ STEP 24 ข้อ 10) · คำสั่งซื้อเก็บ `targetId` เป็น `id`
   แต่หน้าเว็บเปิดด้วย `orderNumber` จึงต้องแปลงก่อน ไม่งั้นได้ลิงก์ที่พาไป 404
7. **สิทธิ์ `log:read` (ADMIN ขึ้นไป)** — log เก็บ IP · User-Agent · และเหตุผลที่แอดมินกรอกไว้
   พนักงานหน้าร้านไม่ควรเห็นว่าใครถูกระงับบัญชีเพราะอะไร
   · หน้าเว็บตั้ง `robots: noindex` และบอกบนหน้าจอว่าเป็นข้อมูลส่วนบุคคล
8. **ตัดวันตามเวลาร้าน** ผ่าน `zonedDayStart/End` เหมือนรายงานยอดขาย (ดูหัวข้อโซนเวลาของ STEP 26)

⚠️ **ยังไม่มีนโยบายระยะเวลาเก็บ log** — ตารางจะโตขึ้นเรื่อย ๆ และเก็บข้อมูลส่วนบุคคล (IP)
การกำหนดอายุและการลบตามกำหนดเป็นงานของ **STEP 53** (PDPA) ร่วมกับ job ตามเวลาของ STEP 52
· หน้าเว็บบอกเรื่องนี้ไว้ตรง ๆ แล้ว

## Security (STEP 28 — ตรวจทั้งระบบแล้ว)

**สรุปด่านทั้งหมด ช่องโหว่ที่เจอ และความเสี่ยงที่ยอมรับไว้ อยู่ที่ [docs/08-security.md](docs/08-security.md)**
ล็อกด้วย [backend/tests/security.test.ts](backend/tests/security.test.ts) ซึ่งทดสอบว่า **ด่านยังอยู่**
ไม่ใช่ทดสอบฟีเจอร์ — เพราะด่านพวกนี้ถอนออกแล้วระบบยังตอบ 200 ตามปกติ

### ⚠️ Open redirect — เช็ค `startsWith("/")` ไม่พอ (เจอจริง 2 ช่องทาง)

**ทุกการ redirect ที่ปลายทางมาจากผู้ใช้ ต้องผ่าน `safeInternalPath()`**
ใน [frontend/src/lib/safe-redirect.ts](frontend/src/lib/safe-redirect.ts) **ที่เดียว**
ห้ามเขียนเงื่อนไขเอง — ทั้งสองช่องโหว่ด้านล่างเกิดจากการเขียนเงื่อนไขเองทั้งคู่

1. **แบ็กสแลช**: `new URL("/\evil.com", origin)` → `https://evil.com/`
   เพราะมาตรฐาน WHATWG URL ถือว่า `\` เท่ากับ `/` สำหรับ scheme แบบ http/https
   `"/\evil.com"` จึงขึ้นต้นด้วย `/` และไม่ขึ้นต้นด้วย `//` แต่ออกนอกเว็บได้
2. **`..`**: `"/..//evil.com"` ผ่านทุกด่านต้นทาง แต่ pathname ที่ normalize ออกมา
   เป็น `"//evil.com"` **เสียเอง** → ต้องตรวจ **ผลลัพธ์** ด้วย ไม่ใช่แค่ input
   (ข้อนี้เจอจากเทสต์ที่ไล่ทุกรูปแบบ ไม่ใช่จากการอ่านโค้ด)

ผลกระทบคือฟิชชิงที่เนียนที่สุด: เหยื่อล็อกอินกับเว็บจริง (โดเมนถูก ทุกอย่างดูปกติ)
แล้วถูกพาไปเว็บปลอมทันทีหลังล็อกอินสำเร็จ

### ⚠️ CSP ใช้ nonce — ห้ามผ่อนเป็น `'unsafe-inline'`

nonce สร้างใหม่ทุกคำขอใน [proxy.ts](frontend/src/proxy.ts) แล้ว Next แปะให้สคริปต์ของตัวเองเอง

- **`script-src` ห้ามมี `'unsafe-inline'`** — จะทำให้ CSP ไร้ความหมายเรื่อง XSS
  ซึ่งเป็นเหตุผลเดียวที่ใส่ CSP
- `'strict-dynamic'` จำเป็น เพราะ Next โหลด chunk เพิ่มทีหลัง — ถอดออกแล้วเปลี่ยนหน้าพัง
- `style-src` ยังต้องมี `'unsafe-inline'` (next/font ฝัง `<style>` · React ใส่ `style` attribute)
  **แต่ห้ามผ่อน `script-src` ตามไปด้วย**
- dev ต้องมี `'unsafe-eval'` (HMR ของ Turbopack) · **production ห้ามมี**
- **วิธีตรวจว่า CSP ไม่ทำให้หน้าเว็บพัง**: จำนวน `<script>` ต้องเท่ากับจำนวนที่มี `nonce`
  ที่ตรงกับ header ของคำขอนั้น ถ้ามีตัวไหนไม่มี nonce เบราว์เซอร์จะบล็อกแล้วหน้านั้นไม่ทำงาน
  — **แต่ status ยังเป็น 200** จึงต้องตรวจด้วยวิธีนี้ ไม่ใช่ดูแค่ว่าหน้าโหลดผ่าน

```bash
curl -s -D h.txt -o p.html http://localhost:3000/
grep -c '<script' p.html            # ต้องเท่ากับบรรทัดล่าง
grep -c '<script[^>]*nonce=' p.html
```

### ⚠️ `TRUST_PROXY_HOPS` ต้องตรงกับจำนวน proxy จริง

ตั้งเกินจริงแล้วผู้ใช้ส่ง `X-Forwarded-For` มาเองได้ → `req.ip` เป็นค่าที่เขากำหนด
ผลคือ **rate limit ต่อ IP ถูกข้าม** และ **IP ใน `AdminLog` ชี้คนผิด**
รันตรงบนเครื่องโดยไม่มี proxy ให้ตั้ง `0`

**กฎอื่นที่ห้ามละเมิด**

1. **ห้ามใช้ `npm audit fix --force` กับโปรเจกต์นี้** — มันถอย Prisma 7 → 6 และ exceljs 4 → 3.4
   ซึ่งพังทั้งโปรเจกต์ · รายการที่เตือนอยู่ตอนนี้เป็น transitive ที่ใช้ไม่ได้กับเรา
   (`mysql2` มาจาก `@prisma/config` แต่เราใช้ PostgreSQL เท่านั้น · `uuid` มาจาก exceljs
   ซึ่งไม่ส่ง `buf`) — เหตุผลเต็มและเงื่อนไขที่ต้องกลับมาทบทวนอยู่ใน docs/08-security.md ข้อ 4.1
2. **อัปโหลดไฟล์รับเฉพาะ `.csv` / `.xlsx` / `.xls` และ 1 ไฟล์ต่อคำขอ**
   ปฏิเสธที่ชั้น multer ก่อนถึงตัวแปลง — `.xlsx` คือ zip ปล่อยให้แกะก่อนคือเปิดช่อง zip bomb
3. **ห้ามใช้ `dangerouslySetInnerHTML`** — ตอนนี้ไม่มีในโปรเจกต์เลย และต้องไม่มีต่อไป
   (SVG บาร์โค้ดใส่ผ่าน data URL ใน `<img>` ซึ่งรันสคริปต์ไม่ได้)
4. **error 500 ห้ามหลุดรายละเอียดภายใน** — `errorHandler` แปลง error ที่ไม่รู้จักเป็นข้อความกลาง
   และตัด `details` ออกตอน production
5. **ของคนอื่นคืน 404 ไม่ใช่ 403** ทุกที่ — 403 บอกใบ้ว่า id นั้นมีอยู่จริง
6. **`verifyOrigin` ทุกคำขอที่เปลี่ยนข้อมูล** · การ mutate จาก Server Component
   ต้องส่ง header `Origin` มาเอง (มีที่เดียวคือ `/api/cart/merge`)

⚠️ **frontend มีตัวรันเทสต์แล้วตั้งแต่ STEP 28** ([vitest.config.mts](frontend/vitest.config.mts))
ขอบเขตตอนนี้: ฟังก์ชันล้วนใน `src/**/*.test.ts` (ไม่ต้องมี DOM) + กฎระดับโปรเจกต์ใน `tests/**/*.test.ts`
(เพิ่มตอน STEP 31 — เทียบซอร์สกับกฎ responsive) · `npm test` รันทั้ง backend และ frontend
การเทสต์คอมโพเนนต์ (ต้องมี jsdom + testing-library) ยังเป็นงานของ STEP 37

## REST API (STEP 29 — รวมเป็นสัญญาที่ตรวจได้แล้ว)

**เอกสารฉบับเต็มของทุก endpoint อยู่ที่ [docs/09-api-reference.md](docs/09-api-reference.md)**
(119 เส้นทาง · ข้อตกลงร่วมเรื่อง response shape · error code · auth · CSRF · rate limit · การแบ่งหน้า)

STEP 29 ไม่ได้เพิ่ม endpoint ใหม่ — endpoint ครบมาตั้งแต่ STEP 6–27 แล้ว
งานของ STEP นี้คือทำให้ **คำอธิบาย API ไม่มีทางโกหก** และทำให้กฎที่เคยเป็นวินัยของคนเขียน
กลายเป็นสิ่งที่เทสต์ตรวจได้ทุกเส้นทาง

### แผนผัง API อ่านจาก router จริง ไม่ใช่รายการที่เขียนด้วยมือ

[`buildApiMap(app)`](backend/src/models/api-map.ts) เดินบน `app.router` ของ Express แล้วคืน
เมธอด · path เต็ม · ต้องล็อกอินไหม · บทบาท · สิทธิ์ · มี CSRF ไหม · rate limit · รับไฟล์ไหม
ของ **ทุกเส้นทาง** ใช้ทั้งใน `GET /api` และในเทสต์

เดิม `GET /api` อ่านจากรายการที่พิมพ์ไว้ในไฟล์เดียวกัน ซึ่งเพี้ยนไปแล้วเงียบ ๆ:
มันประกาศ `/api/inventory` ว่า `planned` ทั้งที่คลังสินค้าเปิดใช้จริงมาตั้งแต่ STEP 15
(อยู่ที่ `/api/admin/inventory`) — และปน "ของที่ยังไม่มี" ไว้ในรายการเดียวกับของที่เรียกได้
โดยมีแค่ฟิลด์ `status` กำกับ ตอนนี้แยกเป็น `groups` (มีจริง) · `external` (อยู่บน Next.js) ·
`planned` (**เรียกแล้วได้ 404** และมีเทสต์ยิงยืนยันทุกอัน)

**กฎที่ห้ามละเมิด**

1. **ทุกการ mount router ต้องผ่าน `mountRouter(parent, path, child)`** ไม่ใช่ `parent.use(path, child)`
   เพราะ Express **ไม่เก็บ path ที่ใช้ mount ไว้** (`layer.path` เป็น undefined จนกว่าจะมีคำขอมาตรง)
   ถ้า mount ตรง ๆ แผนผังจะไม่รู้ prefix แล้ว endpoint ทั้งกลุ่มจะหายจากเอกสาร
   → `buildApiMap()` **โยน error** เมื่อเจอ router ที่ไม่ได้ลงทะเบียน ไม่ใช่ข้ามไปเงียบ ๆ
2. **middleware ที่เป็นด่านต้องติดป้ายด้วย `describeMiddleware()`**
   ([describe.ts](backend/src/middlewares/describe.ts)) — `requirePermission('x')` คืน arrow function
   ที่ไม่มีชื่อ จึงเดาจากชื่อฟังก์ชันไม่ได้ · ป้ายเก็บใน `WeakMap` ไม่ใช่ property ของฟังก์ชัน
   จึงไม่มีทางหลุดไปกับ response · **เพิ่ม middleware ที่เป็นด่านใหม่แล้วไม่ติดป้าย = เอกสารจะบอกว่าไม่มีด่าน**
3. **ตารางในเอกสารต้องตรงกับโค้ดทุกแถว** — [api-contract.test.ts](backend/tests/api-contract.test.ts)
   เทียบ method + path + สิทธิ์ + เงื่อนไขล็อกอิน + เครื่องหมาย `20/นาที` ทีละแถว
   เพิ่ม endpoint แล้วไม่เขียนลงเอกสาร เทสต์ล้ม · เขียน endpoint ที่ไม่มีจริง เทสต์ล้ม
4. **ห้ามใส่ขีดตั้งในเนื้อหาของตาราง endpoint** (ใช้ลูกน้ำคั่นค่าที่เลือกได้แทน)
   ตัวอ่านเอกสารรับเฉพาะแถวที่มี 4 ช่องพอดี — แต่ถ้าเผลอใส่ เทสต์ "ทุก endpoint ถูกเขียนไว้"
   จะฟ้องว่า endpoint นั้นหาย ไม่ได้ผ่านไปเงียบ ๆ
5. **รายการข้อยกเว้นทุกชุดอยู่ในเทสต์แบบ "ต้องตรงเป๊ะ"** ไม่ใช่ "อย่างน้อย"
   (เส้นทางที่เปิดให้ guest · เส้นทางที่เปลี่ยนข้อมูลโดยไม่มี CSRF · เส้นทางที่คุมความถี่แบบเข้ม ·
   เส้นทางที่รับไฟล์) — เพิ่มชื่อเข้ารายการได้ แต่ต้องเห็นใน diff
6. **ลำดับ route ถูกตรวจด้วยเครื่องแล้ว** — `buildApiMap()` คืนรายการ route ที่ Express
   เรียกไปไม่ถึงเพราะถูก `/:param` ที่ลงทะเบียนก่อนจับไปแล้ว (เช่น `/products/search` ที่เผลอไปอยู่
   หลัง `/products/:slug` แล้วกลายเป็น "ค้นหาสินค้าที่ slug ชื่อ search") **ซึ่งไม่มี error ให้เห็นเลย**
   → ไม่ต้องพึ่งการจำคอมเมนต์ "⚠️ ลำดับสำคัญ" ทั้ง 5 ที่ในไฟล์ route อีกแล้ว แต่คอมเมนต์ยังอยู่เพื่ออธิบายเหตุผล
7. **`GET /api` ต้องไม่โฆษณาเส้นทางที่ยังไม่มี** — กลุ่มที่ endpoint เป็น 0 ถือว่าผิด (เทสต์ตรวจ)
   แพตเทิร์นเดียวกับ STEP 4 ข้อ 2: ห้ามใส่ `href` ไปยังหน้าที่ยังไม่มี

### ⚠️ ตัวนับที่ไม่มีใครเรียก = ตัวเลขที่โกหกตลอดกาล (เจอตอน STEP 29)

`viewCount` ของบทความคลังความรู้ถูกแสดง 2 ที่ (การ์ดบน `/faq` และยอดรวมบน `/admin/knowledge`)
แต่ **เส้นทางเดียวที่บวกค่านี้คือ `GET /api/ai/knowledge/articles/:slug` ซึ่งไม่มีใครเรียกเลย**
เพราะรายการบทความส่งเนื้อหาเต็มมาให้แล้ว หน้า FAQ จึงเปิดอ่านจากข้อมูลในมือตรง ๆ
ผลคือทุกบทความแสดง "เข้าชม 0 ครั้ง" ตลอดกาลทั้งที่มีคนอ่านจริง
(ปัญหาชนิดเดียวกับ `User.totalSpent` ของ STEP 25 และ `Product.totalStock` ของ STEP 15:
คอลัมน์ที่ไม่มีใครเขียน แต่ถูกเอาไปแสดงเป็นความจริง)

แก้โดยให้ปุ่ม "อ่านคู่มือฉบับเต็ม" เรียก endpoint นั้นจริง ตัวเลขจึงหมายถึง **"กดอ่านเต็ม ๆ กี่ครั้ง"**
ไม่ใช่ impression · ยิงหลังเปิดหน้าต่างแล้ว และถ้ายิงไม่ผ่านก็ยังอ่านต่อได้
(การนับยอดล้มต้องไม่ทำให้อ่านบทความไม่ได้ — แพตเทิร์นเดียวกับ `notifySafely` ของ STEP 24)

**บทเรียนที่ใช้ต่อได้:** เจอ endpoint ที่ไม่มีใครเรียก ให้ถามก่อนว่า **"แล้วผลข้างเคียงของมันหายไปไหน"**
ไม่ใช่ลบทิ้งทันที

### ⚠️ `strictRateLimiter` ใช้กับเส้นทางที่เรียกแบบ server-to-server ไม่ได้

limit นับต่อ IP — ถ้า Server Component ของ Next เรียก endpoint นั้น คำขอของผู้ใช้ทั้งเว็บ
จะมาจาก IP เดียวแล้ว **แชร์โควตา 20 ครั้ง/นาทีร่วมกันทั้งเว็บ**
→ เส้นทางที่คุมความถี่แบบเข้มต้องถูกเรียกจากเบราว์เซอร์เท่านั้น (client component)
ตรวจทุกครั้งที่จะเพิ่ม `strictRateLimiter` ให้เส้นทางใหม่ว่าใครเป็นคนเรียก

## Error Handling (STEP 30 — ตรวจทั้งระบบแล้ว)

**ตัวแปลง error มีที่เดียว: [`normalizeError()`](backend/src/middlewares/error-handler.ts)**
เป็นฟังก์ชันบริสุทธิ์ (เทสต์ยิง error สังเคราะห์เข้าได้ตรง ๆ) แล้ว `errorHandler` เอาผลไปส่งออก
ลำดับการตัดสิน: `ApiError` → `ZodError` → body-parser → multer → `URIError` → ตาข่าย Prisma → `http-errors`
→ ที่เหลือเป็น 500

### กฎที่ห้ามละเมิด

1. **500 หมายความว่า "โค้ดเราพัง" เท่านั้น** — อะไรที่ผู้ใช้แก้เองได้ห้ามเป็น 500
   ตอนเริ่ม STEP 30 มี **5 เส้นทางที่ตอบ 500 ผิด ๆ** อยู่จริง (ดูหัวข้อถัดไป) ซึ่งเสียสองต่อ:
   ผู้ใช้ไม่รู้ว่าต้องแก้อะไร และเราไปไล่หาบั๊กในที่ที่ไม่มีบั๊ก
   · **503 ไม่ใช่ 500** เมื่อต่อฐานข้อมูลไม่ได้ เพราะ 503 แปลว่า "ลองใหม่ได้"
2. **ห้ามให้ข้อความของไลบรารีหลุดไปถึงผู้ใช้** — มันเป็นภาษาอังกฤษและเป็นศัพท์ภายใน
   (`"incorrect header check"` · `"Failed to decode param"` · ข้อความของ Prisma ที่มีชื่อคอลัมน์)
   ตัวแปลงอ่านแค่ **สถานะ** ของ error พวกนี้ แล้วใช้ข้อความไทยของเราเอง
3. **ตาข่าย Prisma เป็นตาข่ายกันตก ไม่ใช่ที่เขียนข้อความให้ผู้ใช้อ่าน**
   ข้อความที่บอกสาเหตุได้จริง ("บาร์โค้ดนี้ถูกใช้กับตัวเลือกอื่นแล้ว") ต้องมาจาก service ที่รู้บริบท
   → **service ยังต้องดัก P2002 ของตัวเองเหมือนเดิม** ตาข่ายมีไว้กันกรณีที่หลุด เช่น
   unique ของ `InventoryMovement.idempotencyKey` ที่ตรวจก่อนเขียนในทรานแซกชัน
   ถ้าสองคำขอเหมือนกันเข้ามาพร้อมกันจริง ตัวที่แพ้จะโดน P2002 ตอน insert
4. **เพิ่ม `errorCode` ใหม่ได้ แต่ต้องเพิ่มลงตารางใน [docs/09-api-reference.md](docs/09-api-reference.md) ด้วย**
   — [error-handling.test.ts](backend/tests/error-handling.test.ts) เทียบทุกค่าใน `ERROR_CODES`
   กับตารางในเอกสาร และเทียบสถานะที่ `ApiError` แต่ละตัวสร้างกับที่เอกสารเขียนไว้ ลืมแล้วเทสต์ล้ม
5. **middleware ที่ส่ง error ต่อให้ `next()` เองต้องโยน `ApiError`** ไม่ใช่ `Error` เปล่า
   (เจอจริง: `fileFilter` ของ multer โยน `Error` เปล่า → ผู้ใช้ได้ 500 ที่ไม่บอกว่าต้องส่งไฟล์ชนิดไหน)
6. **ทุก error ตอบ shape เดียวกันไม่ว่าจะเกิดที่ชั้นไหน** — มีเทสต์ไล่ยิง 5 ชั้น
   (เส้นทางไม่มีจริง · เมธอดผิด · ไม่ได้ล็อกอิน · query ผิด · id ผิดรูปแบบ)
   แล้วตรวจว่าไม่มี `at ` (stack trace) หลุดออกมาเลย

### ⚠️ 5 เส้นทางที่เคยตอบ 500 ทั้งที่เป็นความผิดของคำขอ (แก้แล้วใน STEP 30)

| คำขอ                                      | เดิม | ตอนนี้ | ทำไมสำคัญ                                                             |
| ----------------------------------------- | ---: | -----: | --------------------------------------------------------------------- |
| อัปโหลดไฟล์ผิดชนิด (`.php`)               |  500 |    400 | เดิมไม่บอกเลยว่ารับชนิดไหน — ด่านที่เพิ่มใน STEP 28 ไร้ผลในทางปฏิบัติ |
| JSON body เกิน 1MB                        |  500 |    413 | 413 บอกตรง ๆ ว่าส่งน้อยลงแล้วผ่าน                                     |
| `charset` ที่อ่านไม่ได้ (เช่น iso-8859-1) |  500 |    415 | ผู้เรียกแก้ที่ header ได้เอง                                          |
| body ที่บอกว่าบีบอัดมาแต่บีบอัดไม่จริง    |  500 |    400 | บ็อตส่งแบบนี้เข้ามาเรื่อย ๆ                                           |
| **path ที่ percent-encode ไม่ใช่ UTF-8**  |  500 |    400 | ดูด้านล่าง — อันตรายที่สุดในกลุ่มนี้                                  |

**`URIError` จาก path ที่เข้ารหัสผิด** เกิดขึ้นเองตลอดเวลาจากลิงก์เก่า บ็อต และเครื่องสแกน
(เจอจริงตอนตรวจ: `/api/products/%E4%C1%E8` = "ไม่" ที่เข้ารหัสแบบ **TIS-620** ไม่ใช่ UTF-8)
Express ตั้ง `status = 400` มาให้แล้วแต่ **ไม่ตั้ง `expose`** จึงไม่เข้าเงื่อนไขของตัวจับ `http-errors`
ผลเดิมคือทุกคำขอแบบนี้ได้ 500 พร้อม **log ระดับ error** ซึ่งอ่านว่า "ระบบเราพัง"
→ การเฝ้าระวังของ STEP 51 จะเตือนผิดเรื่องจนกลายเป็นเสียงรบกวนที่คนเลิกอ่าน
(ตอนนี้เป็น 400 และ log ระดับ warn ตามความเป็นจริง)

### หน้าแสดงข้อผิดพลาดของ frontend

| ไฟล์                         | รับ error จากไหน             | ยังเห็นอะไรอยู่        |
| ---------------------------- | ---------------------------- | ---------------------- |
| `app/(storefront)/error.tsx` | ทุกหน้าในหน้าร้าน            | navbar + footer        |
| `app/admin/error.tsx`        | ทุกหน้าในหลังบ้าน            | แถบเมนู admin          |
| `app/error.tsx`              | `/signin`, `/after-signin`   | แค่โครงของ root layout |
| `app/global-error.tsx`       | **root layout เองพัง**       | ไม่มีอะไรเลย           |
| `app/not-found.tsx`          | URL ที่ไม่ตรงกับ route ใดเลย | แค่โครงของ root layout |

**กฎ**

1. **`error.tsx` ไม่ได้แทน `<SectionError>`** — section ที่ดึงข้อมูลยังต้องจับ error ของตัวเอง
   ตามกฎ STEP 5 ข้อ 1 · หน้าไหนตกมาถึง `error.tsx` บ่อย ๆ แปลว่า section นั้นยังไม่จับ error
2. **ต้องแสดง `digest`** — ตอน production Next **แทนข้อความของ error ที่เกิดฝั่ง server ด้วยข้อความกลาง**
   แล้วให้แฮชมาแทน · `digest` เป็นสิ่งเดียวที่โยงหน้าจอของผู้ใช้กับบรรทัดใน log ได้ ห้ามซ่อนทิ้ง
3. **`global-error.tsx` ใช้ CSS หรือฟอนต์ของแอปไม่ได้** เพราะทั้งคู่มาจาก root layout ที่พังไปแล้ว
   → สไตล์ inline ทั้งหมด (ที่เดียวในโปรเจกต์ที่ยกเว้นกฎ "ห้าม hardcode ค่าสี")
   และใช้ `<a href="/">` ไม่ใช่ `<Link>` เพราะต้องโหลดหน้าใหม่ทั้งหน้า — `<Link>` จะเรนเดอร์
   layout ที่พังอยู่ซ้ำอีกครั้ง (ปิดกฎ eslint ไว้ตรงนั้นพร้อมเหตุผล)
4. **`not-found.tsx` ที่ราก เรนเดอร์ด้วย root layout เท่านั้น ไม่มี navbar** จึงต้องมีลิงก์ของตัวเองให้ครบ
   (ไฟล์ `not-found.tsx` ที่อยู่ในโฟลเดอร์ของ route เช่น `product/[slug]` ยังมี navbar ตามปกติ)
5. **ข้อความ error ที่ผู้ใช้เห็นต้องเขียนให้ผู้ใช้อ่าน** — เดิม `apiFetch` ตอบว่า
   "กรุณาตรวจสอบว่า backend ทำงานอยู่" ซึ่งเป็นคำสั่งถึงนักพัฒนา ลูกค้าทำตามไม่ได้
   (คำใบ้สำหรับนักพัฒนายังอยู่ แต่เฉพาะตอน dev)

### ⚠️ `error.tsx` เรนเดอร์ที่ client — ตรวจด้วย curl ไม่ได้

เมื่อ Server Component โยน error ตอน SSR **Next ไม่ได้เรนเดอร์ `error.tsx` ลงใน HTML**
มันส่งจุดที่พังไปเป็น error marker ใน RSC payload (`E{"digest":"…"}`) พร้อม `errorScripts`
แล้วให้ **เบราว์เซอร์เรนเดอร์ boundary หลัง hydrate** → HTML ที่ curl ได้จึงมีแต่โครงเปล่า
สถานะเป็น 500 ถูกต้อง แต่ **ไม่มีข้อความของเราอยู่ในนั้น**

วิธีตรวจเท่าที่ทำได้โดยไม่เปิดเบราว์เซอร์: ดูว่า chunk ที่ payload อ้างเป็น `errorScripts`
ของ segment นั้น มีข้อความของ boundary ที่ถูกตัวอยู่จริง

```bash
grep -rl "กลับหน้าภาพรวมร้าน" frontend/.next/static/chunks/*.js   # boundary ของ admin
```

✅ **ยืนยันแล้วว่า `error.tsx` ไม่ทำให้ HTTP 404 เพี้ยน** (ต่างจาก `loading.tsx` — ดูหัวข้อ STEP 6)
ทดสอบบน production build: `/product/<slug ที่ไม่มี>` · `/looks/<slug ที่ไม่มี>` · URL ที่ไม่มี route
ยังได้ **404** ครบทั้งสามแบบหลังเพิ่ม error boundary ทุกชั้น

### ระดับ process

`uncaughtException` → log แล้วปิด process (สถานะในหน่วยความจำเชื่อถือไม่ได้อีก)
· `unhandledRejection` → **log แล้วไปต่อโดยเจตนา** เพราะ Express 5 จับ rejection ของ handler ให้แล้ว
และตัวช่วยที่ทำงานเบื้องหลัง (`scanAlertsAfterStockChange` · `notifySafely`) กลืน error ของตัวเองอยู่
ที่เหลือจึงมีโอกาสเป็นเรื่องเล็กมากกว่าเรื่องที่ทำข้อมูลเสีย — การฆ่า API ทั้งตัวเพราะ promise ลอยตัวเดียว
แย่กว่า · **ถ้าวันหนึ่งเจอ rejection ที่ทำให้ข้อมูลไม่ตรงกัน ต้องกลับมาทบทวนข้อนี้**

## Responsive (STEP 31 — วัดจริงทุกหน้าด้วย Chrome แล้ว)

**เครื่องมือ: `node scripts/audit-responsive.mjs`** (ต้องเปิด `npm run dev` ไว้ก่อน)
เปิด Chrome ที่ติดตั้งในเครื่องผ่าน CDP ตรง ๆ (ไม่มี puppeteer/playwright เป็น dependency
เพราะ Node 24 มี `WebSocket` เป็น global) แล้วไล่เปิด **ทุกหน้าในแอป** ทีละความกว้าง
โดยล็อกอินตามบทบาทที่หน้านั้นต้องการ แล้ววัด 3 อย่าง

| วัดอะไร             | ตัวชี้ขาด                                                    |
| ------------------- | ------------------------------------------------------------ |
| หน้าเลื่อนแนวนอนไหม | `documentElement.scrollWidth > clientWidth`                  |
| เนื้อหาถูกตัดหายไหม | กล่องที่ยื่นเกินจอและมีบรรพบุรุษ `overflow-x: hidden` รับไว้ |
| ปุ่มกดได้ไหม        | กล่องของตัวควบคุมทุกตัวต้อง ≥ 44×44 (กฎข้อ 11)               |

ผลล่าสุด: **44 หน้า × 360/768/1280 = 132 หน้า-ความกว้าง · ไม่มีปัญหาเลย** (exit code 0)

**ทำไมต้องใช้เบราว์เซอร์จริง ไม่ใช่อ่านคลาสในซอร์ส:** การล้นเกิดจากผลรวมของ padding + gap +
**ความกว้างของเนื้อหาจริง** (ชื่อสินค้า อีเมลลูกค้า เลขพัสดุ) ที่ไม่มีอยู่ในซอร์ส
และ flex/grid ย่อของให้พอดีจนอาการหายไปโดยที่ layout ยังผิดอยู่

### กฎที่ห้ามละเมิด

1. **ห้ามใช้ `overflow-x: hidden` ที่ `body`/`html` เพื่อ "แก้" การล้น**
   เดิม `globals.css` มีบรรทัดนี้ในนาม "ป้องกัน horizontal overflow" ซึ่ง **ไม่ได้ป้องกันอะไร**
   มันตัดของที่ล้นให้มองไม่เห็น และหน้าก็ยังเลื่อนซ้ายขวาได้จริง (viewport propagation มาจาก html)
   ของจริงที่มันกลบไว้: navbar ของคนที่ล็อกอินบนจอ 360px ล้น 25px แล้ว **ปุ่ม hamburger
   ถูกตัดหายไปครึ่งปุ่ม** — มีเทสต์ใน [responsive.test.ts](frontend/tests/responsive.test.ts) กันไม่ให้ใส่กลับ
2. **ลูกของ grid/flex ที่มีเนื้อหายาวต้อง `min-w-0`** (หรือ track เป็น `minmax(0,1fr)`)
   ไม่งั้นความกว้างของ track โตตาม **min-content** ของลูก แล้วดันทั้งหน้าให้ล้น
   (เจอที่ `/cart`: แถวสินค้าต้องการ 348px ในพื้นที่ 328px → ทั้งหน้าเลื่อนได้)
3. **ไอคอน/ปุ่มในแถบด้านบนต้อง `shrink-0`** — ไม่มีแล้ว flex จะย่อให้พอดีแล้วปัญหาหายไปจากสายตา
   ทั้งที่ของเสียรูป: แถบ `/admin` ที่ 360px ย่อกระดิ่งเหลือ **กว้าง 29px จาก 44** ·
   โลโก้ตัดสองบรรทัด · ปุ่มออกจากระบบสูง 62px **โดยหน้าไม่ได้เลื่อนแนวนอนเลย จึงไม่มีอะไรฟ้อง**
4. **พื้นที่กด ≥ 44px คิดที่ "กล่องที่กดได้จริง"** — `<label>` ที่ครอบ input **คือ** พื้นที่กด
   (แพตเทิร์นของโปรเจกต์: ป้ายเป็นแคปซูล `min-h-12` แล้วข้างในเป็น input โปร่งใส) ·
   ช่องติ๊ก 16–20px ไม่ผิดถ้าป้ายที่ครอบมันใหญ่พอ · ป้ายเปล่า ๆ ที่ครอบ input ต้องใส่ `min-h-11` เอง
5. **ลิงก์ข้อความที่ไหลอยู่ในประโยค เบรดครัมบ์ หรือในช่องตาราง ไม่ต้อง 44px**
   (ข้อยกเว้น "inline" ของ WCAG 2.5.5) — สคริปต์แยกให้แล้วโดยดูว่ามีเส้นขอบ/พื้นหลัง/padding ไหม
   ตอนนี้มี ~600 ลิงก์ที่เข้าข้อยกเว้นนี้ รายงานไว้เป็น "ข้อมูลประกอบ" ไม่ใช่ความผิด
   **ห้ามขยายมันเป็นปุ่ม** เพราะจะทำให้บรรทัดข้อความและตารางเสียรูป
6. **สองกฎนี้ขัดกันเอง — ต้องรันตรวจซ้ำหลังแก้ทุกครั้ง**
   ขยายปุ่มเป็น 44px ทำให้แถวกว้างขึ้นแล้ว **สร้างการล้นขึ้นใหม่** (เกิดจริงที่ `/cart`:
   แก้ปุ่ม +จำนวน/−จำนวน เป็น 44px แล้วหน้าเลื่อนได้ทันที) ทางแก้คือลดช่องไฟและขนาดรูป
   บนจอเล็ก (`gap-3 sm:gap-4` · `size-20 sm:size-24`) ไม่ใช่ย่อปุ่มกลับ
7. **ซ่อนของบนจอเล็กได้ แต่ต้องมีทางเข้าถึงอื่นเสมอ** — จอ 360px รับได้แค่ 4 ไอคอนข้างโลโก้
   (44px ต่อปุ่มห้ามย่อ) คนที่ล็อกอินมีกระดิ่งเพิ่มเป็นไอคอนที่ 5 จึงซ่อน "ถูกใจ" ที่ `<sm`
   **แล้วไปเพิ่มไว้ในเมนู hamburger** (กฎเดียวกับ STEP 4 ข้อ 2: ห้ามทำให้หน้าเข้าไม่ถึง)
8. **master/detail บนจอเล็กต้องสลับหน้า ไม่ใช่วางข้างกันแล้วปล่อยให้ถูกตัด**
   `/admin/support` เดิมวางรายการเคส (`w-full shrink-0`) ข้างห้องแชตในกล่อง `overflow-hidden`
   → ที่ 360px ห้องแชตถูกดันออกไปนอกจอ **แล้วถูกตัดหายทั้งคอลัมน์** (เห็นแค่รายการ กดเคสแล้วไม่มีอะไรเกิด)
   ตอนนี้จอเล็กแสดงทีละคอลัมน์ + ปุ่มย้อนกลับ · จอ `md` ขึ้นไปยังเป็นสองคอลัมน์เหมือนเดิม
9. **หน้าใหม่ต้องเพิ่มใน `ROUTES` ของสคริปต์** — [responsive.test.ts](frontend/tests/responsive.test.ts)
   เทียบทุก `page.tsx` กับรายการนั้น (ยกเว้นที่ประกาศไว้ชัด ๆ) ลืมแล้วเทสต์ล้ม

### ⚠️ กับดักของ "ตัววัด" เอง (ทั้งสามข้อเคยทำให้ผลตรวจผิดจริง)

1. **cookie เป็นของโปรไฟล์เบราว์เซอร์ ไม่ใช่ของแท็บ** — รอบแรกไล่หน้า guest ก่อนจึงสะอาด
   แต่รอบความกว้างถัดไป cookie ของ admin ที่ค้างอยู่ทำให้หน้า "guest" ถูกตรวจในฐานะ admin
   (navbar คนละชุด ตะกร้าคนละใบ) → สคริปต์ล้าง cookie ก่อนทุกหน้าแล้ว
2. **หน้าที่แสดงแผง error ไม่ได้แสดงเลย์เอาต์ของตัวเอง** — ยิงทุกหน้าติด ๆ กันจาก IP เดียว
   ชน rate limit ของ API เอง (300 คำขอ/15 นาที) แล้วหลายหน้ากลายเป็น "โหลดข้อมูลส่วนนี้ไม่สำเร็จ"
   ซึ่งสั้นและไม่ล้น = **ผ่านแบบหลอก ๆ** → สคริปต์ตรวจข้อความสถานะผิดพลาดแล้วนับเป็น "เชื่อผลไม่ได้"
   (exit code ไม่เป็น 0) · ตอนตรวจทั้งชุดให้ตั้ง `RATE_LIMIT_MAX` สูงขึ้นชั่วคราวใน `.env`
3. **ฐานข้อมูลว่างทำให้ขอบเขตการตรวจแคบลงเงียบ ๆ** — หน้าที่ต้องมีเลขออเดอร์/รหัสสินค้าจะถูกข้าม
   → สคริปต์พิมพ์รายการหน้าที่ข้ามทุกครั้ง · เลย์เอาต์ที่แตกมักแตกเพราะ **ข้อมูลจริงที่ยาว**
   (ชื่อคนไทยเต็ม · อีเมลยาว · ที่อยู่คอนโด) หน้าว่างเปล่าตรวจอะไรไม่ได้

### ข้อจำกัดที่รู้อยู่

**ที่ 320px ยังมี 16 หน้าที่เลื่อนแนวนอนได้** (นอกเกณฑ์ 360px ที่โปรเจกต์กำหนด) เพราะโลโก้
บวก 4 ไอคอน × 44px เกินที่ 320px รับได้ · จะรองรับ 320 ต้องซ่อนไอคอนค้นหาเพิ่มอีกตัว
หรือย่อโลโก้เป็นสัญลักษณ์ — ยังไม่ทำเพราะจะแลกกับการเข้าถึงบนจอที่ใช้กันจริง
· ตรวจเฉพาะเลย์เอาต์แนวนอน **ยังไม่ตรวจการซูม 200%** (งานของ STEP 54)

## Accessibility — จุดที่พลาดบ่อย (สรุปจากการเก็บงาน STEP 20/21)

**หน้าต่าง (modal/dialog) — ใช้แพตเทิร์นของ [mobile-menu.tsx](frontend/src/components/layout/mobile-menu.tsx) เสมอ**
`<div className="fixed inset-0">` เฉย ๆ **ไม่ใช่ dialog** สำหรับ screen reader และคีย์บอร์ดออกไม่ได้ ต้องมีครบ 5 อย่าง:

1. พื้นหลังเป็น `<div>` ของตัวเองที่ `aria-hidden` (ไม่ใช่ `bg-black/50` บน container เดียวกับเนื้อหา)
2. ตัวหน้าต่างมี `role="dialog"` + `aria-modal="true"` + `aria-labelledby` ผูกกับ `id` ของหัวข้อ
3. ปิดด้วย **Esc** ผ่าน `useEffect` ที่ผูก `keydown` และถอดออกตอน unmount
4. **ล็อก scroll** ของหน้าเบื้องหลัง (`document.body.style.overflow = "hidden"` แล้วคืนค่าเดิม)
5. ระหว่างที่งานยังค้าง (กำลังบันทึก/ลบ) **ห้ามให้ปิดได้** ทั้ง Esc และคลิกพื้นหลัง

⚠️ **ฟอร์มที่พิมพ์ข้อมูลยาว ๆ ห้ามปิดด้วยการคลิกพื้นหลัง** — เผลอคลิกแล้วงานหายหมด
(หน้าต่างอ่านอย่างเดียวหรือกล่องยืนยันคลิกปิดได้)

**`aria-live` ต้องมีที่ไหนบ้าง** — ทุกที่ที่เนื้อหาเปลี่ยนเองโดยผู้ใช้ไม่ได้ย้าย focus:
กล่องแชต (คำตอบ AI/เจ้าหน้าที่ไหลเข้ามา) · คำตอบของ AI · ตาราง/รายการที่เปลี่ยนตามตัวกรอง
ใส่ `aria-busy` คู่ไปด้วยตอนกำลังโหลด · ข้อความ error ใช้ `role="alert"` (ประกาศทันที ไม่ต้องรอ)

**ชื่อของตัวควบคุม**

- `title` **ไม่นับเป็นชื่อ** — ผู้ใช้ทัชไม่เห็น และ screen reader ประกาศไม่แน่นอน ต้องมี `aria-label` ด้วย
- ฟิลด์ในฟอร์มต้องผูก `<label htmlFor>` ↔ `id` จริง ๆ — `<label>` ที่ลอยอยู่ข้างบน **ไม่ผูกกับอะไรเลย**
- ฟิลด์ที่ซ้ำกันเป็นรายการ (เช่น FAQ ข้อที่ 1, 2, 3) ผูก label เดียวไม่ได้ → ใช้ `aria-label` ที่มีเลขลำดับ
- ช่องค้นหา/ตัวกรองที่มีแต่ placeholder ให้เพิ่ม label แบบ `sr-only`
  (แพตเทิร์นเดิมของโปรเจกต์: `<label>` ห่อ input แล้วมี `<span className="sr-only">` ข้างใน — ดู `/admin/orders`)
- ไอคอนที่อยู่ข้างข้อความอยู่แล้วให้ใส่ `aria-hidden` ไม่งั้นถูกอ่านซ้ำ

**`prefers-reduced-motion`** — `globals.css` คุม CSS animation/transition ให้แล้ว
แต่ **`scrollIntoView({ behavior: "smooth" })` ที่เรียกจาก JS ทับค่า CSS** ต้องเช็คเองด้วย
`window.matchMedia("(prefers-reduced-motion: reduce)").matches`

⚠️ **การตรวจด้วย grep/regex ให้ระวังสองกับดักที่เจอจริง**

- หาปลายแท็กด้วย `indexOf('>')` ไม่ได้ เพราะ `onClick={() => ...}` มี `>` อยู่ข้างใน — ต้องนับวงเล็บปีกกา
- ห้ามตัด `{...}` ทิ้งตอนหาข้อความในปุ่ม เพราะ `{faq.question}` **คือชื่อของปุ่ม**
  (ตัดทิ้งแล้วจะรายงานปุ่มที่มีชื่ออยู่แล้วว่าไม่มีชื่อ)

## ข้อควรระวังเรื่องเครื่องมือบนเครื่องนี้ (Windows / PowerShell)

- **ห้ามใช้ `Set-Content` / `Out-File` แก้ไฟล์ที่มีภาษาไทย** — ทำให้ตัวอักษรเพี้ยน (mojibake)
  ใช้ Edit/Write tool เท่านั้น · ถ้าต้องเขียนจากสคริปต์ ใช้
  `[System.IO.File]::WriteAllText($p, $t, (New-Object System.Text.UTF8Encoding($false)))`
- **ไฟล์ `.ps1` ที่มีภาษาไทยต้องบันทึกเป็น UTF-8 _with_ BOM** ไม่งั้น PowerShell 5.1 อ่านเป็น ANSI
  (Write tool เขียนแบบไม่มี BOM — ต้องเติม BOM เองหลังเขียน)
- **ส่ง SQL ที่มี double quote ให้ `psql -c` ผ่าน PowerShell ไม่ได้** PowerShell กิน `"` ทิ้ง
  ทำให้ `FROM "Product"` กลายเป็น `FROM Product` → error `relation "product" does not exist`
  ให้เขียน SQL เป็นไฟล์แล้วใช้ `psql -f` แทน
- **เลี่ยง `Remove-Item Env:\...`** ในคำสั่งที่มี path ของ `C:\Program Files` — sandbox อ่านผิดว่าจะลบ system path
  (shell state ไม่ข้ามคำสั่งอยู่แล้ว จึงไม่ต้องล้าง env var เอง)
- **ปิด dev server ต้องปิดทั้ง tree ไม่ใช่แค่ process ที่ฟัง port** — `tsx watch` เป็นตัวคุม
  ถ้าฆ่าแต่ลูกที่ฟัง port 4000 มันจะ **start ขึ้นมาใหม่ให้อัตโนมัติ** ทำให้เข้าใจผิดว่า backend ปิดแล้ว
  ใช้วิธีนี้: `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -like "*web003*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`
  (กรองด้วย CommandLine เพื่อไม่ไปแตะ node ของโปรแกรมอื่น) · restart ซ้ำ ๆ ทำให้มี process ค้างสะสม เคยเจอ 18 ตัว
- **`next/font/google` พังเป็นครั้งคราวด้วย `Can't resolve '@vercel/turbopack-next/internal/font/google/font'`**
  เกิดทั้งตอน dev และตอน build (เจอ 2 ครั้งตอน STEP 26) · **ไม่ใช่ปัญหาเน็ตและไม่ใช่โค้ดเรา**
  — เช็คได้ด้วย `curl https://fonts.googleapis.com/css2?family=Noto+Sans+Thai` แล้วได้ 200
  เป็น cache ของ Turbopack ที่ค้างครึ่ง ๆ กลาง ๆ · แก้ด้วย `rm -rf frontend/.next` แล้วรันใหม่
  (ถ้า build ล้มรอบแรกหลังลบ ให้ลองอีกรอบ — รอบที่สองผ่าน)
  สังเกตง่าย ๆ: import trace ชี้ไปที่ `app/layout.tsx` ซึ่งเป็นไฟล์ที่เราไม่ได้แก้
- **ฆ่า dev server กลางคันแล้ว `npm run typecheck` อาจพังด้วย error แปลก ๆ ที่ไม่ใช่โค้ดเรา**
  เช่น `.next/dev/types/routes.d.ts(69,51): error TS1011` — เป็นไฟล์ type ที่ Next สร้างเองและค้างอยู่ครึ่ง ๆ กลาง ๆ
  แก้ด้วย `rm -rf frontend/.next/dev` แล้วรันใหม่ · **อย่าไปไล่แก้โค้ดตามข้อความ error พวกนี้**
  (สังเกตง่าย ๆ: path ขึ้นต้นด้วย `.next/` = ไฟล์ที่ถูก generate ไม่ใช่ source)
- **โฟลเดอร์ใน `app/` ที่ขึ้นต้นด้วย `_` ไม่กลายเป็น route** (Next ถือเป็น private folder)
- **path ที่มี `[...]` หรือ `(...)` ต้องใช้ `-LiteralPath`** — PowerShell อ่าน `[slug]` เป็น wildcard
  `Remove-Item "app\(storefront)\product\[slug]\loading.tsx"` จะ **ไม่ลบอะไรเลยและไม่ error**
- **ทดสอบ cookie ด้วย PowerShell เชื่อไม่ได้** (เจอตอน STEP 9 — เกือบเข้าใจผิดว่าแอปพัง)
  - `Invoke-WebRequest -Headers @{ Cookie = "…" }` **ไม่ส่ง** header นั้นออกไป (PowerShell จัดการ cookie เอง)
  - `HttpClientHandler` + `CookieContainer` ทำค่า cookie เพี้ยน เพราะ `Set-Cookie` มี comma ใน `Expires`
  - วิธีที่ใช้ได้: `HttpClientHandler` ที่ตั้ง `UseCookies = $false` แล้วส่ง header `Cookie` เองจากค่า
    `Set-Cookie` ที่ตัดเอาเฉพาะส่วนหน้า `;` (หรือใช้ `WebRequestSession` ให้ PowerShell จัดการทั้งหมด)
- **git ติดตั้งแล้ว** (2.55.0.3 ผ่าน winget) ที่ `C:\Program Files\Git\cmd` — แต่ **ไม่อยู่ใน PATH
  ของ shell ที่ Claude ใช้** ต้องเติมเองทุกคำสั่ง: `$env:Path = "$env:Path;C:\Program Files\Git\cmd"`
- **Claude push เองไม่ได้ถ้า credential หมดอายุ** — Git Credential Manager ต้องมี terminal
  จริง ๆ แต่ shell ของ Claude เป็น non-interactive → ขึ้น
  `fatal: Cannot prompt because user interactivity has been disabled`
  วิธีที่ใช้ได้ (ทำสำเร็จตอน push ครั้งแรก): บังคับให้ GCM เปิดเบราว์เซอร์แล้วให้ผู้ใช้กด Authorize
  ```powershell
  $env:GIT_TERMINAL_PROMPT = "1"; $env:GCM_INTERACTIVE = "always"; $env:GCM_GUI_PROMPT = "1"
  git -c credential.interactive=true -c credential.guiPrompt=true -c credential.gitHubAuthModes=browser push
  ```
  รันเป็น background task แล้วบอกผู้ใช้ให้มองหาหน้าต่างเบราว์เซอร์ (ชื่อ "ยืนยันการเข้าถึง")
  ปกติ credential ถูกเก็บไว้แล้ว `git push` เฉย ๆ จึงผ่านเลย
- **`.gitattributes` บังคับ `eol=lf` ทั้งโปรเจกต์** เพราะ Git for Windows ตั้ง `autocrlf=true`
  ซึ่งจะแปลงไฟล์เป็น CRLF ตอน checkout แล้ว `prettier --check` ล้มในเครื่องอื่น
  (`*.ps1` ยกเว้นเป็น CRLF เพราะ PowerShell 5.1)
- npm 11 บล็อก install script โดยค่าเริ่มต้น (prisma, esbuild ฯลฯ) — ตรวจแล้วว่าไม่กระทบ
  เพราะ `schema-engine-windows.exe` และ `@esbuild/win32-x64` ถูกติดตั้งมาแล้ว
- เลี่ยง `2>&1` กับ native exe ใน PowerShell 5.1 — จะขึ้น `NativeCommandError` ทั้งที่ exit code เป็น 0
