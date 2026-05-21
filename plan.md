# Plan: JP Database Integration

> Status: **PLANNING COMPLETE — semua keputusan final, code review selesai, siap implementasi**
> Last updated: 2026-05-21 (review #11: DD resolved)

---

## Ringkasan Keputusan Final

| # | Topik | Keputusan |
|---|---|---|
| 1 | Relasi JP↔EN | **Dua database independen** — tidak ada `card_links.json` |
| 2 | Kartu JP-only | **Disertakan** |
| 3 | Image JP | **Disertakan** (`imageUrlJp`) |
| 4 | `nameJp` | **Disertakan**, ditampilkan apa adanya |
| 5 | Search by JP name | **Ya** — untuk user yang bisa bahasa Jepang |
| 6 | Field `name` di `cards_jp.json` | **Tidak ada** — JP murni pakai `nameJp`, tidak ada EN name sama sekali |
| 7 | Update pipeline JP | **`update_jp.js` terpisah** dari `update.js` |
| 8 | Navigasi app | **Global region switcher** + tab Overview untuk user "Keduanya"; single-region terasa seperti satu versi tunggal |
| 9 | Collection DB schema | **JSON-based** — tambah field `region` ke `CollectionEntry` + `WishlistEntry`; backward compat via `entry.region ?? 'EN'` on load |
| 10 | Onboarding | **Ya** — user ditanya saat pertama buka app |
| 11 | Penyimpanan preference | **`settings.json`** — file baru di userdata dir, pola sama dengan `locations.json` yang sudah ada |
| 12 | Default preference (upgrade user lama) | **`'EN'`** — backward compatible |
| 13 | GitHub Actions workflow JP | **Satu workflow, dua job sequential** — EN job dulu, JP job dengan `if: always()` (JP tetap jalan meski EN gagal); schedule tetap Minggu 23:00 UTC |
| 14 | Cache saat downgrade preference | **Dibiarkan** — tidak auto-clear; user bisa hapus manual via tombol di Settings (per-region atau semua sekaligus) |
| 15 | Loading strategy startup | **Eager load** — semua region aktif di-load paralel saat startup; kalau cache belum ada, trigger download di background |

---

## Open Questions (Belum Diputuskan)

| # | Pertanyaan | Opsi yang Ada |
|---|---|---|
| ~~A~~ | ~~Schedule GitHub Actions JP~~ | ✅ **Resolved** — satu workflow, dua job sequential; JP job pakai `if: always()` sehingga tetap jalan meski EN gagal |
| ~~B~~ | ~~Struktur HTML JP site~~ | ✅ **Resolved** — server-rendered HTML, stdlib `https` works, zero-dependency terjaga; gallery + detail page flow; image URL konstruktibel dari card number |
| ~~C~~ | ~~Onboarding bisa di-skip atau wajib?~~ | ✅ **Resolved** — wajib pilih, tidak ada tombol skip; supaya user sadar ada pilihan JP |
| ~~D~~ | ~~Ganti preference dari "Keduanya" ke single — cache region lain di-clear?~~ | ✅ **Resolved** — cache dibiarkan (tidak auto-clear saat downgrade); user bisa hapus manual via tombol di Settings |
| ~~E~~ | ~~Romanisasi JP-only cards~~ | ✅ **Resolved** — tidak diperlukan, field `name` dihapus dari schema JP |
| ~~F~~ | ~~Loading strategy saat startup~~ | ✅ **Resolved** — eager load semua region aktif secara paralel saat startup; kalau salah satu cache belum ada, trigger download di background |
| ~~G~~ | ~~`mergeOrAdd()` uniqueness check perlu `region`~~ | ✅ **Resolved** — tambah `&& (e.region ?? 'EN') === entry.region` ke kondisi find; berlaku untuk semua callsite (card-preview, movePartial, import) |
| ~~H~~ | ~~`movePartial()` tidak copy `region` ke entry baru~~ | ✅ **Resolved** — entry baru yang dibuat harus include `region: sourceEntry.region`; tanpa ini JP entries silent reklasifikasi jadi EN |
| ~~I~~ | ~~`renderStats()` wishlist count tidak region-aware~~ | ✅ **Resolved** — filter `getAllWishlistEntries()` by region sebelum hitung; hanya cosmetic tapi fix tetap perlu untuk akurasi stats |
| ~~J~~ | ~~`tab-nav.ts` tidak ada di Refactor Map~~ | ✅ **Resolved** — tambah ke Refactor Map: tab visibility dinamis berdasarkan preference (4 tab BOTH, 3 tab single-region) |
| ~~K~~ | ~~`types.ts`: `UnitType \| null` dan `TriggerType` di `Card` crash kompilasi JP~~ | ✅ **Resolved** — `Card.unitType: string \| null`, `Card.trigger: string \| null`; `UnitType`/`TriggerType` tetap ada sebagai dokumentasi tapi tidak dipakai di `Card`; import keduanya di `filters.ts` dan `filter-bar.ts` dihapus seiring penghapusan constants |
| ~~L~~ | ~~`collection-db.ts`: `getCollectionByCardCode()` tidak punya `region` parameter~~ | ✅ **Resolved** — tambah `region?: string` optional parameter; filter by `(e.region ?? 'EN') === region` kalau region diberikan; caller di `card-preview.ts` pass `card.region` |
| ~~M~~ | ~~`wishlist-tab.ts` line 254: `removeFromWishlist(entry.cardCode)` tidak pass `region`~~ | ✅ **Resolved** — ganti ke `removeFromWishlist(entry.cardCode, entry.region ?? 'EN')`; tambah ke Refactor Map |
| ~~N~~ | ~~`filters.ts` lines 152–155: "owned-desc" sort pakai `a.enCardNo`~~ | ✅ **Resolved** — ganti `a.enCardNo`/`b.enCardNo` → `a.cardNo`/`b.cardNo`, `a.name` → `a.displayName`; tambah ke Refactor Map |
| ~~O~~ | ~~`card-preview.ts` line 120: `isInWishlist(card.enCardNo)` — plan hanya menyebut rename ke `card.cardNo`, tapi `isInWishlist` juga butuh `region` parameter~~ | ✅ **Resolved** — pisahkan line 120 dari grouping rename generic; fix: `isInWishlist(card.cardNo, card.region)`; Refactor Map diperbarui |
| ~~P~~ | ~~`collection-grouped.ts` lines 87–88: fungsi `sortInGroup` pakai `card?.name`, file ini tidak ada di Refactor Map sama sekali~~ | ✅ **Resolved** — tambah `collection-grouped.ts` ke Refactor Map: `card?.name` → `card?.displayName` di lines 87–88 |
| ~~Q~~ | ~~`loadCollectionTab(region)` dan `loadWishlistTab(region)` tidak update `cardMap` — cardMap di-set sekali di init, stale setelah region switch~~ | ✅ **Resolved** — tambah `cards?: Card[]` optional param ke keduanya; kalau diberikan → update cardMap di awal; caller di `switchRegion()` dan `handleLoad()` pass `allCards`; caller di in-tab refreshes (onMoved, dll) tidak perlu pass cards; Refactor Map diperbarui |
| ~~R~~ | ~~`collection-tab.ts` `applyFilters()` search filter `card?.name.toLowerCase()` missing dari Refactor Map~~ | ✅ **Resolved** — tambah ke Refactor Map; fix: `card?.name.toLowerCase()` → `card?.displayName.toLowerCase()`; simetris dengan wishlist-tab.ts yang sudah benar |
| ~~S~~ | ~~`card.name` sebagai alt text / lightbox param tidak di-dokumentasikan di 3 tempat~~ | ✅ **Resolved** — tambah ke Refactor Map: `card-preview.ts` lines 68 & 72, `wishlist-tab.ts` line ~236; semua `card.name` → `card.displayName` |
| ~~T~~ | ~~`loadCollectionTab(region: string, ...)` dan `loadWishlistTab(region: string, ...)` — `region` required menyebabkan TypeScript compile error di `onMoved` callback (collection-tab.ts) dan `refreshWishlistTab()` (wishlist-tab.ts) yang memanggil tanpa args~~ | ✅ **Resolved** — ubah `region` jadi optional dengan stored-region pattern (`let _currentRegion`); internal callers tidak perlu pass region; callsite rules table dikoreksi |
| ~~U~~ | ~~`handleClearCache()` di main.ts hardcoded hanya clear EN cache (`clearCards()` + `clearMeta()`); JP cache tidak pernah di-clear~~ | ✅ **Resolved** — jadikan region-aware: EN → `clearCards()` + `clearMeta()`, JP → `clearCardsJp()` + `clearMetaJp()`; clear `allEnCards`/`allJpCards` + `enMeta`/`jpMeta` sesuai region; update dialog text include region name; tambah ke main.ts Refactor Map |
| ~~V~~ | ~~`switchRegion()` tidak reset `selectedCardNo` dan tidak hide `cardPreview` — setelah region switch, Browse preview bisa masih tampil card dari region lama~~ | ✅ **Resolved** — tambahkan `cardPreview?.hide(); selectedCardNo = null;` ke step 2 `switchRegion()`; Refactor Map diperbarui |
| ~~W~~ | ~~`main.ts` `refreshList()`: 6 instance `card.enCardNo` di renderRow/onRowClick (list view) dan renderCell/onCellClick (grid view) — tidak ada di Refactor Map sama sekali~~ | ✅ **Resolved** — semua 6 instance → `card.cardNo`; tambah ke main.ts Refactor Map |
| ~~X~~ | ~~Refactor Map mencantumkan `card.enCardNo → card.cardNo` untuk `collection-row.ts` dan `wishlist-row.ts` — kedua file ini tidak punya `card.enCardNo` sama sekali; code display pakai `entry.cardCode` bukan `card.enCardNo`~~ | ✅ **Resolved** — hapus phantom entries; hanya `card.name → card.displayName` yang dibutuhkan di kedua file |
| ~~Y~~ | ~~`loadCollectionTab` dan `loadWishlistTab` tidak filter entries by region — `allEntries = entries` / `allEntries = await getAllWishlistEntries()` assign SEMUA entries (EN+JP gabung); setelah JP integration kedua tab tampilkan data gabungan tanpa peduli region aktif. TypeScript tidak menangkap ini.~~ | ✅ **Resolved** — tambah filter di setiap titik load; lihat Refactor Map yang diperbarui untuk detail |
| ~~Z~~ | ~~`switchRegion()` step 3 di plan: `filterRefs = null` + `setupFilters()` menyebabkan dua bug sekaligus: (1) `populateDropdowns` tidak clear options sebelum append → dropdown Browse akumulasi options EN+JP setelah region switch; (2) semua 5 `addEventListener` di `setupFilters()` terpanggil dua kali → `refreshList()` + Clear + Sort + ViewToggle semua fire dua kali setiap interaksi~~ | ✅ **Resolved** — `populateDropdowns` harus clear dulu sebelum append; step 3 `switchRegion()` diubah: jangan reset filterRefs, langsung panggil `populateDropdowns` + `resetFilters`; lihat Refactor Map |
| ~~AA~~ | ~~`doFetchAndCacheJp()` sebagai mirror dari `doFetchAndCacheEn()` akan lakukan `allCards = allJpCards` + `refreshList()` tanpa cek `activeRegion` — di BOTH mode, kalau EN aktif dan background JP update fire, browse silently switch ke JP cards; tidak ada yang restore state → persistent state corruption~~ | ✅ **Resolved** — `doFetchAndCacheEn()` dan `doFetchAndCacheJp()` harus cek `activeRegion` sebelum reassign `allCards` dan update UI; lihat Refactor Map |
| ~~BB~~ | ~~`fetchFromGitHub()` di `cache.ts` (line 139) juga parse JSON via `JSON.parse(text) as Card[]` — plan hanya dokumentasi `loadCards()` yang dapat `.map(normalizeEn)`, tapi `fetchFromGitHub()` tidak. Setelah type refactor `Card` kehilangan `enCardNo`/`name`/`imageUrlEn`, `result.cards` yang dikembalikan adalah `RawEnCard[]` bukan `Card[]`; `card.cardNo` akan `undefined` saat runtime. TypeScript tidak tangkap ini (type cast).~~ | ✅ **Resolved** — `fetchFromGitHub()` harus tambah `.map(normalizeEn)` saat parse, sejajar dengan `loadCards()`; `fetchFromGitHubJp()` (fungsi baru) juga harus tambah `.map(normalizeJp)`; tambah ke cache.ts Refactor Map |
| ~~CC~~ | ~~`switchRegion()` step 2 hanya tutup Browse's `cardPreview` (`cardPreview?.hide(); selectedCardNo = null;`) — Collection dan Wishlist preview pane tidak ditutup. Kalau user sedang di Collection/Wishlist tab dengan preview terbuka saat region switch, preview tetap tampil card dari region lama; setelah `loadCollectionTab`/`loadWishlistTab` render list baru, `selectedId`/`selectedCode` juga stale.~~ | ✅ **Resolved** — tambah `closeCollectionPreview(); closeWishlistPreview();` ke step 2 `switchRegion()`; keduanya sudah di-import di main.ts; main.ts Refactor Map diperbarui |
| ~~DD~~ | ~~`handleClearCache()` line 326 set `filterRefs = null`. Ketika user force-refresh setelah clear, `doFetchAndCacheEn/Jp()` memanggil `setupFilters()` — guard `if (filterRefs) return` false (filterRefs null) → 5 `addEventListener` baru ditambah ke DOM elements yang SAMA; listener lama dari `setupFilters()` pertama masih ada → doubled handlers: setiap interaksi filter, sort, dan view toggle fire dua kali. Root cause sama dengan Issue Z tapi di path clear-cache → force-refresh.~~ | ✅ **Resolved** — `handleClearCache()` jangan set `filterRefs = null` (hanya hide filter bar); `doFetchAndCacheEn/Jp()` harus pakai conditional yang sama dengan `switchRegion()` step 3: `filterRefs ? (populateDropdowns + show bar) : setupFilters()`; main.ts Refactor Map diperbarui |

---

## Arsitektur Database (vanguard-library-db)

### Struktur File

```
vanguard-library-db/
├── cards.json        ← EN database — TIDAK BERUBAH (backward compatible 100%)
├── cards_jp.json     ← JP database — BARU, independen
├── version.json      ← DIEXTEND: tambah cardCountJp + newSetsJp
├── diagnose.js       ← DIEXTEND: tambah flag --region jp (default en)
└── fix_data.js       ← DIEXTEND: tambah flag --region jp (default en)
```

Tidak ada `card_links.json` — dua database benar-benar terpisah.

### Schema `cards_jp.json`

```json
{
  "jpCardNo":   "D-BT12/001",
  "setCode":    "D-BT12",
  "cardNumber": "001",
  "nameJp":     "忍妖・六道双陀羅刃",
  "unitType":   "G Unit",
  "nations":    ["Dragon Empire"],
  "clan":       ["Nubatama"],
  "races":      ["Demon"],
  "grade":      4,
  "trigger":    null,
  "rarity":     "RRR",
  "imageUrlJp": "https://cf-vanguard.com/..."
}
```

**Perbedaan penting vs `cards.json`:**
- Primary key: `jpCardNo` (bukan `enCardNo`)
- Image: `imageUrlJp` (bukan `imageUrlEn`)
- Nama: `nameJp` saja — tidak ada field `name` (EN name)
- Tidak ada relasi/referensi ke `cards.json` sama sekali
- **Field values disimpan apa adanya dalam Japanese** (`ドラゴンエンパイア`, `ノーマルユニット`, dll) — tidak dinormalisasi ke English. Alasan: normalisasi tidak bisa 100% dijamin (clan/race baru di set mendatang tidak punya mapping), dan ongoing maintenance burden seumur hidup project
- **Implikasi di app:** Filter dropdown Browse JP menampilkan Japanese values; saat BOTH user switch region, filter dropdown di-repopulate via `populateDropdowns()` — natural untuk target user JP, tidak ada yang broken

### `version.json` — Extension

```json
{
  "lastUpdate":   "2026-05-20T...",
  "cardCount":    24262,
  "cardCountJp":  26000,
  "newSets":      [],
  "newSetsJp":    []
}
```

**Catatan penting:** `version.json` di-update oleh dua script berbeda (`update.js` dan `update_jp.js`). Keduanya harus pakai **read-modify-write** (baca dulu, ubah field miliknya saja, tulis ulang) — bukan overwrite penuh. Kalau tidak, satu script bisa menghapus field milik script lain.

**Backward compat:** Sebelum JP integration di-deploy, commit `version.json` dengan JP fields bernilai awal (`cardCountJp: 0`, `newSetsJp: []`) agar app baru tidak baca `undefined`. Di app: selalu pakai `version.cardCountJp ?? 0` dan handle 404 pada fetch `cards_jp.json` sebagai "JP data belum tersedia".

---

## Komponen Baru di Database Repo

### `scrape_jp.js` (file baru)
- Source: `cf-vanguard.com` (JP site)
- **Server-rendered HTML** — stdlib `https` works, zero-dependency terjaga
- Adaptasi dari `scrape_en.js` — struktur mirip, ganti URL + selectors
- Flow: `/cardlist/` (expansion IDs) → `/cardlist/cardsearch/?expansion=N` (card numbers) → `/cardlist/?cardno=XXXX` (semua field)
- PR cards: enumerate via `/cardlist/card-pr?page=N` (table format, paginasi)
  - `setCode` untuk PR cards: `D-PR`, `V-PR`, `PR` — flat bucket per era, konsisten dengan konvensi EN yang sudah ada
  - Stop condition: parse angka halaman terakhir dari pagination element halaman pertama (saat ini 65 halaman, ~40 kartu/halaman, ~2,600 PR cards total)
  - Safety fallback: kalau halaman return 0 kartu → stop lebih awal
  - Catatan: listing URL pakai underscore (`card_pr`) tapi pagination links pakai hyphen (`card-pr`) — scraper pakai hyphen untuk iterasi
- `imageUrlJp` **konstruktibel** dari card number — tidak butuh extra fetch
  - Formula: `setCode.toLowerCase().replace(/-/g,'')` + `_` + cardNum + `.png`
  - **Verified** across all eras: DZ, D, D-TD, D-PR, V, G, BT (classic) — semua konsisten
  - Contoh: `DZ-SS16/002` → `.../cardlist/DZ-SS16/dzss16_002.png`
- Handling encoding: UTF-8 (Node.js default, tidak masalah untuk kanji/kana)
- Estimasi jumlah kartu: ~26,000+

### `update_jp.js` (file baru)
- Sepenuhnya terpisah dari `update.js`
- Logic serupa: detect new JP expansions → scrape → validate → commit
- Update field `cardCountJp` dan `newSetsJp` di `version.json` via read-modify-write
- GitHub Actions: satu workflow bersama `update.js`, dua job sequential; JP job pakai `if: always()` — tetap jalan meski EN job gagal
- **Bug fix:** JP job harus `git pull origin main` di awal sebelum baca/tulis `version.json` — tanpa ini, JP job checkout SHA lama dan akan overwrite `cardCount` EN dengan nilai stale setiap minggu

**Backup/restore (wajib, sama dengan `update.js`):**
1. Backup `cards_jp.json` → `cards_jp.backup.json` sebelum scrape dimulai
2. Scrape → tulis hasil ke `cards_jp.json`
3. Kalau validasi gagal atau error → restore dari backup, tidak ada commit
4. Kalau sukses → hapus backup, lanjut commit
Tanpa ini, timeout atau error di tengah scrape bisa menghasilkan JSON corrupt yang membreak seluruh JP database.

**Validation strategy:**
- Full scrape pertama: validasi **manual** — cek output dengan `diagnose_jp.js`, commit manual setelah verified
- Incremental (mingguan): dua gate otomatis:
  1. **Regression guard** — `newCount >= previousCount` (dari `version.json`); kalau turun, abort + no commit
  2. **Per-set minimum** — tiap set baru harus menghasilkan ≥ 50 kartu; kalau kurang, kemungkinan HTML structure berubah
- Threshold absolute tidak dipakai — ditentukan setelah full scrape pertama selesai dan jumlah real diketahui

---

## Arsitektur App (vg_collection_tauri)

### Onboarding Screen (pertama kali buka app)

```
Kamu kolektor kartu jenis apa?

  ○ EN saja
  ○ JP saja
  ● Keduanya (EN + JP)

  [ Mulai ]
```

| Pilihan | Database di-load | Tab yang muncul |
|---|---|---|
| EN saja | `cards.json` | Browse EN, Collection EN, Wishlist |
| JP saja | `cards_jp.json` | Browse JP, Collection JP, Wishlist |
| Keduanya | Keduanya | Browse (dengan toggle), Collection EN, Collection JP, Wishlist |

- Preference disimpan di **`settings.json`**
- Default untuk upgrade user lama: `'EN'` (tidak lihat onboarding, langsung masuk)
- Bisa diubah kembali dari Settings (bukan hanya onboarding)
- Tidak bisa di-skip — user wajib pilih sebelum masuk app

**Flow ganti preference di Settings:**
1. User pilih preference baru → muncul confirmation dialog
   - Pesan: "Ganti ke [X]? Data koleksi/wishlist region lain tidak dihapus, hanya tidak terlihat selama preference ini aktif."
2. User konfirmasi → force navigate ke tab Browse
3. Apply preference baru (update UI: tabs, region switcher visibility)
4. Clear card data lama dari memory → load card data sesuai preference baru
5. Kalau preference baru butuh cache yang belum ada → trigger download di background
6. Simpan preference baru ke `settings.json`

**Region switcher (`[ EN | JP ]`) hanya muncul untuk user BOTH** — single-region users tidak melihat switcher sama sekali (app terasa satu versi tunggal). Untuk switch region, single-region users harus ubah preference di Settings.

### Browse Tab & Navigasi Global

**User single-region (EN-only atau JP-only):**
- Tab: Browse, Collection, Wishlist — label tidak berubah, tidak ada hint region lain
- App terasa seperti satu versi tunggal

**User "Keduanya":**
- Global region switcher di header/topbar: `[ EN | JP ]`
- Switcher mengubah seluruh konteks app sekaligus — Browse, Collection, Wishlist semua ikut
- Tab tambahan: **Overview** — dashboard ringkasan EN dan JP berdampingan:
  ```
  ┌──────────────────┬──────────────────┐
  │  EN Collection   │  JP Collection   │
  ├──────────────────┼──────────────────┤
  │  1,200 kartu     │   800 kartu      │  ← distinct cardCode per region
  │  3 lokasi        │   2 lokasi       │  ← distinct location values per region
  ├──────────────────┼──────────────────┤
  │  Wishlist: 47    │  Wishlist: 23    │
  └──────────────────┴──────────────────┘
  ```
- Tab reguler tetap: Browse, Collection, Wishlist (tidak ada label "EN"/"JP" di tab)

**Wishlist behavior (mode BOTH):**
- Wishlist **ikut region switcher** — tampilkan EN wishlist atau JP wishlist sesuai region aktif
- User **boleh wishlist kartu EN dan versi JP-nya sekaligus** — schema `UNIQUE (cardNo, region)` sudah support dua row berbeda
- Tombol "Add to Wishlist" di card preview **otomatis pakai region kartu** yang sedang dilihat — tidak ada prompt pilihan region

### Collection & Wishlist Schema

**App menggunakan JSON files, bukan SQLite.** Storage: `collection.json`, `wishlist.json`, `locations.json` di userdata dir.

**Schema saat ini (pre-JP):**
```typescript
CollectionEntry { id?: number; cardCode: string; quantity: number; location: string; }
WishlistEntry   { cardCode: string; }
```

**Schema baru (post-JP) — tambah field `region`:**
```typescript
CollectionEntry { id?: number; cardCode: string; quantity: number; location: string; region: "EN" | "JP"; }
WishlistEntry   { cardCode: string; region: "EN" | "JP"; }
```

- `cardCode` sudah region-agnostic (bukan `enCardNo`) — tidak perlu rename apapun
- **Backward compat on load:** entry lama tidak punya `region` → default `'EN'` saat di-load (`entry.region ?? 'EN'`)
- Tidak ada SQL migration, tidak ada ALTER TABLE — JSON transform on load sudah cukup dan aman
- `deduplicateCollection` key update: dari `cardCode+location` → `cardCode+location+region`
- Filter per-region: `entries.filter(e => (e.region ?? 'EN') === activeRegion)`

**Settings — file baru `settings.json`:**
```typescript
{
  "region_preference":  "EN" | "JP" | "BOTH",
  "last_active_region": "EN" | "JP",
  "migration_version":  number
}
```
Pola sama dengan `locations.json` yang sudah ada — load/save via helper yang sama.

**Backup/import format:**
- Version 1 (legacy, pre-JP): tidak ada field `version`, entries tanpa `region` → import handler set `region='EN'` untuk semua
- Version 2 (post-JP): `"version": 2`, entries dengan `region` → import langsung
- Import handler deteksi via field `version` (lebih robust dari deteksi nama kolom)
- Export baru selalu tulis `"version": 2`

**Bug fix import validation:** `cardSet` untuk validasi harus include `jpCardNo` dari JP cards — kalau tidak, semua JP entries dianggap "unknown" saat import

### Settings (`settings.json`)

File baru di userdata dir, pola load/save sama dengan `locations.json` yang sudah ada:
```typescript
interface Settings {
  region_preference:  "EN" | "JP" | "BOTH";
  last_active_region: "EN" | "JP";
  migration_version:  number;
}
```

**`last_active_region`:** disimpan setiap kali user toggle region switcher; dibaca saat startup untuk restore state terakhir user BOTH. Tidak di-reset saat preference downgrade — kalau user balik ke BOTH, lanjut dari region terakhir.

**Backward compat:** kalau `settings.json` belum ada (user lama / fresh install) → default `region_preference: 'EN'`, tidak tampilkan onboarding.

**Bug yang harus diantisipasi saat implementasi:**

| Bug | Fix |
|---|---|
| Upgrade user lama default ke BOTH | Kalau `settings.json` tidak ada → default `'EN'`, skip onboarding |
| Preference ada tapi cache tidak ada | Validasi cache state saat startup, trigger download kalau kosong |
| Tab invalid saat ganti preference | Force navigate ke tab Browse sebelum apply perubahan |
| Switch ke BOTH tapi JP cache belum ada | Trigger download JP saat preference berubah ke BOTH |
| `settings.json` belum ada | Handle null return dari loadSettings() → pakai defaults |
| Value invalid/corrupt di settings | Validate on read, fallback ke `'EN'` |
| **Migration region field tidak ada di entry lama** | **`entry.region ?? 'EN'` saat load — JSON transform on load, tidak perlu file migration terpisah** |
| **`deduplicateCollection` pakai key lama** | **Update dedup key dari `cardCode+location` → `cardCode+location+region`** |

---

## Masalah JP vs EN yang Perlu Diingat

- JP adalah market asal — JP selalu dapat set baru **lebih dulu** dari EN
- Beberapa set EN adalah kompilasi 2-3 set JP kecil — card number tidak selalu 1:1
- Rarity system berbeda: GR lebih umum di JP, beberapa SP EN-only
- Image URL JP: **publicly accessible** — verified 200 OK, tidak ada hotlink protection

---

## Urutan Implementasi (Draft — Belum Final)

### Phase 1 — Database Repo
1. ~~Investigasi struktur HTML `cf-vanguard.com`~~ ✅ server-rendered, stdlib works
2. ~~Putuskan open questions A, B~~ ✅ Resolved
3. Tulis `scrape_jp.js`
4. Full scrape pertama → generate `cards_jp.json`
5. Validasi manual dengan `node diagnose.js --region jp`
6. Update `version.json` schema + read-modify-write di kedua update scripts
7. Tulis `update_jp.js`
8. Extend `diagnose.js` dan `fix_data.js` dengan flag `--region jp`
9. Update GitHub Actions — tambah workflow JP

### Phase 2 — App
1. Unified `Card` type + transform loader (prerequisite semua langkah lain)
2. Settings system (`settings.json`) + onboarding screen
3. Conditional data loading berdasarkan preference (eager, paralel)
4. `region` field di `CollectionEntry` + `WishlistEntry` (JSON transform on load)
5. Browse filter: jadikan unitType & trigger dinamis; repopulate saat region switch
6. Collection tab: tambah `region` filter ke `loadCollectionTab`
7. Wishlist tab: tambah `region` ke semua wishlist functions
8. Card preview: refactor semua hardcoded EN field references
9. Global region switcher (BOTH mode) + persist `last_active_region`
10. Overview tab (BOTH mode only)
11. Settings page — ganti preference + clear cache per-region

**TypeScript Card type — Normalized shape saat load:**
`cards_jp.json` tetap simpan field names JP asli (`jpCardNo`, `nameJp`, `imageUrlJp`). Saat app load, JP cards di-transform ke unified `Card` shape:
```typescript
interface Card {
  cardNo:      string;        // enCardNo untuk EN, jpCardNo untuk JP
  displayName: string;        // name untuk EN, nameJp untuk JP
  imageUrl:    string | null; // imageUrlEn untuk EN, imageUrlJp untuk JP
  region:      "EN" | "JP";
  // field lain identik di kedua schema:
  setCode:    string;
  cardNumber: string;
  unitType:   string | null;  // Japanese string untuk JP (ノーマルユニット, dll)
  nations:    string[];       // Japanese string untuk JP
  clan:       string[];
  races:      string[];
  grade:      number | null;
  trigger:    string | null;  // Japanese string untuk JP
  rarity:     string | null;
}
```
Transform terjadi sekali di memory saat parsing — tidak mengubah data di disk.

---

## Refactor Map: Semua Perubahan Field yang Dibutuhkan di Phase 2

Hasil code review menunjukkan scope refactor lebih besar dari yang plan awalnya siratkan. Semua perubahan ini adalah **refactor mekanis** (rename field), bukan logika baru.

### `types.ts`
- Ganti interface `Card`: hapus `enCardNo`, `name`, `imageUrlEn` → tambah `cardNo`, `displayName`, `imageUrl`, `region`
- **`unitType: UnitType | null` → `unitType: string | null`** — JP values (ノーマルユニット, dll) tidak assignable ke `UnitType`; TypeScript compilation gagal tanpa ini
- **`trigger: TriggerType` → `trigger: string | null`** — sama, JP trigger values adalah Japanese strings
- `UnitType` dan `TriggerType` type exports tetap ada sebagai dokumentasi, tapi tidak digunakan di `Card` interface
- Tambah field `region: "EN" | "JP"` ke `CollectionEntry` dan `WishlistEntry`

### `collection-db.ts`
- `deduplicateCollection`: key dari `cardCode+location` → `cardCode+location+region`
- `mergeOrAdd(entry)`: tambah `&& (e.region ?? 'EN') === entry.region` ke kondisi find — supaya EN dan JP entries dengan cardCode+location yang sama tidak salah di-merge
- `movePartial(entryId, qty, targetLocation)`: entry baru yang dibuat harus include `region: sourceEntry.region` — tanpa ini kartu JP yang dipindah lokasi akan silent reklasifikasi jadi EN
- `addToWishlist(cardCode, region)`: tambah parameter `region`, uniqueness check `cardCode+region`
- `removeFromWishlist(cardCode, region)`: tambah parameter `region`
- `isInWishlist(cardCode, region)`: tambah parameter `region`
- `getCollectionQtyMap(region: string)`: tambah parameter `region`, filter entries by `(e.region ?? 'EN') === region` sebelum aggregate — supaya badge Browse hanya reflect collection dari region yang sedang aktif, bukan semua region
- `getCollectionByCardCode(cardCode, region?: string)`: tambah optional parameter `region`; kalau diberikan, filter juga by `(e.region ?? 'EN') === region` — mencegah "Already owned" chips di card-preview menampilkan entries dari region yang salah pada edge case promo cards

### `collection-tab.ts`
- Line 59: `cardMap` key dari `c.enCardNo` → `c.cardNo`
- Line 245: sort by name `card?.name` → `card?.displayName`
- **Line ~277 (`applyFilters` search filter): `card?.name.toLowerCase()` → `card?.displayName.toLowerCase()`** — tanpa ini search by name di Collection tab silently broken setelah rename
- Line 359/363/374: `card.imageUrlEn` → `card.imageUrl`, `card.name` → `card.displayName`
- **`loadCollectionTab(region?: string, cards?: Card[])`**: keduanya optional. Simpan region terakhir di module variable `_currentRegion` (default `'EN'`); kalau `region` diberikan → update `_currentRegion`; kalau `cards` diberikan → update `cardMap`. Caller dari `switchRegion()` dan `handleLoad()` wajib pass keduanya; `onMoved` callback di-dalam module cukup call `loadCollectionTab()` tanpa args (pakai `_currentRegion` + cardMap yang sudah benar).
- **Filter entries by region di `loadCollectionTab` (bukan di `renderStats()`):** `allEntries = entries.filter(e => (e.region ?? 'EN') === _currentRegion)` dan `wishlistCount = wishlist.filter(w => (w.region ?? 'EN') === _currentRegion).length` — kedua filter harus di titik ini, bukan di `renderStats()` yang hanya membaca `allEntries`/`wishlistCount` yang sudah di-set

### `wishlist-tab.ts`
- Line 43: `cardMap` key dari `c.enCardNo` → `c.cardNo`
- Line 157-163: sort by name `card?.name` → `card?.displayName`
- Line 190: `card?.name.toLowerCase()` → `card?.displayName.toLowerCase()` (search filter)
- Line ~232: `if (card?.imageUrlEn)` → `card?.imageUrl`
- Line ~236: `img.src = card.imageUrlEn; img.alt = card.name` → `card.imageUrl`, **`card.displayName`** (kedua field di baris yang sama)
- Line 244: `card?.name` → `card?.displayName`
- **Line 254: `removeFromWishlist(entry.cardCode)` → `removeFromWishlist(entry.cardCode, entry.region ?? 'EN')`** — tanpa ini removes entry dari region yang salah
- **`loadWishlistTab(region?: string, cards?: Card[])`**: keduanya optional, pola sama dengan `loadCollectionTab`. Simpan `_currentRegion` di module. `refreshWishlistTab()` tetap call `loadWishlistTab()` tanpa args — pakai region tersimpan, tidak butuh update cardMap. Caller dari `switchRegion()` dan `handleLoad()` wajib pass keduanya.
- **Filter entries by region di `loadWishlistTab`:** `allEntries = (await getAllWishlistEntries()).filter(e => (e.region ?? 'EN') === _currentRegion)` — tanpa ini wishlist tab tampilkan EN+JP wishlist gabung

### `card-preview.ts`
- Line 64: `if (card.imageUrlEn)` → `card.imageUrl`
- Line 66: `img.src = card.imageUrlEn` → `card.imageUrl`
- **Line 68: `img.alt = card.name` → `card.displayName`**
- Line 72: `this._showLightbox(card.imageUrlEn!, card.name)` → `_showLightbox(card.imageUrl!, card.displayName)` — **keduanya** imageUrl dan name
- Line 87: `card.name` → `card.displayName`
- Line 93: `card.enCardNo` → `card.cardNo`
- Lines 119, 175: `getCollectionByCardCode(card.enCardNo)` → `getCollectionByCardCode(card.cardNo, card.region)`
- **Line 120: `isInWishlist(card.enCardNo)` → `isInWishlist(card.cardNo, card.region)`** — butuh BOTH rename dan region
- Line 172: `mergeOrAdd(card.enCardNo, loc, qty)` → `mergeOrAdd(card.cardNo, loc, qty, card.region)`
- Lines 235, 237: `removeFromWishlist(card.enCardNo)` → `removeFromWishlist(card.cardNo, card.region)`, `addToWishlist(card.enCardNo)` → `addToWishlist(card.cardNo, card.region)`

### `filters.ts`
- Lines 60-61: `card.name` → `card.displayName`, `card.enCardNo` → `card.cardNo` (search haystack)
- Line 140: `a.name.localeCompare(b.name)` → `a.displayName.localeCompare(b.displayName)` (sort "name")
- Lines 143, 147, 150: `a.name.localeCompare` → `a.displayName.localeCompare`
- Line 143 (sort by code): `a.enCardNo` → `a.cardNo`
- **Lines 153–155 (sort "owned-desc"): `qtyMap?.get(a.enCardNo)` → `qtyMap?.get(a.cardNo)`, `b.enCardNo` → `b.cardNo`, `a.name` → `a.displayName`** — tanpa ini owned-desc sort selalu return qty 0 setelah field rename
- `UNIT_TYPE_OPTIONS` dan `TRIGGER_OPTIONS`: **hapus constants dan import `UnitType`/`TriggerType`** — jadikan dinamis seperti setCode dan nation

### `filter-bar.ts`
- `populateDropdowns`: ganti dari hardcoded `UNIT_TYPE_OPTIONS`/`TRIGGER_OPTIONS` ke dynamic extraction dari cards — `extractUniqueOptions` perlu di-extend untuk return `unitTypes` dan `triggers` juga
- **`populateDropdowns` harus clear setiap `<select>` sebelum append** — gunakan `el.innerHTML = '<option value="all">...</option>'` sebelum loop (pola sama dengan `populateCollectionFilters` di collection-tab.ts); tanpa ini region switch akumulasi options dari kedua region

### `export-import.ts`
- `BackupData` interface: tambah `version?: number`
- Export: set `version: 2`
- Import: deteksi format via `backup.version` field; kalau tidak ada `version` → legacy format, set `region: 'EN'` untuk semua entries sebelum loop
- **Import loop callsites (lines 102, 105):** `mergeOrAdd(entry.cardCode, entry.location, entry.quantity, entry.region ?? 'EN')` dan `addToWishlist(entry.cardCode, entry.region ?? 'EN')` — TypeScript akan error jika ini tidak di-update saat signature functions berubah, tapi penting untuk dicatat eksplisit

### `cache.ts` ✅ Keputusan: **Opsi B — Fungsi Terpisah Per Region**

EN functions **tidak berubah signature** — nol risiko regresi. JP functions baru dengan suffix `Jp`. Shared logic diekstrak ke private helpers.

**Perubahan EN (minimal — hanya tambah transform):**
- `loadCards()` → tambah `.map(normalizeEn)` saat parse
- **`fetchFromGitHub()` → tambah `.map(normalizeEn)` ke parsed result (Issue BB)** — tanpa ini `doFetchAndCacheEn()` menerima raw cards, bukan `Card[]`
- `loadFromCache()` → tidak berubah signature, output sudah `Card[]` karena transform di `loadCards()`

**Fungsi baru JP:**
- `loadCardsJp()`, `saveCardsJp()`, `clearCardsJp()`
- `loadMetaJp()`, `saveMetaJp()`, `clearMetaJp()`
- `fetchFromGitHubJp()` — URL: `.../cards_jp.json`; **tambah `.map(normalizeJp)` ke parsed result** (sejajar dengan Issue BB fix di EN)
- `loadFromCacheJp()` — convenience wrapper

**Transform functions (baru, di-export):**
```typescript
export function normalizeEn(raw: RawEnCard): Card {
  return { ...raw, cardNo: raw.enCardNo, displayName: raw.name, imageUrl: raw.imageUrlEn, region: "EN" };
}
export function normalizeJp(raw: RawJpCard): Card {
  return { ...raw, cardNo: raw.jpCardNo, displayName: raw.nameJp, imageUrl: raw.imageUrlJp, region: "JP" };
}
```

**`VersionInfo` interface — tambah JP fields:**
```typescript
interface VersionInfo {
  lastUpdate:   string;
  cardCount:    number;
  cardCountJp?: number;   // baru — optional untuk backward compat
  newSets:      string[];
  newSetsJp?:   string[]; // baru — optional
}
```

**Private shared helpers:**
- `readCacheFile(filename)` dan `writeCacheFile(filename, content)` — ekstrak dari existing EN functions agar JP tidak duplikasi boilerplate path-building

**Alasan pilih Opsi B vs Opsi A (region parameter):**
EN path tidak berubah signature → nol risiko regresi EN selama Phase 2 refactor. JP bisa di-develop dan di-test sepenuhnya isolated. Kelemahan (callsite butuh ternary untuk single-region) sangat kecil dibanding keuntungannya.

### `card-row.ts`
- `card.name` → `card.displayName`
- `card.enCardNo` → `card.cardNo`

### `card-tile.ts`
- `card.name` → `card.displayName`
- `card.imageUrlEn` → `card.imageUrl`
- `card.enCardNo` → `card.cardNo`

### `collection-row.ts`
- Line 20: `card?.name` → `card?.displayName` (code display uses `entry.cardCode`, not `card.enCardNo` — no rename needed there)

### `wishlist-row.ts`
- Line 20: `card?.name` → `card?.displayName` (same — code display uses `entry.cardCode`)

### `collection-grouped.ts`
- Lines 87–88 dalam `sortInGroup`: `card?.name ?? a.cardCode` / `card?.name ?? b.cardCode` → `card?.displayName ?? a.cardCode` / `card?.displayName ?? b.cardCode`

### `main.ts` ✅ Arsitektur Diputuskan — Scope Besar, Bukan Sekadar Field Rename

**State baru yang ditambahkan:**
```typescript
let allEnCards: Card[] = [];
let allJpCards: Card[] = [];
let activeRegion: "EN" | "JP" = "EN";
let regionPreference: "EN" | "JP" | "BOTH" = "EN";
let enMeta: CacheMeta | null = null;
let jpMeta: CacheMeta | null = null;
```

**`allCards` sebagai pointer (Opsi 1):** `allCards` tetap ada, selalu di-assign ke salah satu dari `allEnCards`/`allJpCards` sesuai `activeRegion`. Semua kode existing yang pakai `allCards` tidak perlu berubah.

**`handleLoad()` — tiga path:**
- `"EN"`: load `loadFromCache()` → `allEnCards`, fallback `doFetchAndCacheEn()`
- `"JP"`: load `loadFromCacheJp()` → `allJpCards`, fallback `doFetchAndCacheJp()`
- `"BOTH"`: `Promise.all([loadFromCache(), loadFromCacheJp()])` paralel → set keduanya; `checkForUpdatesEn` + `checkForUpdatesJp` di background

**`doFetchAndCache()` → dua fungsi terpisah:**
- `doFetchAndCacheEn()` — path lama; setelah fetch+save: `allEnCards = result.cards`; lalu **hanya jika `activeRegion === "EN"`**: `allCards = allEnCards`, filter update (lihat di bawah), `refreshList()`, update UI stats + toast
- `doFetchAndCacheJp()` — mirror; setelah fetch+save: `allJpCards = result.cards`; lalu **hanya jika `activeRegion === "JP"`**: `allCards = allJpCards`, filter update, `refreshList()`, update UI stats + toast
- **Tanpa guard ini**: di BOTH mode, background update inactive region akan silently reassign `allCards` dan corrupt browse state
- **Filter update pattern (Issue DD fix)** — TIDAK boleh panggil `setupFilters()` langsung:
  ```typescript
  if (filterRefs) {
      populateDropdowns(filterRefs, extractUniqueOptions(allCards));
      filterBarEl.style.display = "";
  } else {
      setupFilters();  // true first-run saja (filterRefs belum pernah di-set)
  }
  ```
  Sama persis dengan `switchRegion()` step 3. Kalau `setupFilters()` dipanggil setelah `handleClearCache()`, listener lama masih attached → doubled handlers.

**`checkForUpdates()` → dua fungsi terpisah:**
- `checkForUpdatesEn(meta)` — bandingkan `version.cardCount` vs `meta.cardCount`
- `checkForUpdatesJp(meta)` — bandingkan `version.cardCountJp` vs `meta.cardCount`

**`handleForceRefresh()` ✅ Opsi A — Refresh active region saja:**
`activeRegion === "EN" ? doFetchAndCacheEn() : doFetchAndCacheJp()`. Alasan: user menekan Refresh di konteks JP → ekspektasi JP yang di-refresh; untuk refresh region lain, switch dulu.

**`handleClearCache()` — jadikan region-aware:**
```typescript
if (activeRegion === "EN") {
    await Promise.all([clearCards(), clearMeta()]);
    allEnCards = []; enMeta = null;
} else {
    await Promise.all([clearCardsJp(), clearMetaJp()]);
    allJpCards = []; jpMeta = null;
}
allCards = []; // pointer mengikuti
```
Dialog text: `"Clear ${activeRegion} card cache? ..."`. Konsisten dengan `handleForceRefresh` yang juga only affects active region.
**Penting (Issue DD fix): jangan set `filterRefs = null`** — cukup `filterBarEl.style.display = "none"`; kalau filterRefs di-null, `doFetchAndCacheEn/Jp` akan panggil `setupFilters()` lagi dan menambah event listeners kedua ke DOM elements yang sama.

**`refreshCollectionOverlay()` → pass `activeRegion`:**
`getCollectionQtyMap(activeRegion)` — badge hanya reflect collection region aktif.

**Region switch handler (fungsi baru `switchRegion(region)`) — urutan wajib:**
1. Set `activeRegion`, reassign `allCards = region === "EN" ? allEnCards : allJpCards`
2. Destroy `virtualList`/`virtualGrid`, clear container; **`cardPreview?.hide(); selectedCardNo = null; closeCollectionPreview(); closeWishlistPreview();`** — tanpa ini semua tiga preview pane (Browse, Collection, Wishlist) bisa masih tampil card dari region lama; `closeCollectionPreview()`/`closeWishlistPreview()` juga reset `selectedId`/`selectedCode` di modul masing-masing
3. **Jangan** reset `filterRefs = null` — langsung panggil `populateDropdowns(filterRefs!, extractUniqueOptions(allCards))` dan `resetFilters(filterRefs!)`. Ini repopulate dropdown dengan cards region baru tanpa re-attach event listeners (yang sudah terpasang sejak init). Kalau `filterRefs` null (belum pernah init), panggil `setupFilters()` sebagai fallback.
4. `refreshList()`
5. `collectionQtyMap = await getCollectionQtyMap(region)` → `virtualList/Grid?.refresh()`
6. `renderCacheInfo(region === "EN" ? enMeta : jpMeta)`
7. `Promise.all([loadCollectionTab(region, allCards), loadWishlistTab(region, allCards)])` — **pass `allCards`** (sudah di-reassign ke region baru di step 1) agar cardMap ikut di-refresh
8. `saveLastActiveRegion(region)`
Urutan ini tidak boleh diubah — tiap step bergantung pada state yang di-set step sebelumnya.

**Callsite rules untuk `loadCollectionTab` / `loadWishlistTab`:**
| Caller | Pass region? | Pass cards? | Alasan |
|---|---|---|---|
| `switchRegion()` step 7 | ✅ `newRegion` | ✅ `allCards` | Region berubah — update keduanya |
| `handleLoad()` startup | ✅ `activeRegion` | ✅ `allCards` | Init pertama — set keduanya eksplisit |
| `onCollectionChanged` callback (main.ts) | ❌ | ❌ | Region & cards tidak berubah; stored values sudah benar |
| `refreshWishlistTab()` (wishlist-tab.ts) | ❌ | ❌ | In-module call; stored `_currentRegion` dipakai |
| `onMoved` callback (collection-tab.ts) | ❌ | ❌ | In-module call; stored `_currentRegion` dipakai |

**`refreshList()` field renames (lines 149, 151, 166, 167, 170):**
- `card.enCardNo === selectedCardNo` → `card.cardNo === selectedCardNo` (list renderRow + grid renderCell)
- `collectionQtyMap.get(card.enCardNo)` → `collectionQtyMap.get(card.cardNo)` (list renderRow + grid renderCell)
- `selectedCardNo = card.enCardNo` → `selectedCardNo = card.cardNo` (list onRowClick + grid onCellClick)
Tanpa ini: selection highlighting tidak bekerja, badge qty di Browse selalu undefined, `selectedCardNo` tidak pernah match setelah rename.

**Import validation line 380:** `cardSet` harus include JP card codes — `new Set([...allEnCards.map(c => c.cardNo), ...allJpCards.map(c => c.cardNo)])`

### Filter dropdown BOTH mode ✅ Tidak ada issue — resolved by architecture
- Di BOTH mode, Browse ikut region switcher — `allCards` selalu berisi satu region saja (EN atau JP) sesuai `activeRegion`
- `extractUniqueOptions()` dipanggil dengan cards region aktif → dropdown selalu monolingual, tidak pernah bilingual bersamaan
- Saat region switch, `populateDropdowns()` dipanggil ulang → dropdown refresh ke values region baru
- **Syarat:** `allCards` di `main.ts` TIDAK boleh jadi gabungan EN+JP — harus selalu filtered by active region

### `back-button.ts` ✅ Keputusan: **Opsi C — Back saat onboarding = exit app langsung**
- Saat onboarding aktif, back button keluar app langsung (single tap, tanpa double-tap confirmation)
- Alasan: user yang buka tidak sengaja bisa langsung keluar; next launch onboarding muncul lagi
- Implementasi: cek `isOnboardingVisible()` **sebelum** semua handler lain — kalau true, panggil Tauri `exit(0)` langsung, jangan masuk ke close chain normal
- Double-tap-to-exit logic tidak berlaku saat onboarding aktif

### `tab-nav.ts`
- Tab visibility dinamis berdasarkan `regionPreference`:
  - Single-region (`"EN"` atau `"JP"`): 3 tab — Collection, Wishlist, Browse
  - BOTH: 4 tab — Collection, Wishlist, Browse, Overview
- Overview tab disembunyikan (`hidden`) untuk single-region users, ditampilkan untuk BOTH
- `tabNav` perlu menerima `regionPreference` saat init atau expose method `setPreference(pref)` untuk toggle visibility

### `browse-stats.ts` ✅ Keputusan: **Opsi A — Show active region's meta, signature tidak berubah**
- `renderCacheInfo(meta: CacheMeta | null)` — signature tetap sama
- Caller (`main.ts`) bertanggung jawab pass meta yang tepat sesuai `activeRegion`
- BOTH users: lihat EN cache info saat di EN region, JP cache info saat di JP region
- Detail kedua cache (status + tombol clear per-region) ada di Settings page (Phase 2 step 11) — sejalan dengan Decision #14