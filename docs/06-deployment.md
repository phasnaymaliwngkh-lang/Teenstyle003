# 06 — Deployment

> รายละเอียดเต็มจะถูกทำจริงใน **STEP 38** ไฟล์นี้คือแผนและ checklist ที่ยึดไว้ตั้งแต่ STEP 1
> เพื่อไม่ให้เขียนโค้ดที่ deploy ไม่ได้

## สถาปัตยกรรมตอน production

| ส่วน               | บริการที่แนะนำ       | ทางเลือก                                    |
| ------------------ | -------------------- | ------------------------------------------- |
| Frontend (Next.js) | **Vercel**           | Netlify, Cloudflare Pages, self-host Docker |
| Backend (Express)  | **Railway** / Render | VPS + Docker, Fly.io                        |
| PostgreSQL         | **Neon** / Supabase  | Railway Postgres, RDS                       |
| Redis              | **Upstash**          | Redis Cloud, Railway                        |
| รูปภาพ             | **Cloudinary**       | S3 + CloudFront                             |

เหตุผลที่แยก frontend/backend: Vercel เหมาะกับ Next.js แต่ไม่เหมาะกับ long-running process
(background job, webhook worker, connection pool) ซึ่งเป็นงานของ backend

## ลำดับการ deploy

### 1. Database

1. สร้าง PostgreSQL instance แล้วคัดลอก connection string
2. ตั้ง `DATABASE_URL` บน backend host
3. รัน migration (**ห้ามใช้ `migrate dev` บน production**)

```bash
npm run db:generate
npm run db:build
npm run db:migrate:deploy
```

### 2. Backend

1. ตั้ง environment variable ทุกตัวจาก [03-environment.md](03-environment.md)
   → `NODE_ENV=production`, `CORS_ORIGIN=https://<frontend-domain>`
2. Build command: `npm install && npm run db:sync && npm run build:backend`
3. Start command: `npm run start:backend` (หรือ `node backend/dist/server.js`)
4. Health check path: `/health` — คืน 503 เมื่อ dependency ล่ม จึงใช้กับ load balancer ได้เลย
5. ถ้า deploy ด้วย Docker: `docker/backend.Dockerfile` (multi-stage, non-root, มี HEALTHCHECK)

### 3. Frontend

1. Root directory: `frontend` (หรือใช้ build ที่ root ผ่าน workspace)
2. Build command: `npm run build:frontend`
3. Environment variable:
   - `NEXT_PUBLIC_API_URL=https://<backend-domain>` ← **ต้องตั้งก่อน build** เพราะถูกฝังลง bundle
   - `NEXT_PUBLIC_SITE_URL=https://<frontend-domain>`
   - `AUTH_SECRET`, `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### 4. ค่าที่ต้องตั้งกับบริการภายนอก

| ที่                  | สิ่งที่ต้องทำ                                                           |
| -------------------- | ----------------------------------------------------------------------- |
| Google Cloud Console | เพิ่ม redirect URI `https://<frontend-domain>/api/auth/callback/google` |
| Payment provider     | ตั้ง webhook URL `https://<backend-domain>/api/payments/webhook`        |
| Backend              | `CORS_ORIGIN` = domain ของ frontend เท่านั้น (ห้าม `*`)                 |
| DNS / Host           | เปิด HTTPS · บังคับ redirect http → https                               |

## Checklist ก่อนขึ้น production

### Security

- [ ] ไม่มี secret ใน repo — ตรวจทั้ง history
- [ ] รหัส Postgres ไม่ใช่ค่า dev จาก `.env.example`
- [ ] `CORS_ORIGIN` เจาะจง domain ไม่ใช่ `*`
- [ ] HTTPS ทำงาน · cookie เป็น `secure` + `httpOnly` + `sameSite`
- [ ] rate limit เปิดอยู่ (STEP 28)
- [ ] error 500 ไม่ส่ง stack trace ออกไป (ทำแล้วใน `errorHandler`)
- [ ] ไม่มี raw card data ในระบบ

### Data

- [ ] `migrate:deploy` รันสำเร็จ · `migrate status` ไม่มี pending
- [ ] ตั้ง backup อัตโนมัติ + ทดสอบ restore แล้ว (STEP 50)
- [ ] มี index ครบตาม query ที่ใช้จริง (STEP 34)

### Quality

- [ ] `npm run typecheck` · `npm run lint` · `npm test` ผ่านทั้งหมด
- [ ] `npm run build` ผ่าน
- [ ] ทดสอบใน Chrome ตาม [05-run-and-test.md](05-run-and-test.md) (STEP 39)
- [ ] ไม่มี horizontal overflow ที่ 360px
- [ ] `/health` คืน 200 บน production

### Monitoring

- [ ] มี log aggregation (pino ส่ง JSON บน production อยู่แล้ว)
- [ ] มี uptime check ชี้ที่ `/health`
- [ ] มี alert เมื่อ payment / AI / job ล้ม (STEP 51)

## Rollback

1. Frontend: Vercel → Instant Rollback ไป deployment ก่อนหน้า
2. Backend: deploy image/commit ก่อนหน้า
3. Database: **migration ย้อนกลับเองไม่ได้อย่างปลอดภัย** — ต้อง restore จาก backup
   ดังนั้นห้าม deploy migration ที่ลบคอลัมน์พร้อมกับโค้ดใหม่ในครั้งเดียว
   ให้ทำแบบ 2 ขั้น: (1) เพิ่มของใหม่ + โค้ดรองรับทั้งสองแบบ → (2) ค่อยลบของเก่าในรอบถัดไป
