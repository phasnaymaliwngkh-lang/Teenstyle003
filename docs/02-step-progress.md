# 02 — Step Progress (STEP 1–55)

สถานะ: ✅ เสร็จ · 🚧 กำลังทำ · ⬜ ยังไม่เริ่ม

> อัปเดตไฟล์นี้ทุกครั้งที่ทำ STEP เสร็จ

**ล่าสุด: STEP 16 เสร็จ — Stock Alert (`/admin/alerts` + ป้ายแจ้งเตือนบนแถบหลังบ้าน)**
**สถานะเตือนคำนวณสดจากฐานข้อมูลทุกครั้ง** (ของกลับมาเต็ม = หายจากรายการทันที ไม่มีการเตือนค้าง) ·
แถว `Notification` ทำหน้าที่เดียวคือจำว่าเคยบอกร้านไปแล้ว → **ไม่ยิงซ้ำ · แย่ลงเตือนใหม่ ·
ดีขึ้นไม่เตือน · ของกลับมาปกติระบบปิดรายการให้เอง** · ระบบตรวจเองทุกครั้งที่สต็อกขยับ
(สั่งซื้อ/ชำระเงิน/ยกเลิก/หมดเวลา/ปรับสต็อก) ไม่ต้องรอคนกด · เตือนเฉพาะของที่ขายอยู่จริง
(ฉบับร่าง/ตัวเลือกที่ปิดขาย ไม่รบกวน) · **ของที่ถูกจองจนหมดก็เตือน** เพราะขายต่อไม่ได้จริง ·
ช่องทางอีเมลถูกปิดพร้อมบอกเหตุผล (ยังไม่ตั้งค่า SMTP) **ไม่สร้างแถวปลอมว่าส่งแล้ว** ·
test 255 เคส (เพิ่ม 20)

**STEP 15:** Inventory / Stock (`/admin/inventory`, `/movements`, `/[variantId]`)
รับของเข้า · ตัดของออก · ปรับยอดตามการตรวจนับ (กรอกยอดที่นับได้ ระบบคำนวณผลต่างเอง) ·
**ทุกการเปลี่ยนจำนวนต้องมีเหตุผลและถูกบันทึกเป็น `InventoryMovement` — ไม่มี endpoint ให้เซ็ตยอดตรง ๆ** ·
**ห้ามตัดของที่ลูกค้าจองไว้** (atomic SQL `quantity + delta >= reservedQuantity` → 409) · สต็อกไม่ติดลบ ·
กดปุ่มซ้ำไม่คูณสอง (idempotencyKey) · ประวัติ append-only ที่ก่อน/หลังต่อกันเป็นลูกโซ่ ·
**ปิดหนี้จาก STEP 7: การ์ดสินค้า · ตัวกรอง `inStock` · ตัวเลขบน dashboard เปลี่ยนมาคิดจากของที่ขายได้จริง**
(เพิ่ม [availability.ts](../backend/src/models/availability.ts) เป็นแหล่งความจริงเดียว) · test 235 เคส (เพิ่ม 29)

**STEP 14:** Product Management (`/admin/products`, `/new`, `/[productId]`)
เพิ่ม/แก้/ลบสินค้าและตัวเลือกได้จริง · **รับเข้าสต็อกครั้งแรกบันทึกเป็น `InventoryMovement` (STOCK_IN) เสมอ —
ไม่มีช่องแก้จำนวนในคลังตรง ๆ** · ลบเป็น soft delete (หน้าร้านหายทันที ประวัติคำสั่งซื้อยังอ้างอิงได้) ·
ลบไม่ได้ถ้าของถูกจองในออเดอร์ที่ยังไม่จบ (409) · slug/SKU ซ้ำ → 409 · เปิดขายต้องมีรูป + ตัวเลือกที่ใช้งาน ·
รูปรับได้เฉพาะโฮสต์ที่อนุญาต · ตัวเลือกฟอร์ม (หมวด/แบรนด์/สี/ไซซ์) มาจากฐานข้อมูล ·
กรอง "สต็อกต่ำ" คิดจากของที่ขายได้จริง (หัก reserved) · ทุกการแก้ไขเขียน AdminLog · test 206 เคส (เพิ่ม 35)

**STEP 13:** Admin Dashboard + จัดการคำสั่งซื้อ (`/admin`, `/admin/orders`)
ตัวเลขสรุปจากฐานข้อมูลจริงทั้งหมด (ไม่มีข้อมูลตัวอย่าง) · **ยอดขายนับเฉพาะเงินที่ได้รับจริง** —
COD ที่ยังไม่เก็บเงินแยกช่อง · เปลี่ยนสถานะตาม state machine (ข้ามขั้นไม่ได้) ·
ส่งของต้องกรอกเลขพัสดุจริง → สร้าง Shipment · ยกเลิกแล้วของกลับเข้าคลัง (RETURN movement) ·
ทุกการแก้ไขเขียน AdminLog · RBAC ครบ (ลูกค้า 403) · test 171 เคส (เพิ่ม 16)

**STEP 12:** Order Tracking (`/account/orders` + `/account/orders/[orderNumber]`)
ประวัติคำสั่งซื้อพร้อมกรองตามสถานะ (ตัวเลขข้างแท็บตรงกับผลกรองจริง) · แบ่งหน้า ·
**ไทม์ไลน์จาก timestamp จริง — ขั้นที่ยังไม่เกิดไม่มีเวลา (ไม่เดา)** · เลขพัสดุ/ใบจัดส่งตามที่มีจริง ·
จ่ายเงินที่ค้างต่อจากหน้านี้ได้ (ใช้แผงของ STEP 11) · เห็นเฉพาะออเดอร์ตัวเอง · test 155 เคส (เพิ่ม 11)

**STEP 11:** Payment (COD ใช้ได้จริง · Stripe รอใส่ key)
**ตัดสต็อกจริงตอนชำระเงิน** + `InventoryMovement` (กันตัดซ้ำที่ระดับฐานข้อมูล) ·
webhook ตรวจลายเซ็น Stripe ทุก event + idempotent 3 ชั้น · ยกเลิก/หมดเวลา → คืนของเข้าคลัง ·
ไม่มีปุ่มใดทำให้ "จ่ายแล้ว" ได้โดยไม่มีหลักฐานจาก provider · ไม่เก็บ raw card data · test 144 เคส (เพิ่ม 19)

**STEP 10:** Checkout (`/checkout` + `/checkout/success`)
สร้างคำสั่งซื้อจริงจากตะกร้า · ยอดทุกบาทคำนวณที่ server · **จองสต็อกแบบ atomic (ไม่ตัดสต็อก)** ·
กัน oversell แม้สั่งพร้อมกัน (ทดสอบแล้ว: แย่งชิ้นสุดท้าย สำเร็จรายเดียว) · กันออเดอร์ซ้ำด้วย `idempotencyKey` ·
snapshot สินค้า/ราคา/ที่อยู่ลงออเดอร์ · ค่าจัดส่ง 4 แบบจากกฎเดียวกับที่คิดเงิน · test 125 เคส (เพิ่ม 26)

**STEP 9:** Cart (guest + รวมตะกร้าตอนล็อกอิน)
ตาราง `Cart`/`CartItem` + 5 CHECK constraint ใหม่ · ตะกร้าใช้ได้ทั้งแบบ guest (cookie httpOnly) และแบบล็อกอิน ·
เพิ่ม/ลบ/แก้จำนวน/ติ๊กเลือกรายการ · ยอดทุกบาทคำนวณที่ server · ห้ามเกินสต็อก (409) ·
หนึ่ง variant = หนึ่งแถว · **รวมตะกร้า guest เข้าบัญชีตอนล็อกอินอัตโนมัติ (idempotent)** ·
กัน CSRF ด้วยการตรวจ Origin · กัน IDOR · ปุ่มในหน้าสินค้า/หน้าลุคเพิ่มของจริงแล้ว · test 99 เคส (เพิ่ม 24)

**STEP 8:** Look Detail (`/looks/[slug]`)
เลือกสี/ไซซ์ของสินค้าทุกชิ้นในลุค แล้ว **ตรวจ "ซื้อทั้งชุด" ที่ server ครั้งเดียว** ·
ราคาทุกบาทมาจากฐานข้อมูล (ราคาที่ client แนบมาถูกเมิน) · variant นอกลุคใช้ไม่ได้ ·
slug ที่ไม่มีจริงคืน HTTP 404 · นับ viewCount · ลุคที่เกี่ยวข้อง (fallback หัวข้อตรงความจริง) ·
test 75 เคส (เพิ่ม 19)

**STEP 7:** Look Ideas (`/looks`)
ลุคจากฐานข้อมูลจริง 4 ชุด · กรองตามสไตล์ (เลือกหลายอันได้) · ค้นหา · เรียง 5 แบบ (รวมราคารวมของลุค) ·
แบ่งหน้า · ตัวกรอง "ซื้อครบชุดได้" ที่คิดจาก Inventory จริง (หัก reserved) ·
ขยายดูสินค้าในลุคได้โดยไม่ต้องมี JS และลิงก์เข้าหน้าสินค้าจริง · test 56 เคส (เพิ่ม 19)

**STEP 6:** Product System (`/shop` + `/product/[slug]`)
ค้นหา/กรอง/เรียง/แบ่งหน้า ทำที่ server ทั้งหมด (4 endpoint ใหม่) · กรองได้ 8 แบบ ·
เรียง 6 แบบบนราคาที่ต้องจ่ายจริง · จำนวนในตัวกรองตรงกับผลค้นหาทุกหมวด ·
หน้าสินค้า: gallery · เลือกสี/ไซซ์/จำนวน · **ตรวจสต็อกที่ server ก่อนเพิ่มลงตะกร้า** ·
slug ที่ไม่มีจริงคืน HTTP 404 จริง · test 37 เคส (เพิ่ม 23)

**STEP 5:** หน้าแรกดึงข้อมูลจริงจากฐานข้อมูลทุก section
7 section (Hero · New Arrivals · Flash Sale · Best Sellers · Categories · Recommended · AI Stylist · Popular Looks)
ครบ 4 สถานะ Loading/Empty/Error/Retry · 3 endpoint ใหม่พร้อม validation

**STEP 4:** Navbar + Footer + Layout กลาง
route group `(storefront)` / `admin` · เมนู 5 รายการ + ไอคอน Search/Wishlist/Account/Cart ·
hamburger menu บนจอเล็ก · 7 หน้า placeholder (ไม่มีลิงก์ไป 404) · 15 routes build ผ่าน

**STEP 3:** Google Login ใช้งานได้จริง — ผูกเข้าบัญชี `SUPER_ADMIN` ที่ seed ไว้ (ไม่สร้างผู้ใช้ซ้ำ)
session เก็บในฐานข้อมูล อายุ 30 วัน · เพิกถอนได้ทันทีทั้ง frontend และ backend

## Foundation

| STEP | หัวข้อ                                    | สถานะ | หมายเหตุ                                                                                  |
| ---: | ----------------------------------------- | :---: | ----------------------------------------------------------------------------------------- |
|    1 | Project Structure                         |  ✅   | monorepo (npm workspaces), Next 16 + Express 5 + Prisma 7, Docker, docs                   |
|    2 | Database (Prisma models, migration, seed) |  ✅   | 36 ตาราง (+Cart/CartItem ใน STEP 9) · 37 CHECK constraints · seed 12 สินค้า / 102 variant |
|    3 | Authentication + Google OAuth + RBAC      |  ✅   | Google Login จริง · session ในฐานข้อมูล · RBAC 4 บทบาท / 31 สิทธิ์ · 401/403 ครบ          |

## Customer Website

| STEP | หัวข้อ                                      | สถานะ |
| ---: | ------------------------------------------- | :---: |
|    4 | Navbar + Main Layout                        |  ✅   |
|    5 | Home Page                                   |  ✅   |
|    6 | Product System (`/shop`, `/product/[slug]`) |  ✅   |
|    7 | Look Ideas (`/looks`)                       |  ✅   |
|    8 | Look Detail (`/looks/[slug]`)               |  ✅   |
|    9 | Cart (guest + merge on login)               |  ✅   |
|   10 | Checkout                                    |  ✅   |
|   11 | Payment (COD + Stripe)                      |  ✅   |
|   12 | Order Tracking                              |  ✅   |
|   22 | Wishlist                                    |  ⬜   |
|   23 | Reviews                                     |  ⬜   |
|   43 | Return / Refund                             |  ⬜   |
|   45 | Advanced Search                             |  ⬜   |

## Admin Dashboard

| STEP | หัวข้อ                          | สถานะ |
| ---: | ------------------------------- | :---: |
|   13 | Admin Dashboard + จัดการออเดอร์ |  ✅   |
|   14 | Product Management              |  ✅   |
|   15 | Inventory / Stock               |  ✅   |
|   16 | Stock Alert                     |  ✅   |
|   17 | Barcode / QR                    |  ⬜   |
|   18 | Import / Export (CSV, Excel)    |  ⬜   |
|   25 | Customer Management             |  ⬜   |
|   26 | Analytics                       |  ⬜   |
|   27 | Admin Logs (Audit)              |  🚧   |
|   41 | Promotion / Coupon              |  ⬜   |
|   42 | Loyalty / Points                |  ⬜   |
|   44 | Shipping Management             |  ⬜   |
|   47 | Image Management                |  ⬜   |
|   48 | Category / Brand / Size / Color |  ⬜   |
|   49 | Store Settings                  |  ⬜   |

## AI

| STEP | หัวข้อ                                | สถานะ |
| ---: | ------------------------------------- | :---: |
|   19 | AI Stylist                            |  ⬜   |
|   20 | AI Customer Service (+ human handoff) |  ⬜   |
|   21 | AI Knowledge Base                     |  ⬜   |
|   46 | AI Recommendation Engine              |  ⬜   |

## Platform / Quality

| STEP | หัวข้อ                            | สถานะ | หมายเหตุ                                                                                                       |
| ---: | --------------------------------- | :---: | -------------------------------------------------------------------------------------------------------------- |
|   24 | Notifications                     |  ⬜   |                                                                                                                |
|   28 | Security                          |  🚧   | helmet · cors · rate limit · Zod env · CSRF (Origin) · IDOR · STEP 11: ตรวจลายเซ็น webhook + ไม่เก็บ card data |
|   29 | REST API                          |  🚧   | +6..12 storefront/orders · +13 `admin/overview` `admin/orders` `admin/orders/:n/status`                        |
|   30 | Error Handling                    |  ✅   | global errorHandler + `{ success, message, errorCode }` + 400/401/403/404/409/422/429/500                      |
|   31 | Responsive                        |  🚧   | จะครบเมื่อมีหน้าจริงตั้งแต่ STEP 4                                                                             |
|   32 | Loading / Empty / Error / Retry   |  ✅   | โครงใช้ซ้ำได้ใน components/shared/section.tsx · ทดสอบ error state แล้วตอน backend ล่ม                          |
|   33 | SEO                               |  🚧   | STEP 6/8: metadata ต่อสินค้า/ลุค + slug ที่ไม่มีจริงคืน HTTP 404 จริง (ไม่ใช่ soft 404)                        |
|   34 | Performance (cache, index, Redis) |  ⬜   |                                                                                                                |
|   35 | Docker                            |  ✅   | compose + 2 Dockerfile (multi-stage, non-root, healthcheck)                                                    |
|   36 | Environment Variables             |  ✅   | `.env.example` ครบทุก service                                                                                  |
|   37 | Testing                           |  🚧   | vitest + supertest 171 เคส: +admin (RBAC · state machine · restock · AdminLog)                                 |
|   38 | Deployment                        |  🚧   | คู่มือใน [06-deployment.md](06-deployment.md)                                                                  |
|   39 | Google Chrome Testing             |  🚧   | STEP 1 ตรวจระดับ HTTP/HTML แล้ว                                                                                |
|   40 | Final Audit                       |  ⬜   |                                                                                                                |
|   50 | Backup / Recovery                 |  ⬜   |                                                                                                                |
|   51 | Monitoring                        |  🚧   | `/health` พร้อมแล้ว                                                                                            |
|   52 | Background Jobs (BullMQ)          |  ⬜   |                                                                                                                |
|   53 | Privacy / Consent                 |  ⬜   |                                                                                                                |
|   54 | Accessibility                     |  🚧   |                                                                                                                |
|   55 | Production Readiness Audit        |  ⬜   |                                                                                                                |
