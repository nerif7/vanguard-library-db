# CLAUDE.md — Vanguard Library DB

## Project Overview

A self-maintaining **Cardfight!! Vanguard card database** that scrapes the official English site, stores structured card data as a public JSON file, and serves a browser-based viewer via GitHub Pages.

- **Live viewer:** https://nerif7.github.io/vanguard-library-db/
- **Raw data:** `cards.json` in repo root (11 MB, 24,262+ cards)
- **Auto-update:** Weekly via GitHub Actions (Sundays 23:00 UTC)

---

## Tech Stack

| Layer | Tech | Notes |
|-------|------|-------|
| Runtime | Node.js v20 | Zero external NPM packages |
| Scraping | `https`, `fs` (stdlib only) | No Puppeteer, no Cheerio |
| Storage | `cards.json` (flat JSON array) | No SQL/NoSQL database |
| Viewer | Vanilla HTML/CSS/JS | No frameworks |
| Automation | GitHub Actions | Scheduled + manual dispatch |
| Hosting | GitHub Pages | `viewer/` folder |

---

## Repository Structure

```
vanguard-library-db/
├── cards.json              # Main database (DO NOT manually edit)
├── scrape_en.js            # Core scraper (895 lines) — fetches en.cf-vanguard.com
├── update.js               # Orchestrator (610 lines) — detects new expansions, validates, commits
├── diagnose.js             # Data quality checker — field coverage report
├── fix_data.js             # In-place data fixer — no re-scrape needed
├── reset_cards.js          # Reset specific cards/sets for retry
├── inspect_card.js         # Debug single card HTML parsing
├── debug_expansion.js      # Debug expansion gallery pages
├── viewer/
│   ├── index.html          # Entry point
│   ├── viewer.js           # Browse + filter logic (virtualized, 17 KB)
│   └── viewer.css          # Responsive styles (12.7 KB)
└── .github/workflows/
    ├── auto-update.yml     # Weekly scrape workflow
    └── deploy-viewer.yml   # GitHub Pages deploy
```

---

## Card Schema

```json
{
  "enCardNo":   "DZ-BT12/001EN",       // Primary key (unique card code)
  "setCode":    "DZ-BT12",             // Expansion code
  "cardNumber": "001",                 // Card number within set
  "name":       "Enma Stealth Rogue, Mujinlord",
  "unitType":   "G Unit",              // Normal Unit | G Unit | Normal Order | Blaze Order | Astral Order | Resonance Order | Token | Crest | G Guardian | Over Trigger
  "nations":    ["Dragon Empire"],     // Array, 1-2 nations, null if nationless
  "clan":       ["Nubatama"],          // Array — populated for older era cards, mostly empty for V+
  "races":      ["Demon"],             // Array
  "grade":      4,                     // Int 0-10, null for Orders/Tokens/Crests
  "trigger":    null,                  // Critical | Draw | Heal | Front | Over | Sentinel | null
  "rarity":     "RRR",                 // RRR | RR | R | C | SP | SSR | FR | FFR | SCR | GR | PR | etc.
  "imageUrlEn": "https://..."          // Always populated
}
```

### Field Coverage

| Field | Coverage | Notes |
|-------|----------|-------|
| `unitType` | ~100% | — |
| `imageUrlEn` | ~100% | — |
| `grade` | ~98.5% | Orders/Tokens/Crests legitimately lack grades |
| `nations` | ~94.8% | Legitimately null: Calamity, Elemental, Collab, Orders, Tokens |
| `races` | ~91.4% | — |
| `clan` | ~53.5% | V+ era cards mostly empty (game mechanic change) |
| `trigger` | ~10.6% | Only trigger units have this |

---

## Common Development Commands

```bash
# Incremental update (detect + scrape new expansions)
node update.js
node update.js --dry-run                  # Preview, no commit
node update.js --check-only               # Exit 0 = up-to-date, 1 = update available
node update.js --force-expansion 248      # Force re-scrape specific expansion ID

# Full scrape (rarely needed, ~9 hours)
node scrape_en.js
node scrape_en.js --expansion 248         # Single expansion test
node scrape_en.js --resume                # Continue interrupted scrape
node scrape_en.js --retry-failed          # Re-fetch empty-field cards

# Data quality
node diagnose.js                          # Coverage report for all sets
node diagnose.js --set DZ-BT12            # Filter by set
node diagnose.js --list                   # List all setCode values
node fix_data.js --dry-run                # Preview fixes
node fix_data.js                          # Apply fixes in-place

# Debugging
node inspect_card.js "DZ-BT12/001EN"      # Debug single card parsing
node debug_expansion.js 248               # Debug expansion gallery
node reset_cards.js --set DZ-BT12         # Reset set for re-fetch
```

---

## Key Architecture Decisions

- **Zero dependencies** — intentional; avoids npm supply-chain risk and keeps CI setup trivial
- **Flat JSON file** — simple, portable, directly consumable via raw GitHub URL without any backend
- **Incremental scraping** — only new expansions are scraped per run (max 5/run) to stay within GitHub Actions 120-min timeout
- **Backup/restore cycle** — `update.js` always backs up `cards.json` before scraping and auto-restores on validation failure
- **Validation gate** — commit is blocked if result < 20,000 cards, invalid JSON, or sample field check fails
- **Concurrency protection** — push retry loop handles race conditions from parallel GitHub Actions runs

---

## Consuming the Data

```javascript
// Fetch all cards
const res = await fetch('https://raw.githubusercontent.com/Nerif7/vanguard-library-db/main/cards.json');
const cards = await res.json();

// Filter by nation
const dragEmpire = cards.filter(c => c.nations?.includes('Dragon Empire'));

// Get all unique set codes
const sets = [...new Set(cards.map(c => c.setCode))];
```

---

## GitHub Actions Workflows

### `auto-update.yml`
- **Schedule:** Every Sunday 23:00 UTC (Monday 06:00 WIB)
- **Manual inputs:** `force_expansion` (expansion ID), `dry_run` (boolean)
- **Timeout:** 120 minutes
- **Steps:** checkout → setup Node 20 → `node update.js` → validate → commit+push

### `deploy-viewer.yml`
- **Trigger:** Push to `main` that touches `viewer/`
- **Action:** Deploys `viewer/` to GitHub Pages

---

## Data Source

All card data is scraped from **en.cf-vanguard.com** (official Bushiroad English site).
Card images and game data are property of **Bushiroad Inc.**
Code in this repository is MIT licensed.
