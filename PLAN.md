# PLAN.md — Game FPS Browser Multiplayer Online

> Dokumen ini adalah **brief lengkap untuk AI agent**. Baca seluruhnya sebelum menulis kode. Kerjakan secara bertahap sesuai fase, dan jangan lompat fase sebelum kriteria penerimaan (acceptance criteria) fase sebelumnya terpenuhi.

---

## 0. Instruksi Utama untuk Agent (WAJIB DIBACA)

1. **Cari semua resource sendiri di internet.** Kamu punya akses internet, jadi gunakan. Jangan mengandalkan ingatan untuk hal berikut, dan **verifikasi lewat pencarian**:
   - Dokumentasi resmi & **versi terbaru** library (Three.js, Colyseus, Rapier, Vite, dll.). Cek npm / GitHub releases / changelog; jangan memakai API yang sudah deprecated.
   - Tutorial, artikel, dan talk tentang netcode FPS (rujukan di Bagian 12).
   - **Aset game**: model 3D, tekstur, HDRI/skybox, suara, musik, font, ikon, crosshair, VFX (rujukan sumber di Bagian 9).
   - Contoh implementasi open-source sebagai referensi (bukan untuk disalin mentah-mentah tanpa memeriksa lisensi).
   - Solusi untuk error/bug: cari issue GitHub, StackOverflow, forum resmi.
2. **Lisensi adalah aturan keras.** Hanya pakai aset/kode berlisensi **CC0, CC-BY, MIT, Apache-2.0, BSD, atau setara** yang membolehkan penggunaan komersial. Hindari CC-NC, CC-ND, GPL (untuk kode yang di-bundle ke klien), dan aset "free tapi tanpa lisensi jelas". Catat **setiap** aset eksternal di `CREDITS.md` (nama, pembuat, URL sumber, lisensi, tanggal diunduh). Simpan salinan teks lisensi bila diwajibkan.
3. **Catat keputusan teknis** di `docs/DECISIONS.md` (format ringkas ADR: konteks → opsi → keputusan → alasan). Bila ada yang menyimpang dari PLAN ini, tulis alasannya.
4. **Bekerja iteratif & terverifikasi.** Setiap fase: jalankan, uji, buktikan berfungsi (screenshot/log/test). Jangan menyatakan "selesai" tanpa menjalankan game dan mengujinya dengan minimal 2 klien bersamaan.
5. **Commit kecil & sering** dengan pesan jelas (Conventional Commits). Jaga `main` selalu bisa dijalankan.
6. **Bila ragu, pilih opsi paling sederhana yang memenuhi acceptance criteria.** Hindari over-engineering. Catat ide tambahan di `docs/BACKLOG.md`, jangan langsung dikerjakan.
7. **Bila terblokir** (butuh akun, kredensial, keputusan desain besar), berhenti, tulis pertanyaan jelas di `docs/QUESTIONS.md`, lalu lanjutkan bagian lain yang tidak terblokir.
8. **Jangan pernah** meng-commit secret (API key, token). Gunakan `.env` + `.env.example`.

---

## 1. Visi & Ruang Lingkup

**Produk:** FPS multiplayer berbasis browser (desktop), langsung main lewat URL tanpa instalasi, gaya arena shooter cepat (seperti Quake/CS-lite) dengan visual low-poly bersih.

**Target MVP:**
- 8–16 pemain per room, mode **Free-For-All Deathmatch**, lalu **Team Deathmatch**.
- Minimal 1 map, 3–4 senjata, respawn, scoreboard, kill feed, HUD.
- Rasa gerak & tembak yang responsif meski ping 50–150 ms.
- Berjalan stabil **60 FPS** di laptop menengah (iGPU modern) pada Chrome/Edge/Firefox terbaru.

**Di luar lingkup MVP (masuk backlog):** mobile/touch, akun & login permanen, ranking/ELO, voice chat, in-app purchase, custom map editor, mode battle royale.

---

## 2. Tech Stack (default — boleh diganti dengan alasan tercatat di DECISIONS.md)

| Area | Pilihan default | Catatan |
|---|---|---|
| Bahasa | **TypeScript** (strict) di klien & server | Berbagi tipe & kode simulasi |
| Monorepo | **pnpm workspaces** (opsional Turborepo) | `apps/client`, `apps/server`, `packages/shared` |
| Build klien | **Vite** | HMR cepat |
| Render 3D | **Three.js** (WebGL2; pertimbangkan WebGPU renderer hanya sebagai opsi lanjutan) | Cek versi terbaru |
| Fisika/collision | **Rapier** (`@dimforge/rapier3d-compat` atau varian deterministic) *atau* controller kinematik kustom (capsule vs AABB/trimesh) | Harus **identik** di klien & server. Riset & putuskan |
| Server | **Node.js** + **Colyseus** (room, matchmaking, state sync) di atas WebSocket | Alternatif: `ws`/uWebSockets.js + protokol sendiri, atau geckos.io (WebRTC UDP-like) |
| Serialisasi | Colyseus Schema *atau* binary kustom (`ArrayBuffer`/`DataView`) | Hindari JSON untuk snapshot tick |
| Audio | **Web Audio API** (atau Howler.js) + audio posisional 3D | |
| UI/HUD | HTML/CSS overlay (+ sedikit canvas) | Ringan, mudah di-style |
| State UI | Zustand / signals ringan (opsional) | |
| Test | **Vitest** (unit), **Playwright** (e2e multi-klien) | |
| Lint/format | ESLint + Prettier | |
| Deploy klien | Cloudflare Pages / Netlify / Vercel | Static hosting + CDN |
| Deploy server | VPS (Hetzner/DigitalOcean) atau Fly.io/Railway, **Docker** | WSS wajib (TLS via Caddy/Nginx) |
| CI/CD | GitHub Actions | lint + test + build + deploy |

> **Prinsip:** Server **authoritative**. Klien hanya mengirim *input*, tidak pernah mengirim posisi/damage/hit sebagai kebenaran.

---

## 3. Struktur Repo

```
/
├─ PLAN.md
├─ README.md
├─ CREDITS.md                 # semua aset & lisensi
├─ docs/
│  ├─ DECISIONS.md
│  ├─ BACKLOG.md
│  ├─ QUESTIONS.md
│  ├─ NETCODE.md              # penjelasan netcode final yang diimplementasi
│  └─ PROTOCOL.md             # daftar pesan jaringan
├─ packages/
│  └─ shared/                 # DIPAKAI KLIEN & SERVER
│     ├─ src/
│     │  ├─ sim/              # movement, collision, weapon logic (deterministik)
│     │  ├─ protocol/         # tipe pesan, encode/decode, konstanta
│     │  ├─ config/           # tick rate, senjata, map metadata
│     │  └─ index.ts
├─ apps/
│  ├─ client/
│  │  ├─ src/
│  │  │  ├─ core/             # game loop, input, pointer lock
│  │  │  ├─ render/           # scene, kamera, viewmodel, VFX, post-fx
│  │  │  ├─ net/              # koneksi, prediksi, rekonsiliasi, interpolasi
│  │  │  ├─ audio/
│  │  │  ├─ ui/               # menu, HUD, scoreboard, killfeed, settings
│  │  │  └─ main.ts
│  │  └─ public/assets/       # model, tekstur, audio (terkompresi)
│  └─ server/
│     ├─ src/
│     │  ├─ rooms/            # GameRoom, lobby
│     │  ├─ systems/          # movement, hit detection, respawn, scoring
│     │  ├─ anticheat/
│     │  └─ index.ts
│     └─ Dockerfile
├─ tools/                     # script optimasi aset (gltf-transform, dll.)
└─ .github/workflows/
```

---

## 4. Arsitektur Game & Netcode

### 4.1 Model waktu
- **Server tick** simulasi tetap: default **60 Hz** (fixed timestep; akumulator).
- **Snapshot rate** ke klien: default **20–30 Hz** (tunable lewat config).
- **Klien**: render per `requestAnimationFrame`, simulasi input pada fixed timestep yang sama dengan server.
- Semua konstanta (tick rate, gravitasi, kecepatan, dll.) berada di `packages/shared/config` — satu sumber kebenaran.

### 4.2 Alur input → state
1. Klien mengumpulkan input per tick: `{seq, tick, moveX, moveZ, yaw, pitch, jump, crouch, fire, reload, weaponSlot}`.
2. Klien **langsung menerapkan** input ke state lokal (**client-side prediction**) memakai kode `shared/sim` yang sama dengan server.
3. Input dikirim ke server (kirim juga beberapa input terakhir sebagai redundansi terhadap packet loss).
4. Server memproses input per pemain secara berurutan, memvalidasi (batas kecepatan, rate fire, cooldown), lalu mengubah state otoritatif.
5. Server mengirim snapshot berisi state semua entitas relevan + `lastProcessedSeq` per pemain.
6. Klien **rekonsiliasi**: bila state server ≠ prediksi, putar ulang (replay) input yang belum di-ack dari state server. Koreksi kecil di-*smooth*, bukan snap.

### 4.3 Pemain lain
- **Entity interpolation**: render pemain lain ~100 ms (2–3 snapshot) di belakang waktu server agar halus. Tambahkan ekstrapolasi terbatas bila snapshot terlambat.
- Sinkronisasi jam klien–server (ping/pong, estimasi offset & RTT, di-smooth).

### 4.4 Hit detection & lag compensation
- Senjata **hitscan**: server melakukan raycast. Gunakan **server-side rewind / lag compensation**: simpan riwayat posisi hitbox pemain (mis. ~1 detik), saat memproses tembakan, rewind ke waktu yang dilihat penembak (`waktu_server − RTT/2 − interpolation_delay`), batasi maksimal rewind (mis. 200–250 ms).
- Senjata **projectile** (mis. roket): disimulasikan di server, klien menampilkan prediksi visual.
- Hitbox: capsule/box per bagian (kepala, badan, kaki) dengan pengali damage.
- Klien menampilkan efek tembakan/tracer **segera** (prediksi), tetapi hit marker & damage **hanya** setelah konfirmasi server.

### 4.5 Optimasi bandwidth
- Delta compression / hanya kirim field yang berubah; kuantisasi (posisi ke int16/fixed-point, sudut ke 8–16 bit).
- Interest management sederhana (opsional: kirim detail penuh hanya untuk pemain dalam radius/visibility).
- Target: **< 30 KB/s per klien** downstream pada 16 pemain, **< 5 KB/s** upstream.

### 4.6 Lobby & matchmaking
- Halaman utama: input nickname → **Quick Play** (gabung room terbuka/otomatis buat) atau **Create/Join Room** dengan kode.
- Room: max pemain, nama map, mode, status (waiting / countdown / in-progress / round-end).
- Siklus match: warmup → match (mis. 10 menit atau 25 kill) → scoreboard akhir → map/ronde berikutnya.
- Reconnect singkat (token sesi) bila koneksi terputus < 15 detik.

### 4.7 Anti-cheat dasar (server-side)
- Validasi: kecepatan maksimum, teleport, fire rate, ammo, jumlah input per detik (rate limit).
- Abaikan/penalti input yang tidak masuk akal; log insiden.
- Jangan kirim data yang tidak perlu diketahui klien (mis. posisi pemain di luar jangkauan visibilitas bila interest management aktif).
- Sanitasi nickname/chat; batasi panjang dan karakter.
- Catatan: anti-cheat penuh di luar lingkup MVP; fokus pada *server authoritative* + validasi.

---

## 5. Gameplay

### 5.1 Kontrol (default, bisa di-rebind)
`WASD` gerak · `Mouse` bidik (Pointer Lock API) · `Space` lompat · `Ctrl/C` jongkok · `Shift` jalan pelan · `LMB` tembak · `RMB` zoom/ADS (opsional) · `R` reload · `1–4`/scroll ganti senjata · `Tab` scoreboard · `Enter` chat · `Esc` menu.

### 5.2 Movement
- Gerak FPS yang terasa: akselerasi/friction, air control, *bunny-hop* ringan (opsional), jongkok, tangga/slope handling, collision capsule.
- Fall damage **tidak** ada di MVP.

### 5.3 Senjata (MVP, nilai awal tunable di `shared/config/weapons.ts`)
| Senjata | Tipe | Damage | Fire rate | Catatan |
|---|---|---|---|---|
| Pistol | hitscan | 20 | semi-auto | senjata awal, ammo tak terbatas cadangan |
| Assault Rifle | hitscan | 14 | ~11/s auto | recoil pattern + spread |
| Shotgun | hitscan multi-pellet | 8×10 | ~1/s | damage turun menurut jarak |
| Sniper | hitscan | 90 | ~1/1.5s | scope, bolt delay |
| (opsional) Rocket Launcher | projectile | 100 AoE | ~1/s | splash & knockback |

### 5.4 Aturan
- HP 100 (+ armor opsional). Respawn 3 detik di spawn point teraman (jauh dari musuh, tidak dilihat musuh).
- Spawn protection 2 detik.
- Pickup: health, ammo, armor (respawn timer).
- Skor: kill +1, death 0 (FFA); tim: skor tim.

### 5.5 HUD & UI
Crosshair (dapat dikustomisasi), HP/armor, ammo, nama senjata, kill feed, indikator damage (arah), hit marker + suara, scoreboard (Tab), timer & skor match, indikator ping/FPS/packet loss, chat, minimap (opsional).
**Settings:** sensitivitas, FOV, volume (master/SFX/musik), kualitas grafis (preset), key bindings, tampilkan FPS/ping. Simpan di `localStorage`.

---

## 6. Rendering & Performa

- Gaya visual **low-poly/stylized** agar ringan dan konsisten dengan aset gratis.
- Teknik: `InstancedMesh` untuk objek berulang, frustum culling, batas draw call (target **< 200**), shadow map hanya untuk cahaya utama (resolusi disesuaikan preset), baked lighting/lightmap untuk map statis bila memungkinkan.
- **Viewmodel** (senjata first-person) dirender pada kamera/layer terpisah dengan FOV sendiri agar tidak menembus dinding.
- VFX: muzzle flash, tracer, impact decal/partikel, blood/hit spark (ringan), shell eject (opsional).
- Post-processing minimal & opsional (FXAA/SMAA, bloom ringan); matikan di preset rendah.
- Aset: kompres geometri dengan **Draco/Meshopt**, tekstur dengan **KTX2/Basis** (gunakan `gltf-transform`), ukuran total download awal **< 25 MB** (idealnya < 15 MB), lazy-load aset non-esensial.
- Hindari GC spike: object pooling untuk partikel/proyektil/vektor sementara; jangan alokasi di hot loop.
- Sediakan profil performa (stats.js / `renderer.info`) dan debug overlay (toggle).
- Anggaran frame: 16.6 ms; catat hasil benchmark di `docs/PERFORMANCE.md`.

---

## 7. Map & Level Design

- MVP: **1 map arena** berukuran sedang (ruang tembak jelas, 2–3 level vertikal, jalur flank, beberapa cover) untuk 8–16 pemain.
- Alur kerja: modelkan di **Blender** (atau pakai kit modular gratis) → ekspor **glTF/GLB** → buat **collision mesh sederhana** terpisah (box/convex/trimesh sederhana) untuk server & klien.
- Metadata map (spawn points, pickup, bounds) disimpan di JSON/`extras` glTF, dimuat oleh server dan klien dari sumber yang sama.
- Server memuat **hanya** data collision/metadata (bukan tekstur/visual).
- Rencanakan 2–3 map pada fase lanjutan.

---

## 8. Audio

- Efek: tembakan per senjata, reload, langkah kaki (per material), lompat/mendarat, hit marker, damage, kematian, pickup, UI click, countdown.
- Audio posisional 3D (PannerNode) untuk tembakan & langkah pemain lain; oklusi sederhana opsional.
- Musik menu/ambient opsional (loop, volume terpisah).
- Format: **OGG/Opus** atau MP3/AAC dengan fallback; normalisasi loudness; jangan mulai audio sebelum interaksi pengguna (kebijakan autoplay browser).

---

## 9. Sumber Resource (agent wajib mencari & memverifikasi sendiri)

> Daftar ini hanya **titik awal**. Cari lebih luas di internet, bandingkan opsi, dan pilih yang kualitas + lisensinya terbaik. Verifikasi lisensi **per aset**, bukan hanya per situs.

**Model 3D / environment kit / senjata**
- Kenney (kenney.nl) — CC0, kit low-poly (termasuk blaster/FPS kit)
- Quaternius (quaternius.com) — CC0, karakter & environment low-poly
- Poly Pizza (poly.pizza) — model low-poly (cek lisensi per model)
- Sketchfab (filter *Downloadable* + CC0/CC-BY), OpenGameArt.org, itch.io (game assets, filter lisensi), Mixamo (animasi karakter; cek syarat penggunaan terbaru), Smithsonian Open Access / NASA (3D tertentu)

**Tekstur / HDRI / material**
- Poly Haven (polyhaven.com) — CC0 (HDRI, tekstur, model)
- ambientCG (ambientcg.com) — CC0 PBR
- 3dtextures / Textures.com (cek batasan lisensi)

**Audio**
- Freesound.org (filter CC0 / CC-BY), OpenGameArt, Kenney audio, Sonniss GDC Game Audio Bundle (cek syarat), Pixabay Audio/Sound (cek lisensi), incompetech/FreePD (musik)

**Font & ikon**
- Google Fonts (OFL), Game-icons.net (CC-BY), Kenney UI pack (CC0)

**Kode, library & referensi implementasi**
- Dokumentasi: threejs.org/docs, docs.colyseus.io, rapier.rs, vitejs.dev, MDN (Pointer Lock, Web Audio, WebSocket, WebRTC, WebTransport, Gamepad)
- Contoh/open-source untuk dipelajari (cek lisensi sebelum menyalin): contoh resmi Three.js (`misc_controls_pointerlock`, `games_fps`), repo FPS browser open-source di GitHub, contoh Colyseus, proyek `three-mesh-bvh` (raycast/collision cepat), `gltf-transform`, `stats.js`, `lil-gui`/`tweakpane` (debug).

**Alat**
- Blender, gltf-transform CLI, gltfpack/meshoptimizer, KTX-Software (`toktx`), Audacity/ffmpeg, TexturePacker alternatif.

---

## 10. Fase Pengerjaan & Acceptance Criteria

### Fase 0 — Riset & Setup (hasil: fondasi repo)
**Tugas**
- Riset versi terbaru semua dependency; konfirmasi stack di Bagian 2, update `DECISIONS.md`.
- Inisialisasi monorepo, TypeScript strict, ESLint/Prettier, Vite, Vitest, CI dasar.
- Buat `README.md` (cara menjalankan dev, test, build) dan `CREDITS.md` kosong berstruktur.
**Selesai bila:** `pnpm install && pnpm dev` menjalankan klien + server; CI hijau; halaman kosong Three.js tampil.

### Fase 1 — Single-player Core (tanpa jaringan)
**Tugas**
- Game loop fixed-timestep, input, Pointer Lock, kamera FPS.
- Movement + collision di `packages/shared/sim` (jalan, lompat, jongkok, tangga/slope).
- Muat map uji (greybox) + collision.
- Satu senjata hitscan dengan viewmodel, muzzle flash, impact, ammo/reload; target dummy/bot diam.
- HUD dasar.
**Selesai bila:** gerak terasa responsif, tidak tembus dinding, tidak "nyangkut"; unit test untuk sim lulus; 60 FPS pada greybox.

### Fase 2 — Multiplayer Fondasi
**Tugas**
- Server Colyseus (GameRoom), koneksi, join/leave, sinkron jam.
- Kirim input, server menjalankan sim yang sama, kirim snapshot.
- Client-side prediction + rekonsiliasi untuk pemain lokal; interpolasi pemain lain.
- Representasi pemain lain (model/placeholder), nickname di atas kepala.
**Selesai bila:** 2+ tab browser bisa bergerak bersama di map yang sama; tidak ada rubber-banding saat ping 0 ms; gerakan tetap halus dengan simulasi **100 ms latency + 2% packet loss** (uji dengan tool throttle/netem atau latency simulator internal).

### Fase 3 — Combat Otoritatif
**Tugas**
- Hit detection server-side + lag compensation, damage, HP, kematian, respawn, spawn point logic.
- Hit marker/damage indicator, kill feed, scoreboard, skor.
- Beberapa senjata (Bagian 5.3), pickup, switch & reload tersinkron.
- Rate limit & validasi input dasar.
**Selesai bila:** tembakan akurat pada target bergerak dengan ping ~100 ms (verifikasi lewat log & uji manual); tidak bisa menembak melebihi fire rate walau input dimanipulasi; match FFA lengkap dari mulai sampai skor akhir.

### Fase 4 — Lobby, Match Flow, UI/UX
**Tugas**
- Menu utama, nickname, Quick Play, Create/Join by code, daftar room.
- Siklus match (warmup → match → hasil → ronde baru), mode TDM + pembagian tim.
- Settings (sensitivitas, FOV, volume, grafis, keybind), chat, indikator ping/FPS.
- Reconnect.
**Selesai bila:** pemain baru bisa masuk lewat URL → bermain 1 match penuh tanpa panduan; settings tersimpan antar sesi.

### Fase 5 — Konten & Polish
**Tugas**
- Map final (aset dari sumber berlisensi Bagian 9), lighting, skybox, props.
- Model/animasi karakter & senjata final, VFX, audio lengkap (posisional).
- Optimasi aset (Draco/Meshopt/KTX2), preset grafis, loading screen dengan progress.
- Profiling & perbaikan performa; pooling objek.
**Selesai bila:** 60 FPS pada target perangkat dengan 16 pemain; download awal sesuai anggaran; `CREDITS.md` lengkap dan akurat.

### Fase 6 — Hardening, Test & Deploy
**Tugas**
- Test e2e Playwright multi-klien (join, gerak, tembak, kill, scoreboard).
- Load test server (bot klien headless, mis. 10 room × 16 bot); ukur CPU/memori/bandwidth per room.
- Logging terstruktur, health-check, metrik dasar (jumlah room/pemain, tick time, snapshot size).
- Dockerfile, deploy server (WSS + TLS), deploy klien ke CDN, domain, CORS/Origin check, rate limit koneksi.
- Dokumentasi: `NETCODE.md`, `PROTOCOL.md`, `README.md` final.
**Selesai bila:** game dapat dimainkan publik via URL HTTPS; satu server tahan beban target tanpa tick overrun (> 90% tick selesai dalam anggaran waktu); CI/CD otomatis.

### Fase 7 (Backlog) — Ekstensi
Bot AI, mode tambahan, akun & leaderboard, replay/killcam, voice chat (WebRTC), dukungan gamepad, lebih banyak map, WebTransport/UDP-like transport, cosmetic.

---

## 11. Testing & Kualitas

- **Unit:** movement, collision, damage, fire rate, serialisasi/deserialisasi protokol (round-trip), kuantisasi.
- **Determinisme:** test yang menjalankan sim klien & server dengan input sama dan memastikan hasil sama (toleransi eksplisit).
- **Integrasi/e2e:** Playwright dengan 2–4 klien; skenario join → gerak → tembak → kill → respawn → akhir match.
- **Jaringan:** simulator latensi/jitter/loss internal (flag dev) + uji dengan throttling nyata; dokumentasikan hasil.
- **Load:** bot headless; target dan hasil di `docs/PERFORMANCE.md`.
- **Compatibility:** Chrome, Edge, Firefox (terbaru), Safari (best effort). Pastikan graceful fallback bila WebGL2/Pointer Lock tidak tersedia.
- **Aksesibilitas dasar:** rebind tombol, opsi kurangi efek kilat/guncangan kamera, kontras HUD.

---

## 12. Referensi Netcode yang Wajib Dipelajari (cari & baca)

Cari materi berikut di internet dan ringkas temuan relevan di `docs/NETCODE.md`:
- Gabriel Gambetta — *Fast-Paced Multiplayer* (client-side prediction, server reconciliation, entity interpolation, lag compensation)
- Valve Developer Wiki — *Source Multiplayer Networking* & *Lag Compensation*
- Glenn Fiedler (Gaffer On Games) — *Networking for Game Programmers*, *Fix Your Timestep*, *Snapshot Compression*
- Overwatch GDC talk — *Netcode / Gameplay Architecture (ECS)*
- Quake 3 networking model; Rocket League *Physics & Netcode* (GDC)
- Dokumentasi Colyseus (state sync, rooms, matchmaking, `@colyseus/schema`)
- Artikel tentang WebSocket vs WebRTC DataChannel vs WebTransport untuk game real-time

---

## 13. Keamanan, Privasi & Legal

- Server tidak mempercayai klien; validasi semua input; rate limit; batasi ukuran pesan.
- Gunakan **WSS** (TLS) di produksi; cek `Origin`; lindungi dari spam koneksi.
- Sanitasi semua teks pengguna (nickname/chat) — cegah XSS di UI; filter kata kasar dasar (opsional).
- Jangan simpan data pribadi tanpa kebutuhan; bila ada analytics, beri pemberitahuan & patuhi regulasi privasi (mis. UU PDP Indonesia / GDPR bila relevan).
- Pastikan seluruh aset sesuai lisensi (Bagian 0 butir 2); sertakan atribusi in-game (halaman Credits) bila lisensi mewajibkan.
- Jangan memakai nama/aset/merek dagang game komersial.

---

## 14. Risiko & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Desync prediksi klien vs server | Satu kode `shared/sim`; test determinisme; log perbedaan state |
| Lag membuat tembakan "tidak kena" | Lag compensation + batas rewind; HUD ping; uji dengan latensi simulasi |
| FPS rendah di laptop lemah | Preset grafis, instancing, kompresi aset, profil rutin |
| Ukuran aset terlalu besar | Draco/Meshopt/KTX2, lazy load, anggaran ukuran di CI |
| Lisensi aset bermasalah | Whitelist lisensi, `CREDITS.md` wajib, audit sebelum rilis |
| Beban server tinggi | Profiling tick, snapshot delta, batasi pemain/room, scale horizontal per room |
| Cheating | Server authoritative, validasi, rate limit, monitoring |
| Scope creep | Backlog terpisah; patuhi acceptance criteria per fase |

---

## 15. Definition of Done (keseluruhan MVP)

- [ ] Game bisa dimainkan lewat URL publik (HTTPS/WSS) oleh minimal 8 pemain bersamaan dengan pengalaman halus pada ping ≤ 150 ms.
- [ ] Mode FFA dan TDM lengkap dengan lobby, match flow, scoreboard, dan settings.
- [ ] Server authoritative dengan prediksi/rekonsiliasi/interpolasi/lag compensation berfungsi dan terdokumentasi.
- [ ] 60 FPS pada target perangkat; ukuran download awal sesuai anggaran.
- [ ] Seluruh aset berlisensi sah dan tercatat di `CREDITS.md`.
- [ ] Unit, e2e, dan load test ada dan lulus di CI.
- [ ] `README.md`, `NETCODE.md`, `PROTOCOL.md`, `DECISIONS.md`, `PERFORMANCE.md` lengkap dan akurat.

---

## 16. Format Laporan Agent

Setelah setiap fase, tulis ringkasan singkat (di `docs/PROGRESS.md`): apa yang selesai, bukti pengujian (log/screenshot/angka), keputusan yang diambil, masalah terbuka, dan rencana fase berikutnya. Lalu lanjut ke fase berikutnya tanpa menunggu, kecuali ada pertanyaan terblokir di `QUESTIONS.md`.

**Mulai sekarang dari Fase 0.**
