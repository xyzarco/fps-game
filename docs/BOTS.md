# BOTS.md — Panduan Implementasi Single Player dengan Musuh Bots

> Dokumen pendamping `PLAN.md`. Baca `PLAN.md` terlebih dahulu (terutama Bagian 2 stack, Bagian 4 arsitektur, Bagian 5 gameplay). Dokumen ini menjelaskan cara membuat **mode single player melawan bot AI** pada game FPS browser, dengan desain yang **bisa dipakai ulang sebagai bot di server multiplayer**.

---

## 0. Instruksi Utama untuk Agent (WAJIB DIBACA)

1. **Cari semua resource sendiri di internet.** Verifikasi dokumentasi & versi terbaru library (navmesh, AI, Three.js), baca artikel/talk tentang AI FPS (Bagian 14), dan cari aset tambahan (model karakter, animasi, suara) bila perlu. Jangan mengandalkan ingatan untuk API library; cek dokumentasi resmi.
2. **Aturan lisensi sama dengan PLAN.md:** hanya CC0 / CC-BY / MIT / Apache-2.0 / BSD atau setara. Catat setiap aset/library baru di `CREDITS.md`.
3. **Catat keputusan teknis** di `docs/DECISIONS.md` (mis. memilih Recast vs three-pathfinding, FSM vs Behavior Tree vs Utility AI).
4. **Bot harus bermain adil.** Bot **tidak boleh** memakai informasi yang tidak bisa diketahui pemain (tidak ada wallhack, tidak ada aimbot sempurna, tidak ada reaksi instan). Semua "kecerdasan" harus lewat persepsi terbatas + waktu reaksi + error bidikan.
5. **Bot = pemain biasa yang inputnya dihasilkan AI.** Bot menggunakan simulasi movement, senjata, damage, dan respawn yang **sama persis** dengan pemain manusia. Jangan membuat jalur logika khusus bot untuk fisika/damage.
6. Kerjakan bertahap per fase (Bagian 11), uji tiap fase, commit kecil & sering. Bila terblokir, tulis di `docs/QUESTIONS.md` dan lanjutkan bagian lain.

---

## 1. Tujuan & Ruang Lingkup

**Tujuan:** pemain bisa menekan **"Play vs Bots"** di menu dan langsung bermain tanpa server online: bertarung melawan N bot yang bergerak natural, menembak, mengambil pickup, mundur saat HP rendah, dan punya tingkat kesulitan yang bisa dipilih.

**Masuk lingkup:**
- Mode **Deathmatch vs Bots** (FFA) dan **Team Deathmatch** (bot sebagai rekan & lawan).
- Opsional: **Survival/Wave** dan **Practice Range** (target latihan).
- Navigasi navmesh, persepsi (penglihatan + pendengaran + memori), pengambilan keputusan, bidikan manusiawi, 4 tingkat kesulitan.
- Debug overlay & tool pengujian bot.

**Di luar lingkup (backlog):** bot belajar (ML/RL), voice line kompleks, komunikasi taktis antar bot yang rumit, bot di server online (lihat Fase B7 — hanya integrasi opsional).

---

## 2. Arsitektur

### 2.1 Prinsip
```
            ┌──────────────┐   PlayerInput    ┌────────────────────┐
 Manusia ──▶│ Input manager│─────────────────▶│                    │
            └──────────────┘                  │  Simulasi bersama  │
            ┌──────────────┐   PlayerInput    │  (packages/shared) │
 Bot AI  ──▶│  BotBrain    │─────────────────▶│  movement, weapon, │
            └──────────────┘                  │  damage, respawn   │
                                              └────────────────────┘
```
- `BotBrain.think(worldView, dt) → PlayerInput` — keluarannya **persis tipe input pemain** (`moveX, moveZ, yaw, pitch, jump, crouch, fire, reload, weaponSlot`).
- Dengan begitu bot otomatis tunduk pada aturan fisika, fire rate, ammo, dan hit detection yang sama.

### 2.2 `GameHost` abstraction (penting)
Buat interface `GameHost` agar HUD/render/UI tidak peduli apakah game online atau lokal:
- `NetworkGameHost` → terhubung ke server Colyseus (multiplayer).
- `LocalGameHost` → **menjalankan logika room/server di dalam browser** (in-process, tanpa jaringan): memproses input pemain + bot, hit detection, damage, respawn, skor, lalu mengirim state ke renderer lewat antarmuka yang sama dengan snapshot.
- Logika game otoritatif (systems: movement, hit detection, respawn, scoring) harus dapat dijalankan **tanpa** Colyseus/WebSocket — pisahkan dari lapisan transport (mis. paket/bagian `game-core` yang dipakai `LocalGameHost` dan `GameRoom` server). Catat di `DECISIONS.md` bagaimana pemisahan ini dilakukan.
- Single player: prediksi/rekonsiliasi **dimatikan** (latensi 0), interpolasi pemain lain opsional.

### 2.3 Struktur folder (tambahan)
```
packages/shared/src/ai/
├─ BotBrain.ts            # titik masuk: think() → PlayerInput
├─ blackboard.ts          # memori kerja bot (target, last known pos, dsb.)
├─ perception/            # vision.ts, hearing.ts, memory.ts
├─ navigation/            # navmesh query, path follow, stuck detection
├─ behavior/              # fsm.ts / utility.ts, state-state (patrol, chase, combat, ...)
├─ combat/                # aim.ts, fire-control.ts, weapon-select.ts
├─ difficulty.ts          # preset & parameter kesulitan
└─ index.ts

apps/client/src/singleplayer/
├─ LocalGameHost.ts
├─ BotManager.ts          # spawn/kick bot, nama, tim, respawn
├─ modes/                 # deathmatch.ts, tdm.ts, survival.ts, practice.ts
└─ debug/                 # overlay navmesh, path, FOV, state

tools/navmesh/            # script bake navmesh dari map (offline)
```

---

## 3. Navigasi (Navmesh)

**Pilihan (riset & putuskan, catat di DECISIONS.md):**
- **recast-navigation-js** (port Recast/Detour ke WASM, ada integrasi Three.js) — pilihan utama: bake otomatis dari geometri, query path, crowd opsional.
- **three-pathfinding** — navmesh sederhana dari glTF (lebih ringan, kurang fitur).
- **Waypoint graph + A\*** buatan sendiri — fallback paling sederhana (cocok untuk map kecil).

**Tugas:**
1. Buat tool `tools/navmesh` yang **mem-bake navmesh dari collision mesh map** (parameter: radius agen ≈ capsule pemain, tinggi, step height, max slope) dan menyimpannya sebagai file (`.navmesh`/binary) di samping map. Jalankan sebagai langkah build; **jangan** bake saat runtime kecuali sangat cepat.
2. Buat `NavService`: `findPath(from, to) → waypoint[]`, `randomPointOnNavmesh()`, `nearestPoint(pos)`, `isReachable(a, b)`.
3. **Path following:** ikuti waypoint dengan steering (lookahead, pemotongan sudut/“funnel”), hasilkan arah gerak → `moveX/moveZ` relatif terhadap yaw. Hitung ulang path secara berkala (mis. tiap 0.3–0.5 s atau saat target pindah jauh), bukan tiap frame.
4. **Stuck detection:** bila posisi hampir tidak berubah > ~1 s padahal punya tujuan → coba lompat/strafe acak → hitung ulang path → pilih tujuan baru.
5. **Off-mesh link (opsional):** lompatan/jatuh terarah antar platform. Mulai tanpa fitur ini; tambah bila map butuh.
6. Hindari bot saling menumpuk: separation steering sederhana (dorongan ringan menjauh dari bot terdekat).

---

## 4. Persepsi (Perception)

Bot hanya boleh bereaksi terhadap apa yang "dilihat/didengar".

### 4.1 Penglihatan
- Kerucut pandang (FOV ±80–110° tergantung kesulitan), jarak maksimum, dan **line-of-sight raycast** ke titik-titik tubuh target (kepala + dada + kaki).
- Cek visibilitas **tidak tiap frame**: jadwalkan (mis. 5–10 Hz per bot, di-*stagger* antar bot) dan batasi total raycast per frame (budget).
- Waktu **"reaction time"**: target baru terlihat → bot menunggu `reactionTime` sebelum boleh menembak.
- Gunakan BVH (mis. `three-mesh-bvh`) atau struktur collision yang sama dengan server untuk raycast cepat.

### 4.2 Pendengaran
- Event suara dipancarkan oleh simulasi: tembakan (radius besar), langkah kaki (radius kecil, lebih kecil bila jongkok/jalan pelan), reload, pickup, lompat/mendarat.
- Bot yang berada dalam radius pendengaran (dikali faktor kesulitan) menerima event beserta posisi **dengan noise** → state **Investigate**.

### 4.3 Memori
- Simpan `lastKnownPosition`, `lastSeenTime`, perkiraan arah gerak target.
- Memori meluruh (mis. 5–10 s). Setelah target hilang dari pandangan, bot menuju posisi terakhir, mencari sebentar (Search), lalu menyerah.
- Bot juga mengingat: lokasi pickup yang pernah dilihat & timer respawn-nya (perkiraan), serta area tempat ia sering tertembak (opsional).

---

## 5. Pengambilan Keputusan (Behavior)

**Rekomendasi:** mulai dengan **Hierarchical FSM** (mudah di-debug), lalu naik ke **Utility AI** untuk pemilihan goal bila perlu. Behavior Tree/GOAP boleh dipilih bila agent punya alasan kuat (catat di DECISIONS.md). Library AI seperti **Yuka** (steering, FSM, goal-driven) bisa dipakai bila lisensinya cocok — evaluasi dulu.

### 5.1 State utama
| State | Perilaku | Masuk bila | Keluar ke |
|---|---|---|---|
| **Roam/Patrol** | Menjelajah titik acak/berbobot (spawn lawan, pickup, choke point) | Tidak ada target/goal lain | Investigate, Combat, Pickup |
| **Seek Pickup** | Ambil health/ammo/armor/senjata | HP rendah, ammo rendah, atau pickup dekat | Combat (bila bertemu musuh), Roam |
| **Investigate** | Menuju sumber suara / lastKnownPosition, waspada | Mendengar suara / target hilang | Combat, Search, Roam |
| **Combat** | Bidik & tembak, strafe, jaga jarak ideal senjata | Musuh terlihat + reaction time lewat | Chase, Retreat, Investigate |
| **Chase** | Mengejar target yang kabur/hilang sebentar | Target keluar LOS tapi baru terlihat | Combat, Search |
| **Retreat/Cover** | Mundur ke cover/pickup health, reload di tempat aman | HP < ambang atau ammo kosong & musuh dekat | Seek Pickup, Combat |
| **Search** | Periksa area sekitar posisi terakhir target | Setelah Chase gagal | Roam |
| **Dead/Respawn** | Menunggu timer respawn, reset blackboard | HP ≤ 0 | Roam |

### 5.2 Pemilihan target & goal
- Skor target = f(jarak, ancaman (arah senjata ke bot), HP target, visibilitas, apakah baru menyerang bot). Ganti target dengan **histeresis** (jangan flip-flop tiap tick).
- Utility sederhana untuk goal non-combat: `score = bobot × kebutuhan` (butuh HP, butuh ammo, jarak ke pickup, risiko).
- Tambahkan **kepribadian** ringan per bot (agresif / hati-hati / pengintai) lewat bobot berbeda → perilaku lebih beragam.
- **Tick keputusan** 5–10 Hz; **tick gerak/aim** mengikuti tick simulasi (60 Hz).

### 5.3 Mode tim (TDM)
- Bot rekan tidak menembak tim sendiri (cek `teamId` pada LOS & friendly-fire).
- Perilaku tim ringan: ikuti/jaga area dekat rekan manusia, kirim info musuh terlihat ke blackboard bersama (dengan delay), hindari semua menumpuk di satu titik.

---

## 6. Combat: Bidikan & Tembakan yang Manusiawi

**Aim model (wajib realistis):**
- Bot tidak "snap" ke target. Gunakan **kecepatan putar maksimum** (deg/s) dan **smoothing** (mis. critically damped spring) menuju titik bidik.
- **Aim error:** offset acak yang berkurang seiring bot "tracking" target lebih lama; bertambah saat target bergerak cepat, bot bergerak, atau jarak jauh. Tambah *flick overshoot* kecil pada kesulitan rendah.
- **Prediksi gerak target** (lead) hanya untuk senjata projectile / hitscan jarak jauh, dengan akurasi terbatas sesuai kesulitan.
- **Kontrol recoil:** kompensasi sebagian, dengan error.
- **Disiplin tembak:** burst untuk rifle jarak jauh, spray jarak dekat, tidak menembak bila LOS terblokir atau teman di garis tembak, jeda setelah reload.
- **Pemilihan senjata:** berdasarkan jarak & ammo (shotgun dekat, sniper jauh, pistol sebagai cadangan); reload saat aman.
- **Gerak saat bertarung:** strafe kiri-kanan dengan pola acak berinterval, kadang jongkok/lompat, jaga jarak ideal per senjata; jangan terus berlari lurus.
- Semua tembakan lewat **kode weapon/hit yang sama** dengan pemain (spread, damage, headshot multiplier).

**Parameter di `difficulty.ts` (nilai awal; tune lewat playtest & metrik):**

| Parameter | Easy | Normal | Hard | Insane |
|---|---|---|---|---|
| Reaction time (s) | 0.8 | 0.45 | 0.25 | 0.12 |
| Turn speed (deg/s) | 120 | 220 | 360 | 540 |
| Aim error (deg, saat jauh) | 6 | 3.5 | 1.8 | 0.8 |
| FOV (deg) | 90 | 100 | 110 | 120 |
| Radius pendengaran (×) | 0.7 | 1.0 | 1.2 | 1.4 |
| Memori target (s) | 4 | 7 | 10 | 14 |
| Agresivitas (0–1) | 0.3 | 0.5 | 0.7 | 0.9 |
| Pemakaian strafe/cover | rendah | sedang | tinggi | tinggi |

> Insane **tetap tunduk** pada aturan persepsi (tidak melihat tembus tembok).

---

## 7. Mode Game Single Player

- **Deathmatch vs Bots:** pemain + N bot (default 7, rentang 1–15), batas skor/waktu, respawn di spawn teraman, scoreboard & kill feed identik dengan multiplayer.
- **Team Deathmatch:** pemain dibagi tim bersama bot; opsi komposisi tim.
- **Survival/Wave (opsional):** gelombang bot makin banyak/sulit, jeda antar gelombang, drop pickup, skor & high score lokal (`localStorage`).
- **Practice Range (opsional):** target diam/bergerak, bot pasif/latihan, statistik akurasi.
- **Menu setup:** pilih mode, map, jumlah bot, kesulitan (global atau per bot), batas skor/waktu, friendly fire on/off.
- Nama bot dari daftar nama bergaya gamertag (hindari merek/nama orang nyata); avatar/skin dibedakan lewat warna.
- Bot dapat mengisi/keluar dinamis (menjaga jumlah pemain target).

---

## 8. Visual & Audio Bot

- Pakai **model & rig yang sama** dengan pemain lain; animasi digerakkan oleh state: idle, walk/run (blend berdasar kecepatan), strafe, jump, crouch, shoot, reload, hit reaction, death.
- Arah tubuh/kepala mengikuti yaw/pitch bot (pitch kepala/lengan untuk bidikan).
- Efek tembakan, suara langkah, dan suara senjata identik dengan pemain lain (audio posisional 3D) sehingga **pemain bisa mengandalkan suara** untuk mendeteksi bot.
- Nama & indikator tim di atas kepala (opsional di single player; bisa dimatikan).

---

## 9. Performa

- Target: **16 bot @ 60 FPS** di laptop menengah (bersama render game).
- Tick AI: keputusan 5–10 Hz, persepsi di-*stagger*, path replan terbatas, **budget** raycast & pathfinding per frame (time-slicing; antrikan permintaan).
- Jalankan AI di **Web Worker** bila profiling menunjukkan main thread tertekan (siapkan antarmuka berbasis pesan; hati-hati overhead serialisasi). Putuskan berdasar data, bukan asumsi.
- Hindari alokasi di hot path (pool vektor/array hasil path); gunakan spatial grid untuk query "musuh terdekat".
- Catat hasil benchmark di `docs/PERFORMANCE.md` (waktu AI per frame vs jumlah bot).

---

## 10. Debug, Tooling & Pengujian

**Debug overlay (toggle dengan tombol dev):**
- Gambar navmesh, path aktif, waypoint, kerucut FOV, garis LOS, titik lastKnownPosition, radius suara.
- Label di atas bot: nama, state, target, HP, kesulitan.
- Panel statistik: waktu AI/frame, jumlah raycast/frame, jumlah bot stuck.

**Perintah dev/console:** `bot.add [difficulty] [team]`, `bot.kick <id|all>`, `bot.freeze`, `bot.setDifficulty`, `bot.teleport`, `god`, `timescale <x>`, `seed <n>`.

**RNG ber-seed:** semua keputusan acak bot memakai PRNG ber-seed agar bug bisa direproduksi.

**Pengujian otomatis:**
- Unit test: perhitungan FOV/LOS, peluruhan memori, transisi state, aim model (konvergensi, batas turn speed), pemilihan senjata.
- **Simulasi headless bot vs bot** (tanpa render) selama beberapa menit simulasi: ukur *stuck rate*, kill/menit, akurasi per kesulitan, distribusi state, ketiadaan crash/NaN. Jalankan di CI dengan seed tetap.
- Playtest manual terstruktur: checklist "terasa adil?", "terasa hidup?", "ada bot yang diam/berputar?".
- Validasi kesulitan: Easy dapat dikalahkan pemain pemula, Hard menantang pemain berpengalaman — catat metrik (K/D pemain vs tiap level) di `docs/BOTS-TUNING.md`.

---

## 11. Fase Pengerjaan & Acceptance Criteria

> Prasyarat: `PLAN.md` **Fase 1** (core single-player: movement, collision, senjata dasar, map) dan idealnya sebagian **Fase 3** (damage, HP, respawn, kill feed, scoreboard) sudah ada. Bila belum, kerjakan bagian minimal yang dibutuhkan (damage/HP/respawn) di `shared`/`game-core` dengan cara yang tetap bisa dipakai server.

### Fase B0 — Riset & Keputusan
- Riset library navmesh & AI (Bagian 3, 5), referensi (Bagian 14). Putuskan FSM/BT/Utility & navmesh lib, catat di `DECISIONS.md`.
- Buat prototipe kecil: bake navmesh dari map uji & query path.
**Selesai bila:** keputusan tercatat; prototipe path terlihat di overlay debug.

### Fase B1 — LocalGameHost & Bot "Dummy"
- Implementasi `GameHost` + `LocalGameHost`; menu "Play vs Bots"; `BotManager` spawn bot.
- Bot dummy: berdiri/berjalan acak, bisa ditembak, mati, respawn; HP/skor/kill feed bekerja.
**Selesai bila:** pemain bisa bermain 1 match mini vs bot dummy; tidak ada kode transport jaringan yang dibutuhkan; renderer/HUD memakai antarmuka sama dengan multiplayer.

### Fase B2 — Navigasi & Gerak
- Tool bake navmesh, `NavService`, path following, stuck detection, separation.
- Bot roam antar titik acak/berbobot dengan gerakan natural (animasi sesuai).
**Selesai bila:** 8 bot roam 10 menit simulasi headless dengan stuck rate < 2% dan tanpa jatuh keluar map; path terlihat benar di overlay.

### Fase B3 — Persepsi & Memori
- Vision (FOV + LOS + budget raycast), hearing, memory; state Investigate/Search.
**Selesai bila:** bot hanya bereaksi pada musuh yang terlihat/terdengar (diuji: berdiri di balik tembok tidak terdeteksi; tembakan di dekat bot memicu Investigate); tidak ada deteksi tembus dinding.

### Fase B4 — Combat
- Aim model, fire control, pemilihan senjata, strafe, Retreat/Seek Pickup, Chase.
- Integrasi dengan semua senjata MVP.
**Selesai bila:** bot memenangkan/kalah duel secara masuk akal; akurasi & TTK wajar; bot mundur saat HP rendah dan mengambil health; tidak menembak teman (TDM).

### Fase B5 — Kesulitan, Mode & Menu
- `difficulty.ts` 4 level, kepribadian bot, mode DM/TDM (+ Survival/Practice opsional), menu setup.
**Selesai bila:** perbedaan 4 level terasa jelas lewat playtest + metrik; semua mode berjalan dari menu sampai skor akhir.

### Fase B6 — Polish, Performa & Pengujian
- Animasi/hit reaction, audio, optimasi (Worker bila perlu), debug tool lengkap, test headless di CI, dokumentasi `docs/BOTS-TUNING.md`.
**Selesai bila:** 16 bot @ 60 FPS pada perangkat target; test unit & simulasi lulus di CI; checklist DoD di bawah terpenuhi.

### Fase B7 (Opsional) — Bot di Server Multiplayer
- Pindahkan `BotBrain` agar dapat dijalankan di **server** (mengisi room yang kurang pemain), memakai input yang sama dengan pemain. Pastikan AI tidak membebani tick server (tick budget, jumlah bot maksimum per room).
**Selesai bila:** room online dapat diisi bot tanpa merusak performa tick; bot tidak melanggar aturan validasi server.

---

## 12. Definition of Done (Single Player + Bots)

- [ ] "Play vs Bots" berjalan sepenuhnya offline di browser (tanpa server).
- [ ] Bot bergerak lewat navmesh, tidak mudah stuck, tidak jatuh keluar map.
- [ ] Persepsi adil (FOV, LOS, suara, memori); tidak ada wallhack/aimbot sempurna.
- [ ] Aim & tembakan manusiawi dengan 4 tingkat kesulitan yang terukur.
- [ ] Mode DM & TDM selesai; setup menu (jumlah bot, kesulitan, map, batas skor).
- [ ] Bot memakai simulasi/senjata/damage yang sama dengan pemain (kode `shared`).
- [ ] 16 bot @ 60 FPS pada perangkat target; benchmark tercatat.
- [ ] Debug overlay & perintah dev tersedia; simulasi headless ber-seed lulus di CI.
- [ ] Dokumentasi: `DECISIONS.md` diperbarui, `docs/BOTS-TUNING.md`, bagian bot di `README.md`.
- [ ] Seluruh aset/library baru tercatat di `CREDITS.md` dengan lisensi sah.

---

## 13. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Bot terasa "curang" atau terlalu bodoh | Persepsi terbatas + parameter kesulitan; playtest & metrik; tuning iteratif |
| Bot stuck di geometri map | Navmesh dibake dari collision yang sama; stuck detection; test headless |
| AI membebani FPS | Tick rate bertingkat, budget raycast/path, time-slicing, Worker bila perlu |
| Logika game terikat ke jaringan sehingga sulit dipakai offline | `GameHost` abstraction + `game-core` tanpa dependensi transport sejak awal |
| Perilaku bot tidak bisa direproduksi | PRNG ber-seed, log keputusan, replay input |
| Scope creep (AI terlalu rumit) | Mulai FSM sederhana; fitur lanjutan masuk `BACKLOG.md` |

---

## 14. Referensi yang Wajib Dicari & Dipelajari

Cari di internet, ringkas temuan relevan ke `docs/DECISIONS.md` atau catatan fase:
- **Navigasi:** dokumentasi *recast-navigation-js* / Recast & Detour (Mikko Mononen), *three-pathfinding*, artikel "Simple Stupid Funnel Algorithm", Red Blob Games (A\*, pathfinding, steering).
- **AI game:** *Yuka* (library AI JS), buku *Programming Game AI by Example* (Mat Buckland) — cari ringkasan/materi legal, *Game AI Pro* (bab gratis online), GDC talk "Building a Better Battle: Halo 3 AI", "Three States and a Plan: The AI of F.E.A.R." (GOAP), artikel tentang Behavior Tree vs FSM vs Utility AI.
- **Bot FPS klasik:** Quake 3 Arena bot (AAS/botlib), Counter-Strike bot (CS Bot / Podbot / Yapb) — pelajari pola perilaku & waypoint/navmesh.
- **Persepsi & aim:** artikel tentang "AI perception systems", "human-like aim bot AI", "reaction time & aim error models".
- **Teknis web:** `three-mesh-bvh` (raycast cepat), Web Workers & `SharedArrayBuffer` (butuh header COOP/COEP; evaluasi), `Comlink`, Vitest untuk simulasi headless.

---

## 15. Format Laporan Agent

Setelah tiap fase, tambahkan ringkasan di `docs/PROGRESS.md`: yang selesai, bukti uji (angka/log/screenshot), keputusan, masalah terbuka, rencana berikutnya. Lanjutkan ke fase berikutnya tanpa menunggu, kecuali ada pertanyaan terblokir di `QUESTIONS.md`.

**Mulai dari Fase B0.**
