# vanguard-library-db

Database kartu Cardfight!! Vanguard yang di-scrape dari [en.cf-vanguard.com](https://en.cf-vanguard.com). Data ini dipakai oleh aplikasi [tcg_library](https://github.com/nerif7/tcg_library) untuk autocomplete kartu di koleksi user.

## 📦 Output

Satu file output: **`cards.json`** (~10 MB, ~24.000+ kartu).

### Schema

```js
{
  "enCardNo":   "DZ-BT12/001EN",       // Card code lengkap
  "setCode":    "DZ-BT12",              // Set prefix
  "cardNumber": "001",                  // Card number
  "name":       "Enma Stealth Rogue, Mujinlord",
  "unitType":   "G Unit",               // 9 enum values
  "nations":    ["Dragon Empire"],      // array, support dual-nation
  "clan":       ["Nubatama"],           // array
  "races":      ["Demon"],              // array
  "grade":      4,                      // 0-10 (Grade 10 = Calamity)
  "trigger":    null,                   // Critical, Draw, Heal, Front, Over, Sentinel, atau null
  "rarity":     "RRR",                  // RRR, RR, R, C, SP, SSR, FR, FFR, SCR, GR, PR, etc.
  "imageUrlEn": "https://en.cf-vanguard.com/wordpress/wp-content/images/cardlist/dzbt12/dzbt12_001.png"
}
```

### Enum `unitType`

Normal Unit · G Unit · Normal Order · Set Order · Blitz Order · Trigger Order · Token · Ride Deck Crest · Others

## 🤖 Auto-update

Database di-update otomatis tiap **Senin pagi (06:00 WIB)** via GitHub Actions. Workflow akan:

1. Fetch daftar expansion dari EN site
2. Bandingkan dengan setCode yang sudah ada di `cards.json`
3. Scrape expansion baru saja (incremental, bukan full scrape)
4. Run diagnose untuk verify
5. Auto-commit kalau ada perubahan

### Trigger manual

Dari GitHub Actions tab, klik **Run workflow** dan optional:
- **force_expansion** — masukkan ID untuk re-scrape expansion tertentu (misal `248`)
- **dry_run** — cek saja, tidak commit perubahan

## 🛠️ Tools

| Script | Fungsi |
|---|---|
| `scrape_en.js` | Scrape semua kartu dari EN site |
| `update.js` | **Auto-update orchestrator** — detect expansion baru, scrape incremental |
| `diagnose.js` | Quality checker — coverage report per field |
| `fix_data.js` | In-place fix untuk data yang sudah ada (no scrape ulang) |
| `reset_cards.js` | Reset field tertentu untuk re-fetch dengan `--retry-failed` |
| `inspect_card.js` | Debug single card — lihat HTML mentah dari EN site |

### Usage

```bash
# Auto-update (incremental)
node update.js                        # detect + scrape expansion baru
node update.js --dry-run              # preview saja
node update.js --force-expansion 248  # force re-scrape expansion tertentu
node update.js --check-only           # exit 1 kalau ada update tersedia

# Full scrape (jarang dipakai — hanya kalau mulai dari nol)
node scrape_en.js                          # scrape semua expansion (~9 jam)
node scrape_en.js --expansion 248          # 1 expansion
node scrape_en.js --resume                 # lanjutkan dari progress terakhir
node scrape_en.js --retry-failed           # re-fetch kartu dengan field kosong

# Maintenance
node diagnose.js                          # cek coverage seluruh DB
node diagnose.js --set DZ-BT12            # filter per set
node diagnose.js --list                   # list semua setCode

node fix_data.js                          # perbaiki bug di cards.json
node reset_cards.js --card "DZ-BT12/001EN"
node reset_cards.js --set DZ-BT12

node inspect_card.js DZ-BT12/001EN        # debug HTML parsing
```

## 📊 Coverage saat ini

- **unitType:** ~99.9%
- **imageUrlEn:** 100%
- **nations:** ~94.9% (sisanya legitimate nationless: Calamity, BanG Dream collab, Cray Elemental, Order/Token)
- **races:** ~91.4%

## ⚙️ Struktur Repo

```
vanguard-library-db/
├── .github/
│   └── workflows/
│       └── auto-update.yml    # GitHub Actions weekly cron
├── cards.json                  # Output utama (~10 MB)
├── scrape_en.js               # Main scraper
├── update.js                  # Auto-update orchestrator
├── diagnose.js                # Quality checker
├── fix_data.js                # In-place fixer
├── reset_cards.js             # Selective reset
└── inspect_card.js            # Debug single card
```

## 📥 Konsumsi Data

URL raw untuk fetch:
```
https://raw.githubusercontent.com/nerif7/vanguard-library-db/main/cards.json
```

Cek perubahan via GitHub commit API:
```
https://api.github.com/repos/nerif7/vanguard-library-db/commits?path=cards.json&per_page=1
```

Aplikasi `tcg_library` pakai pattern hybrid: fetch dari URL ini saat pertama kali atau saat user trigger "Cek Update".

## 📝 Lisensi

Data kartu adalah milik Bushiroad. Repo ini hanya menyediakan database hasil scraping untuk keperluan personal koleksi tracker.
