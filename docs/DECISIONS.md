# DECISIONS.md

## ADR-001: Transport awal pakai `ws` mentah, belum Colyseus
- **Konteks:** Fase 0 butuh server WS jalan cepat untuk fondasi.
- **Opsi:** (a) Colyseus full, (b) `ws` + protokol sendiri, (c) uWebSockets.js.
- **Keputusan (sementara, revisi setelah riset selesai):** `ws` mentah dengan JSON protokol placeholder untuk Fase 0.
- **Alasan:** meminimalkan surface area di fase fondasi; struktur `GameRoom` sudah diabstraksi sehingga migrasi ke Colyseus (jika riset mengkonfirmasi) tidak menyentuh client. HASIL RISET SUBAGENT AKAN MENENTUKAN — lihat ADR-002.
