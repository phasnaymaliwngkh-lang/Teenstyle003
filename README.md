<div align="center">

# TEENSTYLE AI ✧

**Find your style, be you 💜**

ร้านค้าออนไลน์แฟชั่นวัยรุ่นแบบ Full Stack ที่รวม E-Commerce ครบวงจรเข้ากับผู้ช่วย AI

[![Next.js](https://img.shields.io/badge/Next.js-16.3.5-black)](https://nextjs.org)
[![Express](https://img.shields.io/badge/Express-5.2.1-lightgrey)](https://expressjs.com)
[![Prisma](https://img.shields.io/badge/Prisma-7.10.0-2D3748)](https://prisma.io)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-17-336791)](https://postgresql.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)](https://typescriptlang.org)

</div>

---

## สถานะโปรเจกต์

**STEP 1 — Project Structure ✅ เสร็จแล้ว**
ดูความคืบหน้าทั้ง 55 ขั้นตอนที่ [docs/02-step-progress.md](docs/02-step-progress.md)

## เริ่มใช้งานใน 2 คำสั่ง

```powershell
npm install
npm run dev
```

เปิด <http://localhost:3000> — จะเห็นหน้าตรวจสถานะระบบที่เชื่อมต่อ backend จริง

> STEP 1 ยังไม่ต้องมีไฟล์ `.env` และไม่ต้องมี PostgreSQL
> เพราะ backend มีค่า default ครบ และ endpoint ที่ใช้ database จะเริ่มมีใน STEP 2

| Service      | URL                            |
| ------------ | ------------------------------ |
| Frontend     | <http://localhost:3000>        |
| Backend API  | <http://localhost:4000>        |
| Health check | <http://localhost:4000/health> |
| API index    | <http://localhost:4000/api>    |

## Tech Stack

**Frontend** — Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui-ready · Framer Motion · React Hook Form · Zod · Zustand
**Backend** — Node.js · Express 5 · TypeScript (ESM) · Zod · Helmet · CORS · express-rate-limit · pino
**Database** — PostgreSQL 17 · Prisma 7 (driver adapter `@prisma/adapter-pg`)
**จะเพิ่มตาม STEP** — Auth.js + Google OAuth (3) · OpenAI (19) · Redis + BullMQ (34, 52) · Cloudinary (47) · Stripe/PromptPay (11)

## โครงสร้าง

```
web003/                     ← monorepo root (npm workspaces)
├── frontend/               Next.js — หน้าร้าน + Admin Dashboard        :3000
├── backend/                Express — REST API (ชั้นเดียวที่แตะ DB/secret) :4000
├── database/               @teenstyle/database — Prisma schema/migration/seed
├── docker/                 Dockerfile ของ frontend + backend
├── docs/                   📚 เอกสารทั้งหมด
├── docker-compose.yml      postgres · redis · backend · frontend
├── .env.example
└── index.html style.css script.js assets/   ← Landing Page prototype เก่า (ไม่ถูก build)
```

> ไฟล์ `index.html` / `style.css` / `script.js` ที่ root คือ prototype สตัติกจากงานก่อนหน้า
> เก็บไว้เป็นอ้างอิงด้านดีไซน์เท่านั้น ไม่ใช่ส่วนหนึ่งของแอปจริง

## คำสั่งทั้งหมด

| คำสั่ง                                              | ทำอะไร                                                               |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| `npm run dev`                                       | `db:sync` + เปิด backend และ frontend พร้อมกัน                       |
| `npm run build`                                     | `db:sync` → `tsc` backend → `next build`                             |
| `npm start`                                         | รันเวอร์ชัน production ในเครื่อง                                     |
| `npm run typecheck`                                 | `tsc` ทั้ง 3 workspace                                               |
| `npm run lint`                                      | ESLint backend + frontend                                            |
| `npm test`                                          | vitest ของ backend                                                   |
| `npm run format`                                    | Prettier                                                             |
| `npm run db:sync`                                   | `prisma generate` + build `database` — **รันทุกครั้งหลังแก้ schema** |
| `npm run db:migrate`                                | `prisma migrate dev` (ต้องมี Postgres)                               |
| `npm run db:seed` / `db:studio` / `db:reset`        | seed / Prisma Studio / ล้างและสร้างใหม่                              |
| `npm run docker:up:infra`                           | เปิดแค่ Postgres + Redis (แนะนำตอน dev)                              |
| `npm run docker:up` / `docker:down` / `docker:logs` | จัดการทั้งระบบใน container                                           |
| `npm run docker:config`                             | validate compose โดยไม่ต้องเปิด Docker Desktop                       |

## เอกสาร

| ไฟล์                                                           | เนื้อหา                                              |
| -------------------------------------------------------------- | ---------------------------------------------------- |
| [docs/00-project-overview.md](docs/00-project-overview.md)     | ภาพรวมและกติกาของโปรเจกต์                            |
| [docs/01-architecture.md](docs/01-architecture.md)             | สถาปัตยกรรม, การไหลของ request, เหตุผลของการตัดสินใจ |
| [docs/02-step-progress.md](docs/02-step-progress.md)           | สถานะ STEP 1–55                                      |
| [docs/03-environment.md](docs/03-environment.md)               | environment variable ทุกตัว + วิธีขอค่า              |
| [docs/04-google-oauth-setup.md](docs/04-google-oauth-setup.md) | ตั้งค่า Google OAuth (ต้องทำก่อน STEP 3)             |
| [docs/05-run-and-test.md](docs/05-run-and-test.md)             | วิธีรัน, ทดสอบ, checklist ใน Chrome                  |
| [docs/06-deployment.md](docs/06-deployment.md)                 | นำขึ้น production + checklist                        |
| [database/README.md](database/README.md)                       | Prisma 7 — สิ่งที่ต่างจาก Prisma 6                   |
| [CLAUDE.md](CLAUDE.md)                                         | convention และกฎสำหรับคนที่เขียนโค้ดต่อ              |

## ⚠️ Prisma 7 ต่างจาก tutorial ส่วนใหญ่

Prisma 7 ย้าย `DATABASE_URL` ออกจาก `schema.prisma` ไปที่ `database/prisma.config.ts`,
บังคับใช้ driver adapter และ generate client เป็น **TypeScript source**
ถ้าทำตาม tutorial ของ Prisma 6 จะพังทันที — อ่าน [database/README.md](database/README.md) ก่อนแก้ database

## ⚠️ Next 16 breaking changes

Turbopack เป็น default · `params`/`searchParams`/`cookies()`/`headers()` ต้อง `await` ·
**`middleware.ts` → `proxy.ts`** · `next lint` ถูกถอด · `next.config` ไม่มี key `eslint`
เอกสารฉบับเต็มอยู่ใน `node_modules/next/dist/docs/`

## หมายเหตุสำหรับเครื่องนี้

- **ยังไม่มี Git** — `git init` / commit ทำไม่ได้จนติดตั้ง (`winget install Git.Git`)
- Docker ติดตั้งแล้ว แต่ต้องเปิด Docker Desktop ก่อนใช้ `docker compose up`

---

<div align="center">

© 2026 TEENSTYLE AI · Find your style, be you 💜

</div>
