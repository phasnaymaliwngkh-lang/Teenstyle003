# CLAUDE.md — TEENSTYLE AI

> **Find your style, be you 💜**
> Full Stack Fashion E-Commerce สำหรับวัยรุ่น — Next.js + Express + PostgreSQL + Prisma + OpenAI

โปรเจกต์นี้เดินตาม **Master Prompt STEP 1–55** ทำทีละ STEP แล้วหยุดรอคำสั่งถัดไป
สถานะปัจจุบัน: **STEP 1–19 เสร็จแล้ว** — ครบวงจรทั้งฝั่งลูกค้าและร้าน:
หน้าร้าน → ตะกร้า → checkout → ชำระเงิน (COD จริง · Stripe รอใส่ key) → ติดตามคำสั่งซื้อ
→ **หลังบ้าน: ภาพรวมร้าน + จัดการคำสั่งซื้อ + จัดการสินค้า + คลังสินค้า + แจ้งเตือนสต็อก + บาร์โค้ด/QR + นำเข้า/ส่งออก (CSV, Excel)**
→ **AI: AI Stylist ผู้ช่วยเลือกชุดและสไตล์ส่วนบุคคล (OpenAI GPT-4o-mini Tool Calling + Intelligent Catalog Matcher)**
→ ดู [docs/02-step-progress.md](docs/02-step-progress.md)

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
npm test                 # vitest ของ backend

npm run db:sync          # prisma generate + build database (รันหลังแก้ schema ทุกครั้ง)
npm run db:migrate       # prisma migrate dev (ต้องมี Postgres รันอยู่)
npm run db:seed
npm run db:studio

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
│   ├── ai-stylist          ผู้ช่วยเลือกชุดและสไตล์ (STEP 19)
│   ├── about wishlist search   ← placeholder (ComingSoon)
│   └── account forbidden unauthorized
├── admin/
│   ├── layout.tsx          แถบ admin + requireStaff() ป้องกันทุกหน้าใต้ /admin
│   ├── page.tsx            ภาพรวมร้าน (STEP 13)
│   ├── orders/ orders/[orderNumber]/   จัดการคำสั่งซื้อ (STEP 13)
│   ├── products/ products/new/ products/[productId]/   จัดการสินค้า (STEP 14)
│   ├── inventory/ inventory/movements/ inventory/[variantId]/   คลังสินค้า (STEP 15)
│   ├── alerts/             แจ้งเตือนสต็อก (STEP 16)
│   ├── barcodes/ barcodes/labels/   สแกนบาร์โค้ด + พิมพ์ป้าย (STEP 17)
│   └── import-export/      นำเข้าและส่งออกสินค้า/สต็อก/คำสั่งซื้อ (STEP 18)
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
12. **Accessibility:** focus ring มองเห็นได้, ปุ่มไอคอนต้องมี `aria-label`, ทุก form ต้องมี label,
    `aria-live` สำหรับเนื้อหาที่เปลี่ยนเอง, เคารพ `prefers-reduced-motion`
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
