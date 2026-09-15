# 07 — ตั้งค่าการชำระเงิน (STEP 11)

ระบบรองรับ 2 ช่องทาง และ **ปิดช่องทางที่ยังตั้งค่าไม่ครบเสมอ** (ไม่มีหน้าชำระเงินปลอม)

| ช่องทาง                                  | ใช้ได้เมื่อ                                          | เงินเข้าเมื่อไร            |
| ---------------------------------------- | ---------------------------------------------------- | -------------------------- |
| **COD — เก็บเงินปลายทาง**                | ใช้ได้ทันที (ยอดไม่เกิน 5,000 บาท)                   | ตอนลูกค้ารับของ            |
| **Stripe — บัตรเครดิต/เดบิต, PromptPay** | ต้องมี `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` | ตอนลูกค้าจ่ายบนหน้า Stripe |

## สิ่งที่เกิดขึ้นกับสต็อก

```
สั่งซื้อ (STEP 10)      → reservedQuantity += จำนวน        (จองไว้ ยังไม่ตัด)
ชำระเงินสำเร็จ (Stripe) → quantity -= จำนวน + InventoryMovement (ตัดจริง)
ยืนยัน COD              → quantity -= จำนวน + InventoryMovement (ของออกไปกับพนักงานส่ง)
ยกเลิก / หมดเวลา        → reservedQuantity -= จำนวน        (คืนเข้าคลัง)
```

ทุกการตัดสต็อกมี `InventoryMovement.idempotencyKey = order:<id>:deduct:<variantId>`
ซึ่ง unique ที่ฐานข้อมูล → **webhook ยิงซ้ำกี่ครั้งก็ตัดสต็อกแค่ครั้งเดียว**

## ขั้นตอนตั้งค่า Stripe (โหมดทดสอบ)

1. สมัคร/เข้าสู่ระบบที่ <https://dashboard.stripe.com> แล้ว **เปิด Test mode** (สวิตช์มุมขวาบน)
2. คัดลอก **Secret key** จาก Developers → API keys (ขึ้นต้นด้วย `sk_test_`)
3. ใส่ในไฟล์ `.env` ที่ root:

   ```env
   STRIPE_SECRET_KEY=sk_test_xxxxxxxxxxxxxxxxxxxxx
   ```

4. เปิด webhook ให้ Stripe ยิงกลับเข้าเครื่องเรา — วิธีที่ง่ายที่สุดคือ Stripe CLI:

   ```powershell
   # ติดตั้งครั้งเดียว
   winget install Stripe.StripeCLI

   stripe login
   stripe listen --forward-to http://localhost:4000/api/payments/webhook/stripe
   ```

   คำสั่ง `stripe listen` จะพิมพ์ **webhook signing secret** (`whsec_...`) ออกมา
   นำไปใส่ใน `.env`:

   ```env
   STRIPE_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxx
   ```

5. รีสตาร์ต backend (`npm run dev`) แล้วช่องทาง Stripe จะเปิดใช้งานอัตโนมัติ
   ตรวจได้ที่ `GET http://localhost:4000/api/payments/methods` — `available` ของ `STRIPE` ต้องเป็น `true`

6. ทดลองจ่ายด้วยบัตรทดสอบของ Stripe (โหมดทดสอบไม่มีการตัดเงินจริง):
   `4242 4242 4242 4242` · วันหมดอายุอนาคตใด ๆ · CVC อะไรก็ได้

### ถ้าไม่ใช้ Stripe CLI

ตั้ง endpoint ใน Dashboard → Developers → Webhooks → Add endpoint
URL ต้องเข้าถึงได้จากอินเทอร์เน็ต (ตอน deploy จริงคือ `https://<backend-domain>/api/payments/webhook/stripe`)
เลือก event อย่างน้อย:

- `checkout.session.completed`
- `checkout.session.async_payment_succeeded`
- `checkout.session.async_payment_failed`
- `checkout.session.expired`

แล้วคัดลอก signing secret ของ endpoint นั้นมาใส่ `STRIPE_WEBHOOK_SECRET`

## กฎความปลอดภัยที่บังคับในโค้ด

- **ห้ามเก็บ raw card data** — เลขบัตรกรอกบนหน้าโฮสต์ของ Stripe เท่านั้น
  เราเก็บเฉพาะ `session id`, `payment_intent id`, สถานะ และยอด (ดู `Payment.rawPayload`)
- **ทุก webhook ต้องมีลายเซ็นที่ถูกต้อง** — ลายเซ็นผิด/ไม่มี → `400` และไม่แตะข้อมูลใด ๆ
- **idempotent 3 ชั้น**: event id ซ้ำ → ตรวจพบ · สถานะออเดอร์ต้องเป็น `PENDING_PAYMENT` เท่านั้น ·
  การตัดสต็อกกันซ้ำที่ระดับฐานข้อมูล
- **ยอดเงินอ่านจากออเดอร์ในฐานข้อมูล** — client ส่งได้แค่ว่าจะจ่ายวิธีไหน
- ออเดอร์ที่ไม่จ่ายภายใน `PAYMENT_WINDOW_MINUTES` (ค่าเริ่มต้น 1440 = 24 ชม.)
  จะถูกยกเลิกและคืนของเข้าคลัง — เรียกได้ที่ `expireOverdueOrders()`
  (STEP 52 จะทำให้รันอัตโนมัติด้วย BullMQ)

## ทดสอบโดยไม่มีบัญชี Stripe

เทสต์ของโปรเจกต์ (`backend/tests/payment.test.ts`) **เซ็นลายเซ็น webhook เองด้วย secret ทดสอบ**
(HMAC-SHA256 ของ `timestamp.body` — วิธีเดียวกับ Stripe) จึงทดสอบเส้นทางเงินได้ครบโดยไม่ต้องมีบัญชีจริง:

```powershell
npm test   # ครอบ: ตัดสต็อกครั้งเดียว · event ซ้ำ · ลายเซ็นผิด · หมดอายุคืนของ · COD
```
