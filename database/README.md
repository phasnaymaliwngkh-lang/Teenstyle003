# database — Prisma schema, migrations, seed

Workspace: `@teenstyle/database` · Prisma **7.10.0** + PostgreSQL

```
database/
├── prisma/schema.prisma   27 models · 19 enums
├── prisma.config.ts       ⚠️ Prisma 7: DATABASE_URL อยู่ที่นี่ ไม่ใช่ใน schema แล้ว
├── migrations/            2 migration (init + check constraints)
├── generated/prisma/      Prisma Client ที่ generate ออกมา (gitignored)
├── scripts/               check-connection.mjs (npm run db:check)
├── seed/                  data.ts (ข้อมูล) + seed.ts (logic)
└── src/index.ts           PrismaClient singleton + checkDatabaseHealth()
```

**สถานะจริงในฐานข้อมูลตอนนี้** (วัดด้วย `information_schema` / `pg_catalog`):
31 ตาราง (27 models + 3 join table ของ implicit m-n + `_prisma_migrations`) ·
19 enum types · 141 index (5 partial · 2 GIN/pg_trgm) · 41 foreign key · 59 unique index · 32 CHECK

## สิ่งที่ต่างจาก Prisma 6 (สำคัญ — อย่าทำตาม tutorial เก่า)

| เรื่อง           | Prisma 6 (เก่า)                                | Prisma 7 (ที่ใช้ในโปรเจกต์นี้)                                      |
| ---------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| connection URL   | `url = env("DATABASE_URL")` ใน `schema.prisma` | `datasource.url` ใน `prisma.config.ts`                              |
| generator        | `prisma-client-js` (output ลง node_modules)    | `prisma-client` + ต้องระบุ `output`                                 |
| generated client | JavaScript + .d.ts                             | **TypeScript source** ที่คอมไพล์รวมกับโปรเจกต์เรา                   |
| สร้าง client     | `new PrismaClient()`                           | `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` |
| โหลด `.env`      | อัตโนมัติ                                      | ต้องโหลดเองใน `prisma.config.ts`                                    |

เพราะ generated client import ด้วยนามสกุล `.ts` และใช้ `import.meta.url`
workspace นี้จึงเป็น **ESM** (`"type": "module"`) และ `tsconfig.json` ต้องเปิด
`allowImportingTsExtensions` + `rewriteRelativeImportExtensions`

## คำสั่ง (รันจาก root ของ repo)

```bash
npm run db:check           # ตรวจว่า DATABASE_URL เชื่อมต่อได้จริง (อ่านอย่างเดียว ไม่พิมพ์รหัสผ่าน)
npm run db:generate        # prisma generate — ต้องรันทุกครั้งหลังแก้ schema
npm run db:build           # คอมไพล์ src + generated client -> dist (backend ใช้ dist ตอน production)
npm run db:sync            # = db:generate + db:build
npm run db:migrate         # prisma migrate dev — สร้าง migration (ต้องมี Postgres รันอยู่)
npm run db:migrate:deploy  # ใช้บน production (ไม่สร้าง migration ใหม่)
npm run db:seed            # รัน seed/seed.ts
npm run db:studio          # เปิด Prisma Studio
npm run db:reset           # ล้าง DB + migrate + seed ใหม่ (dev เท่านั้น)
```

## ลำดับที่ต้องทำหลังแก้ `schema.prisma`

```bash
npm run db:generate              # 1. สร้าง client ใหม่จาก schema
npm run build -w database        # 2. คอมไพล์ให้ backend ใช้ได้ตอน production
npm run db:migrate               # 3. สร้าง/ใช้ migration กับฐานข้อมูล
```

## การใช้งานจาก backend

```ts
import { getPrisma, checkDatabaseHealth } from "@teenstyle/database";

const prisma = getPrisma(); // lazy singleton — สร้าง connection เมื่อเรียกครั้งแรก
const health = await checkDatabaseHealth();
```

`getPrisma()` เป็น lazy เพื่อให้ backend start ได้แม้ยังไม่มี Postgres (STEP 1)
และจะ throw ข้อความที่ชัดเจนถ้า `DATABASE_URL` ว่าง

## ⚠️ กฎของ schema ที่ต้องรู้ก่อนเขียน service (STEP 2)

### 1. Stock — single source of truth อยู่ที่ `Inventory`

`Inventory.quantity` (ต่อ 1 `ProductVariant`) คือจำนวนจริงเพียงที่เดียว
**ห้ามเขียนทับตรง ๆ** ทุกการเปลี่ยนแปลงต้องทำใน transaction เดียวกับการสร้าง `InventoryMovement`
เพื่อให้มี audit trail ครบ (ใครทำ เมื่อไร ก่อน/หลังเท่าไร เพราะอะไร)

```ts
await prisma.$transaction(async (tx) => {
  const inv = await tx.inventory.update({
    where: { variantId },
    data: { quantity: { decrement: qty } },
  });
  await tx.inventoryMovement.create({
    data: {
      variantId,
      type: "STOCK_OUT",
      quantity: qty,
      quantityBefore: inv.quantity + qty,
      quantityAfter: inv.quantity,
      reason: "ตัดสต็อกจากคำสั่งซื้อ",
      referenceType: "ORDER",
      referenceId: orderId,
      idempotencyKey: `order:${orderId}:variant:${variantId}`, // กันตัดซ้ำ
    },
  });
  await tx.product.update({
    where: { id: productId },
    data: { totalStock: { decrement: qty } }, // cache ต้องอัปเดตพร้อมกัน
  });
});
```

### 2. ฟิลด์ที่เป็น cache — ต้องอัปเดตใน transaction เดียวกับต้นทาง

| ฟิลด์                  | ต้นทางจริง                                | อัปเดตเมื่อ                       |
| ---------------------- | ----------------------------------------- | --------------------------------- |
| `Product.totalStock`   | ผลรวม `Inventory.quantity` ของทุก variant | ทุกครั้งที่มี `InventoryMovement` |
| `Order.trackingNumber` | `Shipment.trackingNumber` ล่าสุด          | ตอนสร้าง/แก้ shipment             |
| `Coupon.usedCount`     | จำนวน `Order` ที่ใช้คูปองนั้น             | ตอนยืนยันคำสั่งซื้อ               |
| `User.totalSpent`      | ผลรวม `Order.total` ที่ชำระแล้ว           | ตอนชำระเงินสำเร็จ                 |

มีไว้เพื่อเลี่ยง aggregate query ตอนแสดงรายการ (STEP 34) — ถ้าลืมอัปเดตจะเกิด drift
เมื่อสงสัยว่าค่าเพี้ยน ให้คำนวณจากต้นทางใหม่เสมอ

### 3. Snapshot — ประวัติต้องไม่เปลี่ยนตามข้อมูลปัจจุบัน

`OrderItem` เก็บ `productName` `variantSku` `colorName` `sizeName` `imageUrl` `unitPrice` ไว้เอง
และ `Order.addressSnapshot` เก็บที่อยู่เป็น JSON
เพราะสินค้าอาจถูกเปลี่ยนชื่อ/ขึ้นราคา/ลบ และที่อยู่อาจถูกแก้ภายหลัง
**เวลาแสดงประวัติคำสั่งซื้อให้ใช้ snapshot ไม่ใช่ join กลับไปที่ Product**

### 4. CHECK constraint ระดับฐานข้อมูล

Prisma schema เขียน CHECK ไม่ได้ จึงอยู่ใน migration แยก:
[`migrations/20260913223800_add_check_constraints/migration.sql`](migrations/20260913223800_add_check_constraints/migration.sql)

บังคับไว้ **32 ข้อ** (นับจากฐานข้อมูลจริงด้วย `pg_constraint`) ที่สำคัญ:

- `Inventory.quantity >= 0` และ `reservedQuantity <= quantity` → **stock ติดลบและ oversell ไม่ได้แม้โค้ดพลาด**
- `Product.salePrice < price` → ราคาลดต้องลดจริง
- `User.points >= 0` → แต้มติดลบไม่ได้
- `Order.discountTotal <= subtotal` → ส่วนลดเกินค่าสินค้าไม่ได้
- `Review.rating BETWEEN 1 AND 5`
- `Coupon` แบบ `PERCENTAGE` ต้อง `value <= 100` และ `endsAt > startsAt`

ไฟล์เดียวกันยังสร้าง **partial index** สำหรับ query ที่ใช้บ่อย (สินค้า active, คำสั่งซื้อที่ยังไม่ปิด,
สินค้าใกล้หมด, notification ที่ยังไม่อ่าน, รีวิวที่อนุมัติแล้ว) และเปิด `pg_trgm`
พร้อม GIN index บน `Product.name` / `Product.sku` เพื่อให้ค้นหาแบบ `ILIKE '%คำ%'` เร็ว (STEP 45)

### 5. Soft delete

ตารางข้อมูลหลักมี `deletedAt` — **query ทุกที่ต้องใส่ `where: { deletedAt: null }`**
ตาราง audit trail (`InventoryMovement`, `AdminLog`, `AIChatMessage`) เป็น append-only ไม่มี soft delete

หมายเหตุ: `deletedAt` ไม่ได้ยกเว้น unique constraint — สินค้าที่ถูก soft delete ยังจอง `slug` และ `sku` อยู่
ถ้าต้องการใช้ค่าเดิมซ้ำ ให้เปลี่ยนชื่อ slug/sku ของแถวเก่าตอนลบ

## Seed มีอะไร

`npm run db:seed` (idempotent — รันซ้ำได้ ไม่เกิดข้อมูลซ้ำ)

| ข้อมูล     | จำนวน                                                              |
| ---------- | ------------------------------------------------------------------ |
| Permission | 31 สิทธิ์                                                          |
| Role       | 4 (CUSTOMER / EMPLOYEE / ADMIN / SUPER_ADMIN) พร้อมสิทธิ์ที่ผูกไว้ |
| Size       | 12 (XS–XXL, Free, EU36–40)                                         |
| Color      | 9 สี พร้อมรหัส hex                                                 |
| Category   | 10 (แม่ 6 · ย่อย 4)                                                |
| Brand      | 4                                                                  |
| Product    | 12 พร้อมรูป variant inventory และ movement รับเข้าครั้งแรก         |
| Look       | 4 ลุค · 12 รายการสินค้าในลุค                                       |
| Coupon     | 3 (TEEN15 / FREESHIP690 / NEWBIE100)                               |
| Admin user | 1 — เฉพาะเมื่อตั้ง `SEED_ADMIN_EMAIL` ใน `.env`                    |

แก้ข้อมูลตั้งต้นได้ที่ [`seed/data.ts`](seed/data.ts) โดยไม่ต้องแตะ logic ใน [`seed/seed.ts`](seed/seed.ts)
