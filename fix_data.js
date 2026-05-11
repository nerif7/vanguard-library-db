#!/usr/bin/env node
/**
 * fix_data.js — Perbaiki data di cards.json tanpa perlu scrape ulang
 *
 * Memperbaiki:
 *   1. Bug clan duplikat: hapus entry di clan[] yang sudah ada di nations[]
 *      (kasus G era / BCS dimana div.group berisi nama nation, bukan clan)
 *   2. Bug setCode/cardNumber untuk kartu dengan variant suffix (-B/-W)
 *      (kasus EB10/001EN-B yang sebelumnya setCode-nya jadi "EB10/001EN-B"
 *      dan cardNumber-nya kosong)
 *
 * Usage:
 *   node fix_data.js              # perbaiki cards.json
 *   node fix_data.js --dry-run    # preview saja, tidak menulis file
 */

const fs = require("fs");
const path = require("path");

const CARDS_PATH = path.join(__dirname, "cards.json");

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");

// ── Load ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(CARDS_PATH)) {
  console.error("File tidak ditemukan:", CARDS_PATH);
  process.exit(1);
}

const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));
console.log(`Loaded ${cards.length} cards from cards.json`);
console.log(DRY_RUN ? "Mode: DRY RUN (preview saja)\n" : "Mode: WRITE (akan menulis file)\n");

// ── Fix 1: Remove duplicate clan entries that match nation ──────────────────

console.log("═══════════════════════════════════════════════════");
console.log("  Fix 1: Hapus clan duplikat dari nations");
console.log("═══════════════════════════════════════════════════");

let fixed1 = 0;
const samples1 = [];

for (const c of cards) {
  if (!Array.isArray(c.clan) || !Array.isArray(c.nations)) continue;
  if (c.clan.length === 0) continue;

  const before = [...c.clan];
  c.clan = c.clan.filter((g) => !c.nations.includes(g));

  if (c.clan.length !== before.length) {
    fixed1++;
    if (samples1.length < 5) {
      samples1.push({
        enCardNo: c.enCardNo,
        name:     c.name,
        nations:  c.nations,
        clanBefore: before,
        clanAfter:  c.clan,
      });
    }
  }
}

console.log(`  Total: ${fixed1} kartu diperbaiki\n`);

if (samples1.length > 0) {
  console.log("  Sample 5 kartu yang diperbaiki:");
  for (const s of samples1) {
    console.log(`    ${s.enCardNo.padEnd(22)} "${s.name}"`);
    console.log(`      nations    : ${JSON.stringify(s.nations)}`);
    console.log(`      clan before: ${JSON.stringify(s.clanBefore)}`);
    console.log(`      clan after : ${JSON.stringify(s.clanAfter)}`);
  }
}

// ── Fix 2: Re-parse setCode + cardNumber dengan parser baru ────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  Fix 2: Re-parse setCode + cardNumber (robust parser)");
console.log("═══════════════════════════════════════════════════");

/**
 * Robust parser — handles all known card code format variants:
 *   Regular, EX cards, B/W variant (EB10), Special (-S),
 *   BCS Imaginary Gift (V-GM-), Anniversary (10th), Sneak preview (-SEN),
 *   DZ Special (SER＋), TD copies (_N), G Reborn (Re:), G Special (S01),
 *   Alt rarity (PR suffix), Parallel, Hot-stamped, etc.
 */
function parseCardCode(enCardNo) {
  if (!enCardNo || typeof enCardNo !== "string") {
    return { setCode: "", cardNumber: "" };
  }

  // Step 1: Normalize trailing description/tag into dash suffix
  let normalized = enCardNo.trim();
  normalized = normalized.replace(/\s*\(Hot-stamped ver\.\)\s*$/i, "-HS");
  normalized = normalized.replace(/\s+with serial number\s*$/i, "-SN");
  normalized = normalized.replace(/\s+Neon Gyze side\s*$/i, "-NGS");
  normalized = normalized.replace(/\s+([A-Z][A-Za-z]+)\s*$/, "-$1");

  // Step 2: Split on "/"
  const parts = normalized.split("/");
  if (parts.length !== 2) return { setCode: normalized, cardNumber: "" };

  const setCode = parts[0];
  let cardId = parts[1];

  // Step 3: Strip metadata prefixes
  cardId = cardId.replace(/^\d+th/, "");
  cardId = cardId.replace(/^Re:/, "");
  cardId = cardId.replace(/^V-GM-/, "");
  cardId = cardId.replace(/＋/, "");

  // Step 4: Extract cardNumber
  const numMatch = cardId.match(/^([A-Z]*\d+)/i);
  const cardNumber = numMatch ? numMatch[1] : "";

  // Step 5: Compute normalized enCardNo (dengan suffix replace)
  const normalizedEnCardNo = normalized;

  return { setCode, cardNumber, normalizedEnCardNo };
}

let fixed2 = 0;
const samples2 = [];

for (const c of cards) {
  if (!c.enCardNo) continue;

  const { setCode: newSetCode, cardNumber: newCardNum, normalizedEnCardNo } = parseCardCode(c.enCardNo);

  // Skip jika parse gagal
  if (!newSetCode || !newCardNum) continue;

  const enCardNoNeedsNormalize = c.enCardNo !== normalizedEnCardNo;
  const setCodeWrong   = c.setCode !== newSetCode;
  const cardNumberWrong = (c.cardNumber || "") !== newCardNum;

  if (setCodeWrong || cardNumberWrong || enCardNoNeedsNormalize) {
    if (samples2.length < 8) {
      samples2.push({
        oldEnCardNo:     c.enCardNo,
        newEnCardNo:     normalizedEnCardNo,
        name:            c.name,
        oldSetCode:      c.setCode,
        newSetCode,
        oldCardNumber:   c.cardNumber,
        newCardNumber:   newCardNum,
      });
    }
    c.enCardNo   = normalizedEnCardNo;
    c.setCode    = newSetCode;
    c.cardNumber = newCardNum;
    fixed2++;
  }
}

console.log(`  Total: ${fixed2} kartu diperbaiki\n`);

if (samples2.length > 0) {
  console.log("  Sample 8 kartu yang diperbaiki:");
  for (const s of samples2) {
    console.log(`    "${s.name}"`);
    if (s.oldEnCardNo !== s.newEnCardNo) {
      console.log(`      enCardNo    : "${s.oldEnCardNo}" → "${s.newEnCardNo}"`);
    } else {
      console.log(`      enCardNo    : "${s.oldEnCardNo}"`);
    }
    console.log(`      setCode     : "${s.oldSetCode}" → "${s.newSetCode}"`);
    console.log(`      cardNumber  : "${s.oldCardNumber || ""}" → "${s.newCardNumber}"`);
  }
}

// ── Fix 3: Remove _N suffix duplicates (TD copies bug) ──────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  Fix 3: Hapus duplikat dengan suffix _N (TD copies bug)");
console.log("═══════════════════════════════════════════════════");

// Group by base enCardNo (strip _N suffix). If multiple records exist for same base,
// keep one (prefer the one without _N if exists, else the first one with smallest N).
const byBase = new Map();
for (let i = 0; i < cards.length; i++) {
  const c = cards[i];
  if (!c.enCardNo) continue;
  const base = c.enCardNo.replace(/_\d+$/, "");
  if (!byBase.has(base)) byBase.set(base, []);
  byBase.get(base).push({ index: i, enCardNo: c.enCardNo });
}

// Find which records to remove
const toRemove = new Set();
const samples3 = [];

for (const [base, records] of byBase) {
  if (records.length <= 1) continue;  // No duplicate

  // Prefer record without _N suffix (= base itself)
  // Otherwise prefer record with smallest _N
  records.sort((a, b) => {
    const aHasSuffix = /_\d+$/.test(a.enCardNo);
    const bHasSuffix = /_\d+$/.test(b.enCardNo);
    if (aHasSuffix !== bHasSuffix) return aHasSuffix ? 1 : -1;  // No suffix wins
    // Both have suffix: smaller N wins
    const aN = Number((a.enCardNo.match(/_(\d+)$/) ?? [0, 0])[1]);
    const bN = Number((b.enCardNo.match(/_(\d+)$/) ?? [0, 0])[1]);
    return aN - bN;
  });

  // Keep first (records[0]), mark rest for removal
  for (let i = 1; i < records.length; i++) {
    toRemove.add(records[i].index);
    if (samples3.length < 5) {
      const removed = cards[records[i].index];
      const kept    = cards[records[0].index];
      samples3.push({
        base,
        keptEnCardNo:    kept.enCardNo,
        removedEnCardNo: removed.enCardNo,
        name:            removed.name,
      });
    }
  }
}

const fixed3 = toRemove.size;
console.log(`  Total: ${fixed3} kartu duplikat dihapus\n`);

if (samples3.length > 0) {
  console.log("  Sample 5 kartu yang dihapus:");
  for (const s of samples3) {
    console.log(`    "${s.name}"`);
    console.log(`      kept    : ${s.keptEnCardNo}`);
    console.log(`      removed : ${s.removedEnCardNo}`);
  }
}

// Apply removal (filter out indices in toRemove)
if (fixed3 > 0) {
  for (let i = cards.length - 1; i >= 0; i--) {
    if (toRemove.has(i)) cards.splice(i, 1);
  }
  console.log(`\n  cards.json sekarang: ${cards.length} kartu`);
}

// ── Write ───────────────────────────────────────────────────────────────────

const totalFixed = fixed1 + fixed2 + fixed3;

if (DRY_RUN) {
  console.log("\n[DRY RUN] Tidak ada file yang ditulis.");
  process.exit(0);
}

if (totalFixed === 0) {
  console.log("\n  ✅ Tidak ada perubahan diperlukan. File tidak ditulis.");
  process.exit(0);
}

// Backup file lama dulu, just in case
const backupPath = CARDS_PATH + ".backup-" + Date.now();
fs.copyFileSync(CARDS_PATH, backupPath);
console.log(`\n  Backup dibuat: ${path.basename(backupPath)}`);

// Write cards.json
fs.writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2));
console.log(`  ✅ ${CARDS_PATH} ditulis ulang`);

console.log("\n═══════════════════════════════════════════════════");
console.log(`  Selesai. ${totalFixed} perubahan (${fixed1} clan, ${fixed2} setCode, ${fixed3} duplikat).`);
console.log("═══════════════════════════════════════════════════");
