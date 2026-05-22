#!/usr/bin/env node
/**
 * update_jp.js — Auto-update orchestrator for JP card database
 *
 * Workflow:
 *   1. git pull (ensure latest cards_jp.json before scraping)
 *   2. Fetch expansion list from JP site (cf-vanguard.com)
 *   3. Compare with setCode yang sudah ada di cards_jp.json
 *   4. Scrape each new expansion via scrape_jp.js --expansion N
 *   5. Validate + diagnose
 *   6. Update version.json (JP fields only, preserve EN fields)
 *
 * Usage:
 *   node update_jp.js                        # auto-detect expansion baru
 *   node update_jp.js --force-expansion 295  # force re-scrape expansion tertentu
 *   node update_jp.js --dry-run              # cek saja, jangan scrape apapun
 *   node update_jp.js --check-only           # exit 0 = up-to-date, 1 = update ada
 *
 * Exit codes:
 *   0 = success (atau no-update untuk --check-only)
 *   1 = update available (--check-only) ATAU error
 *   2 = scrape failed
 */

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");
const { spawnSync } = require("child_process");

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL     = "https://cf-vanguard.com";
const CARDS_PATH   = path.join(__dirname, "cards_jp.json");
const VERSION_PATH = path.join(__dirname, "version.json");
const SCRAPE_PATH  = path.join(__dirname, "scrape_jp.js");
const DIAGNOSE_PATH = path.join(__dirname, "diagnose.js");

const args           = process.argv.slice(2);
const ARG_FORCE_EXP  = getArg("--force-expansion");
const ARG_DRY_RUN    = args.includes("--dry-run");
const ARG_CHECK_ONLY = args.includes("--check-only");
const ARG_DELAY      = getArg("--delay") || "400";
const ARG_MAX_EXP    = Number(getArg("--max-expansions") || "5");
const ARG_NO_PULL    = args.includes("--no-pull");

const MIN_VALID_CARD_COUNT = 25000;

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}

// ── HTTP fetch ────────────────────────────────────────────────────────────────

function fetchUrl(url, retries = 3) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith("https") ? https : http;
    const attempt = (n) => {
      const req = lib.get(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) vanguard-library-db/2.0",
          "Accept":     "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : BASE_URL + res.headers.location;
          res.resume();
          return fetchUrl(redirectUrl, retries).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          if (n > 0) setTimeout(() => attempt(n - 1), 1000);
          else reject(new Error(`HTTP ${res.statusCode} for ${url}`));
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

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Backup / restore / validate ───────────────────────────────────────────────

function backupCardsJson() {
  if (!fs.existsSync(CARDS_PATH)) return false;
  try {
    fs.copyFileSync(CARDS_PATH, CARDS_PATH + ".backup");
    return true;
  } catch (err) {
    console.warn(`  ⚠️  Gagal buat backup: ${err.message}`);
    return false;
  }
}

function restoreBackup() {
  const backupPath = CARDS_PATH + ".backup";
  if (!fs.existsSync(backupPath)) return false;
  try {
    fs.copyFileSync(backupPath, CARDS_PATH);
    fs.unlinkSync(backupPath);
    return true;
  } catch (err) {
    console.error(`  ❌ Gagal restore backup: ${err.message}`);
    return false;
  }
}

function cleanupBackup() {
  const backupPath = CARDS_PATH + ".backup";
  if (fs.existsSync(backupPath)) try { fs.unlinkSync(backupPath); } catch {}
}

function validateCardsJson(minCount = 1000) {
  if (!fs.existsSync(CARDS_PATH)) {
    return { valid: false, count: 0, reason: "file tidak ada" };
  }
  try {
    const data = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));
    if (!Array.isArray(data)) return { valid: false, count: 0, reason: "bukan array" };
    if (data.length < minCount) {
      return { valid: false, count: data.length, reason: `kurang dari ${minCount} kartu` };
    }
    for (const card of data.slice(0, 10)) {
      if (!card.jpCardNo || !card.nameJp) {
        return { valid: false, count: data.length, reason: "ada kartu tanpa jpCardNo atau nameJp" };
      }
    }
    return { valid: true, count: data.length, reason: "OK" };
  } catch (err) {
    return { valid: false, count: 0, reason: `parse error: ${err.message}` };
  }
}

// ── version.json (read-modify-write — preserve EN fields) ────────────────────

function generateVersionJson(newSetsJp) {
  try {
    const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));

    let existing = {};
    if (fs.existsSync(VERSION_PATH)) {
      try { existing = JSON.parse(fs.readFileSync(VERSION_PATH, "utf-8")); } catch {}
    }

    const version = {
      lastUpdate:  new Date().toISOString(),
      cardCount:   existing.cardCount  ?? 0,
      newSets:     existing.newSets    ?? [],
      cardCountJp: cards.length,
      newSetsJp,
    };
    fs.writeFileSync(VERSION_PATH, JSON.stringify(version, null, 2) + "\n");
    console.log(`  ✅ version.json diperbarui (${cards.length} kartu JP, sets baru: ${newSetsJp.join(", ") || "tidak ada"})`);
  } catch (err) {
    console.warn(`  ⚠️  Gagal generate version.json: ${err.message}`);
  }
}

// ── Expansion discovery ───────────────────────────────────────────────────────

/**
 * Fetch JP expansion list.
 * Extracts expansion=N from /cardlist/ nav, then probes above max
 * to catch new expansions not yet in site navigation.
 */
async function fetchExpansionList() {
  const html = await fetchUrl(`${BASE_URL}/cardlist/`);
  const ids = new Set();
  for (const m of html.matchAll(/expansion=(\d+)/g)) ids.add(Number(m[1]));

  const maxKnown = ids.size > 0 ? Math.max(...ids) : 200;
  console.log(`  Found ${ids.size} IDs in navigation (max=${maxKnown})`);

  // Probe above max to catch expansions not listed in navigation
  let consecutiveEmpty = 0;
  for (let id = maxKnown + 1; consecutiveEmpty < 5 && id <= maxKnown + 50; id++) {
    try {
      const testHtml = await fetchUrl(`${BASE_URL}/cardlist/cardsearch/?expansion=${id}&page=1`);
      const hasCards = testHtml.includes("cardno=");
      if (hasCards) {
        ids.add(id);
        consecutiveEmpty = 0;
        console.log(`  Probed expansion ${id}: cards found`);
      } else {
        consecutiveEmpty++;
      }
    } catch {
      consecutiveEmpty++;
    }
    await sleep(300);
  }

  return [...ids].sort((a, b) => a - b);
}

/**
 * Get the most frequent setCode from a JP gallery page.
 * JP gallery: plain <li> items containing cardno= hrefs (no ex-item class).
 */
async function getSetCodeForExpansion(expansionId) {
  try {
    const html = await fetchUrl(`${BASE_URL}/cardlist/cardsearch/?expansion=${expansionId}&page=1`);

    const counts = {};
    for (const m of html.matchAll(/[?&]cardno=([A-Z0-9-]+)(?:%2F|\/)/gi)) {
      const sc = m[1].toUpperCase();
      counts[sc] = (counts[sc] ?? 0) + 1;
    }

    let best = null, bestN = 0;
    for (const [sc, n] of Object.entries(counts)) {
      if (n > bestN) { best = sc; bestN = n; }
    }

    // Require at least 2 occurrences to avoid noise
    return bestN >= 2 ? best : null;
  } catch {
    return null;
  }
}

/**
 * Map expansion IDs → setCode.
 * Returns Map<expansionId, setCode|null>.
 */
async function mapExpansionsToSetCodes(expansionIds) {
  const map = new Map();
  console.log(`  Memetakan ${expansionIds.length} expansion ke setCode...`);

  for (let i = 0; i < expansionIds.length; i++) {
    const id = expansionIds[i];
    const setCode = await getSetCodeForExpansion(id);
    map.set(id, setCode);
    process.stdout.write(
      `\r  [${i + 1}/${expansionIds.length}] expansion=${id} → ${setCode ?? "(empty/unknown)"}          `
    );
    await sleep(250);
  }

  console.log("");
  return map;
}

// ── Local DB helpers ──────────────────────────────────────────────────────────

function loadExistingSetCodes() {
  if (!fs.existsSync(CARDS_PATH)) {
    console.log("  ⚠️  cards_jp.json belum ada — semua expansion dianggap baru");
    return new Set();
  }
  try {
    const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));
    const codes = new Set();
    for (const c of cards) if (c.setCode) codes.add(c.setCode);
    return codes;
  } catch (err) {
    console.error("  ❌ Gagal baca cards_jp.json:", err.message);
    return new Set();
  }
}

// ── Child process helpers ─────────────────────────────────────────────────────

function runScraper(expansionId) {
  console.log(`\n  ▶ Scrape expansion=${expansionId} ...`);
  const result = spawnSync(
    "node",
    [SCRAPE_PATH, "--expansion", String(expansionId), "--delay", ARG_DELAY],
    { stdio: "inherit", encoding: "utf-8" }
  );
  return result.status === 0;
}

function runDiagnose() {
  console.log("\n  ▶ Run diagnose.js --region jp ...");
  const result = spawnSync(
    "node", [DIAGNOSE_PATH, "--region", "jp"],
    { stdio: "inherit", encoding: "utf-8" }
  );
  return result.status === 0;
}

function runGitPull() {
  console.log("  ▶ git pull ...");
  const result = spawnSync("git", ["pull", "--ff-only"], { stdio: "inherit", encoding: "utf-8" });
  if (result.status !== 0) {
    console.warn("  ⚠️  git pull gagal atau ada conflict — lanjut dengan data lokal");
  } else {
    console.log("  ✅ git pull OK");
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Vanguard Library — JP Auto Update Orchestrator");
  console.log("═══════════════════════════════════════════════════\n");

  // Step 1: git pull — ensure latest cards_jp.json
  if (!ARG_NO_PULL) {
    console.log("Step 1: git pull (sync cards_jp.json terbaru)");
    runGitPull();
  } else {
    console.log("Step 1: git pull — skip (--no-pull)");
  }

  // Step 2: Fetch JP expansion list
  console.log("\nStep 2: Fetch daftar expansion dari JP site");
  let expansionIds;
  try {
    expansionIds = await fetchExpansionList();
    console.log(`  ✅ Total ${expansionIds.length} expansion (max=${expansionIds[expansionIds.length - 1]})`);
  } catch (err) {
    console.error("  ❌ Gagal fetch expansion list:", err.message);
    process.exit(2);
  }

  // Force mode — skip detection
  if (ARG_FORCE_EXP) {
    const forced = Number(ARG_FORCE_EXP);
    console.log(`\nStep: Force-scrape expansion=${forced} (skip detection)`);
    if (ARG_DRY_RUN) {
      console.log("  [dry-run] would scrape expansion=" + forced);
      process.exit(0);
    }
    const ok = runScraper(forced);
    if (!ok) { console.error("  ❌ Scraper gagal"); process.exit(2); }
    runDiagnose();
    generateVersionJson([]);
    console.log("\n═══════════════════════════════════════════════════");
    console.log("  ✅ Force-update selesai");
    console.log("═══════════════════════════════════════════════════");
    process.exit(0);
  }

  // Step 3: Compare vs local cards_jp.json
  console.log("\nStep 3: Bandingkan dengan cards_jp.json lokal");
  const existingSets = loadExistingSetCodes();
  console.log(`  Lokal punya ${existingSets.size} setCode unik`);

  const expansionToSetCode = await mapExpansionsToSetCodes(expansionIds);

  const newExpansions = [];
  for (const [expId, setCode] of expansionToSetCode) {
    if (!setCode) continue;
    if (!existingSets.has(setCode)) {
      newExpansions.push({ expId, setCode, reason: "setCode baru" });
    }
  }

  if (newExpansions.length === 0) {
    console.log("\n  ✨ Tidak ada update. cards_jp.json sudah up-to-date.");
    if (ARG_CHECK_ONLY) process.exit(0);
    process.exit(0);
  }

  console.log(`\n  📦 ${newExpansions.length} expansion perlu di-update:`);
  for (const { expId, setCode, reason } of newExpansions) {
    console.log(`     • expansion=${expId} (${setCode}) — ${reason}`);
  }

  if (ARG_CHECK_ONLY) {
    console.log("\n  [check-only] keluar dengan exit code 1 (update tersedia)");
    process.exit(1);
  }

  if (ARG_DRY_RUN) {
    console.log("\n  [dry-run] tidak akan scrape apa-apa");
    process.exit(0);
  }

  // Step 4: Apply max limit + backup
  const expansionsToScrape = newExpansions.slice(0, ARG_MAX_EXP);
  const deferred = newExpansions.length - expansionsToScrape.length;
  if (deferred > 0) {
    console.log(`\n  ⏸️  Limit ${ARG_MAX_EXP} expansion per run. ${deferred} ditunda ke run berikutnya.`);
  }

  console.log("\nStep 4: Backup cards_jp.json sebelum scrape...");
  const hasBackup = backupCardsJson();
  console.log(hasBackup ? "  ✅ Backup dibuat" : "  ⚠️  Tidak ada backup");

  // Step 5: Scrape
  console.log("\nStep 5: Scrape expansion baru");
  let succeeded = 0, failed = 0;
  const succeededSets = [];

  for (const { expId, setCode } of expansionsToScrape) {
    const ok = runScraper(expId);
    if (ok) {
      succeeded++;
      succeededSets.push(setCode);
      console.log(`  ✅ expansion=${expId} (${setCode}) selesai`);
    } else {
      failed++;
      console.error(`  ❌ expansion=${expId} (${setCode}) gagal`);
    }
  }

  // Step 6: Validate
  console.log("\nStep 6: Validate cards_jp.json hasil scrape...");
  const validation = validateCardsJson(MIN_VALID_CARD_COUNT);
  if (!validation.valid) {
    console.error(`  ❌ cards_jp.json TIDAK VALID: ${validation.reason}`);
    console.error(`     (${validation.count} kartu — minimum ${MIN_VALID_CARD_COUNT})`);
    console.log("\n  🔄 Rollback dari backup...");
    if (restoreBackup()) {
      console.log("  ✅ cards_jp.json dikembalikan ke versi sebelum scrape");
    } else {
      console.error("  ❌ Rollback GAGAL — cards_jp.json mungkin korup!");
    }
    process.exit(2);
  }
  console.log(`  ✅ Valid (${validation.count} kartu)`);

  // Step 7: Diagnose
  console.log("\nStep 7: Verify dengan diagnose.js --region jp");
  runDiagnose();
  cleanupBackup();

  // Step 8: version.json
  console.log("\nStep 8: Update version.json (JP fields)");
  generateVersionJson(succeededSets);

  // Step 9: Summary
  console.log("\n═══════════════════════════════════════════════════");
  console.log(`  Selesai. ${succeeded} sukses, ${failed} gagal.`);
  if (failed > 0) console.log("  ⚠️  Ada expansion yang gagal — cek log di atas.");
  if (deferred > 0) console.log(`  ⏸️  ${deferred} expansion akan di-scrape di run berikutnya.`);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `new_expansions_jp=${succeeded}\n` +
      `new_set_codes_jp=${newExpansions.map((e) => e.setCode).join(",")}\n` +
      `failed_jp=${failed}\n`
    );
  }

  console.log("═══════════════════════════════════════════════════");
  process.exit(failed > 0 ? 2 : 0);
}

main().catch((err) => {
  console.error("\n💥 Fatal error:", err);
  process.exit(2);
});
