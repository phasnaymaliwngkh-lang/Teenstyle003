# migrations

โฟลเดอร์นี้เก็บ migration ที่ Prisma สร้าง ตั้งค่าไว้ที่ `migrations.path` ใน [../prisma.config.ts](../prisma.config.ts)

- **STEP 1:** ยังว่าง เพราะ `schema.prisma` ยังไม่มี model
- **STEP 2:** `npm run db:migrate` จะสร้างโฟลเดอร์ `<timestamp>_init/migration.sql` ที่นี่

⚠️ ห้ามแก้ไฟล์ `migration.sql` ที่ apply กับฐานข้อมูลไปแล้วด้วยมือ — ให้สร้าง migration ใหม่แทน
และต้อง commit ทุก migration เข้า repo เพื่อให้ทุก environment มีสถานะฐานข้อมูลตรงกัน
