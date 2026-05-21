# Implementation Plan — JP Database Integration

> **Branch policy:** All work goes to `feature/jp-integration` in both repos.
> Merge to `main` only when stable and explicitly instructed.
>
> - DB repo:  `E:\Private_project\vanguard-library-db`  → branch `feature/jp-integration`
> - App repo: `E:\Private_project\vg_collection_tauri`  → branch `feature/jp-integration`

---

## Progress Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Done and committed |
| 🔄 | In progress |
| ⬜ | Not started |
| ⚠️ | Blocked / needs decision |

---

## Phase 1 — Database Repo (`vanguard-library-db`)

### P1-1  `scrape_jp.js` ✅

Scrapes `cf-vanguard.com` (server-rendered HTML, stdlib `https`, zero deps).

**Two scrape paths:**
1. Expansion galleries `/cardlist/cardsearch/?expansion=N&page=P`
2. PR/stamped promos `/cardlist/card-pr?page=P` (table format)

Fetches detail page `/cardlist/?cardno=XXXX` for every card (same CSS class names as EN site).

**Key JP differences handled:**
- No `<select name="expansion">` — expansion IDs extracted from hrefs
- `span.face` for card name (not img title)
- Grade: `グレード N` → extract N
- Trigger keywords in Japanese (`ヒールトリガー`, `クリティカルトリガー`, etc.)
- `トリガーユニット` → normalized to `ノーマルユニット`
- Image URL formula: `/{setCode}/{setCodeLowercaseNoHyphen}_{cardNum}.png`
- Stamped promo copies (`G-TCB01/026 PR`) → image from detail HTML, non-standard path

**Output schema (`cards_jp.json`):**
```json
{ "jpCardNo", "setCode", "cardNumber", "nameJp", "unitType", "nations", "clan",
  "races", "grade", "trigger", "rarity", "imageUrlJp" }
```
Field values stored as-is in Japanese (not normalized to English).

**Commands:**
```bash
node scrape_jp.js                    # full scrape (est. ~9 hours)
node scrape_jp.js --expansion 295   # single expansion (testing)
node scrape_jp.js --resume          # continue interrupted
node scrape_jp.js --retry-failed    # re-fetch incomplete cards
```

---

### P1-2  Full first scrape → `cards_jp.json` ⬜

**Must run manually** (takes ~9 hours). Prerequisites: network access, no existing `cards_jp.json` (or use `--resume`).

```bash
node scrape_jp.js
```

After completion: validate with `node diagnose.js --region jp`.

---

### P1-3  `diagnose.js` — `--region jp` flag ✅

Extended with `--region en|jp` (default `en`). All field names, file path, unit type checks,
sample sections, and issues summary are parameterized via `REGION_CONFIG`.

```bash
node diagnose.js --region jp          # full coverage report
node diagnose.js --region jp --list   # list all JP sets
node diagnose.js --region jp --set D-BT01
```

---

### P1-4  `fix_data.js` — `--region jp` flag ⬜

Mirror of `--region` pattern from `diagnose.js`. Key changes:
- Load `cards_jp.json` when `--region jp`
- Primary key: `jpCardNo` instead of `enCardNo`
- Name field: `nameJp` instead of `name`
- Write back to `cards_jp.json`

All fix functions operate on whichever file the `--region` flag selects.

---

### P1-5  `version.json` schema extension ⬜

**Current schema:**
```json
{ "lastUpdate": "...", "cardCount": 24262, "newSets": [] }
```

**New schema:**
```json
{
  "lastUpdate":   "...",
  "cardCount":    24262,
  "cardCountJp":  0,
  "newSets":      [],
  "newSetsJp":    []
}
```

**Action:** Commit `version.json` with JP fields initialized to `0`/`[]` before any JP data
is deployed. App reads `version.cardCountJp ?? 0` — backward compat.

**CRITICAL:** Both `update.js` and `update_jp.js` must use **read-modify-write** (not overwrite)
so neither script clobbers the other's fields.

---

### P1-6  `update_jp.js` ⬜

Incremental updater for JP database. Runs as a separate workflow job after `update.js`.

**Key behaviors:**
- Detect new JP expansions (compare gallery against `cards_jp.json` existing setCodes)
- Scrape new expansions only (max 5/run, same as EN)
- Update `version.json` via read-modify-write: set `cardCountJp` and `newSetsJp`
- **Must `git pull origin main` at start** — JP job starts from the same checkout SHA as EN job;
  if EN job committed new data, JP job must pull first or it will overwrite `cardCount` with stale value
- Backup/restore cycle: `cards_jp.backup.json` before scrape, restore on failure
- Validation:
  - Full scrape: manual validation only
  - Incremental: `newCount >= previousCount` (regression guard) + per-set minimum ≥ 50 cards

---

### P1-7  GitHub Actions — add JP workflow job ⬜

Extend `auto-update.yml` with a second job for JP:

```yaml
jobs:
  update-en:
    # existing job — unchanged

  update-jp:
    needs: update-en
    if: always()   # run even if EN job fails
    steps:
      - checkout
      - setup Node 20
      - git pull origin main   # pull EN job's commits
      - node update_jp.js
      - validate + commit + push
```

Schedule: Sundays 23:00 UTC (same as EN). JP job runs sequentially after EN.

---

## Phase 2 — App (`vg_collection_tauri`)

### File Change Summary

| File | Status | Changes |
|------|--------|---------|
| `types.ts` | ⬜ | Card interface refactor; CollectionEntry/WishlistEntry add `region` |
| `cache.ts` | ⬜ | normalizeEn/Jp transforms; JP functions; VersionInfo extend |
| `collection-db.ts` | ⬜ | region params on all functions; dedup key update |
| `main.ts` | ⬜ | New state; switchRegion(); two fetch paths; region-aware handlers |
| `filters.ts` | ⬜ | Field renames; dynamic unitType+trigger extraction |
| `filter-bar.ts` | ⬜ | Dynamic dropdowns; clear before append |
| `card-preview.ts` | ⬜ | Field renames; region params on DB calls |
| `collection-tab.ts` | ⬜ | Field renames; stored-region pattern; region filter |
| `wishlist-tab.ts` | ⬜ | Field renames; stored-region pattern; region filter |
| `export-import.ts` | ⬜ | Versioned backup format (v1/v2); region on import |
| `card-row.ts` | ⬜ | Field renames only |
| `card-tile.ts` | ⬜ | Field renames only |
| `collection-row.ts` | ⬜ | Field renames only |
| `wishlist-row.ts` | ⬜ | Field renames only |
| `collection-grouped.ts` | ⬜ | Field renames only |
| `tab-nav.ts` | ⬜ | Dynamic tab visibility; setPreference() method |
| `back-button.ts` | ⬜ | Exit app on back during onboarding |
| **New: `settings.ts`** | ⬜ | load/save settings.json; region preference |
| **New: `onboarding.ts`** | ⬜ | First-launch region selection screen |
| **New: `overview-tab.ts`** | ⬜ | BOTH mode dashboard (EN+JP collection stats) |
| `index.html` | ⬜ | Region switcher element; onboarding panel; overview tab |
| `styles.css` | ⬜ | Region switcher styles; onboarding styles; overview layout |

---

### P2-1  `types.ts` ⬜

**`Card` interface — full refactor:**
```typescript
// Remove: enCardNo, name, imageUrlEn
// Add:
cardNo:      string;
displayName: string;
imageUrl:    string | null;
region:      "EN" | "JP";
// Change:
unitType:    string | null;   // was UnitType | null — JP values not assignable to UnitType
trigger:     string | null;   // was TriggerType — JP values are Japanese strings
```

**`CollectionEntry` and `WishlistEntry`:**
```typescript
region: "EN" | "JP";  // add to both
```

`UnitType` and `TriggerType` type exports stay as documentation but are no longer used in `Card`.

---

### P2-2  `cache.ts` ⬜

**Transform functions (new, exported):**
```typescript
export function normalizeEn(raw: RawEnCard): Card  // maps enCardNo→cardNo, name→displayName, etc.
export function normalizeJp(raw: RawJpCard): Card  // maps jpCardNo→cardNo, nameJp→displayName, etc.
```

**EN changes (minimal):**
- `loadCards()` → add `.map(normalizeEn)` at parse
- `fetchFromGitHub()` → add `.map(normalizeEn)` after `JSON.parse(text)` ← **Issue BB fix**
- Private helpers `readCacheFile(filename)` / `writeCacheFile(filename, content)` extracted

**New JP functions:**
- `loadCardsJp()`, `saveCardsJp()`, `clearCardsJp()`
- `loadMetaJp()`, `saveMetaJp()`, `clearMetaJp()`
- `fetchFromGitHubJp()` — URL `cards_jp.json`; `.map(normalizeJp)` after parse
- `loadFromCacheJp()`

**`VersionInfo` extend:**
```typescript
cardCountJp?: number;
newSetsJp?:   string[];
```

---

### P2-3  `collection-db.ts` ⬜

Every function that touches a collection/wishlist entry needs a `region` parameter.

**`deduplicateCollection`:** key `cardCode+location` → `cardCode+location+region`
(use `e.region ?? 'EN'` for backward compat on load)

**`mergeOrAdd(cardCode, location, qty, region)`:**
- Add `region` param
- Uniqueness check: `e.cardCode === cardCode && e.location === location && (e.region ?? 'EN') === region`
- New entry includes `region`

**`movePartial(entryId, qty, targetLocation)`:**
- New entry must include `region: sourceEntry.region ?? 'EN'`

**`getCollectionQtyMap(region: string)`:**
- Filter by region before aggregate

**`getCollectionByCardCode(cardCode, region?: string)`:**
- Optional region filter

**`addToWishlist(cardCode, region)`**, **`removeFromWishlist(cardCode, region)`**,
**`isInWishlist(cardCode, region)`:** all add `region` param.

---

### P2-4  `settings.ts` (new file) ⬜

```typescript
interface Settings {
  region_preference:  "EN" | "JP" | "BOTH";
  last_active_region: "EN" | "JP";
  migration_version:  number;
}
```

Functions: `loadSettings(): Promise<Settings>`, `saveSettings(s: Settings): Promise<void>`

**Backward compat:** no `settings.json` (existing user) → return default `{ region_preference: 'EN', last_active_region: 'EN', migration_version: 1 }` — skip onboarding, behave as before.

---

### P2-5  `onboarding.ts` + UI (new file) ⬜

First-launch screen asking user to choose region preference.

- Mandatory choice — no skip button
- Options: EN only / JP only / Both (EN + JP)
- On confirm: save preference to `settings.json`, hide onboarding, start app
- `back-button.ts` integration: back during onboarding → `exit(0)` immediately

---

### P2-6  `main.ts` ⬜

Largest change. New state variables:
```typescript
let allEnCards: Card[] = [];
let allJpCards: Card[] = [];
let activeRegion: "EN" | "JP" = "EN";
let regionPreference: "EN" | "JP" | "BOTH" = "EN";
let enMeta: CacheMeta | null = null;
let jpMeta: CacheMeta | null = null;
```
`allCards` stays as pointer: always reassigned to `allEnCards` or `allJpCards`.

**`handleLoad()` — three paths based on `regionPreference`:**
- `"EN"`: load EN cache → `allEnCards`; fallback `doFetchAndCacheEn()`
- `"JP"`: load JP cache → `allJpCards`; fallback `doFetchAndCacheJp()`
- `"BOTH"`: parallel load both → set both; background update checks for both

**`switchRegion(region)` — 8-step ordered sequence:**
1. Set `activeRegion`; reassign `allCards`
2. Destroy virtual list/grid; clear container; hide all three preview panes + reset selectedCardNo
3. Repopulate filters without re-attaching listeners (Issue Z/DD fix)
4. `refreshList()`
5. `getCollectionQtyMap(region)` → refresh virtual list badges
6. `renderCacheInfo(region === "EN" ? enMeta : jpMeta)`
7. `Promise.all([loadCollectionTab(region, allCards), loadWishlistTab(region, allCards)])`
8. `saveLastActiveRegion(region)`

**`doFetchAndCacheEn/Jp()` — activeRegion guard (Issue AA fix):**
After fetch: update `allEnCards`/`allJpCards`. Only reassign `allCards` and update Browse UI
if `activeRegion === "EN"/"JP"` — prevents background region update corrupting active Browse.

**`handleClearCache()` — region-aware; never sets `filterRefs = null` (Issue DD fix).**

**`handleForceRefresh()` — refreshes active region only.**

**`refreshCollectionOverlay()` → `getCollectionQtyMap(activeRegion)`.**

**Field renames in `refreshList()` (lines 149/151/166/167/170):**
`card.enCardNo` → `card.cardNo`, `collectionQtyMap.get(card.enCardNo)` → `…(card.cardNo)`

**Import validation (line 380):**
`cardSet = new Set([...allEnCards.map(c => c.cardNo), ...allJpCards.map(c => c.cardNo)])`

---

### P2-7  `filters.ts` ⬜

**Field renames:**
- `card.name` → `card.displayName` (lines 60, 140, 143, 147, 150)
- `card.enCardNo` → `card.cardNo` (lines 61, 143, 153, 155)
- `qtyMap?.get(a.enCardNo)` → `qtyMap?.get(a.cardNo)` (sort "owned-desc")

**`extractUniqueOptions` — extend to return `unitTypes` and `triggers`:**
```typescript
// Current return: { setCodes: string[], nations: string[] }
// New return:     { setCodes, nations, unitTypes, triggers }
```
Remove `UNIT_TYPE_OPTIONS`, `TRIGGER_OPTIONS` static constants and
`UnitType`/`TriggerType` imports.

---

### P2-8  `filter-bar.ts` ⬜

**`populateDropdowns` — two changes:**
1. Accept `unitTypes: string[]` and `triggers: string[]` from `extractUniqueOptions`
2. **Clear each `<select>` before appending** (Issue Z fix):
   `el.innerHTML = '<option value="all">...</option>'`
   Prevents option accumulation across region switches.

Remove imports of `UNIT_TYPE_OPTIONS`, `TRIGGER_OPTIONS`.

---

### P2-9  `card-preview.ts` ⬜

Field renames + region params on DB calls:

| Line | Change |
|------|--------|
| 64, 66 | `card.imageUrlEn` → `card.imageUrl` |
| 68 | `img.alt = card.name` → `card.displayName` |
| 72 | `_showLightbox(card.imageUrlEn!, card.name)` → `(card.imageUrl!, card.displayName)` |
| 87 | `card.name` → `card.displayName` |
| 93 | `card.enCardNo` → `card.cardNo` |
| 119, 175 | `getCollectionByCardCode(card.enCardNo)` → `(card.cardNo, card.region)` |
| 120 | `isInWishlist(card.enCardNo)` → `isInWishlist(card.cardNo, card.region)` |
| 172 | `mergeOrAdd(card.enCardNo, loc, qty)` → `(card.cardNo, loc, qty, card.region)` |
| 235 | `removeFromWishlist(card.enCardNo)` → `(card.cardNo, card.region)` |
| 237 | `addToWishlist(card.enCardNo)` → `(card.cardNo, card.region)` |

---

### P2-10  `collection-tab.ts` ⬜

**Stored-region pattern:**
```typescript
let _currentRegion: string = 'EN';
export function loadCollectionTab(region?: string, cards?: Card[]): Promise<void>
// if region given → update _currentRegion
// if cards given → rebuild cardMap
```

**Field renames:** `c.enCardNo` → `c.cardNo`, `card?.name` → `card?.displayName`,
`card.imageUrlEn` → `card.imageUrl`

**Region filter (applied at load time, not in renderStats):**
```typescript
allEntries = entries.filter(e => (e.region ?? 'EN') === _currentRegion);
wishlistCount = wishlist.filter(w => (w.region ?? 'EN') === _currentRegion).length;
```

---

### P2-11  `wishlist-tab.ts` ⬜

Same stored-region pattern as `collection-tab.ts`.

**Key fixes:**
- `removeFromWishlist(entry.cardCode)` → `removeFromWishlist(entry.cardCode, entry.region ?? 'EN')`
- Region filter on `getAllWishlistEntries()` result
- Field renames: `c.enCardNo`, `card?.name`, `card?.imageUrlEn` → new names

---

### P2-12  `export-import.ts` ⬜

**Versioned backup format:**
- Export: add `"version": 2` to backup JSON
- Import: detect `backup.version`:
  - No version field → v1 (legacy) → set `region: 'EN'` on all entries before loop
  - Version 2 → use `entry.region` as-is

**Import callsites:**
- `mergeOrAdd(entry.cardCode, entry.location, entry.quantity, entry.region ?? 'EN')`
- `addToWishlist(entry.cardCode, entry.region ?? 'EN')`

---

### P2-13  Field-rename-only files ⬜

These files only need mechanical field renames — no logic changes.

| File | Changes |
|------|---------|
| `card-row.ts` | `card.name` → `card.displayName`; `card.enCardNo` → `card.cardNo` |
| `card-tile.ts` | `card.name` → `card.displayName`; `card.imageUrlEn` → `card.imageUrl`; `card.enCardNo` → `card.cardNo` |
| `collection-row.ts` | `card?.name` → `card?.displayName` (line 20) |
| `wishlist-row.ts` | `card?.name` → `card?.displayName` (line 20) |
| `collection-grouped.ts` | `card?.name ?? a.cardCode` → `card?.displayName ?? a.cardCode` (lines 87–88) |

---

### P2-14  `tab-nav.ts` ⬜

- Add `"overview"` to `TabId`
- Expose `setPreference(pref: "EN" | "JP" | "BOTH"): void` method
- Hide Overview tab for single-region users; show for BOTH
- `TAB_LABELS`: add `"overview": "Overview"`

---

### P2-15  `back-button.ts` ⬜

- Add `isOnboardingVisible()` check at top of back handler
- If onboarding is active → call Tauri `exit(0)` directly, skip all other handlers

---

### P2-16  `overview-tab.ts` (new file) ⬜

BOTH-mode dashboard showing EN and JP collection stats side-by-side:
```
┌──────────────────┬──────────────────┐
│  EN Collection   │  JP Collection   │
├──────────────────┼──────────────────┤
│  1,200 kartu     │   800 kartu      │
│  3 lokasi        │   2 lokasi       │
├──────────────────┼──────────────────┤
│  Wishlist: 47    │  Wishlist: 23    │
└──────────────────┴──────────────────┘
```
Counts are distinct `cardCode` per region, not total quantity.

---

### P2-17  `index.html` + `styles.css` ⬜

**`index.html`:**
- Add `#regionSwitcher` (`[ EN | JP ]` toggle) — hidden for single-region users
- Add `#onboardingPanel` — shown before main app on first launch
- Add `#tabOverview` panel
- Add Overview button to tab bar

**`styles.css`:**
- Region switcher styling
- Onboarding screen layout (centered, full-screen modal)
- Overview tab two-column grid

---

## Recommended Implementation Order (Phase 2)

The dependency chain is strict — do not skip steps:

```
P2-1 types.ts          ← prerequisite for everything
    ↓
P2-2 cache.ts          ← normalizeEn/Jp transforms
    ↓
P2-3 collection-db.ts  ← region params before any tab code
    ↓
P2-4 settings.ts       ← can be parallel with above
P2-13 field-rename files  ← pure renames, do all at once after types.ts
    ↓
P2-7 filters.ts + P2-8 filter-bar.ts  ← dynamic options (needed by main.ts)
    ↓
P2-9 card-preview.ts
P2-10 collection-tab.ts
P2-11 wishlist-tab.ts
P2-12 export-import.ts
    ↓
P2-14 tab-nav.ts
P2-15 back-button.ts
    ↓
P2-6 main.ts           ← ties everything together
    ↓
P2-5 onboarding.ts
P2-16 overview-tab.ts
P2-17 index.html + styles.css  ← final UI wiring
```

---

## Known Bugs Fixed During This Refactor

| ID | Bug | Fix |
|----|-----|-----|
| BB | `fetchFromGitHub()` returns raw cards after `Card` type refactor — `card.cardNo` undefined at runtime | `.map(normalizeEn)` after `JSON.parse` in `fetchFromGitHub()` |
| CC | Region switch doesn't close Collection/Wishlist preview panes — stale card from old region stays visible | `closeCollectionPreview(); closeWishlistPreview();` in `switchRegion()` step 2 |
| DD | `handleClearCache()` sets `filterRefs = null` → next `doFetchAndCacheEn/Jp()` calls `setupFilters()` and doubles all event listeners | Never null-out `filterRefs`; use `filterRefs ? populateDropdowns(...) : setupFilters()` pattern |
| Z | `switchRegion()` old plan reset `filterRefs` — same doubled-listener problem + option accumulation across regions | Same fix as DD; `populateDropdowns` must clear `<select>` before appending |
| AA | `doFetchAndCacheJp()` reassigns `allCards` without checking `activeRegion` — background update of inactive region corrupts Browse state | Guard: only update `allCards` + Browse UI if `activeRegion === "JP"` |
| Y | `loadCollectionTab/WishlistTab` assigns all entries without region filter — tabs show mixed EN+JP data | Filter `entries` by `_currentRegion` at load time |
| X | Phantom `card.enCardNo` entries in `collection-row.ts`/`wishlist-row.ts` Refactor Map | Removed — those files only access `entry.cardCode`, not `card.enCardNo` |

---

## Files Confirmed Clean (No Changes Needed)

`virtual-list.ts`, `virtual-grid.ts`, `collection-edit.ts`, `location-manager.ts`,
`about-dialog.ts`, `stats-collapsible.ts`, `context-menu.ts`, `swipe-dismiss.ts`,
`toast.ts`, `theme.ts`, `focus-trap.ts`, `confirm-dialog.ts`,
`browse-stats.ts` (signature unchanged — caller passes correct meta)
