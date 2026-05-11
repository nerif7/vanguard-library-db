# 🃏 Vanguard Library DB

Database kartu Cardfight!! Vanguard hasil scraping dari [en.cf-vanguard.com](https://en.cf-vanguard.com). Self-maintaining, auto-update mingguan, dengan web viewer untuk verifikasi.

[![Auto-update](https://img.shields.io/badge/auto--update-weekly-success)](https://github.com/nerif7/vanguard-library-db/actions)
[![DB Viewer](https://img.shields.io/badge/viewer-live-blue)](https://nerif7.github.io/vanguard-library-db/)
[![Cards](https://img.shields.io/badge/cards-24%2C262-green)](https://github.com/nerif7/vanguard-library-db/blob/main/cards.json)

---

## 🌐 Live Resources

| Resource | URL |
|---|---|
| **DB Viewer** | https://nerif7.github.io/vanguard-library-db/ |
| **Raw `cards.json`** | https://raw.githubusercontent.com/nerif7/vanguard-library-db/main/cards.json |
| **Last update API** | https://api.github.com/repos/nerif7/vanguard-library-db/commits?path=cards.json&per_page=1 |

---

## 📦 Output

Satu file output utama: **`cards.json`** (~10 MB, ~24.000+ kartu).

### Schema

```jsonc
{
  "enCardNo":   "DZ-BT12/001EN",       // Card code lengkap
  "setCode":    "DZ-BT12",              // Set prefix
  "cardNumber": "001",                  // Nomor kartu
  "name":       "Enma Stealth Rogue, Mujinlord",
  "unitType":   "G Unit",               // 9 nilai enum
  "nations":    ["Dragon Empire"],      // array, support dual-nation
  "clan":       ["Nubatama"],           // array
  "races":      ["Demon"],              // array
  "grade":      4,                      // 0-10 (Grade 10 = Calamity card)
  "trigger":    null,                   // Critical / Draw / Heal / Front / Over / Sentinel / null
  "rarity":     "RRR",                  // RRR, RR, R, C, SP, SSR, FR, FFR, SCR, GR, PR, dll
  "imageUrlEn": "https://en.cf-vanguard.com/wordpress/wp-content/images/cardlist/dzbt12/dzbt12_001.png"
}
```

### Enum `unitType`

`Normal Unit` · `G Unit` · `Normal Order` · `Set Order` · `Blitz Order` · `Trigger Order` · `Token` · `Ride Deck Crest` · `Others`

### Coverage

| Field | Coverage | Catatan |
|---|---|---|
| `unitType` | 100% | |
| `imageUrlEn` | 100% | |
| `nations` | 94.8% | Sisanya legitimate nationless (Calamity, BanG Dream collab, Cray Elemental, Order, Token) |
| `races` | 91.4% | |
| `grade` | 98.5% | Order/Token/Ride Deck Crest tidak punya grade |
| `clan` | 53.5% | Era V+ mostly tidak punya clan, era G dan sebelumnya punya |
| `trigger` | 10.6% | Hanya trigger units |

---

## 🤖 Auto-Update

Database **otomatis di-update mingguan** via GitHub Actions:

- **⏰ Cron**: Setiap Senin 06:00 WIB (Minggu 23:00 UTC)
- **🖱️ Manual**: Bisa trigger via tab Actions
- **🔄 Incremental**: Hanya scrape expansion baru, bukan full re-scrape

### Cara Kerja

```
Cron trigger
    ↓
update.js orchestrator
    ↓
1. Fetch daftar expansion dari EN site
2. Compare dengan setCode di cards.json lokal
3. Detect promo cards via count comparison (expansion=0)
4. Backup cards.json (defensive)
5. Scrape expansion baru saja (max 5 per run)
6. Validate hasil (minimum 20.000 cards, JSON valid)
7. Run diagnose untuk verify field coverage
8. Commit + push otomatis kalau ada perubahan
9. Generate summary di Actions UI
```

### Safeguards

- ✅ **Backup** sebelum scrape — auto-restore kalau validation fail
- ✅ **Validation** — minimum 20k cards + sample field check sebelum commit
- ✅ **Concurrency lock** — cegah dua run jalan bersamaan
- ✅ **Retry push** — handle race condition kalau ada concurrent commit
- ✅ **Max expansion limit** — 5 per run, sisanya di-pick up next week (avoid timeout)
- ✅ **Smart promo detection** — count semua promo era (D-PR + V-PR + G-PR + PR)

### Manual Trigger

Untuk trigger ad-hoc (misal ada set baru rilis hari Kamis dan tidak mau nunggu Senin):

1. Buka [Actions tab](https://github.com/nerif7/vanguard-library-db/actions/workflows/auto-update.yml)
2. Klik **Run workflow**
3. Options:
   - **`force_expansion`** (optional) — masukkan ID number untuk force re-scrape expansion tertentu
   - **`dry_run`** (optional) — preview saja, tidak commit

---

## 🌐 Web Viewer

Live web viewer untuk verifikasi database: **[nerif7.github.io/vanguard-library-db](https://nerif7.github.io/vanguard-library-db/)**

**Features:**
- 🔍 Browse + filter (set, nation, unit type, trigger, search)
- 🎴 Preview kartu dengan gambar + semua field
- 📊 Stats per set (coverage % untuk 6 field: image, unitType, nations, rarity, clan, races)
- ⚡ Virtualized list (handle 24k+ kartu tanpa lag)
- 🕒 Last update info dari GitHub commit API

Auto-deploy via GitHub Actions setiap push ke `viewer/`.

---

## 🛠️ Tools

| Script | Fungsi |
|---|---|
| [`scrape_en.js`](scrape_en.js) | Main scraper — class-based parser EN site |
| [`update.js`](update.js) | **Auto-update orchestrator** — detect + scrape incremental |
| [`diagnose.js`](diagnose.js) | Quality checker — coverage report per field, distribution |
| [`fix_data.js`](fix_data.js) | In-place fix untuk data yang sudah ada (no scrape ulang) |
| [`reset_cards.js`](reset_cards.js) | Reset field tertentu untuk re-fetch dengan `--retry-failed` |
| [`inspect_card.js`](inspect_card.js) | Debug single card — lihat HTML mentah dari EN site |
| [`debug_expansion.js`](debug_expansion.js) | Investigate gallery page expansion tertentu |

### Usage

#### Auto-update (incremental)

```bash
node update.js                        # detect + scrape expansion baru
node update.js --dry-run              # preview, tidak scrape
node update.js --check-only           # exit 0 = up-to-date, 1 = ada update
node update.js --force-expansion 248  # force re-scrape expansion tertentu
node update.js --max-expansions 10    # override default limit (5)
node update.js --delay 800            # delay ms antar request (default 500)
```

#### Full scrape (jarang dipakai)

```bash
node scrape_en.js                          # scrape semua expansion (~9 jam)
node scrape_en.js --expansion 248          # 1 expansion saja
node scrape_en.js --resume                 # lanjutkan dari progress terakhir
node scrape_en.js --retry-failed           # re-fetch kartu dengan field kosong
```

#### Maintenance

```bash
node diagnose.js                          # cek coverage seluruh DB
node diagnose.js --set DZ-BT12            # filter per set
node diagnose.js --list                   # list semua setCode di DB

node fix_data.js --dry-run                # preview perubahan tanpa write
node fix_data.js                          # apply fix in-place

node reset_cards.js --card "DZ-BT12/001EN"  # reset 1 kartu untuk re-fetch
node reset_cards.js --set DZ-BT12           # reset 1 set
node reset_cards.js --suspect               # reset kartu suspect (field kosong)

node inspect_card.js "DZ-BT12/001EN"      # debug HTML parsing
node debug_expansion.js 248               # debug gallery expansion
```

---

## 📋 Card Code Format

Database handle berbagai format card code dengan robust parser ([`parseCardCode()`](scrape_en.js)):

| Format | Contoh | setCode | cardNumber |
|---|---|---|---|
| Regular | `DZ-BT12/001EN` | `DZ-BT12` | `001` |
| EX cards | `DZ-BT12/EX01EN` | `DZ-BT12` | `EX01` |
| B/W variant (pre-V Bermuda Duo) | `EB10/001EN-B` | `EB10` | `001` |
| Special variant | `D-BT11/EX01EN-S` | `D-BT11` | `EX01` |
| BCS Imaginary Gift | `BCS2022/V-GM-01EN` | `BCS2022` | `01` |
| 10th Anniversary | `D-BT05/10thSEC01EN` | `D-BT05` | `SEC01` |
| Sneak preview | `D-PR/805-SEN` | `D-PR` | `805` |
| DZ Special enhanced | `DZ-BT06/SER＋01EN` | `DZ-BT06` | `SER01` |
| G era Reborn | `G-BT08/Re:01EN` | `G-BT08` | `01` |
| G era Special | `G-CB03/S01EN WSP` | `G-CB03` | `S01` |
| Alt rarity | `G-BT01/088EN PR` | `G-BT01` | `088` |
| Parallel variant | `V-EB07/XV01EN Parallel` | `V-EB07` | `XV01` |
| Hot-stamped | `V-EB11/001EN (Hot-stamped ver.)` | `V-EB11` | `001` |

---

## 📂 Repo Structure

```
vanguard-library-db/
├── cards.json                 # 📦 Output utama (~10 MB, 24k+ kartu)
├── scrape_en.js               # 🌐 Main scraper
├── update.js                  # 🤖 Auto-update orchestrator
├── diagnose.js                # 📊 Quality checker
├── fix_data.js                # 🔧 In-place fixer
├── reset_cards.js             # 🔄 Selective reset
├── inspect_card.js            # 🔍 Debug single card
├── debug_expansion.js         # 🔍 Debug gallery expansion
│
├── viewer/                    # 🌐 Web DB viewer (GitHub Pages)
│   ├── index.html
│   ├── viewer.css
│   ├── viewer.js
│   └── .nojekyll
│
├── .github/workflows/
│   ├── auto-update.yml        # ⏰ Weekly cron scrape
│   └── deploy-viewer.yml      # 🚀 Deploy viewer to Pages
│
└── README.md
```

---

## 🔌 Konsumsi Data

### Browser / Web App

```js
const response = await fetch(
  "https://raw.githubusercontent.com/nerif7/vanguard-library-db/main/cards.json"
);
const cards = await response.json();
console.log(`Loaded ${cards.length} cards`);
```

### Cek Update Tersedia (via commit API)

```js
const res = await fetch(
  "https://api.github.com/repos/nerif7/vanguard-library-db/commits?path=cards.json&per_page=1",
  { headers: { Accept: "application/vnd.github+json" } }
);
const data  = await res.json();
const lastSha  = data[0]?.sha;
const lastDate = data[0]?.commit?.committer?.date;
```

Bandingkan `lastSha` dengan SHA yang disimpan local untuk tahu apakah ada update.

### Aplikasi yang Menggunakan DB Ini

- **[tcg_library](https://github.com/nerif7/tcg_library)** — Cardfight!! Vanguard collection tracker dengan autocomplete, multi-nation support, dan hybrid offline-first loader.

---

## ⚙️ Tech Stack

- **Node.js 20** (standar library only — tidak ada NPM dependency)
- **GitHub Actions** untuk automation
- **GitHub Pages** untuk hosting viewer
- **Vanilla JS + CSS** untuk viewer (no frameworks)

---

## 🤝 Contributing

Repo ini personal project, tapi feedback / bug report welcome via [Issues](https://github.com/nerif7/vanguard-library-db/issues).

Kalau menemukan kartu dengan field kosong yang mencurigakan, run:

```bash
node inspect_card.js "CARD-CODE/HERE"
```

Lalu paste output di issue.

---

## 📝 Lisensi & Atribusi

Data kartu (nama, gambar, efek) adalah **milik Bushiroad**. Repo ini hanya menyediakan database hasil scraping untuk keperluan personal — collection tracker, deck builder reference, dll.

Source data: [en.cf-vanguard.com](https://en.cf-vanguard.com) — official Cardfight!! Vanguard English website.

Code di repo ini (scraper, tools, viewer) MIT licensed.

---

<p align="center">
<sub>Built with ❤️ for the Vanguard community · Auto-maintained since May 2026</sub>
</p>
