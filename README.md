# FPS Arena — browser multiplayer FPS

FPS multiplayer deathmatch berbasis browser (TypeScript, three.js + Colyseus). FFA & TDM, prediksi klien + simulasi otoritatif server dengan lag compensation.

## Fitur
- 4 senjata (pistol/rifle/shotgun/sniper), hitscan otoritatif + lag compensation (rewind ≤250ms)
- Match flow: warmup → live (10 menit / first to 25) → scoreboard → restart; FFA & TDM (auto team, no friendly fire)
- Kill feed, scoreboard (Tab), chat, hitmarker server-confirmed
- Audio posisional (footstep musuh), VFX tracer/spark, viewmodel 3D (aset Kenney, MIT)
- Loading screen dengan progress, preset grafis low/medium/high, object pooling

## Struktur
```
apps/client  — three.js + Vite (prediksi/rekonsiliasi/interpolasi)
apps/server  — Colyseus 0.18 (GameRoom otoritatif 60Hz, /metrics :2568)
packages/shared — sim deterministik (movement, combat, map, weapons) + schema
e2e          — Playwright multi-klien
docs/        — NETCODE, PROTOCOL, PERFORMANCE, DECISIONS, CREDITS
```

## Jalankan dev
```sh
pnpm install
pnpm -r typecheck && pnpm --filter shared test     # unit test 14/14
cd apps/server && npx tsx src/index.ts             # ws://localhost:2567 + metrics :2568
cd apps/client && npx vite                          # http://localhost:5173
npx playwright test                                 # e2e multi-klien
node apps/client/tools/loadtest.mjs 10 16 45        # load test 10 room × 16 bot
```

## Deploy
```sh
docker build -t fps-game .
docker run -p 2567:2567 -p 2568:2568 -e ALLOWED_ORIGINS='https://yourdomain.com' fps-game
```
TLS/HTTPS wajib via reverse proxy (Caddy/Nginx) — WS jadi WSS otomatis. Client dist (`apps/client/dist`) bisa dideploy ke CDN/static hosting dengan env URL server.

## Env server
- `PORT` (default 2567), metrics di PORT+1
- `ALLOWED_ORIGINS` — daftar origin dipisah koma, `*` untuk dev
- `JOIN_LIMIT_PER_MIN` — batas koneksi per IP per menit (default 60)

## Hasil kunci
- Load test 160 bot / 10 room: tick avg 0.1ms, overrun 0% (lihat docs/PERFORMANCE.md)
- E2E 2 klien: join → sync → drift < 0.5 unit → scoreboard — passed
- Download awal: bundle gzip ~220KB + aset 216KB (anggaran < 15MB)

## Lisensi
Kode project: milik tim. Aset: Kenney Starter Kit FPS (MIT/OFL) — lihat docs/CREDITS.md.
