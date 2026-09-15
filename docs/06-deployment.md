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
2. ตั้ง `DATABASE_URL` บน host (**ห้ามใช้ `migrate dev` บน production**)
3. **migration รันเองตอน deploy** ผ่าน `deploy.preDeployCommand` ใน [railway.json](../railway.json)
   → ทุกครั้งที่ deploy Railway จะรัน `db:migrate:deploy` ให้ก่อนเริ่มเวอร์ชันใหม่

**Neon: ใช้ connection string คนละแบบตามผู้ใช้**

| ที่ใช้                    | แบบ                          | เพราะ                                                                                                        |
| ------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Railway (backend)         | **สายตรง** (ไม่มี `-pooler`) | เป็น process ที่รันยาวและถือ pool ของตัวเองอยู่แล้ว · migration ต้องใช้ session lock ที่ pgBouncer ไม่รองรับ |
| Vercel (frontend/Auth.js) | **pooled** (`-pooler`)       | serverless เปิด connection ใหม่เยอะ ต้องให้ pooler คุมจำนวน                                                  |

### ⚠️ ถ้ารัน migration จากเครื่อง dev ไม่ได้ (P1001)

เจอจริงบนเครื่องพัฒนาเครื่องนี้: DNS resolve โฮสต์ของ Neon ได้**เฉพาะ IPv6**

| เครื่องมือ                           | ผล                                   |
| ------------------------------------ | ------------------------------------ |
| `pg` / Prisma Client (Node)          | ต่อได้ปกติ                           |
| Prisma **CLI** (`migrate`, `studio`) | `P1001: Can't reach database server` |

engine ของ Prisma CLI เป็น Rust binary แยกตัวและใช้ IPv6 บนเครื่องนี้ไม่ได้ —
**ลองแล้วไม่ผ่านทั้งหมด:** สายตรง · สาย pooled · ปิด sandbox · วิธีแก้ SNI ของ Neon (`options=endpoint%3D…`)

→ อย่าเสียเวลาแก้ที่เครื่อง **ให้ migration รันจาก Railway** ตามข้อ 3 (ถูกต้องกว่าอยู่แล้ว)
ส่วน **seed รันจากเครื่อง dev ได้** เพราะไปผ่าน Prisma Client (Node) ไม่ใช่ CLI engine

### 2. Backend

1. ตั้ง environment variable ทุกตัวจาก [03-environment.md](03-environment.md)
   → `NODE_ENV=production`, `CORS_ORIGIN=https://<frontend-domain>`
2. Build command: `npm install && npm run db:sync && npm run build:backend`
3. Start command: `npm run start:backend` (หรือ `node backend/dist/server.js`)
4. Health check path: `/health` — คืน 503 เมื่อ dependency ล่ม จึงใช้กับ load balancer ได้เลย
5. ถ้า deploy ด้วย Docker: `docker/backend.Dockerfile` (multi-stage, non-root, มี HEALTHCHECK)

**พอร์ต — ไม่ต้องตั้งเอง** Railway / Render / Fly.io / Cloud Run ฉีด `PORT` มาให้
และโค้ดให้ `PORT` **ชนะ** `BACKEND_PORT` เสมอ ([config/env.ts](../backend/src/config/env.ts) → `listenPort`)
พร้อม log `portSource` บอกว่าใช้ค่าจากไหน

> ถ้าไม่มีกลไกนี้ process จะ listen 4000 ขณะที่โฮสต์ route มาที่ `$PORT`
> → health check ล้ม deploy ถูกมาร์กว่าพัง **ทั้งที่ log บอกว่า server เริ่มแล้ว** (หาสาเหตุยากมาก)

### 3. Frontend

1. Root directory: `frontend` (หรือใช้ build ที่ root ผ่าน workspace)
2. Build command: `npm run build:frontend`
3. Environment variable:
   - `NEXT_PUBLIC_API_URL=https://<backend-domain>` ← **ต้องตั้งก่อน build** เพราะถูกฝังลง bundle
   - **`NEXT_PUBLIC_API_PROXY_PATH=/backend`** ← **ห้ามลืม** อ่านเหตุผลที่หัวข้อถัดไป
   - `NEXT_PUBLIC_SITE_URL=https://<frontend-domain>`
   - `AUTH_SECRET`, `AUTH_URL`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`

### ⚠️ 3.1 cookie ข้ามโดเมน — เรื่องที่ทำงานได้บน dev แต่พังบน production

**อาการถ้าพลาด:** เว็บเปิดได้ หน้าตาปกติ แต่ **เพิ่มลงตะกร้าไม่ได้ · สั่งซื้อไม่ได้ · จ่ายเงินไม่ได้ ·
หลังบ้านแก้ข้อมูลอะไรไม่ได้เลย** (ทุกคำขอได้ 401) และหา error ไม่เจอในโค้ด

**สาเหตุ:** 12 คอมโพเนนต์ยิง backend ตรงจากเบราว์เซอร์ด้วย `credentials: "include"`
ตอน dev ใช้ได้เพราะ `localhost:3000` กับ `:4000` ถือเป็นโดเมนเดียวกัน (cookie ไม่แยกตาม port)
แต่บน production ถ้าเป็น `xxx.vercel.app` กับ `yyy.railway.app` → Chrome/Safari
**บล็อก third-party cookie** ทั้ง session cookie และ `cart-token` จึงไม่ถูกส่งไปเลย

**วิธีแก้ (เลือกอย่างใดอย่างหนึ่ง)**

| สถานการณ์            | วิธี                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| **ยังไม่มีโดเมน**    | ตั้ง `NEXT_PUBLIC_API_PROXY_PATH=/backend` → เบราว์เซอร์คุยกับโดเมน frontend เท่านั้น แล้ว Next rewrite ต่อไป backend ให้ |
| **มีโดเมนของตัวเอง** | ใช้ `app.<domain>` + `api.<domain>` ซึ่งเป็น same-site อยู่แล้ว (ยังตั้ง proxy path ไว้ก็ได้ ไม่เสียหาย)                  |

กลไก: [frontend/src/lib/api.ts](../frontend/src/lib/api.ts) เลือกฐาน URL ตามที่รัน —
เบราว์เซอร์ใช้ path สัมพัทธ์ (`/backend/api/...`) ส่วน Server Component ใช้ URL เต็มยิงตรงไป backend
(เร็วกว่าและไม่ต้องอ้อม) · rewrite ประกาศใน [frontend/next.config.ts](../frontend/next.config.ts)

**ห้ามใช้ prefix `/api`** เพราะ Next เป็นเจ้าของ `/api/auth/*` (Auth.js) และ `/api/cart/merge` อยู่แล้ว
ถ้าทับกันการล็อกอินจะพัง

**ทดสอบก่อนเชื่อ** (ทำได้บนเครื่อง dev: ตั้ง `NEXT_PUBLIC_API_PROXY_PATH=/backend` แล้วรีสตาร์ต Next):

```bash
curl "http://localhost:3000/backend/api/products?limit=1"   # ต้องได้ข้อมูลสินค้า
curl "http://localhost:3000/api/auth/providers"             # ต้องยังได้ config ของ Google (ไม่ถูก proxy ทับ)
```

### 3.2 ต้องรัน seed บน production ครั้งแรก

**RBAC ทั้งหมดเก็บในฐานข้อมูล** (ตาราง `Role` ↔ `Permission`) ถ้าไม่ seed จะไม่มีบทบาทใด ๆ
→ ล็อกอินได้แต่ **เข้า `/admin` ไม่ได้แม้แต่ตัวคุณเอง**

```powershell
# รันจากเครื่อง dev ได้ (seed ไปผ่าน Prisma Client ไม่ใช่ CLI engine)
# ⚠️ ต้องรันหลัง migration เสร็จแล้ว ไม่งั้นยังไม่มีตารางให้เขียน
$env:DATABASE_URL = "<Neon connection string>"
$env:SEED_ADMIN_EMAIL = "<อีเมล Google ของคุณ>"
npm run db:seed
```

seed เขียนแบบ upsert จึงรันซ้ำได้ · จะสร้างบัญชี `SUPER_ADMIN` ให้อีเมลนั้น
และ**ไม่ใส่ชื่อ/รูปปลอม** เพื่อให้ข้อมูลจริงจาก Google เติมเข้ามาตอนล็อกอินครั้งแรก

### 3.3 งานตามกำหนดเวลายังไม่มีคนสั่งให้รัน

บน production **ยังไม่มีอะไรเรียก `expireOverdueOrders()`** → ออเดอร์ที่ลูกค้าไม่จ่าย
จะ **จองสต็อกค้างไว้ตลอดไป** ทำให้ของขายไม่ได้ทั้งที่ยังอยู่ในคลัง
(`runStockAlertScan()` ก็ตรวจเฉพาะตอนสต็อกขยับ)

ทางออกชั่วคราวก่อนถึง STEP 52: ตั้ง cron ของ host ยิง endpoint ที่มีอยู่แล้ววันละครั้ง
หรือใส่ `node-cron` ในตัว backend — **ข้อนี้ต้องแก้ก่อนเปิดร้านจริง ไม่ใช่เรื่องรอได้**

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
- [ ] **ตั้ง `NEXT_PUBLIC_API_PROXY_PATH` แล้ว** และทดสอบเพิ่มลงตะกร้า + แก้ข้อมูลหลังบ้านบน production
      ได้จริง (ดูหัวข้อ 3.1 — พลาดข้อนี้เว็บจะดูปกติแต่ใช้งานไม่ได้)
- [ ] **รัน `npm run db:seed` แล้ว** และเข้า `/admin` ได้ (ดูหัวข้อ 3.2)
- [ ] **มีคนสั่งให้ `expireOverdueOrders()` รันตามเวลาแล้ว** (ดูหัวข้อ 3.3)
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
