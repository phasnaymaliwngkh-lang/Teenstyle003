# =============================================================================
# TEENSTYLE AI — Backend (Express 5 + Prisma 7)
# build context = root ของ repo (เพราะเป็น npm workspaces)
#   docker build -f docker/backend.Dockerfile .
# =============================================================================

# ─── Stage 1: ติดตั้ง dependencies ───────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

# คัดลอกเฉพาะ manifest ก่อน เพื่อให้ layer cache ทำงานเมื่อโค้ดเปลี่ยนแต่ deps ไม่เปลี่ยน
COPY package.json package-lock.json ./
COPY backend/package.json ./backend/
COPY database/package.json ./database/
COPY frontend/package.json ./frontend/

# ติดตั้งทั้ง workspace (backend ต้องใช้ @teenstyle/database)
RUN npm ci --ignore-scripts

# ─── Stage 2: build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/backend/node_modules ./backend/node_modules
COPY --from=deps /app/database/node_modules ./database/node_modules

COPY package.json package-lock.json tsconfig.base.json ./
COPY database ./database
COPY backend ./backend

# 1) generate Prisma Client (เป็น TypeScript source)
# 2) คอมไพล์ database workspace -> dist
# 3) คอมไพล์ backend -> dist
RUN npm run generate --workspace database \
  && npm run build --workspace database \
  && npm run build --workspace backend

# ─── Stage 3: production runtime ─────────────────────────────────────────────
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
