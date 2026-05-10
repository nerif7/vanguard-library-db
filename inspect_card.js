#!/usr/bin/env node
/**
 * inspect_card.js — debug satu kartu spesifik
 *
 * Usage:
 *   node inspect_card.js DZ-BT12/EX01EN
 *
 * Akan tampilkan:
 *   1. Data kartu di cards.json saat ini
 *   2. Raw HTML dari EN site (excerpt)
 *   3. Hasil parseDetailHtml()
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const cardNo = process.argv[2];
if (!cardNo) {
  console.error("Usage: node inspect_card.js <enCardNo>");
  console.error("Example: node inspect_card.js DZ-BT12/EX01EN");
  process.exit(1);
}

// ── Load cards.json ───────────────────────────────────────────────────────────

const CARDS_PATH = path.join(__dirname, "cards.json");
if (!fs.existsSync(CARDS_PATH)) {
  console.error("cards.json not found");
  process.exit(1);
}
const cards   = JSON.parse(fs.readFileSync(CARDS_PATH, "utf-8"));
const current = cards.find((c) => c.enCardNo === cardNo);

console.log("═══════════════════════════════════════════════════");
console.log(` Inspecting: ${cardNo}`);
console.log("═══════════════════════════════════════════════════\n");

console.log("1. Current state in cards.json:");
if (!current) {
  console.log("   NOT FOUND in cards.json");
} else {
  console.log(JSON.stringify(current, null, 2));
}
console.log();

// ── Fetch detail page ─────────────────────────────────────────────────────────

const url = `https://en.cf-vanguard.com/cardlist/?cardno=${encodeURIComponent(cardNo)}`;
console.log("2. Fetching:", url);

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
    }, (res) => {
      console.log("   Status:", res.statusCode);
      console.log("   Location:", res.headers.location ?? "(no redirect)");
      let body = "";
      res.on("data", (c) => body += c);
      res.on("end", () => resolve({ status: res.statusCode, body, location: res.headers.location }));
    }).on("error", reject);
  });
}

(async () => {
  const { status, body, location } = await fetchUrl(url);
  console.log("   Body length:", body.length, "bytes\n");

  if (status !== 200) {
    console.log(`Non-200 response. Body preview:\n${body.slice(0, 500)}`);
    return;
  }

  // ── Show key sections of HTML ──────────────────────────────────────────────

  console.log("3. HTML inspection:\n");

  // Title
  const titleMatch = body.match(/<title>([^<]+)<\/title>/);
  console.log("   Title:", titleMatch ? titleMatch[1].trim() : "(no title)");

  // Find <hr>
  const hrIdx = body.indexOf("<hr");
  console.log("   <hr> index:", hrIdx);

  if (hrIdx === -1) {
    console.log("   ⚠ No <hr> found — page structure is different!");
    // Show body around middle
    console.log("\n   Body excerpt (chars 1000-2500):");
    console.log("   " + body.slice(1000, 2500).replace(/\n/g, "\n   "));
    return;
  }

  // Show what's after <hr>
  const blockHtml = body.slice(hrIdx, hrIdx + 1500);
  console.log("\n4. Content after <hr> (first 1500 chars):");
  console.log("───────────────────────────────────────────────────");
  console.log(blockHtml);
  console.log("───────────────────────────────────────────────────\n");

  // Strip tags and show as plain lines
  const stripped = blockHtml
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .trim();

  const lines = stripped.split(/[\n\r]/).map((l) => l.trim()).filter((l) => l.length > 0);

  console.log("5. Parsed lines (first 30):");
  for (let i = 0; i < Math.min(30, lines.length); i++) {
    console.log(`   [${String(i).padStart(2, " ")}] "${lines[i]}"`);
  }
})();
