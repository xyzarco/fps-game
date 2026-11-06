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

## Fase B0 — Riset & Keputusan (selesai)
- Riset paralel (3 subagent): recast-navigation-js 0.44.0 (MIT) vs three-pathfinding 1.3.0 vs waypoint graph → **ADR-006 recast-navigation-js**; FSM custom → **ADR-007** (yuka 0.7.8 stale); mulberry32 → **ADR-008**; ray-AABB slab (three-mesh-bvh tidak perlu) + tanpa Web Worker → **ADR-009**; aim model manusiawi → **ADR-010** (formula di DECISIONS).
- Prototipe: `tools/navmesh/bake.mjs` bake solo navmesh dari GREYBOX (1344→816 verts hasil final 1311 verts/437 tris), query computePath/findRandomPoint/findNearestPoly terbukti; output `apps/client/public/assets/maps/greybox.navmesh.json` (78KB).
- Unit test `packages/shared/test/navmesh.test.ts` (bake + path + randomPoint bounds) — suite 15/15 hijau.
- Masalah terbuka: none blocking.
- Berikutnya: Fase B1 — GameHost abstraction + LocalGameHost + BotManager + bot dummy.

## Fase B1 — LocalGameHost & Bot Dummy (selesai)
- `apps/client/src/net/host.ts`: GameHost abstraction — NetClient (multiplayer) & LocalGameHost (offline) duck-typed; Game mengonsumsi interface sama.
- `apps/client/src/singleplayer/LocalGameHost.ts`: room sim otoritatif di browser TANPA Colyseus — stepMovement/fireWeapon/damage/respawn/kill/score/match flow (warmup→live→ended→siklus) identik GameRoom, latensi 0 tanpa lag comp.
- `apps/client/src/singleplayer/BotManager.ts`: bot dummy wander acak (idle↔wander tiap 1.2–3.4s), input InputCmd sama dengan pemain, nama gamertag, tidak menembak (B4).
- Menu: tombol "🤖 PLAY vs BOTS (offline)" + jumlah bot 1–15.
- Bukti e2e browser (BotTester): join lokal tanpa server ✓ → 8 entitas (1+7 bot) ✓ → phase warmup→live ✓ → bot bergerak (posisi berubah antar snapshot) ✓ → 8 tembakan jarak 4.3 unit: hp 100→20→dead ✓ → killfeed "BotTester ⚔ pistol → Vex" + kills=1 ✓ → respawn 3s (hp 100, protect expired) ✓.
- Regression: Playwright e2e multiplayer passed (59.8s); typecheck hijau; build sukses; test 15/15.
- Commit c7c1420 (pushed). Bug fix saat wiring: onJoinWorld di-rebind saat swap host (game.connected).

## Fase B2 — Navigasi & Gerak (selesai)
- `packages/shared/src/ai/rng.ts`: mulberry32 PRNG ber-seed (ADR-008).
- `packages/shared/src/ai/navigation.ts`: NavService (bake runtime solo navmesh ~300ms; findPath dgn dedup waypoint, randomPoint ground-only y<0.5, randomPointAroundCircle, nearestPoint).
- `packages/shared/src/ai/BotBrain.ts`: state Roam — path following (waypoint reach 1.0u), replan saat path habis/stuck (bukan berkala — anti zig-zag), turn-speed clamp 220 deg/s (ADR-010), separation steering antar bot (radius 1.6), stuck detection 1s → recovery mundur+strafe 0.5-0.8s + goal baru (BOTS.md 3.4).
- Arsitektur: brain THINK-ONLY (output InputCmd; tanpa step sim) — host men-step sim satu-satunya (BOTS.md 2.1). BotManager sync brain.sim dari entity tiap tick.
- Test headless `test/ai-roam.test.ts`: 8 bot × 2 menit sim 60Hz ber-seed — 0 NaN, 0 out-of-bounds, stuck < 2% ✓ (16/16 test hijau).
- Verifikasi in-game: 7 bot roam 7–10 u/s, 0 bot lambat (<1u/s), goal navmesh berganti-ganti, recovery jalan.
- Keputusan (DECISIONS): randomPoint ground-only — bot tidak roam ke atas platform (satu sumber kebenaran fisika; platform area pemain).

## Fase B3 — Persepsi & Memori (selesai)
- `packages/shared/src/ai/perception.ts`:
  - `inFov` (kerucut yaw), `hasLos` (raycast 3 titik tubuh: kepala/dada/kaki — pakai raycastBoxes shared, tanpa wallhack)
  - `Perception`: vision ~8-10Hz dgn jitter (di-stagger), reaction time per-target (mular saat pertama terlihat), memory decay (memorySec per kesulitan), hear (radius × hearMul, posisi dgn noise), mostRecentMemory/latestSound
  - `DIFFICULTY` 4 preset (BOTS.md 6: fov/hear/memory/reaction/turn/aimError/aggressiveness)
  - `SoundBus`: event suara dari simulasi (tembakan radius 45 di LocalGameHost.handleFire; langkah/lompat menyusul B4)
- `BotBrain`: state 'roam' | 'investigate' | 'search' — terlihat musuh → investigate lastKnown; hilang → search 3-5s → roam; suara → investigate (BOTS.md 5.1 subset B3).
- Test `ai-perception.test.ts` (5): FOV depan/belakang ✓, LOS tembus tembok BLOCKED + garis terbuka CLEAR ✓ (kriteria anti-wallhack), reaction time gate ✓, memory decay ✓, hearing radius+noise ✓ — suite 21/21 hijau.
- In-game: bot investigate aktif (semua bot state investigate, goal navmesh), player di balik central block tidak terlihat oleh bot mana pun (seesMe=false di semua bot, dist 29-36).
- Fix infrastruktur: server tsconfig moduleResolution NodeNext→bundler (recast types .mjs mismatch); recast deps masuk devDeps shared.

## Fase B4 — Combat (selesai)
- `packages/shared/src/ai/aim.ts`: aim model manusiawi (ADR-010) — turn clamp per tick (turnSpeed deg/s), aim error Gaussian 2D dgn sigma = base × (1+0.01·dist) ÷ trackingFactor (decay saat tracking), resample 250–400ms, fire gate toleransi angular (2+aimError deg), `pickWeapon` by jarak & ammo (shotgun <12u, sniper >30u, rifle mid, pistol fallback).
- `BotBrain` state combat & retreat: strafe kiri-kanan berinterval (600–1500ms) skala agresivitas, jaga jarak ideal (mendekat >25u, menjauh <8u), retreat saat HP ≤30 (menjauh dari lastKnown 15u), fire hanya bila reaction lewat + dalam toleransi + target benar2 visible (tanpa wallhack).
- `BotManager.reportStatus`: host feed hp/ammo aktual ke brain tiap tick (bot tidak membaca internal host).
- SoundBus: tembakan bot juga diemit (handleFire generik di LocalGameHost).
- Test `ai-aim.test.ts` (5): turn clamp konvergensi, error decay saat tracking, error naik dgn jarak, fire gate, weapon select — suite 27/27 hijau.
- Test `ai-combat.test.ts`: headless bot-vs-bot 30s (4 hard vs 4 easy) — kills 3-200 range (duel hidup, bukan aimbot), 0 NaN, 0 out-of-bounds ✓.
- In-game 35 detik: kill feed 'Vex ⚔ pistol → Rook', skor tersebar (Tango 2/1, Nova 1/1, Onyx 1/0), player ditembak bot (deaths 1), state campur combat/retreat → semua bot combat saat sehat. Kriteria BOTS.md: duel masuk akal ✓, retreat HP rendah ✓, no friendly fire (FF off) ✓.

## Fase B5 — Kesulitan, Mode & Menu (selesai)
- Menu: dropdown kesulitan bot (Easy/Normal/Hard/Insane) + jumlah bot + mode FFA/TDM — diteruskan ke LocalGameHost → BotManager → BotBrain (DIFFICULTY preset B3).
- TDM komposisi tim (BOTS.md 5.3): bot genap → tim A (rekan player), ganjil → tim B; `BotWorldView.allies` (set id satu tim) dikecualikan dari persepsi/targeting → bot tidak membidik rekan (friendly fire off sudah di level host).
- Bukti in-game: TDM 6 bot → tim A [player,Vex,Nova,Onyx] vs tim B [Rook,Jinx,Sable]; kill legal antar tim (Jinx→Nova); verifikasi memory bot: targetingAlly kosong di semua 7 entitas ✓; teamScoreA/B bertambah.
- Suite 27/27 hijau, build sukses.
- Catatan: Survival/Wave & Practice Range tetap backlog opsional (BOTS.md 'opsional') — dicatat di docs/BACKLOG.md.
