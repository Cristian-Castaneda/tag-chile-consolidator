# ── Build stage ───────────────────────────────────────────────────────────────
# Playwright base image ships Chromium + all OS deps, matched to the npm version.
FROM mcr.microsoft.com/playwright:v1.60.0-jammy AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci || npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime stage ──────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.60.0-jammy
WORKDIR /app
ENV NODE_ENV=production
# Chromium is launched with --no-sandbox (see src/scrapers/base.ts), required on
# Cloud Run.
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY --from=build /app/dist ./dist
COPY config ./config
CMD ["node", "dist/main.js"]
