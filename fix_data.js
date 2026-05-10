#!/usr/bin/env node
/**
 * fix_data.js — Perbaiki data di cards.json tanpa perlu scrape ulang
 *
 * Memperbaiki:
 *   1. Bug clan duplikat: hapus entry di clan[] yang sudah ada di nations[]
 *      (kasus G era / BCS dimana div.group berisi nama nation, bukan clan)
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

// ── Write ───────────────────────────────────────────────────────────────────

if (DRY_RUN) {
  console.log("\n[DRY RUN] Tidak ada file yang ditulis.");
  process.exit(0);
}

if (fixed1 === 0) {
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
console.log(`  Selesai. ${fixed1} kartu diperbaiki dalam beberapa detik.`);
console.log("═══════════════════════════════════════════════════");
