/**
 * Targeted trigger re-scrape — fixes trigger field for known anomalous cards.
 *
 * Targets three bug categories:
 *   Bug A/B — non-Grade-0 cards with trigger wrongly set (false positives)
 *   Bug C   — V-era/D-VS Trigger Unit cards (grade 2+) with trigger missing
 *             because old parser missed the "Heal +10000" format (no "Trigger" word)
 *
 * Usage:
 *   node rescrape_triggers.js                    # fix all bugs
 *   node rescrape_triggers.js --dry-run          # preview only, no writes
 *   node rescrape_triggers.js --bug-ab-only      # skip Bug C scan
 *   node rescrape_triggers.js --bug-c-only       # skip Bug A/B
 *
 * Safe to delete after fix is verified and merged.
 */

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const CARDS_FILE   = path.join(__dirname, 'cards.json');
const BACKUP_FILE  = path.join(__dirname, 'cards.json.trigger-before');
const DRY_RUN      = process.argv.includes('--dry-run');
const BUG_AB_ONLY  = process.argv.includes('--bug-ab-only');
const BUG_C_ONLY   = process.argv.includes('--bug-c-only');
const DELAY_MS     = 400; // polite delay between requests

// ── Set prefixes known to contain V-era Grade 3 Trigger Units (Bug C) ─────────
// These sets use the "Heal +10000" gift format (without "Trigger" keyword).
// The old parser missed them. We re-scrape all grade 2+ null-trigger cards
// from these sets and update only the ones that turn out to be Trigger Units.
const BUG_C_SET_PREFIXES = [
  'D-VS',   // D-VS01..D-VS06 — confirmed Bug C source
  'V-BT',   // V-BT01..V-BT12
  'V-EB',   // V-EB01..V-EB15
  'V-SS',   // V-SS01..V-SS10
  'V-TD',   // V-TD01..V-TD12
  'V-PR',   // V-Premium promos
];

// ── Parsing helpers (mirrors updated scrape_en.js logic) ──────────────────────

const TRIGGER_KEYWORDS = ['Critical', 'Draw', 'Heal', 'Front', 'Over', 'Sentinel'];

function stripTags(s) {
  return s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeHtmlEntities(s) {
  return s
    .replace(/&amp;/g,  '&')
    .replace(/&lt;/g,   '<')
    .replace(/&gt;/g,   '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function extractByClass(html, cls) {
  const re = new RegExp(`<div class="${cls}"[^>]*>([\\s\\S]*?)<\\/div>`, 'gi');
  const matches = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const text = decodeHtmlEntities(stripTags(m[1]).trim());
    if (text.length > 0) matches.push(text);
  }
  return matches;
}

function parseTriggerFromHtml(html) {
  // unitType — track if explicitly "Trigger Unit" before normalization
  const types = extractByClass(html, 'type');
  let isTriggerUnit = false;
  if (types.length > 0 && types[0] === 'Trigger Unit') isTriggerUnit = true;

  // grade
  const grades = extractByClass(html, 'grade');
  let grade = null;
  if (grades.length > 0) {
    const gm = grades[0].match(/Grade\s+(\d+)/i);
    if (gm) grade = parseInt(gm[1], 10);
  }

  // trigger from div.gift — only for Grade 0 or explicit Trigger Unit
  const gifts = extractByClass(html, 'gift');
  const canHaveTrigger = grade === null || grade === 0 || isTriggerUnit;

  let trigger = null;
  if (gifts.length > 0 && gifts[0] !== '-' && canHaveTrigger) {
    const giftLower = gifts[0].toLowerCase();
    for (const kw of TRIGGER_KEYWORDS) {
      const kwLower = kw.toLowerCase();
      if (giftLower.includes(kwLower + ' trigger') || giftLower.startsWith(kwLower)) {
        trigger = kw;
        break;
      }
    }
  }

  return { trigger, grade, isTriggerUnit, gift: gifts[0] || null };
}

// ── HTTP fetch ─────────────────────────────────────────────────────────────────

function fetchCard(cardNo) {
  const url = 'https://en.cf-vanguard.com/cardlist/?cardno=' + encodeURIComponent(cardNo);
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    }).on('error', reject);
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Trigger Re-scrape' + (DRY_RUN ? ' [DRY RUN]' : ''));
  console.log('═══════════════════════════════════════════════════\n');

  const cards = JSON.parse(fs.readFileSync(CARDS_FILE, 'utf8'));

  // Bug A/B: non-Grade-0 cards with trigger wrongly set
  const anomalies = BUG_C_ONLY ? [] : cards.filter(c =>
    c.trigger !== null && c.grade !== null && c.grade !== 0
  );

  // Bug C: V-era/D-VS grade 2+ null-trigger cards — re-scrape to find missed Trigger Units
  const bugCCandidates = BUG_AB_ONLY ? [] : cards.filter(c =>
    c.trigger === null &&
    c.grade !== null && c.grade >= 2 &&
    BUG_C_SET_PREFIXES.some(pfx => (c.setCode || '').startsWith(pfx))
  );

  // Deduplicate (a card can't be in both lists)
  const anomalyIds = new Set(anomalies.map(c => c.enCardNo));
  const bugCCards  = bugCCandidates.filter(c => !anomalyIds.has(c.enCardNo));

  const targets = [...anomalies, ...bugCCards];
  console.log(`Targets:`);
  console.log(`  Bug A/B (false positives):  ${anomalies.length} cards`);
  console.log(`  Bug C   (missing trigger):  ${bugCCards.length} cards to scan`);
  console.log(`  Total:                      ${targets.length} cards\n`);

  if (!DRY_RUN) {
    // Save backup before any changes
    fs.writeFileSync(BACKUP_FILE, JSON.stringify(cards, null, 2));
    console.log(`Backup saved → ${path.basename(BACKUP_FILE)}\n`);
  }

  // Build index for fast lookup
  const cardIndex = {};
  cards.forEach((c, i) => { cardIndex[c.enCardNo] = i; });

  const changes = [];
  let changed = 0, unchanged = 0, errors = 0;

  for (let i = 0; i < targets.length; i++) {
    const card = targets[i];
    const prefix = `[${String(i + 1).padStart(2)}/${targets.length}]`;

    try {
      const html = await fetchCard(card.enCardNo);
      const parsed = parseTriggerFromHtml(html);
      const oldTrigger = card.trigger;
      const newTrigger = parsed.trigger;

      const isBugC  = !anomalyIds.has(card.enCardNo);
      const status  = oldTrigger === newTrigger ? 'SAME   ' : 'CHANGED';
      const arrow   = oldTrigger === newTrigger
        ? `${String(oldTrigger).padEnd(10)}`
        : `${String(oldTrigger).padEnd(10)} → ${String(newTrigger)}`;

      // For Bug C scan: only log changes; print progress every 50 cards to show it's alive
      if (!isBugC || oldTrigger !== newTrigger) {
        console.log(`${prefix} ${status} ${card.enCardNo.padEnd(22)} ${arrow}  (${card.name})`);
      } else if ((i + 1) % 50 === 0) {
        console.log(`${prefix} ... scanning Bug C (${changed} found so far)`);
      }

      if (oldTrigger !== newTrigger) {
        changes.push({ enCardNo: card.enCardNo, name: card.name, from: oldTrigger, to: newTrigger });
        if (!DRY_RUN) {
          const idx = cardIndex[card.enCardNo];
          if (idx !== undefined) cards[idx].trigger = newTrigger;
        }
        changed++;
      } else {
        unchanged++;
      }
    } catch (err) {
      console.log(`${prefix} ERROR   ${card.enCardNo} — ${err.message}`);
      errors++;
    }

    if (i < targets.length - 1) await sleep(DELAY_MS);
  }

  console.log('\n───────────────────────────────────────────────────');
  console.log(`Changed: ${changed}  |  Unchanged: ${unchanged}  |  Errors: ${errors}`);

  if (changes.length > 0) {
    console.log('\nChanges summary:');
    changes.forEach(c => {
      console.log(`  ${c.enCardNo.padEnd(22)} ${String(c.from).padEnd(10)} → ${c.to}  (${c.name})`);
    });
  }

  if (!DRY_RUN && changed > 0) {
    fs.writeFileSync(CARDS_FILE, JSON.stringify(cards, null, 2));
    console.log(`\ncards.json updated (${changed} cards fixed).`);
    console.log(`To compare: before data is in ${path.basename(BACKUP_FILE)}`);
    console.log('Verify viewer will auto-reflect changes at http://localhost:3333');
  } else if (DRY_RUN) {
    console.log('\n[DRY RUN] No files written. Run without --dry-run to apply.');
  }
}

main().catch(err => {
  console.error('\nFatal:', err);
  process.exit(1);
});
