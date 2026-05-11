#!/usr/bin/env node
/**
 * scrape_en.js — Vanguard EN card database builder
 *
 * Single source of truth: en.cf-vanguard.com only. No CFA GML dependency.
 *
 * Scrapes expansion by expansion:
 *   1. Gallery page  → enCardNo, name, imageUrlEn per card
 *   2. Detail page   → unitType, nations[], clan[], grade, trigger, rarity
 *
 * Output:
 *   cards.json      — full EN card database (all fields + rarity)
 *
 * Usage:
 *   node scrape_en.js                          # scrape all expansions
 *   node scrape_en.js --expansion 248         # single expansion (for testing)
 *   node scrape_en.js --resume                # continue interrupted scrape
 *   node scrape_en.js --retry-failed          # re-fetch cards with empty fields
 *   node scrape_en.js --retry-failed --delay 800  # retry with slower delay
 *   node scrape_en.js --delay 400             # ms between requests (default 350)
 */

const fs   = require("fs");
const path = require("path");
const https = require("https");
const http  = require("http");

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL    = "https://en.cf-vanguard.com";
const OUT_FULL    = path.join(__dirname, "cards.json");
const RESUME_FILE = path.join(__dirname, ".scrape_progress.json");

const args        = process.argv.slice(2);
const ARG_EXP          = getArg("--expansion");    // single expansion id
const ARG_RESUME       = args.includes("--resume");
const ARG_RETRY_FAILED = args.includes("--retry-failed");
const DELAY_MS         = Number(getArg("--delay") ?? 350);

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

// ── Known values (for parsing) ────────────────────────────────────────────────

// True nation names only (overDress era + old era nation groupings)
const KNOWN_NATIONS = new Set([
  // overDress era nations
  "Dragon Empire", "Dark States", "Keter Sanctuary", "Stoicheia",
  "Lyrical Monasterio", "Brandt Gate",
  // old era nation groupings (still appear on reprint pages)
  "Star Gate", "United Sanctuary", "Zoo", "Magallanica",
  "Dark Zone", "Cray Elemental", "Touken Ranbu", "BanG Dream!",
  "Nationless",
]);

// Old era clan names + BanG Dream bands — appear as clan[] not races[]
const KNOWN_CLANS = new Set([
  // Old era clans
  "Kagero", "Narukami", "Murakumo", "Tachikaze",
  "Nova Grappler", "Dimension Police", "Link Joker",
  "Royal Paladin", "Shadow Paladin", "Gold Paladin",
  "Oracle Think Tank", "Genesis", "Angel Feather",
  "Aqua Force", "Neo Nectar", "Great Nature", "Megacolony",
  "Granblue", "Bermuda Triangle", "Pale Moon",
  "Dark Irregulars", "Spike Brothers",
  "Gear Chronicle", "Nubatama",
  // BanG Dream! collab — band names function as clan
  "Poppin'Party", "Afterglow", "Pastel*Palettes", "Roselia",
  "Hello, Happy World!", "Morfonica", "RAISE A SUILEN",
  "MyGO!!!!!", "Ave Mujica",
]);

const KNOWN_UNIT_TYPES = new Set([
  "Normal Unit", "G Unit", "Order", "Set Order", "Blitz Order", "Token",
]);

const TRIGGER_KEYWORDS = ["Critical", "Draw", "Heal", "Front", "Over", "Sentinel"];

// ── HTTP fetch (no external deps) ────────────────────────────────────────────

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
        // Follow redirects
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : BASE_URL + res.headers.location;
          attempt(n); // try same redirect
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Simple HTML parser helpers (no deps) ─────────────────────────────────────

/** Extract text content between two strings. */
function between(html, open, close, fromIndex = 0) {
  const start = html.indexOf(open, fromIndex);
  if (start === -1) return null;
  const end = html.indexOf(close, start + open.length);
  if (end === -1) return null;
  return html.slice(start + open.length, end);
}

/** Extract all matches of a pattern between open/close. */
function allBetween(html, open, close) {
  const results = [];
  let pos = 0;
  while (true) {
    const result = between(html, open, close, pos);
    if (result === null) break;
    results.push(result);
    pos = html.indexOf(open, pos) + open.length;
  }
  return results;
}

/** Get attribute value from an HTML tag string. */
function attr(tag, name) {
  const patterns = [
    new RegExp(`${name}="([^"]*)"`, "i"),
    new RegExp(`${name}='([^']*)'`, "i"),
  ];
  for (const p of patterns) {
    const m = tag.match(p);
    if (m) return decodeHtmlEntities(m[1]);
  }
  return null;
}

function decodeHtmlEntities(str) {
  return str
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

/** Strip all HTML tags from a string. */
function stripTags(html) {
  return html.replace(/<[^>]*>/g, "").trim();
}

// ── Gallery parser ────────────────────────────────────────────────────────────

/**
 * Parse gallery page HTML.
 * Returns array of { enCardNo, name, imageUrlEn }
 *
 * EN gallery structure (li.ex-item):
 *   <li class="ex-item">
 *     <a href="/cardlist/?cardno=DZ-BT12/001EN&...">
 *       <img src="/wordpress/wp-content/images/cardlist/dzbt12/dzbt12_001.png"
 *            title="Enma Stealth Rogue, Mujinlord" alt="...">
 *     </a>
 *   </li>
 */
function parseGalleryHtml(html) {
  const cards = [];
  const items = allBetween(html, '<li class="ex-item">', "</li>");
  const seenBaseEnCardNo = new Set();

  for (const item of items) {
    // Extract href from <a>
    const aTag   = between(item, "<a", ">");
    const href   = aTag ? attr(aTag, "href") : null;

    // Extract img
    const imgTag = between(item, "<img", ">");
    const src    = imgTag ? (attr(imgTag, "src") ?? "") : "";
    const title  = imgTag ? (attr(imgTag, "title") ?? attr(imgTag, "alt") ?? "") : "";

    if (!href || !src) continue;

    // Parse cardno from href query string
    const cardnoMatch = href.match(/[?&]cardno=([^&]+)/);
    if (!cardnoMatch) continue;
    const enCardNo = decodeURIComponent(cardnoMatch[1]);

    // SKIP TD copies suffix: "DZ-TD01/001EN_16" → "DZ-TD01/001EN"
    // EN site lists Trial Deck cards multiple times with _N suffix indicating
    // deck slot positions. We only want one record per unique card.
    const baseEnCardNo = enCardNo.replace(/_\d+$/, "");
    if (seenBaseEnCardNo.has(baseEnCardNo)) continue;
    seenBaseEnCardNo.add(baseEnCardNo);

    // Build absolute image URL
    const imageUrlEn = src.startsWith("http") ? src : BASE_URL + src;

    cards.push({ enCardNo: baseEnCardNo, name: title, imageUrlEn });
  }

  return cards;
}

// ── Detail page parser ────────────────────────────────────────────────────────

/**
 * Parse detail page HTML into card metadata using class-based extraction.
 *
 * EN site uses semantic CSS classes that we extract directly:
 *   div.type        → unitType (e.g. "Normal Unit", "G Unit", "Trigger Unit", "Order")
 *   div.nation      → nation (or "-" for nationless)
 *   div.group       → clan name (Nubatama, Royal Paladin) — modern era classification
 *   div.race        → race (Demon, Human, Flame Dragon)
 *                     EXCEPTION: BanG Dream band names (Poppin'Party, Afterglow)
 *                     appear here but function as clans — handled via KNOWN_CLANS
 *   div.grade       → "Grade N"
 *   div.rarity      → rarity code
 *   div.gift        → trigger info (e.g. "Heal Trigger +10000")
 *
 * unitType normalization:
 *   "Trigger Unit" → "Normal Unit" (trigger cards are normal units with trigger)
 *
 * nation normalization:
 *   "-" → empty (nationless)
 *
 * Returns { name, unitType, nations[], clan[], races[], grade, trigger, rarity, imageUrlEn }
 */
function parseDetailHtml(html, enCardNo) {
  const result = {
    name:       null,
    unitType:   null,
    nations:    [],
    clan:       [],
    races:      [],
    grade:      null,
    trigger:    null,
    rarity:     null,
    imageUrlEn: null,
  };

  // ── Name from <title> ──────────────────────────────────────────────────────
  const titleTag = between(html, "<title>", "</title>");
  if (titleTag) {
    const namePart = decodeHtmlEntities(titleTag.split("｜")[0].trim());
    if (namePart.length > 0) result.name = namePart;
  }

  // ── Image URL ─────────────────────────────────────────────────────────────
  const imgMatch = html.match(
    /src="(https:\/\/en\.cf-vanguard\.com\/wordpress\/wp-content\/images\/cardlist\/[^"]+\.(?:png|jpg|webp))"/i
  );
  if (imgMatch) result.imageUrlEn = imgMatch[1];

  // ── Class-based extraction ────────────────────────────────────────────────
  // Helper: extract content of <div class="X">...</div>, returns trimmed text
  // Uses simple regex — no full HTML parser needed for this site's flat structure
  const extractByClass = (className) => {
    const re = new RegExp(`<div class="${className}"[^>]*>([\\s\\S]*?)<\\/div>`, "gi");
    const matches = [];
    let m;
    while ((m = re.exec(html)) !== null) {
      const text = decodeHtmlEntities(stripTags(m[1]).trim());
      if (text.length > 0) matches.push(text);
    }
    return matches;
  };

  // ── unitType (div.type) ───────────────────────────────────────────────────
  const types = extractByClass("type");
  if (types.length > 0) {
    let raw = types[0];
    // Normalize: "Trigger Unit" is just a Normal Unit with a trigger ability
    if (raw === "Trigger Unit") raw = "Normal Unit";
    result.unitType = raw;
  }

  // ── nations (div.nation) ──────────────────────────────────────────────────
  // "-" or empty = nationless. Multiple <div class="nation"> = dual-nation
  const nationDivs = extractByClass("nation");
  for (const n of nationDivs) {
    if (n === "-" || n === "") continue;
    if (!result.nations.includes(n)) result.nations.push(n);
  }

  // ── races / clan ──────────────────────────────────────────────────────────
  // EN site uses TWO different classes:
  //   div.group → modern clan name (Nubatama, Royal Paladin) — direct to clan[]
  //   div.race  → mostly races (Demon, Human, Flame Dragon)
  //               BUT BanG Dream collab uses div.race for band names (Poppin'Party)
  //               which are functionally clans, so we cross-check KNOWN_CLANS.
  //
  // Edge case (G era / BCS cards): div.group sometimes mirrors div.nation
  //   (e.g. <group>Dragon Empire</group> + <nation>Dragon Empire</nation>).
  //   In that case the group field is just nation duplication, NOT a clan.
  //   We skip it.
  const groupDivs = extractByClass("group");
  for (const g of groupDivs) {
    if (g === "-" || g === "") continue;
    if (result.nations.includes(g)) continue;  // skip if it duplicates a nation
    if (!result.clan.includes(g)) result.clan.push(g);
  }

  const raceDivs = extractByClass("race");
  for (const r of raceDivs) {
    if (r === "-" || r === "") continue;
    // BanG Dream band names appear in div.race but are functionally clans
    if (KNOWN_CLANS.has(r)) {
      if (!result.clan.includes(r)) result.clan.push(r);
    } else {
      if (!result.races.includes(r)) result.races.push(r);
    }
  }

  // ── grade (div.grade) ─────────────────────────────────────────────────────
  const grades = extractByClass("grade");
  if (grades.length > 0) {
    const gm = grades[0].match(/Grade\s+(\d+)/i);
    if (gm) result.grade = parseInt(gm[1], 10);
  }

  // ── rarity (div.rarity) ───────────────────────────────────────────────────
  const rarities = extractByClass("rarity");
  if (rarities.length > 0) result.rarity = rarities[0];

  // ── trigger (div.gift OR effect text containing "[X Trigger]") ────────────
  // Format B: <div class="gift">Heal Trigger +10000</div>
  const gifts = extractByClass("gift");
  if (gifts.length > 0) {
    for (const kw of TRIGGER_KEYWORDS) {
      if (gifts[0].toLowerCase().includes(kw.toLowerCase() + " trigger")) {
        result.trigger = kw;
        break;
      }
    }
  }

  // Fallback: scan full body for trigger marker (some cards put it in effect)
  if (!result.trigger) {
    const fullText = stripTags(html).toLowerCase();
    for (const kw of TRIGGER_KEYWORDS) {
      if (fullText.includes(kw.toLowerCase() + " trigger")) {
        result.trigger = kw;
        break;
      }
    }
  }

  // ── Post-parse fallbacks ──────────────────────────────────────────────────
  // unitType inference for cards without explicit type
  if (!result.unitType) {
    if (result.trigger)                                   result.unitType = "Normal Unit";
    else if ((enCardNo ?? "").match(/\/T\d+[A-Z]*$/i)) result.unitType = "Token";
    else if (result.grade !== null)                       result.unitType = "Normal Unit";
  }

  // races[] only applies to Normal Unit and G Unit — clear for others
  const isUnitCard = result.unitType === "Normal Unit" || result.unitType === "G Unit";
  if (!isUnitCard) {
    result.races = [];
  }

  return result;
}

// ── Derive imageUrlEn from enCardNo ──────────────────────────────────────────

/**
 * Derive EN CDN image URL from card number.
 *
 * Standard sets:
 *   DZ-BT12/001EN → dzbt12/dzbt12_001.png
 *   D-BT08/053EN  → dbt08/dbt08_053.png
 *
 * D-PR promos:
 *   D-PR/0001EN   → dpr/dpr_0001.png
 *   D-PR/1285EN   → dpr/dpr_1285.png
 *   NOTE: some early D-PR images use "D-PR_NNN.png" format —
 *   the scraper will get the real URL from HTML, this is just a fallback.
 *
 * BCS / special promos (non-D-PR):
 *   BCS2019/VGP01    → pr/bcs/bcs2019_vgp01.png
 *   BCS2022/VGP01EN  → bcs2022/bcs2022_vgp01.png
 *   BCS2425/VGS01    → bcs2425/bcs2425_vgs01.png
 */
function deriveImageUrlEn(enCardNo) {
  if (!enCardNo) return null;

  // BCS2019 series: lives under pr/bcs/ subfolder
  if (enCardNo.toUpperCase().startsWith("BCS2019/")) {
    const num = enCardNo.split("/")[1]?.toLowerCase() ?? "";
    return `${BASE_URL}/wordpress/wp-content/images/cardlist/pr/bcs/bcs2019_${num}.png`;
  }

  // Standard pattern: PREFIX/[LETTER]NNN[EN]
  const match = enCardNo.match(/^([A-Z0-9-]+)\/([A-Z]*)(\d+)[A-Z]*$/i);
  if (!match) return null;

  const [, prefix, letterPfx, numStr] = match;
  const folderName = prefix.replace(/-/g, "").toLowerCase();  // D-PR→dpr, DZ-BT12→dzbt12
  const fileNum    = letterPfx
    ? `${letterPfx.toLowerCase()}${numStr}`
    : numStr.padStart(Math.max(3, numStr.length), "0");       // preserve 4-digit D-PR numbers

  return `${BASE_URL}/wordpress/wp-content/images/cardlist/${folderName}/${folderName}_${fileNum}.png`;
}

// ── Expansion list fetcher ────────────────────────────────────────────────────

/**
 * Fetch the expansion list from the card search page.
 * Returns array of expansion IDs (numbers).
 */
async function fetchExpansionList() {
  console.log("Fetching expansion list...");
  const html = await fetchUrl(`${BASE_URL}/cardlist/`);

  // Parse <select name="expansion"> or similar
  // The site uses a JS-driven product list; expansions are in the URL params
  // We extract from option values in the select or from known links
  const ids = new Set();

  // Match: value="NNN" inside expansion select
  const selectBlock = between(html, 'name="expansion"', "</select>");
  if (selectBlock) {
    const matches = selectBlock.matchAll(/value="(\d+)"/g);
    for (const m of matches) ids.add(Number(m[1]));
  }

  // Fallback: extract from anchor hrefs containing expansion=NNN
  const hrefMatches = html.matchAll(/expansion=(\d+)/g);
  for (const m of hrefMatches) ids.add(Number(m[1]));

  // Always include expansion=0 (PR cards / promos) — it's never in the select
  // but always exists and contains 1900+ cards
  ids.add(0);

  return [...ids].sort((a, b) => a - b);
}

// ── Gallery scraper ───────────────────────────────────────────────────────────

async function scrapeGallery(expansionId) {
  // expansion=0 = PR cards. The site serves a standard cardsearch page
  // (not cardsearch_ex), and the gallery uses <li class="ex-item"> too
  // BUT it has 1900+ cards so pagination is essential.
  // Both endpoints are tried; cardsearch_ex is preferred (faster, image-only).
  const cards = [];
  let   page  = 1;

  while (true) {
    // Try the image-gallery endpoint first (works for most expansions)
    const url = `${BASE_URL}/cardlist/cardsearch_ex/?expansion=${expansionId}&view=image&page=${page}`;
    let html;
    try {
      html = await fetchUrl(url);
    } catch (err) {
      console.warn(`  [gallery] HTTP error page ${page}: ${err.message}`);
      break;
    }

    let parsed = parseGalleryHtml(html);

    // For expansion=0 (promos), cardsearch_ex may return empty on some pages
    // but the standard cardsearch endpoint works — try fallback
    if (parsed.length === 0 && page === 1) {
      try {
        const fallbackUrl = `${BASE_URL}/cardlist/cardsearch/?expansion=${expansionId}&view=image&page=${page}`;
        const fallbackHtml = await fetchUrl(fallbackUrl);
        parsed = parseGalleryHtml(fallbackHtml);
        if (parsed.length > 0) {
          console.log(`  [gallery] Using fallback endpoint for expansion=${expansionId}`);
        }
      } catch { /* ignore fallback error */ }
    }

    if (parsed.length === 0) break;

    cards.push(...parsed);
    process.stdout.write(`  [gallery] expansion=${expansionId} page=${page} (+${parsed.length} cards, total=${cards.length})\r`);
    page++;
    await sleep(DELAY_MS);
  }

  process.stdout.write("\n");
  return cards;
}

// ── Detail scraper ────────────────────────────────────────────────────────────

async function scrapeDetail(enCardNo) {
  const url = `${BASE_URL}/cardlist/?cardno=${encodeURIComponent(enCardNo)}`;
  let html;
  try {
    html = await fetchUrl(url);
  } catch (err) {
    console.warn(`  [detail] Failed ${enCardNo}: ${err.message}`);
    return null;
  }
  return parseDetailHtml(html, enCardNo);
}

// ── Progress tracking ─────────────────────────────────────────────────────────

function loadProgress() {
  try {
    if (fs.existsSync(RESUME_FILE)) {
      return JSON.parse(fs.readFileSync(RESUME_FILE, "utf-8"));
    }
  } catch { /* ignore */ }
  return { done: [], cards: [] };
}

function saveProgress(progress) {
  fs.writeFileSync(RESUME_FILE, JSON.stringify(progress, null, 2));
}

// ── Normalize final card output ───────────────────────────────────────────────

/**
 * Parse setCode + cardNumber from enCardNo, handling all known format variants.
 *
 * Handles:
 *   Regular:       DZ-BT12/001EN     → setCode="DZ-BT12", cardNumber="001"
 *   EX cards:      DZ-BT12/EX01EN    → setCode="DZ-BT12", cardNumber="EX01"
 *   SEC/SP:        DZ-BT12/SECV02EN  → setCode="DZ-BT12", cardNumber="SECV02"
 *   D-PR:          D-PR/1285EN       → setCode="D-PR",    cardNumber="1285"
 *   Sneak preview: D-PR/805-SEN      → setCode="D-PR",    cardNumber="805"
 *   B/W variant:   EB10/001EN-B      → setCode="EB10",    cardNumber="001"
 *   Special var:   D-BT11/EX01EN-S   → setCode="D-BT11",  cardNumber="EX01"
 *   BCS Gift:      BCS2022/V-GM-01EN → setCode="BCS2022", cardNumber="01"
 *   Anniversary:   D-BT05/10thSEC01EN → setCode="D-BT05", cardNumber="SEC01"
 *   DZ special:    DZ-BT06/SER＋01EN  → setCode="DZ-BT06", cardNumber="SER01"
 *   TD copies:     DZ-TD01/001EN_16  → setCode="DZ-TD01", cardNumber="001"
 *   G Reborn:      G-BT08/Re:01EN    → setCode="G-BT08",  cardNumber="01"
 *   G special:     G-CB03/S01EN      → setCode="G-CB03",  cardNumber="S01"
 *   Alt rarity:    G-BT01/088EN PR   → setCode="G-BT01",  cardNumber="088"
 *
 * Returns { setCode, cardNumber } — both strings. Falls back to {enCardNo, ""} if unparseable.
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

  // Step 2: Split on first "/" — left is setCode, right is card identifier
  const parts = normalized.split("/");
  if (parts.length !== 2) return { setCode: normalized, cardNumber: "" };

  const setCode = parts[0];
  let cardId = parts[1];

  // Step 3: Strip metadata prefixes from cardId
  cardId = cardId.replace(/^\d+th/, "");      // "10th" anniversary marker
  cardId = cardId.replace(/^Re:/, "");        // "Re:" G era reborn marker
  cardId = cardId.replace(/^V-GM-/, "");      // "V-GM-" BCS Imaginary Gift Marker
  cardId = cardId.replace(/＋/, "");            // full-width plus (DZ era special)

  // Step 4: Extract first letter*+digits sequence as cardNumber
  const numMatch = cardId.match(/^([A-Z]*\d+)/i);
  const cardNumber = numMatch ? numMatch[1] : "";

  return { setCode, cardNumber };
}

function buildCardEntry(gallery, detail) {
  const enCardNo   = gallery.enCardNo;
  const imageUrlEn = detail?.imageUrlEn ?? gallery.imageUrlEn ?? deriveImageUrlEn(enCardNo);

  const { setCode, cardNumber: cardNum } = parseCardCode(enCardNo);

  return {
    // Identifikasi
    enCardNo,
    setCode,
    cardNumber: cardNum,

    // Nama
    name: detail?.name ?? gallery.name,

    // Klasifikasi
    unitType: detail?.unitType  ?? null,
    nations:  detail?.nations?.length ? detail.nations : [],
    clan:     detail?.clan?.length    ? detail.clan    : [],
    races:    detail?.races?.length   ? detail.races   : [],
    grade:    detail?.grade    ?? null,
    trigger:  detail?.trigger  ?? null,
    rarity:   detail?.rarity   ?? null,

    // Gambar
    imageUrlEn,
  };
}

// ── Min output ────────────────────────────────────────────────────────────────

// ── Main ──────────────────────────────────────────────────────────────────────


// ── Retry failed cards ────────────────────────────────────────────────────────

/**
 * A card is considered "failed" if its detail page returned incomplete data.
 *
 * Excluded from retry (empty fields are legitimate):
 *   - Tokens (matched by cardNo pattern /T001EN etc.)
 *   - Nationless trigger cards: trigger set, grade=0, nations empty (rare but valid)
 *
 * Considered failed and will be retried:
 *   - nations[] is empty (every non-token, non-nationless card has at least one nation)
 *   - unitType is null (post-parse fallback should have inferred something)
 */
function identifyFailedCards(cards) {
  return cards.filter((c) => {
    const isToken = (c.enCardNo ?? "").match(/\/T\d+[A-Z]*$/i);
    if (isToken) return false;

    // Nationless triggers: trigger + grade 0 + nations empty = valid case
    const isNationlessTrigger = c.trigger !== null
      && c.grade === 0
      && (c.nations ?? []).length === 0;
    if (isNationlessTrigger) return false;

    // Failed if either nations is empty or unitType is null
    return (c.nations ?? []).length === 0 || !c.unitType;
  });
}

async function retryFailed() {
  if (!fs.existsSync(OUT_FULL)) {
    console.error("cards.json not found — run a full scrape first.");
    process.exit(1);
  }

  const allCards  = JSON.parse(fs.readFileSync(OUT_FULL, "utf-8"));
  const failed    = identifyFailedCards(allCards);
  const cardIndex = new Map(allCards.map((c, i) => [c.enCardNo, i]));

  console.log(`Found ${failed.length} cards to retry out of ${allCards.length} total.`);
  if (failed.length === 0) {
    console.log("Nothing to retry. ✅");
    return;
  }

  // Show which prefixes are affected
  const prefixCounts = {};
  for (const c of failed) {
    const pfx = (c.enCardNo ?? "").split("/")[1]?.replace(/\d+[A-Z]*$/, "") || "NUM";
    prefixCounts[pfx] = (prefixCounts[pfx] || 0) + 1;
  }
  console.log("  By prefix:", Object.entries(prefixCounts).map(([k,v]) => `${k}(${v})`).join(", "));
  console.log(`  Delay: ${DELAY_MS}ms per request\n`);

  let fixed = 0;
  let stillFailed = 0;

  // Helper to save current state (used both for periodic saves and on exit)
  const saveCurrent = () => {
    // Sort before saving so file stays consistent
    const sorted = [...allCards].sort((a, b) => {
      const sc = (a.setCode ?? "").localeCompare(b.setCode ?? "");
      if (sc !== 0) return sc;
      return (a.cardNumber ?? "").localeCompare(b.cardNumber ?? "", undefined, { numeric: true });
    });
    fs.writeFileSync(OUT_FULL, JSON.stringify(sorted, null, 2));
  };

  // Save partial progress on Ctrl+C so user doesn't lose work
  const onInterrupt = () => {
    process.stdout.write("\n  [interrupted — saving progress...]\n");
    saveCurrent();
    console.log(`  Saved ${fixed} fixes so far.`);
    process.exit(0);
  };
  process.on("SIGINT", onInterrupt);

  for (let i = 0; i < failed.length; i++) {
    const card = failed[i];
    process.stdout.write(`  [${i + 1}/${failed.length}] Retrying ${card.enCardNo}...          \r`);

    const detail = await scrapeDetail(card.enCardNo);
    await sleep(DELAY_MS);

    if (!detail) {
      stillFailed++;
      continue;
    }

    // Rebuild the card entry preserving gallery data we already have
    const galleryData = { enCardNo: card.enCardNo, name: card.name, imageUrlEn: card.imageUrlEn };
    const updated     = buildCardEntry(galleryData, detail);

    // Only update if we actually got more data
    const gotBetter = (updated.nations?.length > 0) || updated.unitType || updated.grade !== null;
    if (gotBetter) {
      const idx = cardIndex.get(card.enCardNo);
      if (idx !== undefined) {
        allCards[idx] = updated;
        fixed++;
      }
    } else {
      stillFailed++;
    }

    // Auto-save every 50 cards
    if ((i + 1) % 50 === 0) {
      saveCurrent();
      process.stdout.write(`\n  [progress saved — ${fixed} fixed so far]\n`);
    }
  }

  process.stdout.write("\n");
  process.off("SIGINT", onInterrupt);

  // Final save
  saveCurrent();

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`✅  Retry complete.`);
  console.log(`   Fixed        : ${fixed}`);
  console.log(`   Still failed : ${stillFailed} (may be legitimately empty or 404)`);
  console.log(`   cards.json   : ${OUT_FULL} (${(fs.statSync(OUT_FULL).size / 1024).toFixed(0)} KB)`);
  console.log("═══════════════════════════════════════════════════");
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Vanguard EN Database Builder — scrape_en.js (EN-only)");
  console.log("═══════════════════════════════════════════════════");

  // Load progress for resume mode
  const progress = ARG_RESUME ? loadProgress() : { done: [], cards: [] };
  const doneSet  = new Set(progress.done);
  let   allCards = progress.cards;

  // Always merge with existing cards.json so multiple --expansion runs accumulate.
  // (--resume already loads cards from progress file; this handles the non-resume case)
  if (!ARG_RESUME && fs.existsSync(OUT_FULL)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT_FULL, "utf-8"));
      if (Array.isArray(existing) && existing.length > 0) {
        allCards = existing;
        console.log(`Loaded ${existing.length} existing cards from ${OUT_FULL}`);
      }
    } catch (err) {
      console.warn(`Could not read existing cards.json: ${err.message}`);
    }
  }

  // Determine which expansions to scrape
  let expansions;
  if (ARG_EXP) {
    expansions = [Number(ARG_EXP)];
    console.log(`Mode: single expansion ${ARG_EXP}`);
  } else {
    expansions = await fetchExpansionList();
    console.log(`Found ${expansions.length} expansions: ${expansions.slice(0, 5).join(", ")}...`);
    await sleep(DELAY_MS);
  }

  // Track cards we've already seen (by enCardNo) to avoid duplicates
  const seenCardNos = new Set(allCards.map((c) => c.enCardNo));
  let totalNew = 0;

  for (const expId of expansions) {
    if (doneSet.has(expId) && ARG_RESUME) {
      console.log(`⏭  Expansion ${expId} — already done, skipping`);
      continue;
    }

    console.log(`\n▶  Expansion ${expId}`);

    // 1. Gallery: get list of cards in this expansion
    const galleryCards = await scrapeGallery(expId);
    if (galleryCards.length === 0) {
      console.log(`  (no cards found)`);
      doneSet.add(expId);
      continue;
    }
    console.log(`  ${galleryCards.length} cards in gallery`);

    // 2. Detail: fetch detail page for each card not yet seen
    let newInExp = 0;
    for (let i = 0; i < galleryCards.length; i++) {
      const gCard = galleryCards[i];

      if (seenCardNos.has(gCard.enCardNo)) {
        process.stdout.write(`  [${i + 1}/${galleryCards.length}] ${gCard.enCardNo} — already in DB, skip\r`);
        continue;
      }

      process.stdout.write(`  [${i + 1}/${galleryCards.length}] Scraping ${gCard.enCardNo}...          \r`);

      const detail = await scrapeDetail(gCard.enCardNo);
      await sleep(DELAY_MS);

      const card = buildCardEntry(gCard, detail);
      allCards.push(card);
      seenCardNos.add(gCard.enCardNo);
      newInExp++;
      totalNew++;

      // Auto-save progress every 50 cards
      if (totalNew % 50 === 0) {
        saveProgress({ done: [...doneSet], cards: allCards });
        process.stdout.write("\n  [progress saved]\n");
      }
    }

    process.stdout.write("\n");
    console.log(`  ✓ ${newInExp} new cards added from expansion ${expId}`);

    doneSet.add(expId);
    progress.done = [...doneSet];
    progress.cards = allCards;
    saveProgress(progress);

    await sleep(DELAY_MS * 2);
  }

  // Sort by setCode then cardNumber
  allCards.sort((a, b) => {
    const sc = a.setCode.localeCompare(b.setCode);
    if (sc !== 0) return sc;
    return (a.cardNumber ?? "").localeCompare(b.cardNumber ?? "", undefined, { numeric: true });
  });

  // Write outputs
  fs.writeFileSync(OUT_FULL, JSON.stringify(allCards, null, 2));

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`✅  Done. ${allCards.length} total cards.`);
  console.log(`   cards.json : ${OUT_FULL} (${(fs.statSync(OUT_FULL).size / 1024).toFixed(0)} KB)`);
  console.log("═══════════════════════════════════════════════════");

  // Clean up progress file on full success
  if (!ARG_EXP && fs.existsSync(RESUME_FILE)) {
    fs.unlinkSync(RESUME_FILE);
  }
}

// ── Entry point ──────────────────────────────────────────────────────────────

if (ARG_RETRY_FAILED) {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Vanguard EN Database Builder — retry-failed mode");
  console.log("═══════════════════════════════════════════════════");
  retryFailed().catch((err) => {
    console.error("\n💥 Fatal error:", err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error("\n💥 Fatal error:", err);
    process.exit(1);
  });
}
