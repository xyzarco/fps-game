# BOTS-TUNING.md — Metrik kesulitan bot (BOTS.md 10)

> Diisi dari playtest & simulasi headless. Update seiring tuning.

## Simulasi headless (CI, ber-seed)

| Test | Hasil | Kriteria |
|---|---|---|
| Roam 8 bot × 2 menit | stuck < 2%, 0 NaN, 0 out-of-bounds | ✓ |
| Combat 8 bot × 30 detik (4 hard vs 4 easy) | kills dalam rentang sehat (3–200), 0 NaN/OOB | ✓ |
| Benchmark AI 16 bot @60Hz | avg 0.135 ms/frame, p95 0.205 ms, max 5.6 ms | budget 16.7 ms/frame → AI ≈ 0.8% |

## Parameter kesulitan (paket DIFFICULTY, BOTS.md Bagian 6)

| Parameter | Easy | Normal | Hard | Insane |
|---|---|---|---|---|
| Reaction time (s) | 0.8 | 0.45 | 0.25 | 0.12 |
| Turn speed (deg/s) | 120 | 220 | 360 | 540 |
| Aim error (deg @10u) | 6 | 3.5 | 1.8 | 0.8 |
| FOV (deg) | 90 | 100 | 110 | 120 |
| Radius pendengaran (×) | 0.7 | 1.0 | 1.2 | 1.4 |
| Memory (s) | 4 | 7 | 10 | 14 |
| Agresivitas | 0.3 | 0.5 | 0.7 | 0.9 |

Error tracking decay: sigma efektif = aimError × (1 + 0.01·dist) ÷ (1 + min(1, trackSec/2)).

## Catatan tuning awal (observasi in-game)

- Normal: duel bot-vs-bot seimbang (skor tersebar 1–2 kill per 35 dtk / 7 bot) — terasa hidup tanpa membantai.
- Retreat HP ≤30 terlihat natural; musuh sempat mengejar via chase lastKnown.
- Fire gate 2+aimError derajat + reaction time membuat easy benar-benar lambat bereaksi.
- Backlog tuning lanjutan: hit-reaction animasi, kepribadian per-bot (agresif/pengintai) via bobot goal, spawn teraman berbasis threat map.
