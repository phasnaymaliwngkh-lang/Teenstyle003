# =============================================================================
# TEENSTYLE AI — Backend (Express 5 + Prisma 7)
# build context = root ของ repo (เพราะเป็น npm workspaces)
#   docker build -f docker/backend.Dockerfile .
#
# ⚠️ ตรวจไฟล์นี้ให้ตรงกับ repo ด้วย `node scripts/audit-deploy.mjs` ก่อน push
# =============================================================================

# ─── Stage 1: build ──────────────────────────────────────────────────────────
# ติดตั้งและ build ใน stage เดียวกันโดยเจตนา — npm hoist node_modules ของทุก
# workspace ขึ้น root ทำให้ `database/node_modules` ไม่ถูกสร้างขึ้นเลย
# การ `COPY --from=deps /app/database/node_modules` จึงล้มทันที (เจอจริงตอน STEP 38)
# layer cache ยังทำงาน เพราะ `npm ci` อยู่ก่อนการคัดลอกซอร์ส
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.base.json ./
COPY backend/package.json ./backend/
COPY database/package.json ./database/
COPY frontend/package.json ./frontend/

# `--include=dev` เพราะ tsc อยู่ใน devDependencies และโฮสต์บางที่ตั้ง
# NODE_ENV=production ไว้ ซึ่งทำให้ npm ข้าม devDependencies แล้ว build ล้มด้วย
# TS7016 (บทเรียนจาก docs/06-deployment.md §2.1)
# ไม่ใส่ --ignore-scripts เพราะ postinstall ของ prisma เตรียม engine ให้ linux-musl
RUN npm ci --include=dev

COPY database ./database
COPY backend ./backend

# 1) generate Prisma Client (เป็น TypeScript source)
# 2) คอมไพล์ database workspace -> dist
# 3) คอมไพล์ backend -> dist
RUN npm run generate --workspace database \
  && npm run build --workspace database \
  && npm run build --workspace backend

# ─── Stage 2: production runtime ─────────────────────────────────────────────
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV BACKEND_PORT=4000

# ติดตั้งเฉพาะ production dependencies
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY database/package.json ./database/
COPY frontend/package.json ./frontend/
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# นำผลลัพธ์ที่ build แล้วมาใช้
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/database/dist ./database/dist
COPY --from=builder /app/database/prisma ./database/prisma
COPY --from=builder /app/database/generated ./database/generated

# โฟลเดอร์รูปที่อัปโหลด (STEP 47) — สร้างให้ user `node` เป็นเจ้าของก่อนถอดสิทธิ์ root
# (volume ที่ mount ทับครั้งแรกรับ owner จากโฟลเดอร์นี้ · ไม่มี volume = รูปหายทุก redeploy)
ENV UPLOAD_DIR=/app/uploads
RUN mkdir -p /app/uploads && chown node:node /app/uploads

# ไม่รันด้วย root
USER node

EXPOSE 4000

# health check ใช้ endpoint เดียวกับ monitoring (STEP 51)
# ⚠️ ลำดับพอร์ตต้องตรงกับ `listenPort` ใน backend/src/config/env.ts เป๊ะ:
#    PORT (โฮสต์ฉีดมา) → BACKEND_PORT → 4000
#    ไม่งั้นเวลา deploy บนโฮสต์ที่ฉีด PORT มา health check จะไปเคาะพอร์ตที่ไม่มีใครฟัง
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||process.env.BACKEND_PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/backend
CMD ["node", "dist/server.js"]
