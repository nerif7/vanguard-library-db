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
const CARDS_PATH   = path.join(__dirname, "cards.json");
const VERSION_PATH = path.join(__dirname, "version.json");
const SCRAPE_PATH  = path.join(__dirname, "scrape_en.js");
const DIAGNOSE_PATH = path.join(__dirname, "diagnose.js");

const args            = process.argv.slice(2);
const ARG_FORCE_EXP   = getArg("--force-expansion");
const ARG_DRY_RUN     = args.includes("--dry-run");
const ARG_CHECK_ONLY  = args.includes("--check-only");
const ARG_DELAY       = getArg("--delay") || "500";  // 500ms default (was 350) for safety
const ARG_MAX_EXP     = Number(getArg("--max-expansions") || "5"); // Max per run untuk avoid timeout

// Minimum cards count untuk dianggap valid cards.json (anti-corrupt safeguard)
const MIN_VALID_CARD_COUNT = 20000;

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Backup cards.json to cards.json.backup before risky operations.
 * Returns true if backup created successfully.
 */
function backupCardsJson() {
  if (!fs.existsSync(CARDS_PATH)) return false;
  const backupPath = CARDS_PATH + ".backup";
  try {
    fs.copyFileSync(CARDS_PATH, backupPath);
    return true;
  } catch (err) {
    console.warn(`  ⚠️  Gagal buat backup: ${err.message}`);
    return false;
  }
}

/**
 * Validate cards.json: parse OK, is array, minimum N cards.
 * Returns { valid: boolean, count: number, reason: string }.
 */
function validateCardsJson(minCount = 1000) {
  if (!fs.existsSync(CARDS_PATH)) {
    return { valid: false, count: 0, reason: "file tidak ada" };
  }
  try {
    const text = fs.readFileSync(CARDS_PATH, "utf-8");
    const data = JSON.parse(text);
    if (!Array.isArray(data)) {
      return { valid: false, count: 0, reason: "bukan array" };
    }
    if (data.length < minCount) {
      return { valid: false, count: data.length, reason: `kurang dari ${minCount} kartu (mencurigakan)` };
    }
    // Sample check: ensure required fields exist on a few cards
    const sample = data.slice(0, 10);
    for (const card of sample) {
      if (!card.enCardNo || !card.name) {
        return { valid: false, count: data.length, reason: "ada kartu tanpa enCardNo atau name" };
      }
    }
    return { valid: true, count: data.length, reason: "OK" };
  } catch (err) {
    return { valid: false, count: 0, reason: `parse error: ${err.message}` };
  }
}

/**
 * Restore cards.json from backup. Used when scrape fails or validation fails.
 */
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

/**
 * Generate version.json — metadata file for app clients to check for updates
 * without needing to download the full 11 MB cards.json.
 * @param {string[]} newSets - setCodes scraped in this run
 */
function generateVersionJson(newSets) {
  try {
    const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));
    const version = {
      lastUpdate: new Date().toISOString(),
      cardCount:  cards.length,
      newSets,
    };
    fs.writeFileSync(VERSION_PATH, JSON.stringify(version, null, 2) + "\n");
    console.log(`  ✅ version.json diperbarui (${cards.length} kartu, sets baru: ${newSets.join(", ") || "tidak ada"})`);
  } catch (err) {
    console.warn(`  ⚠️  Gagal generate version.json: ${err.message}`);
  }
}

/**
 * Clean up backup file after successful operation.
 */
function cleanupBackup() {
  const backupPath = CARDS_PATH + ".backup";
  if (fs.existsSync(backupPath)) {
    try { fs.unlinkSync(backupPath); } catch {}
  }
}

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
 * Count cards in EN site gallery for an expansion.
 * Iterates pagination until empty page, returns total card count.
 *
 * For D-PR (expansion=0), this is the only reliable way to know if
 * new promos were added since the setCode never changes.
 */
async function countGalleryCards(expansionId) {
  let page = 1;
  // Track unique base enCardNos across all pages (skip _N suffix duplicates)
  const seenBaseEnCardNos = new Set();

  /** Extract base enCardNos from gallery page HTML, strip _N suffix. */
  const extractBaseEnCardNos = (html) => {
    const codes = [];
    for (const m of html.matchAll(/<li class="ex-item">[\s\S]*?cardno=([^"&]+)/g)) {
      const enCardNo = decodeURIComponent(m[1]);
      const base     = enCardNo.replace(/_\d+$/, ""); // strip TD copy suffix
      codes.push(base);
    }
    return codes;
  };

  while (true) {
    let url = `${BASE_URL}/cardlist/cardsearch_ex/?expansion=${expansionId}&view=image&page=${page}`;
    let html;
    try {
      html = await fetchUrl(url);
    } catch (err) {
      break;
    }

    // Get this page's unique base cardCodes
    let pageCodes = extractBaseEnCardNos(html);

    // Fallback to non-ex endpoint if first page returned 0 (D-PR sometimes needs this)
    if (pageCodes.length === 0 && page === 1) {
      try {
        url  = `${BASE_URL}/cardlist/cardsearch/?expansion=${expansionId}&view=image&page=${page}`;
        html = await fetchUrl(url);
        pageCodes = extractBaseEnCardNos(html);
        if (pageCodes.length === 0) break;
      } catch {
        break;
      }
    } else if (pageCodes.length === 0) {
      break;
    }

    // Add to set (dedup happens automatically)
    for (const code of pageCodes) seenBaseEnCardNos.add(code);

    page++;
    // Safety cap: 50 pages × ~40 cards = 2000 max (D-PR fits within this)
    if (page > 50) break;

    await new Promise((r) => setTimeout(r, 250));
  }

  return seenBaseEnCardNos.size;
}

/**
 * Count cards in local cards.json matching a setCode.
 *
 * Special case: for "D-PR" (expansion=0 = all PR promo era cards),
 * EN site bundles D-PR + V-PR + G-PR + PR (legacy) under expansion=0.
 * So we count all promo setCodes for accurate comparison.
 */
function countLocalCardsForSet(setCode) {
  if (!fs.existsSync(CARDS_PATH)) return 0;
  try {
    const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));

    // Special case: D-PR detection should compare against all promo era cards
    // (EN site lumps them all under expansion=0)
    if (setCode === "D-PR") {
      const PROMO_SETCODES = new Set(["D-PR", "V-PR", "G-PR", "PR"]);
      return cards.filter((c) => PROMO_SETCODES.has(c.setCode)).length;
    }

    return cards.filter((c) => c.setCode === setCode).length;
  } catch {
    return 0;
  }
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
 *
 * Validation strategy:
 * 1. Fetch gallery page expansion=N
 * 2. Check page is valid (has ex-item OR similar gallery markers)
 * 3. If no items → expansion is empty/invalid, skip
 * 4. Extract setCode from ALL cardno links, pick MOST FREQUENT one (not first)
 *    (avoids picking up sidebar/related card links)
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

      // Validation: check if page actually has gallery items
      // EN site uses <li class="ex-item"> for each card in gallery
      const exItemCount = (html.match(/<li class="ex-item">/g) || []).length;
      if (exItemCount === 0) {
        // No gallery items — expansion invalid/empty, mark and skip
        map.set(id, "(empty)");
        process.stdout.write(`\r  [${i + 1}/${expansionIds.length}] expansion=${id} → (empty)                  `);
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }

      // Extract ALL cardno occurrences and pick the most frequent setCode
      // This avoids grabbing the first non-card link (sidebar nav, related cards)
      const allMatches = [...html.matchAll(/cardno=([A-Z0-9-]+)(?:%2F|\/)/g)];
      const setCodeCounts = {};
      for (const m of allMatches) {
        const sc = m[1];
        setCodeCounts[sc] = (setCodeCounts[sc] || 0) + 1;
      }

      // Pick the setCode with most occurrences (will be the actual set of this gallery)
      let bestSetCode = "(unknown)";
      let bestCount = 0;
      for (const [sc, count] of Object.entries(setCodeCounts)) {
        if (count > bestCount) {
          bestSetCode = sc;
          bestCount   = count;
        }
      }

      // Sanity check: best setCode must appear at least ~50% of ex-items
      // (Otherwise it's noise/sidebar)
      if (bestCount < Math.max(2, Math.floor(exItemCount * 0.5))) {
        map.set(id, "(ambiguous)");
        process.stdout.write(`\r  [${i + 1}/${expansionIds.length}] expansion=${id} → (ambiguous: ${bestSetCode}×${bestCount}/${exItemCount} items)  `);
      } else {
        map.set(id, bestSetCode);
        process.stdout.write(`\r  [${i + 1}/${expansionIds.length}] expansion=${id} → ${bestSetCode} (${bestCount}/${exItemCount} items)            `);
      }
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
    generateVersionJson([]);
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

  // Find expansion yang perlu di-scrape:
  // - Untuk expansion biasa: setCode BELUM ada di lokal
  // - Untuk D-PR (expansion=0): JUMLAH kartu di EN > lokal (promo terus bertambah)
  const newExpansions = [];

  // Step 2a: Cek promo cards (expansion=0 = D-PR + V-PR + G-PR + PR) via count
  if (expansionToSetCode.has(0)) {
    console.log("\n  Cek Promo cards (expansion=0) via count comparison...");
    console.log("    (EN site bundle D-PR + V-PR + G-PR + PR di expansion=0)");
    const localPRCount = countLocalCardsForSet("D-PR");
    console.log(`    Lokal: ${localPRCount} kartu promo (semua era)`);

    try {
      const remotePRCount = await countGalleryCards(0);
      console.log(`    EN site: ${remotePRCount} kartu promo`);

      if (remotePRCount > localPRCount) {
        const diff = remotePRCount - localPRCount;
        console.log(`    📦 +${diff} kartu promo baru terdeteksi`);
        newExpansions.push({
          expId: 0,
          setCode: "D-PR",
          reason: `${diff} kartu baru (${localPRCount} → ${remotePRCount})`,
        });
      } else if (remotePRCount < localPRCount) {
        console.log(`    ✅ Lokal lebih banyak dari EN site (${localPRCount - remotePRCount} kartu lama yang sudah di-archive). Tidak ada update.`);
      } else {
        console.log(`    ✅ Promo cards up-to-date`);
      }
    } catch (err) {
      console.warn(`    ⚠️  Gagal hitung promo di EN site: ${err.message}. Skip detection.`);
    }
  }

  // Step 2b: Cek expansion biasa via setCode comparison
  for (const [expId, setCode] of expansionToSetCode) {
    if (expId === 0) continue; // sudah di-handle di Step 2a
    // Skip invalid/ambiguous setCodes (avoid false positives)
    if (["(unknown)", "(error)", "(empty)", "(ambiguous)"].includes(setCode)) continue;
    if (!existingSets.has(setCode)) {
      newExpansions.push({ expId, setCode, reason: "setCode baru" });
    }
  }

  if (newExpansions.length === 0) {
    console.log("\n  ✨ Tidak ada update. Database sudah up-to-date.");
    if (ARG_CHECK_ONLY) process.exit(0);
    process.exit(0);
  }

  console.log(`\n  📦 ${newExpansions.length} expansion perlu di-update:`);
  for (const { expId, setCode, reason } of newExpansions) {
    console.log(`     • expansion=${expId} (${setCode}) — ${reason}`);
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

  // Step 3a: Apply max-expansions limit (avoid GitHub Actions timeout)
  const expansionsToScrape = newExpansions.slice(0, ARG_MAX_EXP);
  const deferred = newExpansions.length - expansionsToScrape.length;
  if (deferred > 0) {
    console.log(`\n  ⏸️  Limit ${ARG_MAX_EXP} expansion per run. ${deferred} expansion ditunda ke run berikutnya.`);
  }

  // Step 3b: Backup cards.json sebelum scrape (untuk rollback)
  console.log("\nStep 3: Backup cards.json sebelum scrape...");
  const hasBackup = backupCardsJson();
  console.log(hasBackup ? "  ✅ Backup dibuat" : "  ⚠️  Tidak ada backup (cards.json belum ada)");

  // Step 4: Scrape each expansion
  console.log("\nStep 4: Scrape expansion baru");
  let succeeded = 0;
  let failed    = 0;
  const succeededSets = [];
  for (const { expId, setCode } of expansionsToScrape) {
    const ok = runScraper(expId, ARG_DELAY);
    if (ok) {
      succeeded++;
      succeededSets.push(setCode);
      console.log(`  ✅ expansion=${expId} (${setCode}) selesai`);
    } else {
      failed++;
      console.error(`  ❌ expansion=${expId} (${setCode}) gagal`);
    }
  }

  // Step 5: Validate hasil sebelum commit
  console.log("\nStep 5: Validate cards.json hasil scrape...");
  const validation = validateCardsJson(MIN_VALID_CARD_COUNT);
  if (!validation.valid) {
    console.error(`  ❌ cards.json TIDAK VALID: ${validation.reason}`);
    console.error(`     (${validation.count} kartu — minimum ${MIN_VALID_CARD_COUNT})`);
    console.log("\n  🔄 Rollback dari backup...");
    if (restoreBackup()) {
      console.log("  ✅ cards.json dikembalikan ke versi sebelum scrape");
    } else {
      console.error("  ❌ Rollback GAGAL — cards.json mungkin korup!");
    }
    process.exit(2);
  }
  console.log(`  ✅ Valid (${validation.count} kartu)`);

  // Step 6: Diagnose
  console.log("\nStep 6: Verify hasil dengan diagnose.js");
  runDiagnose();

  // Cleanup backup setelah sukses
  cleanupBackup();

  // Step 7: Generate version.json untuk app clients
  console.log("\nStep 7: Generate version.json");
  generateVersionJson(succeededSets);

  // Step 8: Summary
  console.log("\n═══════════════════════════════════════════════════");
  console.log(`  Selesai. ${succeeded} sukses, ${failed} gagal.`);
  if (failed > 0) {
    console.log("  ⚠️  Ada expansion yang gagal — cek log di atas.");
  }
  if (deferred > 0) {
    console.log(`  ⏸️  ${deferred} expansion akan di-scrape di run berikutnya.`);
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
