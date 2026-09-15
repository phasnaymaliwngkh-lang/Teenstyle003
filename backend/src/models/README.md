# src/models

Domain type และ mapper ที่อยู่ระหว่าง Prisma model กับ response ของ API

**ทำไมต้องมีชั้นนี้:** Prisma model คือรูปร่างในฐานข้อมูล ไม่ใช่รูปร่างที่ควรส่งออก API
ชั้นนี้ทำหน้าที่ "เลือกเฉพาะ field ที่ปลอดภัยจะส่งออก" เช่น ไม่ส่ง `passwordHash`, `deletedAt`
และแปลง `Decimal` เป็น number ให้ frontend ใช้ได้ตรง ๆ

- **STEP 2:** สร้างหลังจากมี Prisma model แล้ว
- ไฟล์ที่จะมี เช่น `product.model.ts`, `order.model.ts`, `user.model.ts`

Prisma type ทั้งหมด import ได้จาก `@teenstyle/database`
