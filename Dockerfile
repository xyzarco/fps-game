# Fase 6: production image — server (Colyseus) + klien statik (served via server).
# Build:  docker build -t fps-game .
# Run:    docker run -p 2567:2567 -p 2568:2568 -e ALLOWED_ORIGINS='*' fps-game
FROM node:22-alpine AS build
WORKDIR /app
RUN corepack enable
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm install --frozen-lockfile
RUN pnpm -r typecheck && pnpm --filter shared test
# build client (dist)
WORKDIR /app/apps/client
RUN npx vite build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app ./
EXPOSE 2567 2568
# TLS/HTTPS ditangani reverse proxy (Caddy/Nginx) — PLAN.md Bagian 4
CMD ["sh", "-c", "cd apps/server && npx tsx src/index.ts"]
