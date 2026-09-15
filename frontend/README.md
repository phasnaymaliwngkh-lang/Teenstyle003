# frontend — TEENSTYLE AI

Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS v4 · shadcn/ui-ready

**รันจาก root ของ repo เสมอ** (เป็น npm workspace): `npm run dev`
เปิดเฉพาะ frontend: `npm run dev:frontend` → <http://localhost:3000>

## โครงสร้าง

```
src/
├── app/              App Router — layout.tsx · page.tsx · globals.css (design tokens)
├── components/
│   ├── ui/           shadcn/ui primitives (เพิ่มด้วย npx shadcn@latest add ...)
│   ├── layout/       Navbar · Footer · MobileMenu · AdminSidebar (STEP 4)
│   └── shared/       คอมโพเนนต์กลางที่ใช้หลายที่
├── features/         แยกตาม domain: products, cart, checkout, ai, admin …
├── hooks/            custom hook ที่ใช้ร่วมกัน
├── lib/              api.ts (fetch wrapper) · env.ts · utils.ts (cn)
├── services/         *.service.ts — ชั้นเดียวที่เรียก REST API
├── store/            Zustand store
├── types/            type ที่ใช้ร่วมกัน (api.ts ต้องตรงกับ backend)
└── utils/            pure function
```

## กฎ

1. **ห้าม `fetch` ในคอมโพเนนต์** — เรียกผ่าน `services/*.service.ts` ที่ใช้ `apiFetch` จาก `lib/api.ts`
2. **Server Component เป็นค่าเริ่มต้น** ใส่ `"use client"` เฉพาะที่ต้องมี state / effect / event
3. **ใช้ design token ใน `@theme` ของ `globals.css`** ห้าม hardcode ค่าสี
4. **ทุกหน้า async ต้องมี loading / empty / error / retry** — ดูตัวอย่างที่
   [src/components/shared/system-status.tsx](src/components/shared/system-status.tsx)
5. **env อ่านผ่าน `publicEnv`** ใน `lib/env.ts` — `NEXT_PUBLIC_*` ใส่ secret ไม่ได้

## Next 16 — ต้องรู้ก่อนเขียนโค้ด

- Turbopack เป็น default · `params` / `searchParams` / `cookies()` / `headers()` ต้อง `await`
- **`middleware.ts` → `proxy.ts`** (สำคัญกับ STEP 3)
- `next.config` **ไม่มี key `eslint`** และ `next lint` ถูกถอดออก — lint รันผ่าน ESLint flat config
- ห้าม setState แบบ synchronous ใน `useEffect` (กฎ `react-hooks/set-state-in-effect`)
- เอกสารฉบับเต็ม: `../node_modules/next/dist/docs/` (ดู `01-app/02-guides/upgrading/version-16.md`)

รายละเอียดอื่นดูที่ [../CLAUDE.md](../CLAUDE.md) และ [../docs/](../docs/)
