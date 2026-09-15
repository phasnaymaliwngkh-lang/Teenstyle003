# 05 — Run and Test

## ต้องมีในเครื่อง

| เครื่องมือ     | เวอร์ชัน | สถานะบนเครื่องนี้                                                |
| -------------- | -------- | ---------------------------------------------------------------- |
| Node.js        | ≥ 20.9   | ✅ v24.20.0                                                      |
| npm            | ≥ 10     | ✅ 11.19.0                                                       |
| Docker Desktop | ล่าสุด   | ⚠️ 29.7.2 ติดตั้งแล้วแต่ **ใช้ไม่ได้** (ดูด้านล่าง)              |
| Git            | —        | ❌ **ยังไม่ติดตั้ง** → `winget install Git.Git`                  |
| PostgreSQL     | 18.6     | ✅ ติดตั้งในเครื่องแล้ว (service `postgresql-x64-18`, port 5432) |

### ⚠️ Docker ใช้ไม่ได้บนเครื่องนี้

เครื่องนี้เป็น **Windows Home Single Language** ซึ่งไม่มี Hyper-V → Docker Desktop ต้องใช้ WSL2
แต่ **WSL ยังไม่ได้ติดตั้ง** (`wsl --status` แจ้งว่า not installed) จึงเปิด Linux engine ไม่ได้
(`docker ps` คืน `500 Internal Server Error`)

**จึงใช้ PostgreSQL 18 ที่ติดตั้งในเครื่องแทน** — ไม่ต้องใช้ Docker เลย
`docker-compose.yml` ยังใช้ได้กับเครื่องอื่นหรือหลังติดตั้ง WSL (`wsl --install` ต้องใช้ admin + reboot)
ถ้าเปิด Docker Postgres ทีหลัง จะชนพอร์ต 5432 กับตัวที่ติดตั้งอยู่ — ต้องเปลี่ยน `POSTGRES_PORT`

## เริ่มต้นครั้งแรก

```powershell
npm install
Copy-Item .env.example .env
Copy-Item frontend\.env.local.example frontend\.env.local
```

แก้ `DATABASE_URL` ใน `.env` ให้ชี้ PostgreSQL ในเครื่อง:

```
DATABASE_URL=postgresql://postgres:<รหัสผ่าน>@localhost:5432/teenstyle?schema=public
```

> **จำรหัส postgres ไม่ได้?** รัน PowerShell แบบ Administrator แล้วสั่ง
> `powershell -ExecutionPolicy Bypass -File .\scripts\reset-pg-password.ps1`
> สคริปต์จะสุ่มรหัสใหม่ ตั้งให้ สร้าง database `teenstyle` และเขียนลง `.env` ให้เอง
> (เปิด `trust` ชั่วคราวเฉพาะ localhost แล้วคืนค่า `scram-sha-256` ใน `finally` เสมอ)

แล้วสร้างตารางกับข้อมูลตั้งต้น:

```powershell
npm run db:check           # ตรวจว่าเชื่อมต่อได้ก่อน
npm run db:migrate:deploy  # สร้าง 31 ตาราง + 32 CHECK constraints
npm run db:seed            # 12 สินค้า · 102 variant · 4 look · 3 คูปอง
```

## รัน development

```powershell
npm run dev
```

ทำ 3 อย่างตามลำดับ: `prisma generate` → build `database` → เปิด backend + frontend พร้อมกัน

| Service   | URL                            |
| --------- | ------------------------------ |
| Frontend  | <http://localhost:3000>        |
| Backend   | <http://localhost:4000>        |
| Health    | <http://localhost:4000/health> |
| API index | <http://localhost:4000/api>    |

แยกรันทีละตัวก็ได้: `npm run dev:backend` / `npm run dev:frontend`

## รัน production ในเครื่อง

```powershell
npm run build
npm start
```

## รันด้วย Docker

```powershell
npm run docker:config       # validate compose (ไม่ต้องเปิด daemon)
npm run docker:up:infra     # ⭐ แนะนำ: Postgres + Redis เท่านั้น แล้ว npm run dev
npm run docker:up           # ทั้งระบบใน container
npm run docker:logs
npm run docker:down
```

## ตรวจคุณภาพโค้ด

```powershell
npm run typecheck    # tsc ทั้ง 3 workspace
npm run lint         # eslint backend + frontend
npm test             # vitest ของ backend
npm run format       # prettier (ไม่แตะ prototype เก่าที่ root)
```

## Checklist ของ STEP 1 (ผลการตรวจจริง)

| ข้อ                         | คำสั่ง / วิธีตรวจ                                                  | ผล                        |
| --------------------------- | ------------------------------------------------------------------ | ------------------------- |
| ติดตั้ง dependency          | `npm install`                                                      | ✅ exit 0                 |
| Prisma generate             | `npm run db:generate`                                              | ✅ generate client 7.10.0 |
| TypeScript ทั้ง 3 workspace | `npm run typecheck`                                                | ✅ exit 0                 |
| Lint                        | `npm run lint`                                                     | ✅ exit 0                 |
| Test                        | `npm test`                                                         | ✅ 5/5 ผ่าน               |
| Build ทั้งระบบ              | `npm run build`                                                    | ✅ exit 0                 |
| `GET /health`               | ตอบ 200 + `success:true` + สถานะ 3 service                         | ✅                        |
| `X-Request-Id`              | มีในทุก response                                                   | ✅                        |
| `GET /api`                  | ตอบ 200 + 18 endpoints                                             | ✅                        |
| 404 shape                   | `{success:false, message, errorCode:"NOT_FOUND"}`                  | ✅                        |
| 400 JSON พัง                | `errorCode:"BAD_REQUEST"`                                          | ✅                        |
| CORS                        | `access-control-allow-origin: http://localhost:3000` + credentials | ✅                        |
| Security header (backend)   | `x-content-type-options: nosniff`, ไม่มี `x-powered-by`            | ✅                        |
| Rate limit header           | `ratelimit: "300-in-15min"` (draft-8)                              | ✅                        |
| Frontend                    | 200, HTML มี `TeenStyle` + tagline, `lang="th"`                    | ✅                        |
| Security header (frontend)  | `x-frame-options: DENY`, `permissions-policy`                      | ✅                        |
| Docker compose              | `docker compose config`                                            | ✅ valid (4 services)     |

## ที่ยังตรวจไม่ได้ใน STEP 1

- `docker compose up` จริง — ต้องเปิด Docker Desktop ก่อน (daemon ยังไม่รัน)
- การเชื่อมต่อ PostgreSQL / Redis จริง — จะทดสอบใน STEP 2 / 34
- Google OAuth — ต้องมี credential จริงก่อน (STEP 3)
- การตรวจด้วยตาบนหน้าจอ Chrome — ยืนยันได้แค่ระดับ HTTP/HTML เพราะไม่มี browser automation

## วิธีตรวจใน Google Chrome (STEP 39)

1. เปิด <http://localhost:3000>
2. `F12` → **Console** ต้องไม่มี error
3. **Network** → ต้องเห็น request ไป `localhost:4000/health` ได้ status 200
4. กดปุ่ม “ตรวจสอบอีกครั้ง” → เห็น loading แล้วกลับมาเป็นสถานะ
5. ปิด backend (`Ctrl+C`) แล้วกดปุ่มอีกครั้ง → ต้องเห็น **error state + ปุ่มลองอีกครั้ง** ไม่ใช่หน้าขาว
6. `Ctrl+Shift+M` ทดสอบขนาด 360 / 768 / 1440px → ต้องไม่มี scrollbar แนวนอน
7. กด `Tab` ไล่ทั้งหน้า → ต้องเห็นกรอบ focus สีม่วงทุกปุ่ม
