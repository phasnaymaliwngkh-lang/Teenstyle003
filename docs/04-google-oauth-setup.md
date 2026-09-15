# 04 — Google OAuth Setup

⚠️ **ต้องทำเองก่อนเริ่ม STEP 3** — Master Prompt ระบุว่า Google Login ต้องใช้งานได้จริง
ห้ามทำระบบ mock ดังนั้นต้องมี Client ID / Client Secret ของจริงจาก Google

## 1. สร้าง Project ใน Google Cloud Console

1. เปิด <https://console.cloud.google.com/>
2. เลือก project หรือกด **New Project** → ตั้งชื่อ เช่น `teenstyle-ai`

## 2. ตั้งค่า OAuth consent screen

1. ไปที่ **APIs & Services → OAuth consent screen**
2. เลือก **External** → **Create**
3. กรอก:
   - App name: `TEENSTYLE AI`
   - User support email: อีเมลของคุณ
   - Developer contact email: อีเมลของคุณ
4. **Scopes** — ใช้เท่าที่จำเป็นเท่านั้น (STEP 53 Privacy: ห้ามเก็บข้อมูลที่ไม่จำเป็น):
   - `openid`
   - `.../auth/userinfo.email`
   - `.../auth/userinfo.profile`
5. **Test users** — ระหว่างที่ยังไม่ publish ให้เพิ่มอีเมลที่จะใช้ทดสอบเข้าไป
   ไม่งั้นจะ login ไม่ได้

## 3. สร้าง OAuth Client ID

1. ไปที่ **APIs & Services → Credentials → Create Credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `TEENSTYLE AI Web`
4. **Authorized JavaScript origins**

   | Environment | ค่า                     |
   | ----------- | ----------------------- |
   | Local       | `http://localhost:3000` |
   | Production  | `https://<your-domain>` |

5. **Authorized redirect URIs** ← ผิดบ่อยที่สุด ต้องตรงทุกตัวอักษร

   | Environment | ค่า                                              |
   | ----------- | ------------------------------------------------ |
   | Local       | `http://localhost:3000/api/auth/callback/google` |
   | Production  | `https://<your-domain>/api/auth/callback/google` |

   > path `/api/auth/callback/google` คือรูปแบบของ Auth.js (NextAuth)
   > ถ้าเปลี่ยน `basePath` ของ Auth.js ต้องแก้ค่านี้ตามด้วย

6. กด **Create** แล้วคัดลอก **Client ID** และ **Client Secret**

## 4. ใส่ค่าลงไฟล์ .env

```bash
# frontend/.env.local  (Auth.js ทำงานฝั่ง Next.js)
AUTH_SECRET=<ผลลัพธ์จาก: npx auth secret>
AUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=<Client ID>
GOOGLE_CLIENT_SECRET=<Client Secret>
```

ใส่ค่าเดียวกันใน `.env` ที่ root ด้วย เพื่อให้ docker compose ส่งต่อเข้า container ได้

🔒 **ห้าม commit ค่าจริง** — `.env` และ `.env.local` อยู่ใน `.gitignore` แล้ว
ถ้า secret รั่วให้กด **Reset secret** ใน Google Cloud Console ทันที

## 5. ตรวจสอบ

หลังทำ STEP 3 เสร็จ:

1. `npm run dev` → เปิด <http://localhost:3000>
2. กด Sign in with Google → ต้องเด้งไปหน้า Google แล้วกลับมาเว็บเรา
3. ตรวจว่า session ถูกสร้าง และ role เริ่มต้นเป็น `CUSTOMER`
4. redirect หลัง login: `CUSTOMER → /account`, `EMPLOYEE|ADMIN|SUPER_ADMIN → /admin`

## ปัญหาที่เจอบ่อย

| อาการ                                 | สาเหตุ / วิธีแก้                                                         |
| ------------------------------------- | ------------------------------------------------------------------------ |
| `redirect_uri_mismatch`               | redirect URI ใน Console ไม่ตรงเป๊ะ — เช็ค http/https, ท้าย `/`, เลข port |
| `access_blocked` / `app not verified` | ยังไม่ publish และอีเมลที่ใช้ไม่ได้อยู่ใน Test users                     |
| login สำเร็จแต่ session หาย           | `AUTH_SECRET` ว่าง หรือ `AUTH_URL` ไม่ตรงกับ domain ที่เปิดอยู่          |
| production login ไม่ได้               | ยังไม่ได้เพิ่ม redirect URI ของ domain production ใน Console             |
