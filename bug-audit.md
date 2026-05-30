# Trigger Data Bug Audit
Branch: `fix/trigger-data-bugs`

---

## Kategori Bug

### Bug A — False positive: Normal Unit Grade 1-3 dapat trigger dari `div.gift` (DZ era)
**Penyebab:** Scraper membaca `div.gift` (contoh: `"Over Trigger +100,000,000"`, `"Draw Trigger +10000"`, `"Critical Trigger +5000"`) pada Normal Unit non-trigger dan assign trigger. Gift parser tidak cek apakah kartu memang Trigger Unit.  
**Fix:** Gift parser hanya boleh jalan jika `grade === 0` ATAU `isTriggerUnit === true`.  
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
**Penyebab:** Fallback di `scrape_en.js:370-378` scan `stripTags(html)` dari seluruh halaman, bukan hanya `div.effect`. Teks "Heal Trigger"/"Critical Trigger"/"Draw Trigger" dari section lain (product listing, tabel kartu terkait) ikut ter-pick up.  
**Fix:** Hapus fallback atau batasi scan ke `div.effect` saja.

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
**Penyebab:** Format gift lama `"Heal +10000"` tidak match pattern `"heal trigger"` di gift parser. Kartu dengan `div.type = "Trigger Unit"` tapi grade 3 kehilangan trigger-nya.  
**Fix:** Tambah pattern `startsWith(kw)` di gift parser, aktifkan jika `isTriggerUnit === true`.

| enCardNo | Nama | Grade | Trigger seharusnya | Trigger sekarang |
|---|---|---|---|---|
| D-VS01/074EN | Escutcheo Bubble Dragon | 3 | Heal | null |

> Perlu audit lebih lanjut — kemungkinan ada kartu serupa di set V-era lain.

---

### Bug D — Data error di sumber (Bushiroad site salah)
**Penyebab:** Scraper membaca data yang benar dari situs, tapi situs itu sendiri punya data yang salah. Tidak bisa difix dengan perbaikan scraper — perlu manual override di `fix_data.js`.

| enCardNo | Nama | Trigger di situs | Trigger seharusnya |
|---|---|---|---|
| V-EB06/045EN | Beloved Child of Superstring Theory | Critical | Draw |

---

### Bug E — Schema limitation: Sentinel tidak tersimpan sama sekali
**Penyebab:** Field `trigger` hanya menyimpan satu nilai. Kartu yang sekaligus Draw Trigger + Sentinel hanya tersimpan sebagai "Draw", Sentinel hilang. Total **0 kartu Sentinel** di seluruh database padahal ada 629+ Grade 0 Draw trigger yang berpotensi Sentinel.  
**Status:** Perlu keputusan desain dulu — `isSentinel: boolean` vs `trigger: string[]`.

Contoh:
| enCardNo | Nama | Trigger sekarang | Seharusnya |
|---|---|---|---|
| V-BT01/024EN | Twin Blader | Draw | Draw + Sentinel |

---

### Bug F — Image URL mismatch pada S-variant
**Penyebab:** Kartu variant `-S` punya image URL yang menunjuk ke nomor kartu berbeda. Kemungkinan data entry error di situs Bushiroad.

| enCardNo | imageUrlEn | Seharusnya |
|---|---|---|
| D-PR/797EN-S | `dpr_796_S.png` | `dpr_797_S.png` (?) |

> Perlu verifikasi apakah URL `dpr_796_S.png` valid atau broken. Juga perlu cek apakah ada S-variant lain dengan masalah serupa.

---

## Status Audit
- [ ] Bug A: 5 kartu teridentifikasi — mungkin lebih di set DZ lain
- [ ] Bug B: ~52 kartu teridentifikasi — mungkin lebih
- [ ] Bug C: 1 kartu teridentifikasi — perlu audit V-era
- [ ] Bug D: 1 kartu teridentifikasi — perlu audit manual lebih lanjut
- [ ] Bug E: Belum diputuskan desain schema
- [ ] Bug F: 1 kartu teridentifikasi — perlu audit S-variant lain
