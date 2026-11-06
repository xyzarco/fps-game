# PROGRESS.md

## Fase 0 — Riset & Setup ✅
**Selesai:**
- Monorepo pnpm workspaces: `apps/client` (Vite 6.4.5 + Three.js 0.170), `apps/server` (Node + ws, tsx watch), `packages/shared` (TS strict, config/constants, weapons, protokol, sim movement + collision AABB).
- Unit test sim movement: **5/5 lulus** (jatuh-mendarat, kecepatan 7 u/s top speed, tidak menembus dinding, determinisme, gravity).
- Typecheck `pnpm -r typecheck` hijau.
- **Bukti runtime:** client `http://localhost:5173` → HTTP 200; server `ws://localhost:2567` → klien WS connect, kirim input, terima snapshot.
- Riset dependency versi & netcode: subagent berjalan, hasil diintegrasikan ke NETCODE.md + ADR.

**Keputusan:** ADR-001 (ws sementara → migrasi Colyseus), ADR-002 (three.js target r187). Fix friction-acceleration supaya top speed eksak `MOVE_SPEED`.

## Fase 1 — Single-player Core ✅ (56be47d)
Fixed-timestep 60Hz, pointer lock, viewmodel, map greybox + collision, hitscan pistol, HUD. **Test 14/14**. Bukti CDP: gerak W 1s z −30→−36.8; tembak dummy yaw tepat → HP 100→83 ("✛ 17").

## Fase 2 — Multiplayer Fondasi ✅ (ea767e2)
Colyseus 0.18 (server 0.18.11, @colyseus/sdk 0.18.9). Prediksi + rekonsiliasi **zero drift** (ack 120/120, z=22.42), interpolasi remote 100ms. **3 klien nyata** di room sama terverifikasi. Bug "Seat reservation expired" diakarbi custom httpServer menimpa router matchmaking → default transport.

## Fase 3 — Combat Otoritatif ✅ (c50bf78)
Hitscan server + lag compensation (history 1s, rewind ≤250ms), damage/HP/death/respawn 3s, kill feed, scoreboard, weapon switch 1-4, fire rate limit, seq guard, spawn protect 2s. Hitmarker **hanya dari `hitConfirmed` server** (PLAN 4.4). Bukti: Eve→Dave HP 100→80→0, killfeed, tembakan melewati cover meleset (wall block benar).

## Fase 4 — Lobby, Match Flow, UI/UX ✅ (819910c)
Menu utama (nickname/mode/room code + localStorage), Quick Play & join by code (`game_<CODE>` dynamic room type), warmup 10s → live 10 menit/25 kill → ended 8s → restart, FFA & TDM (auto team, friendly fire off, skor tim), chat sanitasi, HUD timer/skor, overlay akhir match.
**Fix desync penting:** rate-limit input lama membuang cmd di tengah antrean → determinisme prediksi putus; diganti cap antrean 240. Drift setelahnya 0.06 unit (float32 quantization).

## Fase 5 — Konten & Polish ✅ (6250163, 393cb9c)
- Viewmodel GLB Kenney (MIT) + dedicated viewmodel lighting (fixed siluet hitam)
- Audio manager WebAudio: tembakan, hurt, jump/land, footstep sendiri + **footstep posisional pemain lain** (PannerNode)
- Lighting upgrade (fog/sky/sun/rim), VFX impact spark, preset grafis low/medium/high, slider volume
- **Draco kompresi**: blaster.glb 68.8KB→6.9KB, repeater 75.6KB→7.1KB (gltf-transform) + DRACOLoader
- **Object pooling** tracer/spark (tanpa alloc/dispose per tembakan — pool reuse terverifikasi)
- **Loading screen dengan progress** (8 langkah) — bar 25%→100% → "Klik untuk main" terverifikasi
- CREDITS.md lengkap (Kenney MIT/OFL). Total aset 216KB (budget < 15MB ✓)

## Fase 6 — Hardening, Test & Deploy ✅ (bc40568)
- **Logging terstruktur** (JSON: room_create/join/leave/kill, origin_rejected, rate_limited) + `GET :2568/metrics` (rooms + tick stats avg/max/overrun%)
- Ping/pong RTT measurement → lag comp kini pakai RTT asli per pemain (bukan hardcoded 200ms)
- **Origin check** (`ALLOWED_ORIGINS`, reject di WS upgrade) + **rate limit koneksi** per IP (429)
- **E2E Playwright** 2 klien (join → cross-visibility → gerak/prediksi → reconciliasi drift<0.5 → scoreboard): **passed**
- **Load test 160 bot / 10 room** (`apps/client/tools/loadtest.mjs`): tick avg **0.1ms**, max **6.4ms**, **overrun 0%** (kriteria PLAN >90% → 100% ✓), CPU ~14%, RSS 174MB → docs/PERFORMANCE.md
- **Dockerfile** multi-stage + `.dockerignore` — **terbukti ter-build di CI** (docker build + typecheck + test + vite build hijau)
- **CI/CD GitHub Actions LIVE**: `.github/workflows/ci.yml` — typecheck + unit test + build client + Docker build + push image ke GHCR — **run #42165634707 success** (fix bertahap: pnpm version duplikat, typescript devDep client, permissions packages:write). Repo: https://github.com/xyzarco/fps-game
- **Dokumentasi final**: PROTOCOL.md (baru), PERFORMANCE.md (baru), README.md (final), NETCODE.md, BACKLOG.md (baru)

**Masalah terbuka:** deploy HTTPS publik butuh host/domain (image `ghcr.io/xyzarco/fps-game/fps-game:latest` siap ditarik; instruksi di README).

## Fase 7 (Backlog) — tidak dikerjakan sesuai PLAN; dicatat di docs/BACKLOG.md.
