# PROTOCOL.md — protokol jaringan fps-game (Colyseus 0.18)

## Transport & endpoint
- **WebSocket**: `ws://<host>:2567` (prod: WSS via reverse proxy TLS — Caddy/Nginx)
- **HTTP matchmaking**: `POST /matchmake/<method>/<roomName>` — method: `joinOrCreate`, `create`, `join`, `joinById`, `reconnect`
- **Room**: `game` (Quick Play) atau `game_<CODE>` (join by code; room type didaftarkan on-demand)
- **Health/metrics**: `GET :2568/__healthcheck` → `OK`; `GET :2568/metrics` → JSON rooms + tick stats

## Handshake
1. `joinOrCreate` → respons `{ sessionId, roomId, processId }`
2. Klien join room, menerima **`welcome`** `{ sessionId }`
3. State schema (delta-patch ~20Hz via `setPatchRate(1000/SNAPSHOT_RATE)`)

## Messages klien → server
| Message | Payload | Frekuensi / catatan |
|---|---|---|
| `input` | `{ cmd: { seq, tick, moveX, moveZ, yaw, pitch, jump, crouch, walk, fire, reload, weaponSlot } }` | per tick 60Hz; guard seq duplikat; antrean max 240 (determinisme prediksi) |
| `chat` | `{ text }` | sanitasi server (strip `<>`, max 120 char) |
| `pong` | `{ t }` | echo ping → server ukur RTT (dipakai lag comp) |

## Messages server → klien
| Message | Payload |
|---|---|
| `welcome` | `{ sessionId }` |
| `ping` | `{ t }` — tiap 2 dtk per klien |
| `hitConfirmed` | `{ target, damage }` — sumber hitmarker (PLAN 4.4: klien tidak boleh spawn angka damage sendiri) |
| `damaged` | `{ by, amount }` — sumber damage vignette |
| `killFeed` | `{ killer, victim, weapon, headshot, t }` — expire 5 dtk di HUD |
| `chat` | `{ from, text, t }` |
| `matchStart` | `{ endsAt, mode }` |
| `matchEnd` | `{ winner, scores, teamA, teamB, t }` |

## State schema (delta-patch)
- `GameState`: `serverTick`, `serverTimeMs`, `mode` ('ffa'|'tdm'), `phase` ('warmup'|'live'|'ended'), `phaseEndsAt`, `matchEndsAt`, `teamScoreA/B`, `players` MapSchema
- `Player`: `nickname, x/y/z (float32), yaw/pitch (int2 = yaw*100), hp, dead, kills, deaths, team, ammo, weapon, crouch, lastProcessedSeq`

## Match flow (otoritatif di server)
warmup 10s → live (10 menit / first-to-25) → ended (scoreboard 8s) → warmup baru. Freeze input saat `ended`.

## Anti-cheat & rate limit
- Fire rate limit per weapon (`fireIntervalMs`) di server
- Seq guard (duplikat/replay) + antrean input max 240
- Spawn protect 2s, respawn 3s
- Koneksi: origin check (`ALLOWED_ORIGINS`) + rate limit koneksi per IP (`JOIN_LIMIT_PER_MIN`, default 60/menit) di upgrade WebSocket

## Lag compensation
- Server menyimpan history posisi 1 detik per pemain (per tick)
- Saat fire: rewind target ke `viewTime = now - min(250ms, RTT/2 + 100ms)` sebelum raycast
- Raycast memakai `fireWeapon` shared (sama dengan klien) — head/body/legs, damage falloff, wall block, pellets

## Kuantisasi & determinisme
- Posisi float32 di schema (drift klien-server setelah reconcile ≈ 0.06 unit)
- yaw/pitch dikirim ×100 (int) untuk hemat bandwidth
- Sim movement shared pakai fixed-timestep 60Hz — klien prediksi & server memproses cmd yang sama
