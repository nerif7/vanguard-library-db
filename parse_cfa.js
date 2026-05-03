#!/usr/bin/env node
/**
 * cfa-texts → Vanguard Library JSON parser
 *
 * Reads all .txt files from the CFA Text/ folder,
 * converts GML card entries to JSON, and outputs:
 *   - cfa_cards.json    : full card database
 *   - cfa_cards_min.json: minified (name, nation, grade, power, imageUrl only)
 */

const fs   = require("fs");
const path = require("path");

// ── Config ────────────────────────────────────────────────
const TEXT_DIR    = path.join(__dirname, "cfa-texts/Text");
const SPRITE_BASE = "https://raw.githubusercontent.com/uniquekid/cfa-texts/master/CardSprite/n{id}.jpg";
const OUT_FULL    = path.join(__dirname, "cards_full.json");
const OUT_MIN     = path.join(__dirname, "cards_min.json");

// Files that are not card data
const SKIP_FILES = new Set(["UnitPower.txt", "NoUse.txt", "Game.txt"]);

// Map CFA file names → canonical Vanguard Library nation names
const FILE_TO_NATION = {
  "Dragon Empire.txt":       "Dragon Empire",
  "Dark States.txt":         "Dark States",
  "Keter Sanctuary.txt":     "Keter Sanctuary",
  "Stoicheia.txt":           "Stoicheia",
  "Lyrical Monasterio.txt":  "Lyrical Monasterio",
  "Brandt Gate.txt":         "Brandt Gate",
  "Kagero.txt":              "Dragon Empire",
  "Narukami.txt":            "Dragon Empire",
  "Murakumo.txt":            "Dragon Empire",
  "Tachikaze.txt":           "Dragon Empire",
  "Nova Grappler.txt":       "Star Gate",
  "Dimension Police.txt":    "Star Gate",
  "Link Joker.txt":          "Star Gate",
  "Royal Paladin.txt":       "United Sanctuary",
  "Shadow Paladin.txt":      "United Sanctuary",
  "Gold Paladin.txt":        "United Sanctuary",
  "Oracle.txt":              "United Sanctuary",
  "Genesis.txt":             "United Sanctuary",
  "Anger Feather.txt":       "United Sanctuary",
  "Aqua Force.txt":          "Zoo",
  "Neo Nectar.txt":          "Zoo",
  "Great Nature.txt":        "Zoo",
  "Megacolony.txt":          "Zoo",
  "Granblue.txt":            "Magallanica",
  "Bermuda.txt":             "Magallanica",
  "Pale Moon.txt":           "Magallanica",
  "Spike Brothers.txt":      "Dark Zone",
  "Dark Irregulars.txt":     "Dark Zone",
  "Gear Chronicle.txt":      "Cray Elemental",
  "Cray Elemental.txt":      "Cray Elemental",
  "Nubatama.txt":            "Dark States",
  "Touken Ranbu.txt":        "Touken Ranbu",
  "Bang Dream.txt":          "BanG Dream!",
  "Triggers.txt":            "Nationless",
  "Order Cards.txt":         "Nationless",
  "Etrangers.txt":           "Nationless",
  "Animation.txt":           "Nationless",
  "Iconic.txt":              "Nationless",
  "Live Action.txt":         "Nationless",
  "The Mask Collection.txt": "Nationless",
  "Corocoro.txt":            "Nationless",
  "Buddyfight.txt":          "Nationless",
  "Monster Strike.txt":      "Nationless",
  "Shaman King.txt":         "Nationless",
  "Record of Ragnarok.txt":  "Nationless",
  "VSPO.txt":                "Nationless",
  "B-Robo Kabutack.txt":     "Nationless",
};

// ── Helpers ───────────────────────────────────────────────

/** Strip surrounding single quotes from GML string value */
function stripQuotes(s) {
  s = s.trim();
  if (s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1);
  return s;
}

/** Determine trigger type from CardText */
function getTriggerType(cardText) {
  const t = cardText.toLowerCase();
  if (t.includes("critical trigger"))  return "Critical";
  if (t.includes("draw trigger"))      return "Draw";
  if (t.includes("front trigger"))     return "Front";
  if (t.includes("heal trigger"))      return "Heal";
  if (t.includes("over trigger"))      return "Over";
  if (t.includes("sentinel"))         return "Sentinel";
  return null;
}

// ── Parser ────────────────────────────────────────────────

/**
 * Parse one GML text file (already decoded to UTF-8).
 * Returns array of raw card objects.
 */
function parseGmlFile(content, fileName) {
  const cards = [];
  const nation = FILE_TO_NATION[fileName] ?? "Nationless";

  // Split into card blocks on "CardStat = NNNN"
  // Each block starts at "CardStat = N" and ends before the next one
  const blockRegex = /CardStat\s*=\s*(\d+)\s*\{([\s\S]*?)\}([\s\S]*?)(?=CardStat\s*=\s*\d+|$)/g;

  let match;
  while ((match = blockRegex.exec(content)) !== null) {
    const id         = parseInt(match[1], 10);
    const innerBlock = match[2];   // inside { }
    const afterBlock = match[3];   // between } and next CardStat

    const card = { id, nation };

    // Parse all "global.Field[CardStat] = value" lines
    // inside the block
    const fieldRegex = /global\.(\w+)\[CardStat\]\s*=\s*('[\s\S]*?'|-?\d+)/g;
    let fm;
    while ((fm = fieldRegex.exec(innerBlock)) !== null) {
      const key = fm[1];
      const raw = fm[2].trim();
      const isStr = raw.startsWith("'");
      card[key] = isStr ? stripQuotes(raw) : parseInt(raw, 10);
    }

    // Parse standalone fields after the closing } (PowerStat, DefensePowerStat, etc.)
    const afterRegex = /global\.(\w+)\[CardStat\]\s*=\s*(-?\d+)/g;
    let am;
    while ((am = afterRegex.exec(afterBlock)) !== null) {
      card[am[1]] = parseInt(am[2], 10);
    }

    // Must have at least a name
    if (!card.CardName) continue;

    cards.push(card);
  }

  return cards;
}

const KNOWN_NATIONS = new Set([
  "Dragon Empire","Dark States","Keter Sanctuary","Stoicheia",
  "Lyrical Monasterio","Brandt Gate","Star Gate","United Sanctuary",
  "Zoo","Magallanica","Dark Zone","Cray Elemental","Touken Ranbu",
  "Kagero","Narukami","Murakumo","Tachikaze","Nova Grappler",
  "Dimension Police","Link Joker","Royal Paladin","Shadow Paladin",
  "Gold Paladin","Oracle Think Tank","Genesis","Angel Feather",
  "Aqua Force","Neo Nectar","Great Nature","Megacolony","Granblue",
  "Bermuda Triangle","Pale Moon","Dark Irregulars","Spike Brothers",
  "Gear Chronicle","Nubatama","BanG Dream!",
]);

/** Transform raw parsed card into clean output shape */
function normalizeCard(raw, fileName) {
  const fileNation = FILE_TO_NATION[fileName] ?? "Nationless";

  let detectedNation = fileNation;
  let subtype = "";
  let effectText = raw.CardText ?? "";

  if (effectText) {
    const firstLine = effectText.split("\n")[0].trim();
    const slash = firstLine.indexOf("/");

    if (slash !== -1) {
      // Has Nation/Subtype format
      const candidate = firstLine.slice(0, slash).trim();
      detectedNation = candidate || fileNation;
      subtype = firstLine.slice(slash + 1).trim();
      effectText = effectText.split("\n").slice(1).join("\n").trim();
    } else if (KNOWN_NATIONS.has(firstLine)) {
      // Nation only, no subtype
      detectedNation = firstLine;
      effectText = effectText.split("\n").slice(1).join("\n").trim();
    }
    // else: first line is effect text, keep fileNation
  }

  const trigger = raw.TriggerUnit ? getTriggerType(raw.CardText ?? "") : null;

  return {
    cfaId:          raw.id,
    name:           raw.CardName,
    nation:         detectedNation,
    subtype,
    grade:          raw.UnitGrade ?? null,
    power:          raw.PowerStat ?? null,
    shield:         raw.DefensePowerStat ?? null,
    trigger,
    personaRide:    raw.PersonaRide    === 1 ? true : undefined,
    extraDeck:      raw.ExtraDeck      === 1 ? true : undefined,
    banned:         raw.CardBanned     === 1 ? true : undefined,
    effect:         effectText || undefined,
    imageUrl:       SPRITE_BASE.replace("{id}", raw.id),
  };
}

// ── Main ──────────────────────────────────────────────────

const files = fs.readdirSync(TEXT_DIR).filter(f => f.endsWith(".txt") && !SKIP_FILES.has(f));

const allCards = [];
const errors   = [];

for (const file of files) {
  const filePath = path.join(TEXT_DIR, file);
  let content;
  try {
    // Files are Windows-1251 encoded
    const buf = fs.readFileSync(filePath);
    content = new TextDecoder("windows-1251").decode(buf);
  } catch (e) {
    errors.push({ file, error: e.message });
    continue;
  }

  const rawCards = parseGmlFile(content, file);
  for (const raw of rawCards) {
    allCards.push(normalizeCard(raw, file));
  }
}

// Sort by cfaId ascending
allCards.sort((a, b) => a.cfaId - b.cfaId);

// Remove undefined values
const cleaned = allCards.map(c => {
  const out = {};
  for (const [k, v] of Object.entries(c)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
});

// Full output
fs.writeFileSync(OUT_FULL, JSON.stringify(cleaned, null, 2));

// Minimal output (name lookup use-case)
const minimal = cleaned.map(({ cfaId, name, nation, grade, power, shield, trigger, imageUrl }) =>
  ({ cfaId, name, nation, grade, power, shield, ...(trigger ? { trigger } : {}), imageUrl })
);
fs.writeFileSync(OUT_MIN, JSON.stringify(minimal, null, 2));

// Stats
const byNation = {};
for (const c of cleaned) {
  byNation[c.nation] = (byNation[c.nation] ?? 0) + 1;
}

console.log(`✅ Parsed ${cleaned.length} cards from ${files.length} files`);
if (errors.length) console.warn(`⚠️  ${errors.length} file errors:`, errors);
console.log("\nBy nation:");
Object.entries(byNation).sort((a,b) => b[1]-a[1]).forEach(([n, c]) => console.log(`  ${n}: ${c}`));
console.log(`\nOutput:`);
console.log(`  Full : ${OUT_FULL} (${(fs.statSync(OUT_FULL).size/1024).toFixed(0)} KB)`);
console.log(`  Min  : ${OUT_MIN} (${(fs.statSync(OUT_MIN).size/1024).toFixed(0)} KB)`);
