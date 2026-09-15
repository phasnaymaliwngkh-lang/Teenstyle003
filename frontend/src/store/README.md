# src/store

Zustand store สำหรับ state ที่ต้องใช้ร่วมกันหลายหน้า

| Store               |  STEP | หน้าที่                                                                |
| ------------------- | ----: | ---------------------------------------------------------------------- |
| `cart.store.ts`     |     9 | ตะกร้าของ guest (persist ลง localStorage) + merge เข้าบัญชีเมื่อ login |
| `ui.store.ts`       |     4 | สถานะ UI ร่วม เช่น เปิด/ปิด drawer, mobile menu, search overlay        |
| `wishlist.store.ts` |    22 | wishlist ของ guest ก่อน login                                          |
| `ai-chat.store.ts`  | 19–20 | ประวัติแชทของ AI Stylist / Customer Service                            |

**กฎ**

- store เก็บได้แค่ **ค่าที่เป็น UI state หรือข้อมูล guest** เท่านั้น
- ข้อมูลจาก server (สินค้า, ราคา, stock, คำสั่งซื้อ) **ห้ามถือเป็น source of truth ใน store**
  ต้องดึงจาก API ใหม่ทุกครั้งที่ต้องตัดสินใจ เพราะราคาและ stock ต้องเชื่อฝั่ง server เท่านั้น
  (SECURITY REQUIREMENT: Trust Client-side Price / Stock = ห้าม)
- ใช้ `persist` เฉพาะกับข้อมูลที่หายได้ไม่เสียหาย และต้องครอบ error ไว้ (โหมดส่วนตัวอาจ throw)
