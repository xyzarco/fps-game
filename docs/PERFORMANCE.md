# PERFORMANCE.md — hasil load test & profiling (Fase 6)

Target PLAN.md Bagian 11: "> 90% tick selesai dalam anggaran waktu" (budget tick = 16.67ms @ 60Hz).

## Setup load test
- Bot: klien headless Colyseus SDK (`apps/client/tools/loadtest.mjs`), input 60Hz + fire berkala
- Server: `npx tsx src/index.ts` (single process, host Linux 6.8, Node 22)
- Metrics: `/metrics` endpoint (port 2568) — tick time window 600 tick

## Hasil — 10 room × 16 bot = **160 bot**, 40 detik

| Metrik | Nilai |
|---|---|
| Bot joined | 160/160 (0 error) |
| Tick avg | **0.1 ms** |
| Tick max | **6.4 ms** |
| Tick overrun (% > 16.67ms) | **0%** ✓ |
| CPU server (ps %cpu) | ~14% (total, semua room) |
| RSS server | ~174 MB |
| Pesan ke server | ~170–185 msg/s (aggregate) |
| Bot client RSS | ~158 MB (semua 160 bot dalam 1 proses) |

### Kriteria PLAN terpenuhi
- **> 90% tick selesai dalam anggaran waktu**: 100% (overrun 0%) ✓
- Headroom besar: tick avg 0.1ms vs budget 16.67ms (~160× headroom per tick)

## E2E Playwright (`e2e/multi-client.spec.ts`)
- Skenario: join ×2 klien → cross-visibility → gerak (prediksi) → reconciliasi (drift < 0.5 unit) → scoreboard.
- Hasil: **passed** (42.5s, chromium headless swiftshader).

## Download awal klien (anggaran PLAN: < 25MB, ideal < 15MB)
- Bundle JS: 808KB (gzip ~220KB) + aset publik **216KB** (GLB Draco 6.9KB, SFX OGG, font)
- Total jauh di bawah anggaran ✓

## Catatan
- Reconciliation dengan burst input (90 cmd manual dalam 1 frame) butuh ~6 detik server-time untuk mengonsumsi antrean (60 cmd/s) — drift < 0.5 unit setelah settle. Ini perilaku deterministik yang benar, bukan bug.
- Metrik yang belum ada: snapshot size per patch & bandwidth per room (estimasi bisa dari msgsIn × payload ~60B).

## Deploy status (Fase 6 + Cloudflare Tunnel)

- **Server publik (WSS)**: verifikasi e2e BERHASIL — browser join via `wss://<tunnel>` ✓
- **Client publik (HTTPS)**: dist served + tunnel — join end-to-end BERHASIL (PublicJoe connected, 2 klien dlm 1 room: TunnelGuy + PublicJoe) ✓
- Quick tunnel URL berubah tiap restart — untuk URL permanen pakai **named tunnel** (root `cloudflared` service sudah terpasang di server ini, remote-managed via dashboard Zero Trust: tambahkan 2 public hostname → `http://localhost:2567` dan client static)
- Client kini mendukung override server: `?server=wss://...` atau `localStorage.fps.server` (default ws://localhost:2567 untuk dev)
