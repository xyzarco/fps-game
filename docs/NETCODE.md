# NETCODE.md — model netcode final

Detail blueprint hasil riset, siap diimplementasi Fase 2-3. Sumber lengkap di DECISIONS ADR-005.

## 1. Model waktu
- Fixed timestep 60Hz (dt=16.67ms), accumulator loop klien & server; clamp max 5 step/frame (anti spiral of death).
- Snapshot 20-30Hz: Colyseus `setPatchRate(33-50ms)`. Sim 60Hz internal, patch dikirim di snapshot rate.
- Input ditandai tick asal (ring buffer modulo tick seperti Quake 3 usercmd).

## 2. Prediksi + rekonsiliasi (pemain lokal)
1. Klien sampling input per tick, simpan queue {seq, tick} + **langsung terapkan** ke state prediksi (0 latency).
2. Kirim input via room messages (reliable WebSocket), bawa seq.
3. Server sim 60Hz otoritatif.
4. Snapshot membawa `lastProcessedSeq` + state otoritatif pemain.
5. Terima snapshot: jika ada input belum di-ack → **rewind ke state server, replay input dengan seq > lastProcessedSeq**. Koreksi besar di-blend smooth (gaya Source), bukan snap.
- Catatan Colyseus: state patches untuk entity remote; prediksi lokal hidup di klien (ack via field/message khusus).

## 3. Interpolasi entity remote
- Buffer ≥3 snapshot; render di `renderTime = clientTime - 100ms`, lerp posisi / slerp rotasi antara 2 snapshot yang mengapit renderTime.
- 100ms @ 20-30Hz menutup 2-3 snapshot (tahan 1 packet loss).
- Fallback: ekstrapolasi velocity bounded ≤200ms, lebih baik freeze singkat daripada ekstrapolasi masuk dinding.
- JANGAN interpolasi pemain lokal (sudah diprediksi, selalu "sekarang").

## 4. Lag compensation (hitscan)
- Server simpan history posisi/hitbox ~1 detik per tick.
- Saat tembak: rewind ke waktu dilihat penembak (`serverTime - RTT/2 - interpDelay`), **clamp ≤200-250ms**.
- Resolve hitscan di dunia rewound, broadcast hit. Tradeoff terdokumentasi: korban bisa kena tepat setelah naik cover — acceptable, clamp menjaga bound.

## 5. Kuantisasi & kompresi
- Colyseus schema sudah delta-diff per field; pakai quantized floats untuk posisi/rotasi.
- Manual (jika binary kustom): posisi fixed-point (1/128), velocity ±32 m/s ~11 bit/axis, rotasi smallest-three quat 29 bit, HP/ammo 8 bit.
- Event ephemeral (hit, tracer, muzzle) = room broadcast messages, bukan schema fields.
- Budget target: ~15KB/s per klien @30Hz, 20 entity, ~24B/entity delta.

## 6. Urutan implementasi
1. Fixed-tick server + accumulator klien. 2. Snapshot broadcast + lastProcessedSeq. 3. Prediksi + replay. 4. Interpolasi 100ms. 5. Hitbox history + rewind hitscan. 6. Kuantisasi + binary. 7. Test 150/250/400ms latency + 2-5% loss (netem), verifikasi tanpa rubber-banding.

## Referensi
- Gabriel Gambetta — Fast-Paced Multiplayer (4 bagian): https://www.gabrielgambetta.com/client-server-game-architecture.html
- Valve — Source Multiplayer Networking: https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking
- Glenn Fiedler — Fix Your Timestep: https://gafferongames.com/post/fix_your_timestep/ ; Snapshot Compression: https://gafferongames.com/post/snapshot_compression/
- Quake 3 networking: https://research.ncl.ac.uk/game/mastersdegree/gametechnologies/networkingtutorials/2structuringdata/Networking%20-%20Structuring%20Data.pdf
- Colyseus 0.18 migration: https://docs.colyseus.io/migrating/0.18
