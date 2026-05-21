#!/usr/bin/env node
/**
 * diagnose.js — Cek kualitas output cards.json / cards_jp.json
 *
 * Usage:
 *   node diagnose.js                          # diagnose EN (cards.json)
 *   node diagnose.js --region jp              # diagnose JP (cards_jp.json)
 *   node diagnose.js --set DZ-BT12            # filter satu set
 *   node diagnose.js --set DZ-BT12,D-BT08    # filter beberapa set (comma-separated)
 *   node diagnose.js --set DZ-BT              # prefix matching: semua DZ-BT01..DZ-BTxx
 *   node diagnose.js --list                   # list semua setCode yang ada di DB
 *   node diagnose.js --region jp --list       # list JP sets
 *
 * Filter --set memakai prefix matching:
 *   --set DZ-BT  → match DZ-BT01, DZ-BT02, ..., DZ-BT12
 *   --set D-PR   → match semua kartu D-PR/...
 *   --set DZ-BT12 → match exact DZ-BT12 saja
 */

const fs = require("fs");
const path = require("path");

// ── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const ARG_LIST   = args.includes("--list");
const ARG_SET    = getArg("--set");
const ARG_REGION = (getArg("--region") ?? "en").toLowerCase();

if (ARG_REGION !== "en" && ARG_REGION !== "jp") {
  console.error("--region harus 'en' atau 'jp'");
  process.exit(1);
}

// ── Region config ─────────────────────────────────────────────────────────────

const REGION_CONFIG = {
  en: {
    label:          "EN",
    cardsFile:      "cards.json",
    primaryKey:     "enCardNo",
    nameField:      "name",
    imageField:     "imageUrlEn",
    unitTypeNormal: "Normal Unit",
    unitTypeG:      "G Unit",
    sampleTypes:    ["G Unit", "Normal Order", "Set Order", "Blitz Order", "Token", null],
  },
  jp: {
    label:          "JP",
    cardsFile:      "cards_jp.json",
    primaryKey:     "jpCardNo",
    nameField:      "nameJp",
    imageField:     "imageUrlJp",
    unitTypeNormal: "ノーマルユニット",
    unitTypeG:      "Gユニット",
    sampleTypes:    ["Gユニット", "ノーマルオーダー", "セットオーダー", "ブレイズオーダー", "トークン", null],
  },
};

const cfg = REGION_CONFIG[ARG_REGION];
const CARDS_PATH = path.join(__dirname, cfg.cardsFile);

// ── Load data ────────────────────────────────────────────────────────────────

if (!fs.existsSync(CARDS_PATH)) {
  console.error(`File tidak ditemukan: ${CARDS_PATH}`);
  console.error(ARG_REGION === "jp" ? "Jalankan 'node scrape_jp.js' untuk membuat cards_jp.json" : "");
  process.exit(1);
}
const allCards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));

// ── --list mode: tampilkan semua setCode yang ada ───────────────────────────

if (ARG_LIST) {
  const bySet = {};
  for (const c of allCards) {
    const set = c.setCode ?? "(no setCode)";
    bySet[set] = (bySet[set] ?? 0) + 1;
  }
  const sorted = Object.entries(bySet).sort((a, b) => a[0].localeCompare(b[0]));

  console.log("═══════════════════════════════════════════════════");
  console.log(`  Sets in ${cfg.cardsFile} (${sorted.length} unique sets)`);
  console.log("═══════════════════════════════════════════════════");
  for (const [setCode, count] of sorted) {
    console.log(`  ${setCode.padEnd(15)} ${String(count).padStart(4)} kartu`);
  }
  console.log(`\nTotal: ${allCards.length} kartu`);
  process.exit(0);
}

// ── Filter cards by --set if provided ────────────────────────────────────────

let en;
let filterLabel;

if (ARG_SET) {
  const setPrefixes = ARG_SET.split(",").map((s) => s.trim().toUpperCase());
  en = allCards.filter((c) => {
    const setCode = (c.setCode ?? "").toUpperCase();
    return setPrefixes.some((p) => setCode.startsWith(p));
  });
  filterLabel = `setCode matching: ${setPrefixes.join(", ")}`;

  if (en.length === 0) {
    console.error(`Tidak ada kartu yang match dengan --set ${ARG_SET}`);
    console.error(`Jalankan 'node diagnose.js --list' untuk lihat sets yang tersedia`);
    process.exit(1);
  }
} else {
  en = allCards;
  filterLabel = "all cards";
}

console.log("═══════════════════════════════════════════════════");
console.log(`  Diagnose ${cfg.label}: ${filterLabel}`);
console.log(`  ${en.length} kartu dari total ${allCards.length}`);
console.log("═══════════════════════════════════════════════════\n");

// ── 1. Field coverage ────────────────────────────────────────────────────────

console.log("═══════════════════════════════════════════════════");
console.log("  1. Field coverage");
console.log("═══════════════════════════════════════════════════");

const fields = ["unitType", "nations", "clan", "races", "grade", "trigger", cfg.imageField];
for (const f of fields) {
  const filled = en.filter((c) => {
    const v = c[f];
    return v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0);
  }).length;
  const pct = (filled / en.length * 100).toFixed(1);
  const bar = "█".repeat(Math.round(filled / en.length * 20)).padEnd(20, "░");
  console.log(`  ${f.padEnd(12)} ${bar} ${pct.padStart(5)}%  (${filled}/${en.length})`);
}

// ── 2. Kartu dengan field kosong (incomplete) ────────────────────────────────
// Hanya count Normal Unit / G Unit yang nations-nya kosong sebagai "incomplete".
// Order/Token/Others memang sering nationless secara valid.

console.log("\n═══════════════════════════════════════════════════");
console.log("  2. Kartu dengan field kosong (kemungkinan fetch gagal)");
console.log("═══════════════════════════════════════════════════");

const isUnitCard = (c) => c.unitType === cfg.unitTypeNormal || c.unitType === cfg.unitTypeG;
const incomplete = en.filter((c) => {
  // Card definitely needs investigation if unitType is null
  if (!c.unitType) return true;
  // For unit cards (Normal/G), missing nations = likely fetch failure
  if (isUnitCard(c) && (c.nations ?? []).length === 0) return true;
  return false;
});
console.log(`  Total: ${incomplete.length} kartu`);
console.log(`  (Order/Token/Others dengan nations kosong tidak dihitung — mereka memang nationless valid)\n`);

const byPrefix = {};
for (const c of incomplete) {
  const rawNum = (c[cfg.primaryKey] ?? "").split("/")[1] ?? "";
  const prefix = rawNum.replace(/\d+[A-Z\s]*$/, "") || "NUM";
  byPrefix[prefix] = (byPrefix[prefix] || 0) + 1;
}
console.log("  Breakdown by card number prefix:");
for (const [pfx, count] of Object.entries(byPrefix).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${(pfx || "reguler").padEnd(10)} ${count} kartu`);
}

console.log("\n  Sample 10:");
for (const c of incomplete.slice(0, 10)) {
  console.log(`    ${(c[cfg.primaryKey] ?? "").padEnd(22)} "${c[cfg.nameField] ?? ""}"`);
}

// ── 3. unitType distribution ─────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  3. unitType distribution");
console.log("═══════════════════════════════════════════════════");

const unitTypes = {};
for (const c of en) {
  const ut = c.unitType ?? "(null)";
  unitTypes[ut] = (unitTypes[ut] ?? 0) + 1;
}
for (const [ut, count] of Object.entries(unitTypes).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${ut.padEnd(16)} ${count}`);
}

// ── 4. Nations distribution ──────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  4. Nations distribution");
console.log("═══════════════════════════════════════════════════");

const nations = {};
for (const c of en) {
  for (const n of c.nations ?? []) {
    nations[n] = (nations[n] ?? 0) + 1;
  }
}
if (Object.keys(nations).length === 0) {
  console.log("  ⚠️  Tidak ada nations terisi!");
} else {
  for (const [n, count] of Object.entries(nations).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${n.padEnd(20)} ${count}`);
  }
}

// ── 5. Trigger distribution ──────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  5. Trigger distribution");
console.log("═══════════════════════════════════════════════════");

const triggers = {};
for (const c of en) {
  const t = c.trigger ?? "(null)";
  triggers[t] = (triggers[t] ?? 0) + 1;
}
for (const [t, count] of Object.entries(triggers).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${t.padEnd(12)} ${count}`);
}

// ── 6. Top races ─────────────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  6. Top races (race types)");
console.log("═══════════════════════════════════════════════════");

const races = {};
for (const c of en) {
  for (const r of c.races ?? []) {
    races[r] = (races[r] ?? 0) + 1;
  }
}
const sortedRaces = Object.entries(races).sort((a, b) => b[1] - a[1]);
if (sortedRaces.length === 0) {
  console.log("  (no races detected)");
} else {
  for (const [r, count] of sortedRaces.slice(0, 12)) {
    console.log(`  ${r.padEnd(20)} ${count}`);
  }
  if (sortedRaces.length > 12) {
    console.log(`  ... dan ${sortedRaces.length - 12} race lainnya`);
  }
}

// ── 7. Sample per unitType ───────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  7. Sample per unitType");
console.log("═══════════════════════════════════════════════════");

for (const ut of cfg.sampleTypes) {
  const sample = en.find((c) => c.unitType === ut);
  if (!sample) { console.log(`\n  [${ut ?? "null"}] — tidak ada`); continue; }
  console.log(`\n  [${ut ?? "null unitType"}]`);
  console.log(`    ${cfg.primaryKey.padEnd(12)}: ${sample[cfg.primaryKey]}`);
  console.log(`    ${cfg.nameField.padEnd(12)}: ${sample[cfg.nameField]}`);
  console.log(`    nations     : ${JSON.stringify(sample.nations)}`);
  console.log(`    clan        : ${JSON.stringify(sample.clan)}`);
  console.log(`    races       : ${JSON.stringify(sample.races)}`);
  console.log(`    grade       : ${sample.grade}`);
  console.log(`    trigger     : ${sample.trigger}`);
  console.log(`    ${cfg.imageField.padEnd(12)}: ${sample[cfg.imageField] ? "✓ ada" : "✗ null"}`);
}

// ── 8. Dual-nation cards ─────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  8. Dual-nation cards");
console.log("═══════════════════════════════════════════════════");

const dualNation = en.filter((c) => (c.nations ?? []).length > 1);
if (dualNation.length === 0) {
  console.log("  Tidak ada di filter ini (normal untuk set modern)");
} else {
  console.log(`  ${dualNation.length} kartu dual-nation:`);
  for (const c of dualNation.slice(0, 8)) {
    console.log(`    ${(c[cfg.primaryKey] ?? "").padEnd(22)} ${JSON.stringify(c.nations)}`);
  }
  if (dualNation.length > 8) console.log(`    ... dan ${dualNation.length - 8} lagi`);
}

// ── 9. Ringkasan masalah ─────────────────────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  9. Ringkasan masalah yang terdeteksi");
console.log("═══════════════════════════════════════════════════");

const issues = [];

const nullUnitType = en.filter((c) => !c.unitType).length;
if (nullUnitType > 0) issues.push(`⚠️  ${nullUnitType} kartu tanpa unitType`);

// Only count unit cards (Normal Unit / G Unit) without nations as problematic
const incompleteUnits = en.filter((c) => isUnitCard(c) && (c.nations ?? []).length === 0).length;
if (incompleteUnits > 0) issues.push(`⚠️  ${incompleteUnits} unit cards tanpa nations (kemungkinan fetch gagal)`);

const nullImage = en.filter((c) => !c[cfg.imageField]).length;
if (nullImage > 0) issues.push(`⚠️  ${nullImage} kartu tanpa ${cfg.imageField}`);

const nullGrade = en.filter((c) => c.grade === null).length;
if (nullGrade > 0) issues.push(`ℹ️  ${nullGrade} kartu tanpa grade (normal untuk Order/Token)`);

if (issues.length === 0) {
  console.log("  ✅ Tidak ada masalah yang terdeteksi");
} else {
  for (const i of issues) console.log("  " + i);
}

console.log("\n═══════════════════════════════════════════════════\n");
