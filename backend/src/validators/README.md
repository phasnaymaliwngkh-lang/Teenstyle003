# src/validators

Zod schema สำหรับตรวจ input ของทุก API (UNIVERSAL RULE #10: ทุก API ต้อง Validate Input)

**หลักการ:** ห้ามเชื่อค่าที่ client ส่งมาเด็ดขาด โดยเฉพาะ `price` และ `stock`
ซึ่งต้องดึงจากฐานข้อมูลฝั่ง server เสมอ (SECURITY REQUIREMENT)

- **STEP 3 เป็นต้นไป:** เพิ่ม schema ตาม endpoint เช่น `product.validator.ts`, `order.validator.ts`
- error จาก Zod จะถูกแปลงเป็น HTTP 422 + `errorCode: VALIDATION_ERROR` โดย
  [errorHandler](../middlewares/error-handler.ts) อยู่แล้ว ไม่ต้องจับเอง

```ts
// รูปแบบที่จะใช้
export const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  price: z.coerce.number().int().nonnegative(),
});
```
