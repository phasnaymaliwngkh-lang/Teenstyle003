# 03 — Environment Variables

## ไฟล์ที่เกี่ยวข้อง

| ไฟล์                          | ใช้โดย                                     | commit ได้ไหม         |
| ----------------------------- | ------------------------------------------ | --------------------- |
| `.env.example`                | เทมเพลตของทุกค่า                           | ✅ ได้ (ไม่มีค่าจริง) |
| `.env`                        | backend, database (Prisma), docker compose | ❌ ห้าม               |
| `frontend/.env.local.example` | เทมเพลตของ frontend                        | ✅ ได้                |
| `frontend/.env.local`         | Next.js                                    | ❌ ห้าม               |
| `backend/.env`                | override เฉพาะ backend (ไม่จำเป็น)         | ❌ ห้าม               |

## ลำดับความสำคัญ

```
process.env (shell / Docker)  >  backend/.env  >  <root>/.env
```

โหลดโดย [backend/src/config/env.ts](../backend/src/config/env.ts) และ
[database/prisma.config.ts](../database/prisma.config.ts) — dotenv จะไม่ override ค่าที่มีอยู่แล้ว

## backend ตรวจ env ด้วย Zod ตอน boot

ถ้าค่าผิดรูปแบบ backend **จะไม่ start** และบอกชื่อตัวแปรที่ผิดทันที (fail fast)
ค่าที่มี default จะใช้ default ได้ถ้าไม่ตั้ง — **STEP 1 จึงรันได้โดยไม่ต้องมีไฟล์ `.env` เลย**

## ตารางตัวแปรทั้งหมด

### Core

| ตัวแปร                 | Default                 | จำเป็นเมื่อ | หมายเหตุ                                |
| ---------------------- | ----------------------- | ----------- | --------------------------------------- |
| `NODE_ENV`             | `development`           | —           | `development` \| `test` \| `production` |
| `BACKEND_PORT`         | `4000`                  | —           |                                         |
| `BACKEND_URL`          | `http://localhost:4000` | —           | ใช้ใน log                               |
| `FRONTEND_URL`         | `http://localhost:3000` | —           |                                         |
| `CORS_ORIGIN`          | `http://localhost:3000` | production  | หลาย origin คั่นด้วย comma              |
| `LOG_LEVEL`            | `info`                  | —           | `fatal`…`trace`                         |
| `RATE_LIMIT_WINDOW_MS` | `900000`                | —           | 15 นาที                                 |
| `RATE_LIMIT_MAX`       | `300`                   | —           | ต่อ window                              |
| `TZ`                   | `Asia/Bangkok`          | —           | ใช้ใน Docker                            |

### Database (STEP 2)

| ตัวแปร                                                                  | จำเป็นเมื่อ       | วิธีได้มา                                                                   |
| ----------------------------------------------------------------------- | ----------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`                                                          | **STEP 2 ขึ้นไป** | ใช้ Docker: ค่าใน `.env.example` ใช้ได้เลย · หรือ Neon / Supabase / Railway |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | ใช้ Docker        | docker compose อ่านไปสร้าง container                                        |

รูปแบบ: `postgresql://USER:PASSWORD@HOST:PORT/DATABASE?schema=public`
ใน Docker ต้องใช้ host ว่า `postgres` (ชื่อ service) ไม่ใช่ `localhost`

### Redis (STEP 34 cache, STEP 52 BullMQ)

| ตัวแปร       | จำเป็นเมื่อ                                         |
| ------------ | --------------------------------------------------- |
| `REDIS_URL`  | STEP 34 / 52 · ใช้ Docker: `redis://localhost:6379` |
| `REDIS_PORT` | ใช้ Docker                                          |

### Authentication (STEP 3)

| ตัวแปร                 | วิธีได้มา                                                                   |
| ---------------------- | --------------------------------------------------------------------------- |
| `AUTH_SECRET`          | `npx auth secret` (หรือ `openssl rand -base64 32`)                          |
| `AUTH_URL`             | URL ของ frontend เช่น `http://localhost:3000`                               |
| `GOOGLE_CLIENT_ID`     | Google Cloud Console → [04-google-oauth-setup.md](04-google-oauth-setup.md) |
| `GOOGLE_CLIENT_SECRET` | เหมือนกัน                                                                   |
| `BACKEND_JWT_SECRET`   | สุ่มเอง — ใช้ให้ backend ตรวจ session ที่ออกจาก frontend                    |

### AI (STEP 19–21, 45–46)

| ตัวแปร           | วิธีได้มา                                                              |
| ---------------- | ---------------------------------------------------------------------- |
| `OPENAI_API_KEY` | <https://platform.openai.com/api-keys> — **เรียกจาก backend เท่านั้น** |
| `OPENAI_MODEL`   | default `gpt-4o-mini`                                                  |

### Image Storage (STEP 47)

`CLOUDINARY_CLOUD_NAME` · `CLOUDINARY_API_KEY` · `CLOUDINARY_API_SECRET`
→ Cloudinary Dashboard (แผนฟรีพอสำหรับ dev)

### Payment (STEP 11)

| ตัวแปร                                        | หมายเหตุ                          |
| --------------------------------------------- | --------------------------------- |
| `PAYMENT_SECRET` / `PAYMENT_WEBHOOK_SECRET`   | ของ provider ที่เลือกใช้          |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Stripe Dashboard (test mode ก่อน) |
| `PROMPTPAY_ID`                                | เบอร์/เลขประจำตัวที่ผูกพร้อมเพย์  |

ยังไม่มี key ก็พัฒนาต่อได้ — STEP 11 จะสร้างเป็น Payment **architecture** ที่ต่อ provider จริงได้ภายหลัง
แต่จะไม่ทำหน้าชำระเงินปลอมแล้วอ้างว่าเป็นของจริง

### Email (STEP 24)

`SMTP_HOST` · `SMTP_PORT` · `SMTP_USER` · `SMTP_PASSWORD` · `MAIL_FROM`

### Frontend (`frontend/.env.local`)

| ตัวแปร                                         | Default                 | หมายเหตุ                                            |
| ---------------------------------------------- | ----------------------- | --------------------------------------------------- |
| `NEXT_PUBLIC_API_URL`                          | `http://localhost:4000` | ⚠️ ฝังลง bundle                                     |
| `NEXT_PUBLIC_SITE_NAME`                        | `TeenStyle`             | ⚠️ ฝังลง bundle                                     |
| `NEXT_PUBLIC_SITE_URL`                         | `http://localhost:3000` | ⚠️ ฝังลง bundle                                     |
| `AUTH_SECRET` / `AUTH_URL` / `GOOGLE_CLIENT_*` | —                       | secret ฝั่ง server ของ Next (ไม่ใช่ `NEXT_PUBLIC_`) |

## 🔒 กฎความปลอดภัย

1. **`NEXT_PUBLIC_*` ใส่ secret ไม่ได้เด็ดขาด** — ค่าถูกฝังลง JavaScript ที่ส่งไปเบราว์เซอร์
2. `DATABASE_URL`, `OPENAI_API_KEY`, `*_SECRET` **อยู่ฝั่ง backend เท่านั้น**
3. `.env` และ `.env.local` อยู่ใน `.gitignore` แล้ว — ถ้าเผลอ commit ให้ rotate ค่านั้นทันที
4. production ต้องเปลี่ยนรหัส Postgres จากค่า dev ใน `.env.example` ทุกครั้ง
5. ค่าที่เปลี่ยนใน `NEXT_PUBLIC_*` ต้อง **build frontend ใหม่** ถึงมีผล
