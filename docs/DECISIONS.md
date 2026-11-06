# DECISIONS.md

## ADR-001: Transport awal pakai `ws` mentah, belum Colyseus
- **Konteks:** Fase 0 butuh server WS jalan cepat untuk fondasi.
- **Opsi:** (a) Colyseus full, (b) `ws` + protokol sendiri, (c) uWebSockets.js.
- **Keputusan (sementara, revisi setelah riset selesai):** `ws` mentah dengan JSON protokol placeholder untuk Fase 0.
- **Alasan:** meminimalkan surface area di fase fondasi; struktur `GameRoom` sudah diabstraksi sehingga migrasi ke Colyseus (jika riset mengkonfirmasi) tidak menyentuh client. HASIL RISET SUBAGENT AKAN MENENTUKAN — lihat ADR-002.

## ADR-006: Navigasi bot — recast-navigation-js (Fase B0)
- **Pilihan:** @recast-navigation/core + @recast-navigation/three 0.44.0 (MIT; upstream Recast/Detour zlib-style).
- **Alasan:** bake otomatis dari geometri (BOTS.md rekomendasi utama), query lengkap (computePath, findRandomPoint(AroundCircle), findNearestPoly, getPolyHeight), agent radius/height/step via parameter bake. three-pathfinding 1.3.0 butuh navmesh GLTF siap-pakai (tidak generate) — tidak cocok untuk map AABB kita. Waypoint graph sendiri = fallback jika WASM bermasalah (dicatat, tidak dipilih).
- **Detail bake:** map greybox = 15 AABB → tool `tools/navmesh` emit quad permukaan atas tiap box (triangulasi), bake solo (map 80x80 kecil, tidak perlu tiled). Parameter: cs 0.3, ch 0.2, walkableHeight 1.8, walkableClimb 4 (step 0.5–1.0 unit), walkableRadius 0.4.
- **Risiko diantisipasi:** WASM ~340KB → lazy-load hanya saat mode bot; init() async sekali; WASM object di-destroy manual; versi di-pin 0.44.0 (single-maintainer, churn cepat).

## ADR-007: Behavior — Hierarchical FSM custom (~200 lines), tanpa library
- **Pilihan:** FSM tulis sendiri di packages/shared/src/ai (8 state: Roam, SeekPickup, Investigate, Combat, Chase, Retreat, Search, Dead). Utility AI sederhana untuk goal non-combat bila perlu (B5+).
- **Alasan:** yuka 0.7.8 stale (rilis terakhir ~2022, terikat integrasi three.js Entity — overhead di headless sim). FSM custom = deterministic, testable, PRNG-seedable, tanpa dependency. Behavior Tree/GOAP tidak dibutuhkan untuk scope ini.

## ADR-008: PRNG ber-seed — mulberry32 (inline, tanpa dependency)
- De-facto standard JS game sim, deterministic, seed uint32, period ~4e9 cukup untuk 16 bot. Alea (128-bit) tidak dibutuhkan.

## ADR-009: LOS raycast — slab-method ray vs AABB (pakai raycastBoxes existing)
- three-mesh-bvh 0.9.18 bekerja di triangle mesh — untuk level AABB murni lebih murah ray-AABB manual (sudah ada `raycastBoxes` di shared). BVH hanya bila map berubah jadi mesh kompleks.
- Budget: 16 bot x persepsi 5–10 Hz staggered x ray-AABB O(15 boxes) = trivial (<1ms/frame). **Web Worker tidak dibutuhkan** (estimasi AI 16-160ms/s total = 1.6–16% budget — baru dipertimbangkan bila profiling membuktikan sebaliknya).

## ADR-010: Aim model manusiawi (formula riset)
- Turn clamp: dAngle = clamp(shortestAngle(target-yaw), ±turnSpeed·dt) — 120/220/360/540 deg/s per level.
- Aim error: offset Gaussian 2D di camera-space (right/up), sigma per kesulitan (6/3.5/1.8/0.8°) x (1 + 0.01·dist); resample tiap 250–400ms dengan smoothing lerp tau=100ms (error drift, tidak teleport).
- Fire gate: canSee && now>=reactAt && angularDiff <= 2–4° (scale kesulitan) — plus reaction time 0.8/0.45/0.25/0.12s.
- Target selection: skor = w1/dist + w2·alignment + w3·threat, histeresis x1.2 (anti flip-flop).
- Referensi: Game AI Pro (aim/error chapters, gameaipro.com), Quake 3 g_ai.c (GPL, pola reaction-delay+aim-error+FOV/LOS), GDC 'Building a Better Battle: Halo 3 AI', Steve Polge UT bot papers.

### Temuan bake greybox (eksperimen B0)
- **Bug indices:** non-indexed geometry harus pakai identity indices per-VERTEX (positions.length/3), bukan per-float — penyebab awal "Failed to create Detour navmesh data".
- **walkableClimb/region interplay:** konfigurasi stabil = cs 0.3, ch 0.1, climb 12 voxel (1.2m), radius 0.4, minRegionArea 4, mergeRegionArea 8. climb terlalu kecil mengisolasi tepi (eroded); climb sangat besar (1000) membuat findNearestPoly anomali.
- **Keputusan map:** platform atas (y=2) sengaja TIDAK di-navmesh (ground-only). Bot roam level tanah; platform jadi area keunggulan pemain. Semua spawn point bot di ground. Fisika shared tetap membatasi gerak nyata.
