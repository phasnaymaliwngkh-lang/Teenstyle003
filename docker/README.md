# docker

Docker configuration ของ TEENSTYLE AI (STEP 35)

```
docker/
├── backend.Dockerfile    Express 5 + Prisma 7 (multi-stage: deps → builder → runner)
└── frontend.Dockerfile   Next.js (multi-stage)
```

[docker-compose.yml](../docker-compose.yml) อยู่ที่ root ของ repo

## คำสั่งที่ใช้บ่อย

```bash
# ตรวจไฟล์ compose ว่าถูกต้อง (ไม่ต้องเปิด Docker Desktop)
docker compose config

# ⭐ แนะนำตอน dev: เปิดแค่ Postgres + Redis แล้วรัน frontend/backend บนเครื่อง
docker compose up -d postgres redis
npm run dev

# เปิดทั้งระบบใน container
docker compose up -d --build

docker compose ps            # ดูสถานะ
docker compose logs -f       # ดู log ทั้งหมด
docker compose logs -f backend
docker compose down          # ปิด (ข้อมูลยังอยู่)
docker compose down -v       # ปิด + ลบข้อมูลใน volume ทั้งหมด
```

## หมายเหตุสำคัญ

- **build context คือ root ของ repo** ไม่ใช่โฟลเดอร์นี้ เพราะเป็น npm workspaces
  จึงต้องคัดลอก `package.json` ของทุก workspace เข้าไปก่อน `npm ci`
- **`NEXT_PUBLIC_*` ต้องส่งเป็น build arg** ไม่ใช่ runtime env เพราะ Next ฝังค่านี้ลง bundle
  ถ้าเปลี่ยนค่าต้อง build image ใหม่
- **backend ต้อง generate + build Prisma ก่อน** เพราะ Prisma 7 สร้าง client เป็น TypeScript
  ลำดับใน Dockerfile คือ `prisma generate` → `tsc (database)` → `tsc (backend)`
- container รันด้วย user `node` ไม่ใช่ root
- `DATABASE_URL` ใน compose ใช้ host ว่า `postgres` (ชื่อ service) ไม่ใช่ `localhost`
  เพราะอยู่ใน network เดียวกัน
