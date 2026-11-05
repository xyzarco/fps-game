# PROGRESS.md

## Fase 0 — Riset & Setup ✅
**Selesai:**
- Monorepo pnpm workspaces: `apps/client` (Vite 6.4.5 + Three.js 0.170), `apps/server` (Node + ws, tsx watch), `packages/shared` (TS strict, config/constants, weapons, protokol, sim movement + collision AABB).
- Unit test sim movement: **5/5 lulus** (jatuh-mendarat, kecepatan 7 u/s top speed, tidak menembus dinding, determinisme, gravity).
- Typecheck `pnpm -r typecheck` hijau.
- **Bukti runtime:** client `http://localhost:5173` → HTTP 200; server `ws://localhost:2567` → klien WS connect, kirim input, terima snapshot.
- Riset dependency versi & netcode: subagent berjalan, hasil akan diintegrasikan ke NETCODE.md + ADR.

**Keputusan:** ADR-001 (ws sementara, migrasi Colyseus dinilai setelah riset). Fix friction-acceleration supaya top speed eksak `MOVE_SPEED`.

**Masalah terbuka:** pilihan fisika (Rapier vs kinematik kustom) menunggu riset.
**Rencana:** Fase 1 — single-player core (loop fixed timestep, pointer lock, hitscan senjata pertama, HUD).
