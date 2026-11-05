# FPS Browser Multiplayer

Arena FPS multiplayer di browser. Monorepo: `apps/client` (Vite + Three.js), `apps/server` (Colyseus), `packages/shared` (sim deterministic bersama).

## Dev
```bash
pnpm install
pnpm dev        # client + server paralel
```
- Client: http://localhost:5173
- Server: ws://localhost:2567

## Test
```bash
pnpm test
```
