# src/features

โค้ดที่แยกตาม domain — แต่ละ feature เก็บ component, hook, type และ logic ของตัวเองไว้ที่เดียว
เพื่อให้หาของง่ายเมื่อโปรเจกต์ใหญ่ขึ้น (ต่างจาก `components/` ที่เก็บของกลางที่ทุก feature ใช้ร่วมกัน)

โครงที่จะเกิดขึ้น:

| Feature     |         STEP | เนื้อหา                                                    |
| ----------- | -----------: | ---------------------------------------------------------- |
| `auth/`     |            3 | ปุ่ม Google sign-in, guard, hook อ่าน session              |
| `products/` |            6 | ProductCard, ProductGrid, Gallery, ตัวเลือกสี/ไซซ์, filter |
| `looks/`    |          7–8 | LookCard, LookDetail, add-all-to-cart                      |
| `cart/`     |            9 | CartDrawer, CartItem, สรุปยอด                              |
| `checkout/` |        10–11 | ฟอร์มหลายขั้น, ที่อยู่, วิธีจัดส่ง, ชำระเงิน               |
| `orders/`   |           12 | รายการคำสั่งซื้อ, timeline สถานะ                           |
| `wishlist/` |           22 | ปุ่มหัวใจ, หน้า wishlist                                   |
| `reviews/`  |           23 | ฟอร์มรีวิว, ดาว, รายการรีวิว                               |
| `ai/`       |        19–21 | AI Stylist chat, AI Customer Service, human handoff        |
| `search/`   |           45 | autocomplete, suggestion, filter panel                     |
| `admin/`    | 13–18, 25–27 | ตาราง, ฟอร์ม, chart ของ Admin Dashboard                    |

**รูปแบบในแต่ละโฟลเดอร์**

```
features/products/
├── components/      UI ของ feature นี้เท่านั้น
├── hooks/           logic ฝั่ง React
├── types.ts         type ที่ใช้ใน feature
└── index.ts         re-export ของที่ให้ feature อื่นใช้
```

เรียก API ผ่าน `src/services/*.service.ts` เสมอ — ห้าม `fetch` ตรงในคอมโพเนนต์
