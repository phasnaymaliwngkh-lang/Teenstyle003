# 08 — Security (STEP 28)

สรุปด่านความปลอดภัยทั้งหมดที่มีจริงในระบบ ณ ตอนนี้ · ช่องโหว่ที่เคยเจอและแก้แล้ว ·
และความเสี่ยงที่ **ยอมรับไว้อย่างรู้ตัว** พร้อมเหตุผลและเงื่อนไขที่ต้องกลับมาทบทวน

> ไฟล์นี้เป็นบันทึกการตัดสินใจ ไม่ใช่รายการสิ่งที่ "น่าจะทำ"
> อะไรที่ยังไม่ได้ทำจะเขียนไว้ตรง ๆ ว่ายังไม่ได้ทำ

---

## 1. ด่านที่มีอยู่จริง

| ชั้น               | สิ่งที่ทำ                                                                                  | ไฟล์                                                                                                          |
| ------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| HTTP header (API)  | helmet · ปิด `x-powered-by` · HSTS ตอน production                                          | [backend/src/app.ts](../backend/src/app.ts)                                                                   |
| HTTP header (เว็บ) | CSP แบบ nonce · HSTS · nosniff · Referrer-Policy · X-Frame-Options · Permissions-Policy    | [frontend/src/lib/csp.ts](../frontend/src/lib/csp.ts) · [frontend/next.config.ts](../frontend/next.config.ts) |
| CORS               | allowlist จาก `CORS_ORIGIN` + `credentials: true`                                          | `app.ts`                                                                                                      |
| CSRF               | `verifyOrigin` ทุกคำขอที่เปลี่ยนข้อมูล                                                     | [verify-origin.ts](../backend/src/middlewares/verify-origin.ts)                                               |
| Rate limit         | ทั่วระบบ 300/15 นาที · `strictRateLimiter` 20/นาที บน endpoint ที่มีค่าใช้จ่ายจริง         | [rate-limit.ts](../backend/src/middlewares/rate-limit.ts)                                                     |
| Authentication     | session ในฐานข้อมูล (เพิกถอนได้ทันที) ไม่ใช่ JWT                                           | [auth.service.ts](../backend/src/services/auth.service.ts)                                                    |
| Authorization      | RBAC จากตาราง `Role ↔ Permission` ไม่ hard-code ตามบทบาท                                   | [authorize.ts](../backend/src/middlewares/authorize.ts)                                                       |
| Input validation   | Zod ทุก endpoint · คีย์ที่ไม่รู้จักถูกตัดทิ้ง (กัน mass assignment)                        | `validators/`                                                                                                 |
| IDOR               | ทุกคิวรีกรองเจ้าของ · ไม่ใช่ของเราคืน **404 ไม่ใช่ 403**                                   | ทุก service                                                                                                   |
| SQL injection      | ค่าจากผู้ใช้เป็น parameter ของ `Prisma.sql` · `ORDER BY` มาจาก whitelist                   | `shop.service.ts` · `analytics.service.ts`                                                                    |
| XSS                | React escape ให้ · **ไม่มี `dangerouslySetInnerHTML` ในโปรเจกต์เลย** · CSP เป็นด่านสุดท้าย | —                                                                                                             |
| Open redirect      | `safeInternalPath()` ที่เดียว                                                              | [safe-redirect.ts](../frontend/src/lib/safe-redirect.ts)                                                      |
| ข้อมูลการเงิน      | ไม่เก็บ raw card data · `paymentStatus = PAID` เปลี่ยนได้จาก webhook ที่ลายเซ็นถูกเท่านั้น | [payment.service.ts](../backend/src/services/payment.service.ts)                                              |
| Audit              | ทุกการแก้ข้อมูลสำคัญเขียน `AdminLog` ในทรานแซกชันเดียวกัน · อ่านอย่างเดียว                 | [admin-log.model.ts](../backend/src/models/admin-log.model.ts)                                                |
| Log                | redact `authorization` · `cookie` · `set-cookie` · `password` · `token` · `cardNumber`     | [logger.ts](../backend/src/utils/logger.ts)                                                                   |
| Error              | 500 ตอบข้อความกลาง ไม่มี stack trace หลุด                                                  | [error-handler.ts](../backend/src/middlewares/error-handler.ts)                                               |

ทั้งหมดถูกล็อกด้วย [backend/tests/security.test.ts](../backend/tests/security.test.ts)
ซึ่งไม่ได้ทดสอบฟีเจอร์ แต่ทดสอบว่า **ด่านยังอยู่** — เพราะของพวกนี้พังแบบเงียบ ๆ ได้ทั้งหมด

---

## 2. ช่องโหว่ที่เจอจริงตอน STEP 28 และแก้แล้ว

### 2.1 Open redirect ผ่านแบ็กสแลช (ระดับสำคัญ)

ด่านเดิมเช็คว่า `value.startsWith("/") && !value.startsWith("//")` ซึ่ง **ไม่พอ**

```
new URL("/\evil.com", "https://teenstyle.example")  →  https://evil.com/
```

มาตรฐาน WHATWG URL ถือว่า `\` เท่ากับ `/` สำหรับ scheme แบบ http/https
`"/\evil.com"` จึงถูกอ่านเป็น `"//evil.com"` แต่ผ่านด่านทั้งสองข้อ

**ผลกระทบ:** ส่งลิงก์ `/signin?callbackUrl=/\evil.com` ให้เหยื่อ
เหยื่อล็อกอินกับเว็บเราจริง (โดเมนถูก ใบรับรองถูก ทุกอย่างดูปกติ) แล้วถูกพาไปเว็บปลอมทันที
เป็นรูปแบบฟิชชิงที่เนียนที่สุด เพราะจุดเริ่มต้นคือเว็บจริง

จุดที่ได้รับผล: `callbackUrl` ของ `/signin` · `next` ของ `/api/cart/merge` · `x-pathname` ที่ DAL อ่าน

### 2.2 Open redirect ผ่าน `..` (เจอจากเทสต์ ไม่ใช่จากการอ่านโค้ด)

หลังแก้ 2.1 แล้ว เทสต์ที่ไล่ทุกรูปแบบจับได้อีกอันหนึ่ง

```
"/..//evil.com"  ผ่านทุกด่าน  →  pathname ที่ normalize ออกมา = "//evil.com"
```

`..` ทำให้ segment แรกถูกตัด เหลือ path ที่เป็น protocol-relative **เสียเอง**
พอผู้เรียกเอาค่านี้ไป resolve กับโดเมนจริงอีกที ก็ออกนอกเว็บ

**บทเรียน:** ต้องตรวจ **ผลลัพธ์** ไม่ใช่แค่ input — ดู `safeInternalPath()`

### 2.3 `trust proxy` ที่ตั้งเกินจริงทำให้ IP ปลอมได้

เดิม `app.set('trust proxy', 1)` ฮาร์ดโค้ดไว้ ถ้า deploy โดยไม่มี proxy จริง
ผู้ใช้ส่ง `X-Forwarded-For` มาเองแล้ว `req.ip` จะเป็นค่าที่เขากำหนด ซึ่งทำให้

- rate limit ต่อ IP ถูกข้ามได้ (เปลี่ยน IP ปลอมทุกคำขอ)
- **IP ใน `AdminLog` เป็นค่าปลอม** → audit log ชี้คนผิด

แก้เป็น `TRUST_PROXY_HOPS` (ค่าเริ่มต้น 1) — **ต้องตั้งให้ตรงกับจำนวน proxy จริง**
รันตรงบนเครื่องโดยไม่มี proxy ให้ตั้ง `0`

### 2.4 อัปโหลดไฟล์ไม่จำกัดชนิด

เดิมรับไฟล์อะไรก็ได้ไม่เกิน 5MB แล้วปล่อยให้ ExcelJS ไปเจอเองว่าอ่านไม่ออก
ซึ่งหมายถึงต้องแกะไฟล์แปลกปลอมก่อน (`.xlsx` คือ zip — มีทั้ง zip bomb และ XML ซ้อนลึก)
ตอนนี้ปฏิเสธที่ชั้น multer ด้วยนามสกุล `.csv` / `.xlsx` / `.xls` และจำกัด 1 ไฟล์ต่อคำขอ

---

## 3. Content-Security-Policy

ใช้ **nonce ใหม่ทุกคำขอ** ที่สร้างใน [proxy.ts](../frontend/src/proxy.ts)
แล้ว Next เอาไปแปะให้สคริปต์ของตัวเองอัตโนมัติ

```
default-src 'self'
script-src  'self' 'nonce-…' 'strict-dynamic'   (+ 'unsafe-eval' เฉพาะ dev)
style-src   'self' 'unsafe-inline' https://fonts.googleapis.com
img-src     'self' data: blob: https://lh3.googleusercontent.com https://images.unsplash.com
connect-src 'self' <NEXT_PUBLIC_API_URL>
frame-src 'none' · object-src 'none' · frame-ancestors 'none'
base-uri 'self' · form-action 'self' · upgrade-insecure-requests (production)
```

**สิ่งที่ต้องรู้ก่อนแก้ CSP**

- **ห้ามใส่ `'unsafe-inline'` ใน `script-src`** — จะทำให้ CSP แทบไร้ความหมายเรื่อง XSS
  ซึ่งเป็นเหตุผลเดียวที่ใส่ CSP
- `'strict-dynamic'` จำเป็น เพราะ Next โหลด chunk เพิ่มหลังหน้าเริ่มทำงาน
  ถ้าถอดออก การเปลี่ยนหน้าแบบ client-side จะพัง
- `style-src` **ยังต้องมี `'unsafe-inline'`** เพราะ `next/font` ฝัง `<style>` inline
  และ React ใส่ `style` attribute ให้บางคอมโพเนนต์ (เช่นแถบสัดส่วนในหน้ารายงาน)
  CSS injection อันตรายน้อยกว่า script injection มาก จึงยอมแลก
- dev ต้องมี `'unsafe-eval'` เพราะ HMR ของ Turbopack ใช้ eval · **production ห้ามมี**
- ใส่ `nonce` แล้วหน้าเว็บถูกแคชแบบ static ไม่ได้ — ไม่เสียอะไรเพราะหน้าร้านเป็น dynamic
  อยู่แล้วตั้งแต่ STEP 4 (navbar อ่าน session)

**วิธีตรวจว่า CSP ไม่ทำให้หน้าเว็บพัง** (ทำแล้วตอน STEP 28)
เทียบจำนวน `<script>` ในหน้ากับจำนวนที่มี `nonce` ตรงกับ header — ต้องเท่ากันทุกหน้า
ถ้ามีสคริปต์ตัวใดไม่มี nonce เบราว์เซอร์จะบล็อกและหน้านั้นจะไม่ทำงาน

```bash
curl -s -D h.txt -o p.html http://localhost:3000/
grep -o '<script' p.html | wc -l          # ต้องเท่ากับ
grep -o '<script[^>]*nonce=' p.html | wc -l
```

---

## 4. ความเสี่ยงที่ยอมรับไว้ (พร้อมเหตุผล)

### 4.1 `npm audit` เตือน 6 รายการ — ทั้งหมดเป็น transitive และใช้ไม่ได้กับเรา

| แพ็กเกจ                   | ทางที่ติดมา                 | เหตุผลที่ยังไม่แก้                                                                                                                                                                                                                                |
| ------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mysql2` (high)           | `prisma` → `@prisma/config` | เราใช้ **PostgreSQL เท่านั้น** ไม่เคยเปิดการเชื่อมต่อ MySQL · ช่องโหว่ (auth plugin downgrade · zlib bomb) เกิดได้เฉพาะตอนต่อ MySQL server · `npm audit fix --force` จะ **ถอย Prisma 7 → 6** ซึ่งพังทั้งโปรเจกต์ (ดูหัวข้อ Prisma 7 ใน CLAUDE.md) |
| `uuid` <11.1.1 (moderate) | `exceljs`                   | ช่องโหว่เกิดเมื่อส่ง `buf` เข้า `uuid` v3/v5/v6 · เราไม่เรียก `uuid` ตรง ๆ และ exceljs ไม่ส่ง `buf` · `fix --force` จะถอย `exceljs` 4 → 3.4 ซึ่งเป็น breaking change                                                                              |

**เงื่อนไขที่ต้องกลับมาทบทวน:** เมื่อ Prisma ปล่อยเวอร์ชันที่ตัด `mysql2` ออกหรืออัปเดตแล้ว
หรือเมื่อ exceljs ปล่อยเวอร์ชันที่ใช้ `uuid` ใหม่ — ให้อัปแล้วรัน `npm audit` ซ้ำ
**ห้ามใช้ `npm audit fix --force` กับโปรเจกต์นี้** เพราะมันถอยเวอร์ชันหลักลง

### 4.2 Rate limit เก็บ state ในหน่วยความจำของแต่ละ instance

รันหลาย instance แล้ว limit จะหลวมตามจำนวน instance
ยังไม่มี Redis บนเครื่องนี้ (WSL ยังไม่ติดตั้ง) — เป็นงานของ **STEP 34**

### 4.3 เส้นทาง `/api/auth/*` ของ Auth.js ไม่ผ่าน rate limiter ของเรา

Next เป็นเจ้าของเส้นทางนั้น ไม่ได้วิ่งผ่าน Express
การจำกัดอัตราของ OAuth callback ต้องทำที่ชั้น edge/reverse proxy ตอน deploy (**STEP 38**)

### 4.4 ยังไม่มีนโยบายอายุของ `AdminLog` และ `Session`

`AdminLog` เก็บ IP และ User-Agent ซึ่งเป็นข้อมูลส่วนบุคคล และตารางจะโตขึ้นเรื่อย ๆ
การกำหนดอายุ + ลบตามกำหนดเป็นงานของ **STEP 53** (PDPA) ร่วมกับ job ตามเวลาของ **STEP 52**
(`deleteExpiredSessions()` มีอยู่แล้วแต่ยังไม่มีใครเรียกอัตโนมัติ)

### 4.5 ยังไม่มีการสแกนช่องโหว่อัตโนมัติใน CI

ยังไม่มี CI pipeline (STEP 38) · `npm audit` ต้องรันเอง

### 4.6 CSP ยังไม่มีปลายทางรายงาน (`report-uri` / `report-to`)

ถ้ามีสคริปต์ถูกบล็อกจริงบนเครื่องผู้ใช้ เราจะไม่รู้
การตั้งปลายทางรับรายงานต้องมีที่เก็บก่อน — ทำพร้อมระบบ monitoring ของ **STEP 51**

---

## 5. สิ่งที่ตรวจแล้วว่าไม่มีปัญหา

- **ไม่มี `dangerouslySetInnerHTML`** ในโปรเจกต์ (SVG บาร์โค้ดใส่ผ่าน data URL ใน `<img>`)
- **ไม่มี `data: req.body`** ส่งตรงเข้า Prisma — ทุกอย่างผ่าน Zod ก่อน
- **webhook ของ Stripe** ใช้ `Stripe.webhooks.constructEvent` ซึ่งเทียบลายเซ็นแบบ timing-safe
- **ไม่มีการเก็บรหัสผ่าน** (เข้าระบบด้วย Google OAuth เท่านั้น) · `passwordHash` เป็น null ทุกแถว
- **การ mutate จาก Server Component** มีที่เดียวคือ `/api/cart/merge` ซึ่งส่ง header `Origin`
  มาเองอย่างชัดเจน จึงไม่ติด `verifyOrigin` ตอน production
- **`x-pathname`** ถูก proxy เขียนทับค่าที่ client ส่งมาเสมอ และ DAL ยังกรองผ่าน
  `safeInternalPath()` อีกชั้นสำหรับเส้นทางที่ proxy ไม่ได้รัน

---

## 6. วิธีตรวจซ้ำ

```bash
npm test                 # รวม backend/tests/security.test.ts และเทสต์ของ frontend
npm audit                # เทียบกับตารางในหัวข้อ 4.1 — ต้องไม่มีรายการใหม่
```

ตรวจ header ของจริง

```bash
curl -s -D - -o /dev/null http://localhost:3000/ | grep -i 'content-security-policy\|x-frame\|referrer'
curl -s -D - -o /dev/null http://localhost:4000/health | grep -i 'x-content-type\|x-powered-by'
```

ตรวจ open redirect

```bash
curl -s -o /dev/null -D - 'http://localhost:3000/api/cart/merge?next=%2F%5Cevil.example.com' | grep -i location
# ต้องได้ Location เป็นโดเมนของเราเท่านั้น
```
