# =============================================================================
# TEENSTYLE AI — Frontend (Next.js)
# build context = root ของ repo (npm workspaces)
#   docker build -f docker/frontend.Dockerfile .
#
# ⚠️ ตรวจไฟล์นี้ให้ตรงกับ repo ด้วย `node scripts/audit-deploy.mjs` ก่อน push
#    (เครื่องที่พัฒนาไม่มี Docker daemon — ความผิดพลาดในไฟล์นี้จะไปโผล่ตอน deploy)
# =============================================================================

# ─── Stage 1: build ──────────────────────────────────────────────────────────
# ติดตั้งและ build ใน stage เดียวกันโดยเจตนา: การคัดลอก node_modules ข้าม stage
# ใช้กับ npm workspaces ไม่ได้ เพราะ npm hoist ของทุก workspace ขึ้น root
# แล้ว `frontend/node_modules` กับ `database/node_modules` ไม่ถูกสร้างขึ้นเลย
# → `COPY --from=deps /app/database/node_modules` ล้มทันที (เจอจริงตอน STEP 38)
# layer cache ยังทำงานเหมือนเดิม เพราะ `npm ci` อยู่ก่อนการคัดลอกซอร์ส
FROM node:22-alpine AS builder
WORKDIR /app

# NEXT_PUBLIC_* ต้องมีตอน build เพราะถูกฝังลง bundle ที่ส่งไปเบราว์เซอร์
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SITE_NAME=TeenStyle
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
# ⚠️ ห้ามปล่อยว่างตอน deploy จริง — ถ้าว่าง เบราว์เซอร์จะยิง backend คนละ origin
#    แล้ว cookie ถูกบล็อกแบบ third-party (ตะกร้า/สั่งซื้อ/หลังบ้าน พังหมด)
#    ดู docs/06-deployment.md §3.1 · compose ส่งค่ามาให้แล้ว
ARG NEXT_PUBLIC_API_PROXY_PATH=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_PUBLIC_API_PROXY_PATH=$NEXT_PUBLIC_API_PROXY_PATH
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json tsconfig.base.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY database/package.json ./database/

# `--include=dev` เพราะ tsc และ tailwind อยู่ใน devDependencies
# และโฮสต์บางที่ตั้ง NODE_ENV=production ไว้ ซึ่งทำให้ npm ข้าม devDependencies
# (บทเรียนจาก docs/06-deployment.md §2.1) · ไม่ใส่ --ignore-scripts เพราะ
# postinstall ของ prisma เป็นตัวเตรียม engine ให้ตรงกับ linux-musl ของ alpine
RUN npm ci --include=dev

# frontend พึ่ง @teenstyle/database (Auth.js เก็บ session ในฐานข้อมูลผ่าน Prisma adapter)
# จึงต้องมีซอร์สของ database และต้อง generate + build ก่อน
# เพราะ Prisma Client เป็นโค้ดที่ถูก generate และ package ชี้ exports ไปที่ dist/
COPY database ./database
COPY frontend ./frontend

RUN npm run generate --workspace database \
  && npm run build --workspace database \
  && npm run build --workspace frontend

# ─── Stage 2: production runtime ─────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY database/package.json ./database/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/frontend/.next ./frontend/.next
COPY --from=builder /app/frontend/public ./frontend/public
COPY --from=builder /app/frontend/next.config.ts ./frontend/

# ต้องมีตอนรันด้วย ไม่ใช่แค่ตอน build — ทุกคำขอที่อ่าน session เรียก Prisma Client จริง
COPY --from=builder /app/database/dist ./database/dist
COPY --from=builder /app/database/generated ./database/generated
COPY --from=builder /app/database/prisma ./database/prisma

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/frontend
CMD ["npx", "next", "start"]
