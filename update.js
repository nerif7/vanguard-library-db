#!/usr/bin/env node
/**
 * update.js — Auto-update orchestrator for vanguard-library-db
 *
 * Workflow:
 *   1. Fetch expansion list dari EN site (en.cf-vanguard.com)
 *   2. Bandingkan dengan setCode yang sudah ada di cards.json
 *   3. Untuk setiap expansion yang baru / belum lengkap:
 *      - Invoke scrape_en.js --expansion N sebagai child process
 *   4. Run diagnose.js untuk verify hasil
 *   5. Print summary (untuk dipakai GitHub Actions step output)
 *
 * Usage:
 *   node update.js                       # auto-detect expansion baru
 *   node update.js --force-expansion 248 # force re-scrape expansion tertentu
 *   node update.js --dry-run             # cek saja, jangan scrape apapun
 *   node update.js --check-only          # exit code 0 kalau no update,
 *                                          1 kalau ada update tersedia
 *
 * Exit codes:
 *   0 = success (atau no-update untuk --check-only mode)
 *   1 = update available (--check-only) ATAU error
 *   2 = scrape failed
 */

const fs   = require("fs");
const path = require("path");
const https = require("https");
const { spawnSync } = require("child_process");

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL    = "https://en.cf-vanguard.com";
const CARDS_PATH  = path.join(__dirname, "cards.json");
const SCRAPE_PATH = path.join(__dirname, "scrape_en.js");
const DIAGNOSE_PATH = path.join(__dirname, "diagnose.js");

const args            = process.argv.slice(2);
const ARG_FORCE_EXP   = getArg("--force-expansion");
const ARG_DRY_RUN     = args.includes("--dry-run");
const ARG_CHECK_ONLY  = args.includes("--check-only");
const ARG_DELAY       = getArg("--delay") || "350";

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function fetchUrl(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const req = https.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) vanguard-library-db/2.0",
          "Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      }, (res) => {
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : BASE_URL + res.headers.location;
          return fetchUrl(redirectUrl, retries).then(resolve).catch(reject);
        }

        if (res.statusCode !== 200) {
          res.resume();
          if (n > 0) {
            setTimeout(() => attempt(n - 1), 1000);
          } else {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          }
          return;
        }

        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end",  () => resolve(Buffer.concat(chunks).toString("utf-8")));
        res.on("error", reject);
      });
      req.on("error", (err) => {
        if (n > 0) setTimeout(() => attempt(n - 1), 1000);
        else reject(err);
      });
      req.setTimeout(15000, () => { req.destroy(); });
    };
    attempt(retries);
  });
}

function between(html, open, close) {
  const i = html.indexOf(open);
  if (i === -1) return null;
  const j = html.indexOf(close, i + open.length);
  return j === -1 ? null : html.slice(i + open.length, j);
}

/**
 * Fetch list of expansion IDs from EN site (copy of scrape_en.js logic).
 * Inline here so update.js works standalone without refactoring scrape_en.js.
 */
async function fetchExpansionList() {
  const html = await fetchUrl(`${BASE_URL}/cardlist/`);
  const ids  = new Set();

  const selectBlock = between(html, 'name="expansion"', "</select>");
  if (selectBlock) {
    for (const m of selectBlock.matchAll(/value="(\d+)"/g)) ids.add(Number(m[1]));
  }
  for (const m of html.matchAll(/expansion=(\d+)/g)) ids.add(Number(m[1]));
  ids.add(0); // PR promos always included

  return [...ids].sort((a, b) => a - b);
}

/**
 * Get all unique setCode values from cards.json.
 * Returns a Set of setCodes (e.g. "DZ-BT12", "V-BT01", "G-BT11").
 */
function loadExistingSetCodes() {
  if (!fs.existsSync(CARDS_PATH)) {
    console.log("  ⚠️  cards.json belum ada — semua expansion dianggap baru");
    return new Set();
  }
  try {
    const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));
    const codes = new Set();
    for (const c of cards) {
      if (c.setCode) codes.add(c.setCode);
    }
    return codes;
  } catch (err) {
    console.error("  ❌ Gagal baca cards.json:", err.message);
    return new Set();
  }
}

/**
 * Count cards per expansion in cards.json.
 * Returns { expansionId → cardCount } (best-effort; relies on imageUrl pattern).
 */
function countCardsByExpansion() {
  if (!fs.existsSync(CARDS_PATH)) return {};
  const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));
  // No direct expansionId in cards, but we can group by setCode prefix
  const bySet = {};
  for (const c of cards) {
    if (c.setCode) bySet[c.setCode] = (bySet[c.setCode] || 0) + 1;
  }
  return bySet;
}

/**
 * For each expansion ID from EN site, fetch its gallery page to determine setCode.
 * Returns Map<expansionId, setCode>.
 * Slow (1 fetch per expansion), so called only when needed.
 */
async function mapExpansionsToSetCodes(expansionIds) {
  const map = new Map();
  console.log(`  Memetakan ${expansionIds.length} expansion ke setCode...`);

  for (let i = 0; i < expansionIds.length; i++) {
    const id = expansionIds[i];
    if (id === 0) {
      map.set(0, "D-PR"); // PR promos
      process.stdout.write(`\r  [${i + 1}/${expansionIds.length}] expansion=${id} → D-PR (PR promos)         `);
      continue;
    }

    try {
      const url  = `${BASE_URL}/cardlist/cardsearch_ex/?expansion=${id}&view=image&page=1`;
      const html = await fetchUrl(url);

      // Find any card code in gallery and extract setCode prefix
      // Pattern: cardno=DZ-BT12%2F001EN or cardno=DZ-BT12/001EN
      const match = html.match(/cardno=([A-Z0-9-]+)(?:%2F|\/)/);
      const setCode = match ? match[1] : "(unknown)";

      map.set(id, setCode);
      process.stdout.write(`\r  [${i + 1}/${expansionIds.length}] expansion=${id} → ${setCode}                  `);
    } catch (err) {
      map.set(id, "(error)");
    }

    // Brief delay to be polite
    await new Promise((r) => setTimeout(r, 200));
  }

  console.log("");
  return map;
}

/**
 * Run scrape_en.js for a specific expansion as a child process.
 * Returns true if exit code 0.
 */
function runScraper(expansionId, delay = "350") {
  console.log(`\n  ▶ Scrape expansion=${expansionId} ...`);
  const result = spawnSync(
    "node",
    [SCRAPE_PATH, "--expansion", String(expansionId), "--delay", delay],
    { stdio: "inherit", encoding: "utf-8" }
  );
  return result.status === 0;
}

/**
 * Run diagnose.js to verify the database state.
 */
function runDiagnose() {
  console.log("\n  ▶ Run diagnose.js ...");
  const result = spawnSync("node", [DIAGNOSE_PATH], { stdio: "inherit", encoding: "utf-8" });
  return result.status === 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Vanguard Library — Auto Update Orchestrator");
  console.log("═══════════════════════════════════════════════════\n");

  // Step 1: Fetch expansion list from EN site
  console.log("Step 1: Fetch daftar expansion dari EN site");
  let expansionIds;
  try {
    expansionIds = await fetchExpansionList();
    console.log(`  ✅ Ditemukan ${expansionIds.length} expansion di en.cf-vanguard.com`);
  } catch (err) {
    console.error("  ❌ Gagal fetch expansion list:", err.message);
    process.exit(2);
  }

  // Step 2: Force mode — skip detection, scrape langsung
  if (ARG_FORCE_EXP) {
    const forced = Number(ARG_FORCE_EXP);
    console.log(`\nStep 2: Force-scrape expansion=${forced} (skip detection)`);
    if (ARG_DRY_RUN) {
      console.log("  [dry-run] would scrape expansion=" + forced);
      process.exit(0);
    }
    const ok = runScraper(forced, ARG_DELAY);
    if (!ok) {
      console.error("  ❌ Scraper gagal");
      process.exit(2);
    }
    runDiagnose();
    console.log("\n═══════════════════════════════════════════════════");
    console.log("  ✅ Force-update selesai");
    console.log("═══════════════════════════════════════════════════");
    process.exit(0);
  }

  // Step 3: Compare expansion list vs local cards.json
  console.log("\nStep 2: Bandingkan dengan cards.json lokal");
  const existingSets = loadExistingSetCodes();
  console.log(`  Lokal punya ${existingSets.size} setCode unik`);

  // Map expansion IDs to setCodes (1 fetch per expansion, slow but reliable)
  const expansionToSetCode = await mapExpansionsToSetCodes(expansionIds);

  // Find expansion yang setCode-nya BELUM ada di lokal
  const newExpansions = [];
  for (const [expId, setCode] of expansionToSetCode) {
    if (setCode === "(unknown)" || setCode === "(error)") continue;
    if (!existingSets.has(setCode)) {
      newExpansions.push({ expId, setCode });
    }
  }

  if (newExpansions.length === 0) {
    console.log("\n  ✨ Tidak ada expansion baru. Database sudah up-to-date.");
    if (ARG_CHECK_ONLY) process.exit(0);
    process.exit(0);
  }

  console.log(`\n  📦 ${newExpansions.length} expansion baru terdeteksi:`);
  for (const { expId, setCode } of newExpansions) {
    console.log(`     • expansion=${expId} (setCode: ${setCode})`);
  }

  // --check-only mode: exit dengan kode 1 untuk signal "ada update"
  if (ARG_CHECK_ONLY) {
    console.log("\n  [check-only] keluar dengan exit code 1 (update tersedia)");
    process.exit(1);
  }

  if (ARG_DRY_RUN) {
    console.log("\n  [dry-run] tidak akan scrape apa-apa");
    process.exit(0);
  }

  // Step 4: Scrape each new expansion
  console.log("\nStep 3: Scrape expansion baru");
  let succeeded = 0;
  let failed    = 0;
  for (const { expId, setCode } of newExpansions) {
    const ok = runScraper(expId, ARG_DELAY);
    if (ok) {
      succeeded++;
      console.log(`  ✅ expansion=${expId} (${setCode}) selesai`);
    } else {
      failed++;
      console.error(`  ❌ expansion=${expId} (${setCode}) gagal`);
    }
  }

  // Step 5: Diagnose
  console.log("\nStep 4: Verify hasil dengan diagnose.js");
  runDiagnose();

  // Step 6: Summary
  console.log("\n═══════════════════════════════════════════════════");
  console.log(`  Selesai. ${succeeded} sukses, ${failed} gagal.`);
  if (failed > 0) {
    console.log("  ⚠️  Ada expansion yang gagal — cek log di atas.");
  }

  // Print machine-readable summary for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    const newCount = succeeded;
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `new_expansions=${newCount}\n` +
      `new_set_codes=${newExpansions.map((e) => e.setCode).join(",")}\n` +
      `failed=${failed}\n`
    );
  }

  console.log("═══════════════════════════════════════════════════");
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error("\n💥 Fatal error:", err);
  process.exit(2);
});
