# src/jobs

Background job ที่รันด้วย **BullMQ + Redis** (STEP 52)

งานที่จะย้ายมาทำที่นี่ เพื่อไม่ให้ HTTP request ต้องรอ:

| Job                   | ใช้ใน STEP | หน้าที่                                   |
| --------------------- | ---------- | ----------------------------------------- |
| `email.job.ts`        | 24         | ส่งอีเมลยืนยันคำสั่งซื้อ / รีเซ็ตรหัส     |
| `notification.job.ts` | 24         | push / in-app notification                |
| `image.job.ts`        | 47         | ย่อ–บีบอัดรูป แปลงเป็น WebP/AVIF          |
| `report.job.ts`       | 26         | สร้างรายงานยอดขาย / export ไฟล์ใหญ่       |
| `ai.job.ts`           | 19–21      | งาน AI ที่ใช้เวลานาน เช่น สร้าง embedding |
| `backup.job.ts`       | 50         | backup ฐานข้อมูลตามตาราง                  |

ทุก job ต้องมี: **retry**, บันทึก **failed job**, ดู **job status** ได้, และ **ป้องกัน duplicate job**
(ใช้ `jobId` ที่คงที่ต่อหนึ่งงาน เพื่อให้ enqueue ซ้ำไม่เกิดงานซ้ำ)

ยังไม่ติดตั้ง `bullmq` / `ioredis` ใน STEP 1 — จะติดตั้งตอนทำ STEP 52
