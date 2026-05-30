# Trigger Data Bug Audit

> **Status: SELESAI** — Fix di-merge ke `main` pada 2026-05-30.
> Rescrape dilakukan via `rescrape_triggers.js`: **96 kartu difix** (48 Bug A/B → null, 48 Bug C → Heal).

---

## Kategori Bug

### Bug A — False positive: Normal Unit Grade 1-3 dapat trigger dari `div.gift` (DZ era)
**Status: ✅ FIXED** — `scrape_en.js` dan `cards.json` sudah dikoreksi via rescrape.
**Penyebab:** Scraper membaca `div.gift` (contoh: `"Over Trigger +100,000,000"`, `"Draw Trigger +10000"`, `"Critical Trigger +5000"`) pada Normal Unit non-trigger dan assign trigger. Gift parser tidak cek apakah kartu memang Trigger Unit.  
**Fix:** Tambah flag `isTriggerUnit` dan guard `canHaveTrigger` di `scrape_en.js` — trigger hanya di-assign jika `grade === 0 || grade === null || isTriggerUnit`.  
**Catatan:** Ini mencakup semua tipe trigger, bukan hanya Over.

Kartu yang teridentifikasi:
| enCardNo | Nama | Grade | Trigger salah |
|---|---|---|---|
| DZ-BT08/049EN | Petite Tilget | 1 | Draw |
| DZ-BT08/094EN | Viogaon | 1 | Draw |
| DZ-BT08/103EN | Agulhas Assault | 1 | Over |
| DZ-BT08/FR03EN | Mass Bullets of Dust Storm, Ivrines | 1 | Over |
| DZ-BT08/FR04EN | Stealth Rogue of Song and Dance, Maika | 1 | Over |
| DZ-BT08/FR33EN | Green Revelation Dragon, Meldeaiza | 2 | Over |
| DZ-BT08/FR34EN | Wise Brave Shooter | 2 | Over |

> Kemungkinan ada banyak lagi di DZ-BT08 dan set DZ lain — perlu audit lanjutan setelah fix scraper.

---

### Bug B — False positive: Fallback scanner scan seluruh halaman HTML
**Status: ✅ FIXED** — `scrape_en.js` dan `cards.json` sudah dikoreksi via rescrape.
**Penyebab:** Fallback di `scrape_en.js:370-378` scan `stripTags(html)` dari seluruh halaman, bukan hanya `div.effect`. Teks "Heal Trigger"/"Critical Trigger"/"Draw Trigger" dari section lain (product listing, tabel kartu terkait) ikut ter-pick up.  
**Fix:** Full-page fallback scanner dihapus sepenuhnya dari `scrape_en.js`. Trigger hanya dibaca dari `div.gift`.

Kartu yang teridentifikasi (non-Grade-0 dengan trigger salah dari fallback):
| enCardNo | Nama | Grade | Trigger salah | Keterangan |
|---|---|---|---|---|
| BT08/001EN | Ultimate Dimensional Robo, Great Daiyusha | 3 | Heal | Old era, gift = "-" |
| BT08/003EN | Arboros Dragon, Sephirot | 3 | Heal | Old era |
| BT08/S01EN | Ultimate Dimensional Robo, Great Daiyusha | 3 | Heal | SP version |
| BT08/S03EN | Arboros Dragon, Sephirot | 3 | Heal | SP version |
| EB09/001EN | Transcendence Dragon, Dragonic Nouvelle Vague | 4 | Heal | Old era |
| EB09/003EN | Blast Bulk Dragon | 3 | Critical | Old era |
| EB09/S01EN | Transcendence Dragon, Dragonic Nouvelle Vague | 4 | Heal | SP version |
| EB09/S03EN | Blast Bulk Dragon | 3 | Critical | SP version |
| DZ-BT01/010EN | Fated One of Miracles, Rezael | 3 | Critical | DZ era |
| DZ-BT07/004EN | Dualmajestar, Astroea=Bico Stella | 3 | Critical | DZ era |
| DZ-BT07/123EN | Obliteration Strategy: Resilience | 2 | Critical | DZ era |
| DZ-BT08/033EN | Hound Raiser, Hinami | 2 | Critical | DZ era |
| DZ-BT08/034EN | Pentaculation Sorceress | 2 | Critical | DZ era |
| DZ-BT08/035EN | Green Revelation Dragon, Meldeaiza | 2 | Draw | DZ era |
| DZ-BT08/037EN | Sylvan Horned Beast, Voldyaar | 2 | Heal | DZ era |
| DZ-BT08/047EN | Beautiful Princess of Placidity, Ardalil | 2 | Critical | DZ era |
| DZ-BT08/048EN | Direful Doll, Altea | 1 | Critical | DZ era |
| ~~DZ-BT08/049EN~~ | ~~Petite Tilget~~ | ~~1~~ | ~~Draw~~ | ~~dipindah ke Bug A~~ |
| DZ-BT08/051EN | Cardinal Fang, Purisma | 3 | Heal | DZ era |
| DZ-BT08/062EN | A Gardener's Treasure | 1 | Critical | DZ era |
| DZ-BT08/063EN | Thumbs Up, Favoral | 2 | Critical | DZ era |
| DZ-BT08/064EN | Step By Step, Lezity | 1 | Draw | DZ era |
| DZ-BT08/066EN | From Me to You, My Song | 3 | Heal | DZ era |
| DZ-BT08/078EN | Steam Fighter, Iddinam | 2 | Critical | DZ era |
| DZ-BT08/079EN | Steam Maiden, Larsa | 2 | Critical | DZ era |
| DZ-BT08/080EN | Adept Wildmaster, Felylne | 1 | Draw | DZ era |
| DZ-BT08/082EN | Bareness Ripper | 1 | Heal | DZ era |
| DZ-BT08/092EN | Sorrowful Ardent Light, Youth | 2 | Critical | DZ era |
| DZ-BT08/093EN | War-severing Knight, Fethful | 2 | Critical | DZ era |
| ~~DZ-BT08/094EN~~ | ~~Viogaon~~ | ~~1~~ | ~~Draw~~ | ~~dipindah ke Bug A~~ |
| DZ-BT08/096EN | Squire of Spear Streaks, Youth | 1 | Heal | DZ era |
| DZ-BT08/104EN | Knight of Common Celebration, Lovist | 1 | Critical | DZ era |
| DZ-BT08/105EN | Blossoming Flowers Sylvan Horned Beast, Charis | 1 | Critical | DZ era |
| DZ-BT08/107EN | Sprightly Jumper, Aftir | 3 | Critical | DZ era |
| DZ-BT08/108EN | Happy Invitation, Ymail | 2 | Critical | DZ era |
| DZ-BT08/109EN | Come Around, Lapuole | 2 | Draw | DZ era |
| DZ-BT08/110EN | Swing on A Swing, Runalu | 2 | Draw | DZ era |
| DZ-BT08/111EN | Hip Hop Streamer, Seril | 2 | Draw | DZ era |
| DZ-BT08/112EN | Smile Blooming in a Corner, Lukkigi | 1 | Draw | DZ era |
| DZ-BT08/113EN | Paste It for You, Careria | 1 | Draw | DZ era |
| DZ-PS01/016EN | Innocent Ray Dragon | 3 | Heal | DZ TD |
| DZ-PS02/016EN | Astral Chain Dragon | 3 | Heal | DZ TD |
| DZ-PS03/016EN | Pure-hearted Flower Maiden, Fiorenza | 3 | Heal | DZ TD |
| DZ-TB01/096EN | Poisonous Water Dragon, Zazamera | 2 | Heal | DZ era |
| DZ-TB01/H28EN | Poisonous Water Dragon, Zazamera | 2 | Heal | H rarity |
| DZ-BT10/016EN | Juicy-Fruity, Tuarina | 3 | Heal | DZ era |
| D-PR/741EN | Yumenokessho PASTEL | 1 | Heal | PR |
| D-PR/742EN | Yumenokessho HALO | 1 | Critical | PR |
| D-PR/876EN | Energy | null | Critical | Grade null |
| D-PR/877EN | Energy | null | Critical | Grade null |
| V-SS10/025EN | Nightmare Doll, Lindy | 3 | Heal | V era |
| V-SS10/053EN | Sea Cruising Banshee | 3 | Heal | V era |

> Total ~52 kartu teridentifikasi. Kemungkinan ada lebih banyak yang belum dicek.

---

### Bug C — False negative: Trigger Unit Grade 3 tidak terdeteksi
**Status: ✅ FIXED** — 48 kartu dikoreksi via rescrape dari set D-VS dan V-era.
**Penyebab:** Format gift V-era `"Heal +10000"` tidak mengandung kata "Trigger", sehingga pattern lama `"heal trigger"` tidak match. Kartu dengan `div.type = "Trigger Unit"` tapi grade 2-3 kehilangan trigger-nya.  
**Fix:** Tambah pattern `giftLower.startsWith(kw)` di gift parser (di samping pattern `kw + " trigger"` yang sudah ada). Dikombinasikan dengan flag `isTriggerUnit` sehingga guard `canHaveTrigger` lolos untuk Grade 3 Trigger Units.

Contoh kartu yang terdeteksi:

| enCardNo | Nama | Set |
|---|---|---|
| D-VS01/074EN | Escutcheo Bubble Dragon | D-VS01 |
| D-VS01/018EN | Aias the Fortress | D-VS01 |
| D-VS01/032EN | Covert Demonic Dragon, Kumadori Dope | D-VS01 |
| D-VS02/011EN | Astral Chain Dragon | D-VS02 |
| ... | 44 kartu lainnya dari D-VS dan V-era | |

> Total 48 kartu difix. Set D-VS03 dan D-VS04 tidak menghasilkan perubahan (tidak ada Grade 3 Trigger Unit di set tersebut — clan-dependent).

---

### Bug D — Data error di sumber (Bushiroad site salah)
**Status: ⚠️ DIBIARKAN** — Tidak bisa difix via re-scrape karena data di sumber memang salah.
**Penyebab:** Scraper membaca data yang benar dari situs, tapi situs Bushiroad sendiri punya data yang salah. Re-scrape hanya akan menghasilkan data yang sama.

| enCardNo | Nama | Field bermasalah | Data di situs | Seharusnya |
|---|---|---|---|---|
| V-EB06/045EN | Beloved Child of Superstring Theory | trigger | Critical | Draw |
| D-PR/741EN | Yumenokessho PASTEL | grade | 1 | 0 |
| D-PR/742EN | Yumenokessho HALO | grade | 1 | 0 |

> Keputusan: dibiarkan sesuai data sumber. Kalau Bushiroad mengkoreksi situs mereka di masa depan, re-scrape kartu ini akan otomatis fix.

---

### Bug E — Schema limitation: Sentinel tidak tersimpan sama sekali
**Status: ⏸️ DEFERRED** — Keputusan: dibiarkan untuk sekarang.
**Penyebab:** Field `trigger` hanya menyimpan satu nilai. Kartu yang sekaligus Draw Trigger + Sentinel hanya tersimpan sebagai "Draw", Sentinel hilang. Total **0 kartu Sentinel** di seluruh database padahal ada 629+ Grade 0 Draw trigger yang berpotensi Sentinel.  
**Opsi yang ada:** `isSentinel: boolean` (field baru) vs `trigger: string[]` (schema breaking change) vs dibiarkan.  
**Alasan defer:** Cost implementasi tidak sebanding dengan frekuensi kebutuhan filter Sentinel. Bisa di-revisit kalau ada consumer yang butuh.

Contoh:
| enCardNo | Nama | Trigger sekarang | Seharusnya |
|---|---|---|---|
| V-BT01/024EN | Twin Blader | Draw | Draw + Sentinel |

---

### Bug F — Image URL mismatch pada S-variant
**Status: ✅ FIXED** — `cards.json` sudah dikoreksi langsung (tidak perlu re-scrape).
**Penyebab:** Kartu variant `-S` punya image URL yang menunjuk ke nomor kartu berbeda. Kemungkinan data entry error saat scrape pertama.

| enCardNo | imageUrlEn lama | imageUrlEn baru |
|---|---|---|
| D-PR/797EN-S | `dpr_796_S.png` | `dpr_797_S.png` |

Audit 132 S-variant lainnya: hanya 1 mismatch ditemukan. Semua S-variant lain URL-nya sudah benar.

---

## Status Audit

| Bug | Status | Jumlah Kartu | Keterangan |
|---|---|---|---|
| A — DZ Normal Unit false trigger | ✅ FIXED | ~7 kartu | Tercover oleh rescrape Bug A/B |
| B — Fallback full-page false trigger | ✅ FIXED | ~41 kartu | Fallback dihapus dari scraper |
| C — V-era Trigger Unit missing trigger | ✅ FIXED | 48 kartu | D-VS + V-BT/EB/SS/TD/PR |
| D — Bushiroad source error | ⚠️ DIBIARKAN | 3 kartu | V-EB06/045, D-PR/741, D-PR/742 |
| E — Sentinel schema limitation | ⏸️ DEFERRED | — | Keputusan: skip untuk sekarang |
| F — S-variant image URL mismatch | ✅ FIXED | 1 kartu | D-PR/797EN-S |

**Total kartu difix di `cards.json`:** 96 (via `rescrape_triggers.js`) + 1 (manual fix Bug F)  
**Commit:** `8bd5ae5` → merged ke `main` 2026-05-30
