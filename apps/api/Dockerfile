# --- builder ---
FROM node:20-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
RUN npm ci --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npx turbo run build --filter=@tracegraph/api

# --- runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/shared/dist ./packages/shared/dist
COPY --from=builder /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /repo/apps/api/dist ./dist
COPY --from=builder /repo/apps/api/package.json ./package.json
COPY --from=builder /repo/apps/api/data ./data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:4000/api/investigations >/dev/null 2>&1 || exit 1
CMD ["node", "dist/main.js"]
