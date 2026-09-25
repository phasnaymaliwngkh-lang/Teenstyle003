# 00 — Project Overview

## TEENSTYLE AI

> Find your style, be you 💜

ร้านค้าออนไลน์แฟชั่นสำหรับวัยรุ่นแบบ Full Stack ที่รวมระบบ E-Commerce ครบวงจรเข้ากับผู้ช่วย AI

## กลุ่มเป้าหมาย

วัยรุ่นและคนรุ่นใหม่ที่สนใจแฟชั่น และต้องการค้นหาสไตล์ของตัวเองผ่านระบบออนไลน์

## ระบบที่ประกอบกันเป็น TEENSTYLE AI

| กลุ่ม        | ระบบ                                                                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Customer** | Home, Shop, Product Detail, Looks, Search, Cart, Checkout, Payment, Order Tracking, Wishlist, Review, Return/Refund, Account, Loyalty                                  |
| **Admin**    | Dashboard, Products, Inventory, Stock Alert, Barcode/QR, Orders, Payments, Shipping, Customers, Coupons, Promotions, Reviews, Returns, Analytics, Logs, Store Settings |
| **AI**       | AI Stylist, AI Customer Service, AI Recommendation, AI Knowledge Base                                                                                                  |
| **Platform** | Auth + Google OAuth, RBAC, REST API, Redis Cache, Background Jobs, Notification, Backup, Monitoring, Security, SEO, Accessibility                                      |

## กติกาสำคัญของโปรเจกต์ (สรุปจาก UNIVERSAL DEVELOPMENT RULES)

1. **ใช้ฐานข้อมูลจริงเท่านั้น** — ห้ามใช้ mock data แทนระบบจริง
2. **AI ห้ามแต่งข้อมูล** Product / Price / Stock / SKU / Order / Policy — ต้องดึงจาก backend เสมอ
3. **Stock ห้ามติดลบ** — ทุก operation ต้องใช้ database transaction และกัน race condition
4. **ราคาและ stock เชื่อฝั่ง server เท่านั้น** — ห้ามเชื่อค่าที่ client ส่งมา
5. **Payment ต้องกัน duplicate** และ webhook ต้องมี idempotency
6. **ห้าม hard-code secret** — ทุกค่าอยู่ใน environment variable
7. **TypeScript strict** ทุก workspace
8. **ทุกหน้า async ต้องมี** loading / empty / error / retry state
9. **ทุกหน้าต้อง responsive** และไม่มี horizontal overflow
10. **ห้ามเก็บ raw card data**

## เอกสารอื่น

| ไฟล์                                                 | เนื้อหา                                     |
| ---------------------------------------------------- | ------------------------------------------- |
| [01-architecture.md](01-architecture.md)             | สถาปัตยกรรม, tech stack, การไหลของข้อมูล    |
| [02-step-progress.md](02-step-progress.md)           | สถานะ STEP 1–55                             |
| [03-environment.md](03-environment.md)               | environment variable ทุกตัวและวิธีขอค่า     |
| [04-google-oauth-setup.md](04-google-oauth-setup.md) | ตั้งค่า Google OAuth (ต้องทำเองก่อน STEP 3) |
| [05-run-and-test.md](05-run-and-test.md)             | วิธีรันและทดสอบ                             |
| [06-deployment.md](06-deployment.md)                 | นำขึ้น production                           |
| [07-payment-setup.md](07-payment-setup.md)           | ตั้งค่า Stripe และบัตรทดสอบ                 |
| [08-security.md](08-security.md)                     | ด่านความปลอดภัยและความเสี่ยงที่ยอมรับไว้    |
| [09-api-reference.md](09-api-reference.md)           | REST API ทุกเส้นทาง สิทธิ์ และข้อตกลงร่วม   |
