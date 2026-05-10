#!/usr/bin/env node
/**
 * reset_cards.js — Reset field klasifikasi kartu tertentu sehingga
 *                  --retry-failed akan re-fetch mereka.
 *
 * Yang di-reset: unitType, nations, clan, races, grade, trigger, rarity
 * Yang DIPERTAHANKAN: enCardNo, setCode, cardNumber, name, imageUrlEn
 *
 * Setelah reset, jalankan:
 *   node scrape_en.js --retry-failed --delay 800
 *
 * Usage:
 *   node reset_cards.js --card DZ-BT12/EX01EN              # reset 1 kartu
 *   node reset_cards.js --card DZ-BT12/EX01EN,BT03/001EN   # reset beberapa kartu
 *   node reset_cards.js --set BCS2019                      # reset semua kartu di set
 *   node reset_cards.js --set BCS                          # prefix: semua BCS2019, BCS2022, ...
 *   node reset_cards.js --null-unit-type                   # reset semua kartu null unitType
 *   node reset_cards.js --suspect                          # reset Normal/G Unit yang nations kosong
 *                                                          #  (kemungkinan fetch sebelumnya gagal)
 *   node reset_cards.js --suspect --dry-run                # preview saja, tidak menulis
 */

const fs = require("fs");
const path = require("path");

const CARDS_PATH = path.join(__dirname, "cards.json");
const MIN_PATH   = path.join(__dirname, "cards_min.json");

// ── Argument parsing ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const ARG_CARD          = getArg("--card");
const ARG_SET           = getArg("--set");
const ARG_NULL_TYPE     = args.includes("--null-unit-type");
const ARG_SUSPECT       = args.includes("--suspect");
const DRY_RUN           = args.includes("--dry-run");

if (!ARG_CARD && !ARG_SET && !ARG_NULL_TYPE && !ARG_SUSPECT) {
  console.error("Error: pilih satu mode reset.");
  console.error("");
  console.error("Usage:");
  console.error("  node reset_cards.js --card DZ-BT12/EX01EN");
  console.error("  node reset_cards.js --card DZ-BT12/EX01EN,BT03/001EN");
  console.error("  node reset_cards.js --set BCS2019");
  console.error("  node reset_cards.js --null-unit-type");
  console.error("  node reset_cards.js --suspect");
  console.error("");
  console.error("Tambah --dry-run untuk preview tanpa menulis file.");
  process.exit(1);
}

// ── Load ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(CARDS_PATH)) {
  console.error("File tidak ditemukan:", CARDS_PATH);
  process.exit(1);
}

const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));
console.log(`Loaded ${cards.length} cards from cards.json`);
console.log(DRY_RUN ? "Mode: DRY RUN (preview saja)\n" : "Mode: WRITE (akan menulis file)\n");

// ── Build target list ────────────────────────────────────────────────────────

let targets = [];
let modeLabel = "";

if (ARG_CARD) {
  const codes = ARG_CARD.split(",").map((s) => s.trim().toUpperCase());
  targets = cards.filter((c) => codes.includes((c.enCardNo ?? "").toUpperCase()));
  modeLabel = `--card: ${codes.join(", ")}`;
} else if (ARG_SET) {
  const prefixes = ARG_SET.split(",").map((s) => s.trim().toUpperCase());
  targets = cards.filter((c) => {
    const setCode = (c.setCode ?? "").toUpperCase();
    return prefixes.some((p) => setCode.startsWith(p));
  });
  modeLabel = `--set: ${prefixes.join(", ")}`;
} else if (ARG_NULL_TYPE) {
  targets = cards.filter((c) => !c.unitType);
  modeLabel = "--null-unit-type (semua kartu dengan unitType null)";
} else if (ARG_SUSPECT) {
  // Suspect = Normal Unit / G Unit yang nations[] kosong
  // (kemungkinan fetch gagal atau parser bug pada fetch sebelumnya)
  targets = cards.filter((c) => {
    const isUnit = c.unitType === "Normal Unit" || c.unitType === "G Unit";
    return isUnit && (c.nations ?? []).length === 0;
  });
  modeLabel = "--suspect (Normal Unit / G Unit dengan nations kosong)";
}

console.log(`Target mode: ${modeLabel}`);
console.log(`Total target: ${targets.length} kartu\n`);

if (targets.length === 0) {
  console.log("Tidak ada kartu yang match. Tidak ada perubahan.");
  process.exit(0);
}

// Show samples
console.log("Sample 10 target:");
for (const c of targets.slice(0, 10)) {
  const before = `[${c.unitType ?? "null"}] nations:${JSON.stringify(c.nations ?? [])}`;
  console.log(`  ${c.enCardNo.padEnd(22)} "${(c.name ?? "").slice(0, 40)}"`);
  console.log(`    before: ${before}`);
}
if (targets.length > 10) console.log(`  ... dan ${targets.length - 10} kartu lagi`);

// ── Confirm before destructive action ───────────────────────────────────────

if (!DRY_RUN) {
  console.log(`\n⚠️  AKAN MERESET ${targets.length} KARTU.`);
  console.log("    Field yang di-reset: unitType, nations, clan, races, grade, trigger, rarity");
  console.log("    Field yang DIPERTAHANKAN: enCardNo, setCode, cardNumber, name, imageUrlEn");
  console.log("");

  // Simple safety: untuk target > 100 kartu, perlu --confirm tambahan
  if (targets.length > 100 && !args.includes("--confirm")) {
    console.error(`❌ Target ${targets.length} kartu (> 100). Tambahkan --confirm untuk lanjut.`);
    console.error(`   node reset_cards.js ... --confirm`);
    process.exit(1);
  }
}

// ── Reset ────────────────────────────────────────────────────────────────────

const targetSet = new Set(targets.map((c) => c.enCardNo));

for (const c of cards) {
  if (!targetSet.has(c.enCardNo)) continue;

  c.unitType = null;
  c.nations  = [];
  c.clan     = [];
  c.races    = [];
  c.grade    = null;
  c.trigger  = null;
  c.rarity   = null;
  // imageUrlEn, name, enCardNo, setCode, cardNumber tetap
}

// ── Write ────────────────────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log("\n[DRY RUN] Tidak ada file yang ditulis.");
  console.log("Jalankan tanpa --dry-run untuk benar-benar reset.");
  process.exit(0);
}

// Backup
const backupPath = CARDS_PATH + ".backup-" + Date.now();
fs.copyFileSync(CARDS_PATH, backupPath);
console.log(`\n  Backup dibuat: ${path.basename(backupPath)}`);

// Write cards.json
fs.writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2));
console.log(`  ✅ ${CARDS_PATH} ditulis ulang`);

// Regenerate cards_min.json
const minCards = cards.map((c) => {
  const m = {
    enCardNo:   c.enCardNo,
    setCode:    c.setCode,
    name:       c.name,
    unitType:   c.unitType,
    nations:    c.nations,
    clan:       c.clan,
    races:      c.races,
    grade:      c.grade,
    imageUrlEn: c.imageUrlEn,
  };
  if (c.trigger) m.trigger = c.trigger;
  return m;
});

fs.writeFileSync(MIN_PATH, JSON.stringify(minCards, null, 2));
console.log(`  ✅ ${MIN_PATH} di-regenerate`);

console.log("\n═══════════════════════════════════════════════════");
console.log(`  ${targets.length} kartu di-reset.`);
console.log("");
console.log("  Langkah berikutnya:");
console.log("    node scrape_en.js --retry-failed --delay 800");
console.log("    node diagnose.js");
console.log("═══════════════════════════════════════════════════");
