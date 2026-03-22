# --- Stage 1: Build (same libc as Playwright image — do not copy node_modules from Alpine) ---
FROM mcr.microsoft.com/playwright:v1.42.0-jammy AS builder
WORKDIR /app
COPY package*.json ./
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# --- Stage 2: Production ---
FROM mcr.microsoft.com/playwright:v1.42.0-jammy AS runner
WORKDIR /app
COPY package*.json ./
RUN npm ci && npx playwright install chromium
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma
EXPOSE 3000
CMD ["node", "dist/index.js"]
