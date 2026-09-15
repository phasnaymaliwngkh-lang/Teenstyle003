# =============================================================================
# TEENSTYLE AI — Frontend (Next.js)
# build context = root ของ repo (npm workspaces)
#   docker build -f docker/frontend.Dockerfile .
# =============================================================================

# ─── Stage 1: ติดตั้ง dependencies ───────────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json ./frontend/
COPY backend/package.json ./backend/
COPY database/package.json ./database/

RUN npm ci --ignore-scripts

# ─── Stage 2: build ──────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# NEXT_PUBLIC_* ต้องมีตอน build เพราะถูกฝังลง bundle ที่ส่งไปเบราว์เซอร์
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_SITE_NAME=TeenStyle
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_SITE_NAME=$NEXT_PUBLIC_SITE_NAME
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules

COPY package.json package-lock.json tsconfig.base.json ./
COPY frontend ./frontend

RUN npm run build --workspace frontend

# ─── Stage 3: production runtime ─────────────────────────────────────────────
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

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/frontend
CMD ["npx", "next", "start"]
