#!/usr/bin/env node
/**
 * fix_data.js — Perbaiki data di cards.json / cards_jp.json tanpa perlu scrape ulang
 *
 * Memperbaiki:
 *   1. Bug clan duplikat: hapus entry di clan[] yang sudah ada di nations[]
 *      (kasus G era / BCS dimana div.group berisi nama nation, bukan clan)
 *   2. Bug setCode/cardNumber untuk kartu dengan variant suffix
 *   3. Hapus duplikat _N suffix (TD copies bug)
 *
 * Usage:
 *   node fix_data.js                        # perbaiki cards.json (EN)
 *   node fix_data.js --region jp            # perbaiki cards_jp.json (JP)
 *   node fix_data.js --dry-run              # preview saja, tidak menulis file
 *   node fix_data.js --region jp --dry-run  # preview JP
 */

const fs   = require("fs");
const path = require("path");

// ── Argument parsing ─────────────────────────────────────────────────────────

const args     = process.argv.slice(2);
const DRY_RUN  = args.includes("--dry-run");

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const ARG_REGION = (getArg("--region") ?? "en").toLowerCase();

if (ARG_REGION !== "en" && ARG_REGION !== "jp") {
  console.error("--region harus 'en' atau 'jp'");
  process.exit(1);
}

// ── Region config ─────────────────────────────────────────────────────────────

const REGION_CONFIG = {
  en: {
    label:      "EN",
    cardsFile:  "cards.json",
    primaryKey: "enCardNo",
    nameField:  "name",
  },
  jp: {
    label:      "JP",
    cardsFile:  "cards_jp.json",
    primaryKey: "jpCardNo",
    nameField:  "nameJp",
  },
};

const cfg        = REGION_CONFIG[ARG_REGION];
const CARDS_PATH = path.join(__dirname, '..', cfg.cardsFile);

// ── Load ─────────────────────────────────────────────────────────────────────

if (!fs.existsSync(CARDS_PATH)) {
  console.error("File tidak ditemukan:", CARDS_PATH);
  process.exit(1);
}

const cards = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));
console.log(`Loaded ${cards.length} cards from ${cfg.cardsFile} [${cfg.label}]`);
console.log(DRY_RUN ? "Mode: DRY RUN (preview saja)\n" : "Mode: WRITE (akan menulis file)\n");

// ── Card code parsers ────────────────────────────────────────────────────────

/**
 * EN: parse enCardNo → { setCode, cardNumber, normalizedPrimaryKey }
 * Handles all known EN format variants.
 */
function parseCardCodeEn(enCardNo) {
  if (!enCardNo || typeof enCardNo !== "string") {
    return { setCode: "", cardNumber: "", normalizedPrimaryKey: enCardNo };
  }

  let normalized = enCardNo.trim();
  normalized = normalized.replace(/\s*\(Hot-stamped ver\.\)\s*$/i, "-HS");
  normalized = normalized.replace(/\s+with serial number\s*$/i, "-SN");
  normalized = normalized.replace(/\s+Neon Gyze side\s*$/i, "-NGS");
  normalized = normalized.replace(/\s+([A-Z][A-Za-z]+)\s*$/, "-$1");

  const parts = normalized.split("/");
  if (parts.length !== 2) return { setCode: normalized, cardNumber: "", normalizedPrimaryKey: normalized };

  const setCode = parts[0];
  let cardId = parts[1];

  cardId = cardId.replace(/^\d+th/, "");
  cardId = cardId.replace(/^Re:/, "");
  cardId = cardId.replace(/^V-GM-/, "");
  cardId = cardId.replace(/＋/, "");

  const numMatch = cardId.match(/^([A-Z]*\d+)/i);
  const cardNumber = numMatch ? numMatch[1] : "";

  return { setCode, cardNumber, normalizedPrimaryKey: normalized };
}

/**
 * JP: parse jpCardNo → { setCode, cardNumber, normalizedPrimaryKey }
 * Handles JP format variants including " PR" suffix and "_N" copy index.
 */
function parseCardCodeJp(jpCardNo) {
  if (!jpCardNo || typeof jpCardNo !== "string") {
    return { setCode: "", cardNumber: "", normalizedPrimaryKey: jpCardNo };
  }

  const normalized = jpCardNo.trim();
  const parts = normalized.split("/");
  if (parts.length < 2) return { setCode: normalized, cardNumber: "", normalizedPrimaryKey: normalized };

  const setCode = parts[0];
  let cardId = parts.slice(1).join("/");

  cardId = cardId.replace(/\s+PR$/i, "").replace(/_\d+$/, "");

  const numMatch = cardId.match(/^([A-Z]*\d+)/i);
  const cardNumber = numMatch ? numMatch[1] : "";

  return { setCode, cardNumber, normalizedPrimaryKey: normalized };
}

const parseCardCode = ARG_REGION === "jp" ? parseCardCodeJp : parseCardCodeEn;

// ── Fix 1: Remove duplicate clan entries that match nation ───────────────────

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
        id:         c[cfg.primaryKey],
        name:       c[cfg.nameField],
        nations:    c.nations,
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
    console.log(`    ${(s.id ?? "").padEnd(22)} "${s.name}"`);
    console.log(`      nations    : ${JSON.stringify(s.nations)}`);
    console.log(`      clan before: ${JSON.stringify(s.clanBefore)}`);
    console.log(`      clan after : ${JSON.stringify(s.clanAfter)}`);
  }
}

// ── Fix 2: Re-parse setCode + cardNumber ────────────────────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  Fix 2: Re-parse setCode + cardNumber (robust parser)");
console.log("═══════════════════════════════════════════════════");

let fixed2 = 0;
const samples2 = [];

for (const c of cards) {
  const primaryVal = c[cfg.primaryKey];
  if (!primaryVal) continue;

  const { setCode: newSetCode, cardNumber: newCardNum, normalizedPrimaryKey } = parseCardCode(primaryVal);

  if (!newSetCode || !newCardNum) continue;

  const primaryNeedsNormalize = primaryVal !== normalizedPrimaryKey;
  const setCodeWrong          = c.setCode !== newSetCode;
  const cardNumberWrong       = (c.cardNumber || "") !== newCardNum;

  if (setCodeWrong || cardNumberWrong || primaryNeedsNormalize) {
    if (samples2.length < 8) {
      samples2.push({
        oldId:         primaryVal,
        newId:         normalizedPrimaryKey,
        name:          c[cfg.nameField],
        oldSetCode:    c.setCode,
        newSetCode,
        oldCardNumber: c.cardNumber,
        newCardNumber: newCardNum,
      });
    }
    c[cfg.primaryKey] = normalizedPrimaryKey;
    c.setCode         = newSetCode;
    c.cardNumber      = newCardNum;
    fixed2++;
  }
}

console.log(`  Total: ${fixed2} kartu diperbaiki\n`);

if (samples2.length > 0) {
  console.log("  Sample 8 kartu yang diperbaiki:");
  for (const s of samples2) {
    console.log(`    "${s.name}"`);
    if (s.oldId !== s.newId) {
      console.log(`      ${cfg.primaryKey.padEnd(12)}: "${s.oldId}" → "${s.newId}"`);
    } else {
      console.log(`      ${cfg.primaryKey.padEnd(12)}: "${s.oldId}"`);
    }
    console.log(`      setCode     : "${s.oldSetCode}" → "${s.newSetCode}"`);
    console.log(`      cardNumber  : "${s.oldCardNumber || ""}" → "${s.newCardNumber}"`);
  }
}

// ── Fix 3: Remove _N suffix duplicates (TD copies bug) ──────────────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  Fix 3: Hapus duplikat dengan suffix _N (TD copies bug)");
console.log("═══════════════════════════════════════════════════");

const byBase = new Map();
for (let i = 0; i < cards.length; i++) {
  const c = cards[i];
  const pk = c[cfg.primaryKey];
  if (!pk) continue;
  const base = pk.replace(/_\d+$/, "");
  if (!byBase.has(base)) byBase.set(base, []);
  byBase.get(base).push({ index: i, pk });
}

const toRemove = new Set();
const samples3 = [];

for (const [base, records] of byBase) {
  if (records.length <= 1) continue;

  records.sort((a, b) => {
    const aHasSuffix = /_\d+$/.test(a.pk);
    const bHasSuffix = /_\d+$/.test(b.pk);
    if (aHasSuffix !== bHasSuffix) return aHasSuffix ? 1 : -1;
    const aN = Number((a.pk.match(/_(\d+)$/) ?? [0, 0])[1]);
    const bN = Number((b.pk.match(/_(\d+)$/) ?? [0, 0])[1]);
    return aN - bN;
  });

  for (let i = 1; i < records.length; i++) {
    toRemove.add(records[i].index);
    if (samples3.length < 5) {
      const removed = cards[records[i].index];
      const kept    = cards[records[0].index];
      samples3.push({
        base,
        keptId:    kept[cfg.primaryKey],
        removedId: removed[cfg.primaryKey],
        name:      removed[cfg.nameField],
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
    console.log(`      kept    : ${s.keptId}`);
    console.log(`      removed : ${s.removedId}`);
  }
}

if (fixed3 > 0) {
  for (let i = cards.length - 1; i >= 0; i--) {
    if (toRemove.has(i)) cards.splice(i, 1);
  }
  console.log(`\n  ${cfg.cardsFile} sekarang: ${cards.length} kartu`);
}

// ── Fix 3b: Rename single _N suffix cards that have no base in DB ────────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  Fix 3b: Rename _N suffix cards tanpa base (strip copy index)");
console.log("═══════════════════════════════════════════════════");

const pkSet3b = new Set(cards.map(c => c[cfg.primaryKey]));
let fixed3b = 0;
const samples3b = [];

for (const card of cards) {
  const pk = card[cfg.primaryKey];
  if (!pk || !/_\d+$/.test(pk)) continue;
  const base = pk.replace(/_\d+$/, "");
  if (pkSet3b.has(base)) continue;
  if (samples3b.length < 5) samples3b.push({ oldId: pk, newId: base, name: card[cfg.nameField] });
  card[cfg.primaryKey] = base;
  const parsed = parseCardCode(base);
  if (parsed.cardNumber) card.cardNumber = parsed.cardNumber;
  fixed3b++;
}

console.log(`  Total: ${fixed3b} kartu di-rename (suffix dihapus)\n`);
if (samples3b.length > 0) {
  console.log("  Sample kartu yang di-rename:");
  for (const s of samples3b) {
    console.log(`    "${s.name}"`);
    console.log(`      old: ${s.oldId}`);
    console.log(`      new: ${s.newId}`);
  }
}

// ── Fix 4: Normalize Unicode dash entries in nations[] → nations: [] ─────────

console.log("\n═══════════════════════════════════════════════════");
console.log("  Fix 4: Hapus dash Unicode dari nations[] (nationless cards)");
console.log("═══════════════════════════════════════════════════");

// Matches: ASCII hyphen, U+2010 hyphen, en dash, em dash, minus sign
const DASH_RE = /^[\-‐–—−]+$/;

let fixed4 = 0;
const samples4 = [];

for (const c of cards) {
  if (!Array.isArray(c.nations) || c.nations.length === 0) continue;

  const before = [...c.nations];
  c.nations = c.nations.filter((n) => !DASH_RE.test(n));

  if (c.nations.length !== before.length) {
    fixed4++;
    if (samples4.length < 5) {
      samples4.push({
        id:      c[cfg.primaryKey],
        name:    c[cfg.nameField],
        before,
        after:   c.nations,
      });
    }
  }
}

console.log(`  Total: ${fixed4} kartu diperbaiki\n`);

if (samples4.length > 0) {
  console.log("  Sample 5 kartu yang diperbaiki:");
  for (const s of samples4) {
    console.log(`    ${(s.id ?? "").padEnd(22)} "${s.name}"`);
    console.log(`      nations before: ${JSON.stringify(s.before)}`);
    console.log(`      nations after : ${JSON.stringify(s.after)}`);
  }
}

// ── Write ────────────────────────────────────────────────────────────────────

const totalFixed = fixed1 + fixed2 + fixed3 + fixed3b + fixed4;

if (DRY_RUN) {
  console.log("\n[DRY RUN] Tidak ada file yang ditulis.");
  process.exit(0);
}

if (totalFixed === 0) {
  console.log("\n  ✅ Tidak ada perubahan diperlukan. File tidak ditulis.");
  process.exit(0);
}

const backupPath = CARDS_PATH + ".backup-" + Date.now();
fs.copyFileSync(CARDS_PATH, backupPath);
console.log(`\n  Backup dibuat: ${path.basename(backupPath)}`);

fs.writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2));
console.log(`  ✅ ${cfg.cardsFile} ditulis ulang`);

console.log("\n═══════════════════════════════════════════════════");
console.log(`  Selesai. ${totalFixed} perubahan (${fixed1} clan, ${fixed2} setCode, ${fixed3} duplikat, ${fixed3b} rename suffix, ${fixed4} nations dash).`);
console.log("═══════════════════════════════════════════════════");
