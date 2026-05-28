# 🃏 Vanguard Library DB

Database kartu Cardfight!! Vanguard hasil scraping dari situs resmi EN & JP. Self-maintaining, auto-update mingguan, dengan web viewer untuk verifikasi.

[![Auto-update](https://img.shields.io/badge/auto--update-weekly-success)](https://github.com/nerif7/vanguard-library-db/actions)
[![DB Viewer](https://img.shields.io/badge/viewer-live-blue)](https://nerif7.github.io/vanguard-library-db/)
[![EN Cards](https://img.shields.io/badge/EN%20cards-24%2C260-green)](https://github.com/nerif7/vanguard-library-db/blob/main/cards.json)
[![JP Cards](https://img.shields.io/badge/JP%20cards-27%2C219-orange)](https://github.com/nerif7/vanguard-library-db/blob/main/cards_jp.json)

---

## 🌐 Live Resources

| Resource | URL |
|---|---|
| **DB Viewer** | https://nerif7.github.io/vanguard-library-db/ |
| **Raw `cards.json` (EN)** | https://raw.githubusercontent.com/nerif7/vanguard-library-db/main/cards.json |
| **Raw `cards_jp.json` (JP)** | https://raw.githubusercontent.com/nerif7/vanguard-library-db/main/cards_jp.json |
| **Last update API** | https://api.github.com/repos/nerif7/vanguard-library-db/commits?path=cards.json&per_page=1 |

---

## 📦 Output

Dua file output: **`cards.json`** (EN, ~10.5 MB, ~24.260 kartu) dan **`cards_jp.json`** (JP, ~12.4 MB, ~27.219 kartu).

### EN Schema (`cards.json`)

```jsonc
{
  "enCardNo":   "DZ-BT12/001EN",       // Card code lengkap (primary key)
  "setCode":    "DZ-BT12",              // Set prefix
  "cardNumber": "001",                  // Nomor kartu dalam set
  "name":       "Enma Stealth Rogue, Mujinlord",
  "unitType":   "G Unit",               // 9 nilai enum (lihat bawah)
  "nations":    ["Dragon Empire"],      // Array, support dual-nation; [] = nationless
  "clan":       ["Nubatama"],           // Array; mostly kosong era V+
  "races":      ["Demon"],              // Array
  "grade":      4,                      // 0–10 (Grade 10 = Calamity card)
  "trigger":    null,                   // Critical / Draw / Heal / Front / Over / Sentinel / null
  "rarity":     "RRR",                  // RRR, RR, R, C, SP, SSR, FR, FFR, SCR, GR, PR, dll
  "imageUrlEn": "https://en.cf-vanguard.com/..."
}
```

### JP Schema (`cards_jp.json`)

```jsonc
{
  "jpCardNo":   "DZ-BT12/001",         // Card code JP (primary key)
  "setCode":    "DZ-BT12",
  "cardNumber": "001",
  "nameJp":     "閻魔忍竜 ムジンロード",  // Nama JP
  "unitType":   "Gユニット",             // Nilai JP (ノーマルユニット, Gユニット, dll)
  "nations":    ["ドラゴンエンパイア"],   // Nama nation JP; [] = nationless
  "clan":       ["沼地の魔神官"],
  "races":      ["デーモン"],
  "grade":      4,
  "trigger":    null,                   // Nilai JP (ヒールトリガー, クリティカルトリガー, dll)
  "rarity":     "RRR",
  "imageUrlJp": "https://cf-vanguard.com/..."
}
```

### Enum `unitType` (EN)

`Normal Unit` · `G Unit` · `Normal Order` · `Set Order` · `Blitz Order` · `Trigger Order` · `Token` · `Ride Deck Crest` · `Others`

### Coverage

**EN (`cards.json`)**

| Field | Coverage | Catatan |
|---|---|---|
| `unitType` | 100% | |
| `imageUrlEn` | 100% | |
| `nations` | 94.8% | Sisanya legitimate nationless (Calamity, BanG Dream collab, Cray Elemental, Order, Token) |
| `races` | 91.4% | |
| `grade` | 98.5% | Order/Token/Ride Deck Crest tidak punya grade |
| `clan` | 53.5% | Era V+ mostly tidak punya clan |
| `trigger` | 10.6% | Hanya trigger units |

**JP (`cards_jp.json`)**

| Field | Coverage | Catatan |
|---|---|---|
| `unitType` | 100% | |
| `imageUrlJp` | 100% | |
| `nations` | 93.3% | Legitimate nationless: Order, Token, Elemental, Collab |
| `races` | 90.6% | |
| `grade` | 97.2% | |
| `trigger` | 13.6% | |
| `clan` | 49.3% | Era V+ mostly tidak punya clan |

> **Catatan nationless:** Cards dengan `nations: []` memang tidak punya nation (bukan data hilang). Contoh: ライトエレメンタル パチリ, 伝説のファイター DAIGO. Gunakan filter ini untuk menemukan kartu seperti Elemental, Order, dan collab cards.

---

## 🤖 Auto-Update

Database **otomatis di-update mingguan** via GitHub Actions — mencakup EN dan JP dalam satu workflow:

- **⏰ Cron**: Setiap Senin 06:00 WIB (Minggu 23:00 UTC)
- **🖱️ Manual**: Trigger via tab Actions (ada input `force_expansion` dan `force_expansion_jp`)
- **🔄 Incremental**: Hanya scrape expansion baru, bukan full re-scrape

### Cara Kerja

```
Cron trigger
    ├── EN job (update.js)
    │     1. Fetch daftar expansion dari EN site
    │     2. Compare dengan setCode di cards.json
    │     3. Detect promo cards via count comparison
    │     4. Backup cards.json (defensive)
    │     5. Scrape expansion baru (max 5 per run)
    │     6. Validate + diagnose
    │     7. Commit + push
    │
    └── JP job (update_jp.js)
          1. git pull (ensure latest cards_jp.json)
          2. Fetch expansion list dari JP site (cf-vanguard.com)
          3. Compare dengan setCode di cards_jp.json
          4. Scrape expansion baru via scrape_jp.js
          5. Validate + diagnose
          6. Update version.json (JP fields)
          7. Commit + push
```

### Safeguards

- ✅ **Backup** sebelum scrape — auto-restore kalau validation fail
- ✅ **Validation** — minimum 20k cards + sample field check sebelum commit
- ✅ **Concurrency lock** — cegah dua run jalan bersamaan
- ✅ **Retry push** — handle race condition kalau ada concurrent commit
- ✅ **Max expansion limit** — 5 per run, sisanya di-pick up next week (avoid timeout)
- ✅ **Smart promo detection** — count semua promo era (D-PR + V-PR + G-PR + PR)

### Manual Trigger

1. Buka [Actions tab](https://github.com/nerif7/vanguard-library-db/actions/workflows/auto-update.yml)
2. Klik **Run workflow**
3. Input tersedia:
   - **`force_expansion`** — force re-scrape expansion EN tertentu (ID number)
   - **`force_expansion_jp`** — force re-scrape expansion JP tertentu
   - **`dry_run`** — preview saja, tidak commit

---

## 🌐 Web Viewer

Live web viewer untuk verifikasi database: **[nerif7.github.io/vanguard-library-db](https://nerif7.github.io/vanguard-library-db/)**

**Features:**
- 🔍 Browse + filter (set, nation, unit type, trigger, search)
- 🎴 Preview kartu dengan gambar + semua field
- 📊 Stats per set (coverage % untuk 6 field: image, unitType, nations, rarity, clan, races)
- ⚡ Virtualized list (handle 24k–27k+ kartu tanpa lag)
- 🕒 Last update info dari GitHub commit API

Auto-deploy via GitHub Actions setiap push ke `viewer/`.

---

## 🛠️ Tools

| Script | Fungsi |
|---|---|
| [`scrape_en.js`](scrape_en.js) | EN scraper — class-based parser dari en.cf-vanguard.com |
| [`scrape_jp.js`](scrape_jp.js) | JP scraper — parser dari cf-vanguard.com (JP site) |
| [`update.js`](update.js) | EN auto-update orchestrator — detect + scrape incremental |
| [`update_jp.js`](update_jp.js) | JP auto-update orchestrator — detect + scrape incremental |
| [`diagnose.js`](diagnose.js) | Quality checker — coverage report per field, per set |
| [`fix_data.js`](fix_data.js) | In-place fixer untuk data yang sudah ada (no re-scrape) |
| [`reset_cards.js`](reset_cards.js) | Reset field tertentu untuk re-fetch dengan `--retry-failed` |
| [`inspect_card.js`](inspect_card.js) | Debug single card — lihat HTML mentah dari EN site |
| [`debug_expansion.js`](debug_expansion.js) | Investigate gallery page expansion tertentu |

### Usage

#### EN — Auto-update (incremental)

```bash
node update.js                        # detect + scrape expansion EN baru
node update.js --dry-run              # preview, tidak scrape
node update.js --check-only           # exit 0 = up-to-date, 1 = ada update
node update.js --force-expansion 248  # force re-scrape expansion tertentu
node update.js --max-expansions 10    # override default limit (5)
node update.js --delay 800            # delay ms antar request (default 500)
```

#### JP — Auto-update (incremental)

```bash
node update_jp.js                        # detect + scrape expansion JP baru
node update_jp.js --dry-run              # preview, tidak scrape
node update_jp.js --check-only           # exit 0 = up-to-date, 1 = ada update
node update_jp.js --force-expansion 295  # force re-scrape expansion tertentu
```

#### EN — Full scrape (jarang dipakai)

```bash
node scrape_en.js                      # scrape semua expansion (~9 jam)
node scrape_en.js --expansion 248      # 1 expansion saja
node scrape_en.js --resume             # lanjutkan dari progress terakhir
node scrape_en.js --retry-failed       # re-fetch kartu dengan field kosong
```

#### JP — Full scrape

```bash
node scrape_jp.js                      # scrape semua expansion + tabel PR
node scrape_jp.js --expansion 295      # 1 expansion saja
node scrape_jp.js --pr-only            # hanya scrape tabel card-pr
node scrape_jp.js --resume             # lanjutkan dari progress terakhir
node scrape_jp.js --retry-failed       # re-fetch kartu dengan field kosong
node scrape_jp.js --delay 400          # delay ms (default 350)
```

#### Maintenance (EN + JP)

```bash
# Diagnose
node diagnose.js                          # coverage seluruh EN DB
node diagnose.js --region jp              # coverage seluruh JP DB
node diagnose.js --set DZ-BT12            # filter per set (EN)
node diagnose.js --region jp --set DZ-BT12
node diagnose.js --list                   # list semua setCode

# Fix data in-place
node fix_data.js --dry-run                # preview EN (tanpa write)
node fix_data.js                          # apply fix EN
node fix_data.js --region jp --dry-run    # preview JP
node fix_data.js --region jp              # apply fix JP

# Fix 1: hapus duplikat clan dari nations[]
# Fix 2: re-parse setCode + cardNumber
# Fix 3: hapus duplikat _N suffix (TD copies bug)
# Fix 4: strip Unicode-dash entries dari nations[] (nationless normalization)

# Reset & inspect
node reset_cards.js --card "DZ-BT12/001EN"  # reset 1 kartu untuk re-fetch
node reset_cards.js --set DZ-BT12           # reset 1 set
node reset_cards.js --suspect               # reset kartu suspect (field kosong)
node inspect_card.js "DZ-BT12/001EN"        # debug HTML parsing EN
node debug_expansion.js 248                 # debug gallery expansion EN
```

---

## 📋 Card Code Format (EN)

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
| Hot-stamped | `V-EB11/001EN (Hot-stamped ver.)` | `V-EB11` | `001` |

---

## 📂 Repo Structure

```
vanguard-library-db/
├── cards.json                 # 📦 Output EN (~10.5 MB, 24k+ kartu)
├── cards_jp.json              # 📦 Output JP (~12.4 MB, 27k+ kartu)
│
├── scrape_en.js               # 🌐 EN scraper (en.cf-vanguard.com)
├── scrape_jp.js               # 🌐 JP scraper (cf-vanguard.com)
├── update.js                  # 🤖 EN auto-update orchestrator
├── update_jp.js               # 🤖 JP auto-update orchestrator
├── diagnose.js                # 📊 Quality checker (EN + JP via --region jp)
├── fix_data.js                # 🔧 In-place fixer (EN + JP via --region jp)
├── reset_cards.js             # 🔄 Selective reset for re-fetch
├── inspect_card.js            # 🔍 Debug single card HTML (EN)
├── debug_expansion.js         # 🔍 Debug gallery expansion (EN)
│
├── viewer/                    # 🌐 Web DB viewer (GitHub Pages)
│   ├── index.html
│   ├── viewer.css
│   ├── viewer.js              # EN viewer
│   ├── viewer_jp.js           # JP viewer
│   └── .nojekyll
│
├── .github/workflows/
│   ├── auto-update.yml        # ⏰ Weekly cron (EN + JP jobs)
│   └── deploy-viewer.yml      # 🚀 Deploy viewer to Pages
│
└── README.md
```

---

## 🔌 Konsumsi Data

### Browser / Web App

```js
// EN cards
const enCards = await fetch(
  "https://raw.githubusercontent.com/nerif7/vanguard-library-db/main/cards.json"
).then(r => r.json());

// JP cards
const jpCards = await fetch(
  "https://raw.githubusercontent.com/nerif7/vanguard-library-db/main/cards_jp.json"
).then(r => r.json());

console.log(`EN: ${enCards.length} cards, JP: ${jpCards.length} cards`);
```

### Cek Update Tersedia (via commit API)

```js
const res = await fetch(
  "https://api.github.com/repos/nerif7/vanguard-library-db/commits?path=cards.json&per_page=1",
  { headers: { Accept: "application/vnd.github+json" } }
);
const data = await res.json();
const lastSha  = data[0]?.sha;
const lastDate = data[0]?.commit?.committer?.date;
```

Bandingkan `lastSha` dengan SHA yang disimpan lokal untuk tahu apakah ada update.

### Filter Nationless Cards

```js
// Cards tanpa nation (Elemental, Order, collab, dll)
const nationless = cards.filter(c => c.nations.length === 0);

// Kartu dengan nation tertentu
const dragEmpire = cards.filter(c => c.nations.includes("Dragon Empire"));
```

> **Penting:** Nationless cards disimpan sebagai `nations: []` (array kosong), bukan `null` atau `["-"]`. Semua Unicode-dash variants (`‐`, `–`, `—`, `−`) sudah dinormalisasi ke array kosong sejak scraper v2.

### Aplikasi yang Menggunakan DB Ini

- **[vg_collection_tauri](https://github.com/nerif7/vg_collection_tauri)** — Cardfight!! Vanguard collection manager (Tauri + TypeScript). Support EN + JP databases, hybrid offline-first loader, virtualized list 27k+ cards.
- **[tcg_library](https://github.com/nerif7/tcg_library)** — Electron version (stable). Collection tracker dengan autocomplete dan multi-nation support.

---

## ⚙️ Tech Stack

- **Node.js 20** (standar library only — tidak ada NPM dependency)
- **GitHub Actions** untuk automation (EN + JP weekly jobs)
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

Source data:
- EN: [en.cf-vanguard.com](https://en.cf-vanguard.com) — official Cardfight!! Vanguard English website
- JP: [cf-vanguard.com](https://cf-vanguard.com) — official Cardfight!! Vanguard JP website

Code di repo ini (scraper, tools, viewer) MIT licensed.

---

<p align="center">
<sub>Built with ❤️ for the Vanguard community · Auto-maintained since May 2026</sub>
</p>
