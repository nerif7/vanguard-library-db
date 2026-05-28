#!/usr/bin/env node
/**
 * scrape_jp.js — Vanguard JP card database builder
 *
 * Single source of truth: cf-vanguard.com only (JP official site).
 * Zero external NPM packages — stdlib https/fs only.
 *
 * Two scrape paths:
 *   1. Expansion galleries  → /cardlist/cardsearch/?expansion=N&page=P
 *   2. PR/stamped promos    → /cardlist/card-pr?page=P  (table format)
 *
 * For every discovered card: fetch detail page /cardlist/?cardno=XXXX
 * for unitType, nations[], clan[], grade, trigger, rarity, imageUrlJp.
 *
 * Output:
 *   cards_jp.json      — full JP card database (all fields)
 *
 * Usage:
 *   node scrape_jp.js                          # scrape all expansions + PR table
 *   node scrape_jp.js --expansion 295          # single expansion (for testing)
 *   node scrape_jp.js --pr-only                # only scrape card-pr table
 *   node scrape_jp.js --resume                 # continue interrupted scrape
 *   node scrape_jp.js --retry-failed           # re-fetch cards with empty fields
 *   node scrape_jp.js --delay 400              # ms between requests (default 350)
 */

const fs    = require("fs");
const path  = require("path");
const https = require("https");
const http  = require("http");

// ── Config ────────────────────────────────────────────────────────────────────

const BASE_URL   = "https://cf-vanguard.com";
const OUT_FULL   = path.join(__dirname, "cards_jp.json");
const RESUME_FILE = path.join(__dirname, ".scrape_jp_progress.json");

const args             = process.argv.slice(2);
const ARG_EXP          = getArg("--expansion");
const ARG_PR_ONLY      = args.includes("--pr-only");
const ARG_RESUME       = args.includes("--resume");
const ARG_RETRY_FAILED = args.includes("--retry-failed");
const DELAY_MS         = Number(getArg("--delay") ?? 350);

function getArg(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

// ── JP trigger keywords (matched against div.gift text) ───────────────────────

// Stored as-is in Japanese — not normalized to English.
const JP_TRIGGER_KEYWORDS = [
  "ヒールトリガー",
  "クリティカルトリガー",
  "ドロートリガー",
  "フロントトリガー",
  "オーバートリガー",
  "センチネル",
];

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
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = res.headers.location.startsWith("http")
            ? res.headers.location
            : BASE_URL + res.headers.location;
          res.resume();
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

function between(html, open, close, fromIndex = 0) {
  const start = html.indexOf(open, fromIndex);
  if (start === -1) return null;
  const end = html.indexOf(close, start + open.length);
  if (end === -1) return null;
  return html.slice(start + open.length, end);
}

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

function stripTags(html) {
  return html.replace(/<[^>]*>/g, "").trim();
}

// ── Gallery parser ────────────────────────────────────────────────────────────

/**
 * Parse JP gallery page HTML.
 * Returns array of { jpCardNo, nameJp, imageUrlJp }
 *
 * JP gallery structure (plain li, no ex-item class):
 *   <li>
 *     <a href="/cardlist/?cardno=DZ-SS16/001&expansion=295&view=image">
 *       <img src="/wordpress/wp-content/images/cardlist/DZ-SS16/dzss16_001.png"
 *            class="object-fit-img"
 *            alt="ドラグリッター ラティーファ"
 *            title="ドラグリッター ラティーファ">
 *     </a>
 *   </li>
 */
function parseGalleryHtml(html) {
  const cards = [];
  const seenCardNos = new Set();

  // Match all <li> items that contain a cardno href
  const liMatches = html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi);

  for (const m of liMatches) {
    const item = m[1];
    if (!item.includes("cardno=")) continue;

    const aTag   = between(item, "<a", ">");
    const href   = aTag ? attr(aTag, "href") : null;
    const imgTag = between(item, "<img", ">");
    const src    = imgTag ? (attr(imgTag, "src") ?? "") : "";
    const title  = imgTag ? (attr(imgTag, "title") ?? attr(imgTag, "alt") ?? "") : "";

    if (!href || !src) continue;

    const cardnoMatch = href.match(/[?&]cardno=([^&]+)/);
    if (!cardnoMatch) continue;
    const jpCardNo = decodeURIComponent(cardnoMatch[1]);

    if (seenCardNos.has(jpCardNo)) continue;
    seenCardNos.add(jpCardNo);

    const imageUrlJp = src.startsWith("http") ? src : BASE_URL + src;

    cards.push({ jpCardNo, nameJp: title, imageUrlJp });
  }

  return cards;
}

// ── PR table parser ───────────────────────────────────────────────────────────

/**
 * Parse /cardlist/card-pr table page.
 * Returns array of { jpCardNo, nameJp }  (no imageUrlJp — derive later)
 *
 * Table row format:
 *   <tr class="card_pr*">
 *     <td>D-PR/1681</td>                      ← may have <br> inside: "D<br/>-PR/1681"
 *     <td><a href="/cardlist/?cardno=...">カード名</a></td>
 *     ...
 *   </tr>
 */
function parsePrTableHtml(html) {
  const cards = [];

  const trMatches = html.matchAll(/<tr[^>]*class="card_pr[^"]*"[^>]*>([\s\S]*?)<\/tr>/gi);

  for (const m of trMatches) {
    const row = m[1];

    // Extract cells
    const tds = allBetween(row, "<td", "</td>").map((td) => {
      const inner = td.replace(/^[^>]*>/, ""); // strip opening tag attrs
      return stripTags(inner).replace(/\s+/g, " ").trim();
    });

    if (tds.length < 2) continue;

    // First <td> is the card number — strip any injected whitespace
    const jpCardNo = tds[0].replace(/\s+/g, "");
    if (!jpCardNo || !jpCardNo.includes("/")) continue;

    // Second <td> has the card name in an anchor (strip any <span class="new"> etc.)
    const aContent = between(row, "<a", "</a>");
    if (!aContent) continue;
    const nameJp = stripTags(aContent.replace(/^[^>]*>/, "")).trim();
    if (!nameJp) continue;

    cards.push({ jpCardNo, nameJp, imageUrlJp: null });
  }

  return cards;
}

// ── Detail page parser ────────────────────────────────────────────────────────

/**
 * Parse JP detail page HTML.
 *
 * JP site uses the same CSS classes as EN:
 *   div.type        → unitType  (ノーマルユニット, Gユニット, トリガーユニット, ...)
 *   div.nation      → nation    (ドラゴンエンパイア, ...)  or "-"
 *   div.group       → clan      (Gユニットのクラン名, old era)
 *   div.race        → race
 *   div.grade       → "グレード N"
 *   div.rarity      → rarity code
 *   div.gift        → trigger info ("ヒールトリガー＋10000") or "-"
 *   span.face       → card name (JP name)
 *   div.image img   → imageUrlJp
 *
 * unitType normalization (parallel to EN):
 *   "トリガーユニット" → "ノーマルユニット"
 *
 * Returns { nameJp, unitType, nations[], clan[], races[], grade, trigger, rarity, imageUrlJp }
 */
function parseDetailHtml(html, jpCardNo) {
  const result = {
    nameJp:    null,
    unitType:  null,
    nations:   [],
    clan:      [],
    races:     [],
    grade:     null,
    trigger:   null,
    rarity:    null,
    imageUrlJp: null,
  };

  // ── Name from span.face ────────────────────────────────────────────────────
  const faceMatch = html.match(/<span class="face">([^<]+)<\/span>/);
  if (faceMatch) {
    result.nameJp = decodeHtmlEntities(faceMatch[1].trim());
  }

  // Fallback: name from <title> (before first ｜)
  if (!result.nameJp) {
    const titleTag = between(html, "<title>", "</title>");
    if (titleTag) {
      const namePart = decodeHtmlEntities(titleTag.split("｜")[0].trim());
      if (namePart.length > 0) result.nameJp = namePart;
    }
  }

  // ── Image URL from div.image div.main img ─────────────────────────────────
  const imageSection = between(html, '<div class="image">', '</div>');
  if (imageSection) {
    const imgTag = between(imageSection, "<img", ">");
    if (imgTag) {
      const src = attr(imgTag, "src");
      if (src) result.imageUrlJp = src.startsWith("http") ? src : BASE_URL + src;
    }
  }

  // ── Class-based extraction helper ─────────────────────────────────────────
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
    if (raw === "トリガーユニット") raw = "ノーマルユニット";
    result.unitType = raw;
  }

  // ── nations (div.nation) ──────────────────────────────────────────────────
  const nationDivs = extractByClass("nation");
  for (const n of nationDivs) {
    if (n === "" || /^[\-\‐\–\—\−]+$/.test(n)) continue;
    if (!result.nations.includes(n)) result.nations.push(n);
  }

  // ── clan (div.group) and races (div.race) ─────────────────────────────────
  // JP site: div.group = clan (same as EN)
  // div.race = race (no BanG Dream edge case on JP — band names don't appear in JP as clan via race)
  const groupDivs = extractByClass("group");
  for (const g of groupDivs) {
    if (g === "-" || g === "") continue;
    if (result.nations.includes(g)) continue; // skip nation duplicates (G era)
    if (!result.clan.includes(g)) result.clan.push(g);
  }

  const raceDivs = extractByClass("race");
  for (const r of raceDivs) {
    if (r === "-" || r === "") continue;
    if (!result.races.includes(r)) result.races.push(r);
  }

  // ── grade (div.grade) ─────────────────────────────────────────────────────
  const grades = extractByClass("grade");
  if (grades.length > 0) {
    const gm = grades[0].match(/グレード\s*(\d+)/);
    if (gm) result.grade = parseInt(gm[1], 10);
  }

  // ── rarity (div.rarity) ───────────────────────────────────────────────────
  const rarities = extractByClass("rarity");
  if (rarities.length > 0) result.rarity = rarities[0];

  // ── trigger (div.gift) ────────────────────────────────────────────────────
  const gifts = extractByClass("gift");
  if (gifts.length > 0 && gifts[0] !== "-") {
    for (const kw of JP_TRIGGER_KEYWORDS) {
      if (gifts[0].includes(kw)) {
        result.trigger = kw;
        break;
      }
    }
    // Fallback: scan full body for trigger keywords
    if (!result.trigger) {
      const fullText = stripTags(html);
      for (const kw of JP_TRIGGER_KEYWORDS) {
        if (fullText.includes(kw)) {
          result.trigger = kw;
          break;
        }
      }
    }
  }

  // ── Post-parse fallbacks ──────────────────────────────────────────────────
  if (!result.unitType) {
    if (result.trigger)                                     result.unitType = "ノーマルユニット";
    else if ((jpCardNo ?? "").match(/\/T\d+[A-Z]*$/i))    result.unitType = "トークン";
    else if (result.grade !== null)                        result.unitType = "ノーマルユニット";
  }

  // races[] only applies to Normal Unit and G Unit — clear for orders/tokens/etc.
  const isUnitCard = result.unitType === "ノーマルユニット" || result.unitType === "Gユニット";
  if (!isUnitCard) {
    result.races = [];
  }

  return result;
}

// ── Derive imageUrlJp from jpCardNo (formula fallback) ───────────────────────

/**
 * Construct JP CDN image URL from card number.
 *
 * Standard sets:
 *   DZ-SS16/001  → .../cardlist/DZ-SS16/dzss16_001.png
 *   G-BT01/001   → .../cardlist/G-BT01/gbt01_001.png
 *   D-PR/1681    → .../cardlist/D-PR/dpr_1681.png
 *
 * Folder uses original setCode with hyphens (uppercase).
 * File prefix is setCode lowercased with hyphens removed.
 *
 * NOTE: Stamped promo copies (G-TCB01/026 PR) use a different
 * non-standard path — always prefer URL from detail page HTML.
 */
function deriveImageUrlJp(jpCardNo) {
  if (!jpCardNo) return null;

  // Strip trailing " PR" or "_N" copy suffix from the cardNo portion
  const cleaned = jpCardNo.replace(/\s+PR$/i, "").replace(/_\d+$/, "");

  const match = cleaned.match(/^([A-Z0-9-]+)\/([A-Z]*)(\d+)/i);
  if (!match) return null;

  const [, prefix, letterPfx, numStr] = match;
  const folder     = prefix;                              // DZ-SS16 (original case)
  const folderLow  = prefix.replace(/-/g, "").toLowerCase(); // dzss16
  const fileNum    = letterPfx
    ? `${letterPfx.toLowerCase()}${numStr}`
    : numStr.padStart(Math.max(3, numStr.length), "0");

  return `${BASE_URL}/wordpress/wp-content/images/cardlist/${folder}/${folderLow}_${fileNum}.png`;
}

// ── Expansion list fetcher ────────────────────────────────────────────────────

/**
 * Fetch expansion IDs from the JP card list page.
 * JP site has no <select name="expansion"> — extract from href patterns.
 * Returns sorted array of numeric expansion IDs.
 */
async function fetchExpansionList() {
  console.log("Fetching expansion list...");
  const html = await fetchUrl(`${BASE_URL}/cardlist/`);

  const ids = new Set();
  const hrefMatches = html.matchAll(/expansion=(\d+)/g);
  for (const m of hrefMatches) ids.add(Number(m[1]));

  const maxKnown = ids.size > 0 ? Math.max(...ids) : 200;
  console.log(`  Found ${ids.size} expansion IDs in navigation (max=${maxKnown})`);

  // Probe IDs above the known max — the site navigation may not list recent expansions.
  // Stop after 5 consecutive empty galleries or 50 probes, whichever comes first.
  let consecutiveEmpty = 0;
  for (let id = maxKnown + 1; consecutiveEmpty < 5 && id <= maxKnown + 50; id++) {
    const url = `${BASE_URL}/cardlist/cardsearch/?expansion=${id}&page=1`;
    try {
      const testHtml = await fetchUrl(url);
      const cards = parseGalleryHtml(testHtml);
      if (cards.length > 0) {
        ids.add(id);
        consecutiveEmpty = 0;
        console.log(`  Probed expansion ${id}: ${cards.length} cards`);
      } else {
        consecutiveEmpty++;
      }
    } catch {
      consecutiveEmpty++;
    }
    await sleep(DELAY_MS);
  }

  const sorted = [...ids].sort((a, b) => a - b);
  console.log(`  Total after probing: ${sorted.length} expansions (max=${sorted[sorted.length - 1] ?? 0})`);
  return sorted;
}

// ── Gallery scraper ───────────────────────────────────────────────────────────

async function scrapeGallery(expansionId) {
  const cards = [];
  let   page  = 1;

  while (true) {
    const url = `${BASE_URL}/cardlist/cardsearch/?expansion=${expansionId}&page=${page}`;
    let html;
    try {
      html = await fetchUrl(url);
    } catch (err) {
      console.warn(`  [gallery] HTTP error page ${page}: ${err.message}`);
      break;
    }

    const parsed = parseGalleryHtml(html);
    if (parsed.length === 0) break;

    cards.push(...parsed);
    process.stdout.write(`  [gallery] exp=${expansionId} page=${page} (+${parsed.length} cards, total=${cards.length})\r`);
    page++;
    await sleep(DELAY_MS);
  }

  process.stdout.write("\n");
  return cards;
}

// ── PR table scraper ──────────────────────────────────────────────────────────

/**
 * Scrape /cardlist/card-pr table.
 * Reads last page from pagination on page 1, then iterates.
 * Only returns cards NOT already in seenCardNos (avoids redundant detail fetches
 * for cards already picked up via yearly expansion galleries).
 */
async function scrapePrTable(seenCardNos) {
  const cards = [];

  // Get last page number from page 1
  let lastPage = 1;
  try {
    const page1Html = await fetchUrl(`${BASE_URL}/cardlist/card-pr`);
    const pageLinks = page1Html.matchAll(/card-pr\?page=(\d+)/g);
    for (const m of pageLinks) {
      const n = Number(m[1]);
      if (n > lastPage) lastPage = n;
    }
    // Parse page 1 cards
    const parsed = parsePrTableHtml(page1Html);
    for (const c of parsed) {
      if (!seenCardNos.has(c.jpCardNo)) {
        cards.push(c);
        seenCardNos.add(c.jpCardNo);
      }
    }
    process.stdout.write(`  [card-pr] page=1 last=${lastPage} (+${cards.length} new)\r`);
    await sleep(DELAY_MS);
  } catch (err) {
    console.warn(`  [card-pr] Failed to fetch page 1: ${err.message}`);
    return cards;
  }

  for (let page = 2; page <= lastPage; page++) {
    let html;
    try {
      html = await fetchUrl(`${BASE_URL}/cardlist/card-pr?page=${page}`);
    } catch (err) {
      console.warn(`  [card-pr] HTTP error page ${page}: ${err.message}`);
      break;
    }

    const parsed = parsePrTableHtml(html);
    if (parsed.length === 0) break;

    let newCount = 0;
    for (const c of parsed) {
      if (!seenCardNos.has(c.jpCardNo)) {
        cards.push(c);
        seenCardNos.add(c.jpCardNo);
        newCount++;
      }
    }

    process.stdout.write(`  [card-pr] page=${page}/${lastPage} (+${newCount} new, pr-total=${cards.length})\r`);
    await sleep(DELAY_MS);
  }

  process.stdout.write("\n");
  return cards;
}

// ── Detail scraper ────────────────────────────────────────────────────────────

async function scrapeDetail(jpCardNo) {
  const url = `${BASE_URL}/cardlist/?cardno=${encodeURIComponent(jpCardNo)}`;
  let html;
  try {
    html = await fetchUrl(url);
  } catch (err) {
    console.warn(`  [detail] Failed ${jpCardNo}: ${err.message}`);
    return null;
  }
  return parseDetailHtml(html, jpCardNo);
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

// ── Parse setCode + cardNumber from jpCardNo ─────────────────────────────────

/**
 * Parse setCode and cardNumber from a JP card number.
 *
 * Examples:
 *   DZ-SS16/001      → setCode="DZ-SS16", cardNumber="001"
 *   D-PR/1681        → setCode="D-PR",    cardNumber="1681"
 *   G-BT01/EX01      → setCode="G-BT01",  cardNumber="EX01"
 *   G-TCB01/026 PR   → setCode="G-TCB01", cardNumber="026"
 *   PR/0054          → setCode="PR",       cardNumber="0054"
 *   V-PR/0260        → setCode="V-PR",     cardNumber="0260"
 */
function parseCardCodeJp(jpCardNo) {
  if (!jpCardNo || typeof jpCardNo !== "string") {
    return { setCode: "", cardNumber: "" };
  }

  const normalized = jpCardNo.trim();
  const parts = normalized.split("/");
  if (parts.length < 2) return { setCode: normalized, cardNumber: "" };

  const setCode = parts[0];
  let cardId    = parts.slice(1).join("/"); // rejoin in case of extra slashes

  // Strip trailing " PR" (stamped promo suffix) and "_N" (copy index)
  cardId = cardId.replace(/\s+PR$/i, "").replace(/_\d+$/, "");

  // Extract first alphanumeric sequence as cardNumber
  const numMatch = cardId.match(/^([A-Z]*\d+)/i);
  const cardNumber = numMatch ? numMatch[1] : "";

  return { setCode, cardNumber };
}

// ── Build final card entry ────────────────────────────────────────────────────

function buildCardEntry(galleryCard, detail) {
  const jpCardNo    = galleryCard.jpCardNo;
  const imageUrlJp  = detail?.imageUrlJp ?? galleryCard.imageUrlJp ?? deriveImageUrlJp(jpCardNo);
  const nameJp      = detail?.nameJp ?? galleryCard.nameJp;

  const { setCode, cardNumber } = parseCardCodeJp(jpCardNo);

  return {
    jpCardNo,
    setCode,
    cardNumber,
    nameJp,
    unitType: detail?.unitType  ?? null,
    nations:  detail?.nations?.length ? detail.nations : [],
    clan:     detail?.clan?.length    ? detail.clan    : [],
    races:    detail?.races?.length   ? detail.races   : [],
    grade:    detail?.grade    ?? null,
    trigger:  detail?.trigger  ?? null,
    rarity:   detail?.rarity   ?? null,
    imageUrlJp,
  };
}

// ── Identify failed cards ─────────────────────────────────────────────────────

function identifyFailedCards(cards) {
  return cards.filter((c) => {
    const isToken = (c.jpCardNo ?? "").match(/\/T\d+[A-Z]*$/i);
    if (isToken) return false;

    // Nationless triggers: valid — grade=0, nations empty, trigger set
    const isNationlessTrigger = c.trigger !== null
      && c.grade === 0
      && (c.nations ?? []).length === 0;
    if (isNationlessTrigger) return false;

    return (c.nations ?? []).length === 0 || !c.unitType;
  });
}

// ── Retry failed cards ────────────────────────────────────────────────────────

async function retryFailed() {
  if (!fs.existsSync(OUT_FULL)) {
    console.error("cards_jp.json not found — run a full scrape first.");
    process.exit(1);
  }

  const allCards  = JSON.parse(fs.readFileSync(OUT_FULL, "utf-8"));
  const failed    = identifyFailedCards(allCards);
  const cardIndex = new Map(allCards.map((c, i) => [c.jpCardNo, i]));

  console.log(`Found ${failed.length} cards to retry out of ${allCards.length} total.`);
  if (failed.length === 0) {
    console.log("Nothing to retry. ✅");
    return;
  }

  const prefixCounts = {};
  for (const c of failed) {
    const pfx = (c.jpCardNo ?? "").split("/")[0] || "?";
    prefixCounts[pfx] = (prefixCounts[pfx] || 0) + 1;
  }
  console.log("  By setCode:", Object.entries(prefixCounts).map(([k, v]) => `${k}(${v})`).join(", "));
  console.log(`  Delay: ${DELAY_MS}ms per request\n`);

  let fixed      = 0;
  let stillFailed = 0;

  const saveCurrent = () => {
    const sorted = [...allCards].sort((a, b) => {
      const sc = (a.setCode ?? "").localeCompare(b.setCode ?? "");
      if (sc !== 0) return sc;
      return (a.cardNumber ?? "").localeCompare(b.cardNumber ?? "", undefined, { numeric: true });
    });
    fs.writeFileSync(OUT_FULL, JSON.stringify(sorted, null, 2));
  };

  const onInterrupt = () => {
    process.stdout.write("\n  [interrupted — saving progress...]\n");
    saveCurrent();
    console.log(`  Saved ${fixed} fixes so far.`);
    process.exit(0);
  };
  process.on("SIGINT", onInterrupt);

  for (let i = 0; i < failed.length; i++) {
    const card = failed[i];
    process.stdout.write(`  [${i + 1}/${failed.length}] Retrying ${card.jpCardNo}...          \r`);

    const detail = await scrapeDetail(card.jpCardNo);
    await sleep(DELAY_MS);

    if (!detail) { stillFailed++; continue; }

    const galleryData = { jpCardNo: card.jpCardNo, nameJp: card.nameJp, imageUrlJp: card.imageUrlJp };
    const updated     = buildCardEntry(galleryData, detail);

    const gotBetter = (updated.nations?.length > 0) || updated.unitType || updated.grade !== null;
    if (gotBetter) {
      const idx = cardIndex.get(card.jpCardNo);
      if (idx !== undefined) { allCards[idx] = updated; fixed++; }
    } else {
      stillFailed++;
    }

    if ((i + 1) % 50 === 0) {
      saveCurrent();
      process.stdout.write(`\n  [progress saved — ${fixed} fixed so far]\n`);
    }
  }

  process.stdout.write("\n");
  process.off("SIGINT", onInterrupt);
  saveCurrent();

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`✅  Retry complete.`);
  console.log(`   Fixed        : ${fixed}`);
  console.log(`   Still failed : ${stillFailed}`);
  console.log(`   cards_jp.json: ${OUT_FULL} (${(fs.statSync(OUT_FULL).size / 1024).toFixed(0)} KB)`);
  console.log("═══════════════════════════════════════════════════");
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Vanguard JP Database Builder — scrape_jp.js");
  console.log("═══════════════════════════════════════════════════");

  const progress = ARG_RESUME ? loadProgress() : { done: [], cards: [] };
  const doneSet  = new Set(progress.done);
  let   allCards = progress.cards;

  // Merge with existing cards_jp.json so multiple --expansion runs accumulate
  if (!ARG_RESUME && fs.existsSync(OUT_FULL)) {
    try {
      const existing = JSON.parse(fs.readFileSync(OUT_FULL, "utf-8"));
      if (Array.isArray(existing) && existing.length > 0) {
        allCards = existing;
        console.log(`Loaded ${existing.length} existing cards from ${OUT_FULL}`);
      }
    } catch (err) {
      console.warn(`Could not read existing cards_jp.json: ${err.message}`);
    }
  }

  const seenCardNos = new Set(allCards.map((c) => c.jpCardNo));
  let totalNew = 0;

  // ── Phase 1: Expansion galleries ─────────────────────────────────────────

  if (!ARG_PR_ONLY) {
    let expansions;
    if (ARG_EXP) {
      expansions = [Number(ARG_EXP)];
      console.log(`Mode: single expansion ${ARG_EXP}`);
    } else {
      expansions = await fetchExpansionList();
      console.log(`Found ${expansions.length} expansion IDs: ${expansions.slice(0, 8).join(", ")}...`);
      await sleep(DELAY_MS);
    }

    for (const expId of expansions) {
      if (doneSet.has(`exp:${expId}`) && ARG_RESUME) {
        console.log(`⏭  Expansion ${expId} — already done, skipping`);
        continue;
      }

      console.log(`\n▶  Expansion ${expId}`);

      const galleryCards = await scrapeGallery(expId);
      if (galleryCards.length === 0) {
        console.log(`  (no cards found)`);
        doneSet.add(`exp:${expId}`);
        continue;
      }
      console.log(`  ${galleryCards.length} cards in gallery`);

      let newInExp = 0;
      for (let i = 0; i < galleryCards.length; i++) {
        const gCard = galleryCards[i];

        if (seenCardNos.has(gCard.jpCardNo)) {
          process.stdout.write(`  [${i + 1}/${galleryCards.length}] ${gCard.jpCardNo} — already in DB, skip\r`);
          continue;
        }

        process.stdout.write(`  [${i + 1}/${galleryCards.length}] Scraping ${gCard.jpCardNo}...          \r`);

        const detail = await scrapeDetail(gCard.jpCardNo);
        await sleep(DELAY_MS);

        const card = buildCardEntry(gCard, detail);
        allCards.push(card);
        seenCardNos.add(gCard.jpCardNo);
        newInExp++;
        totalNew++;

        if (totalNew % 50 === 0) {
          saveProgress({ done: [...doneSet], cards: allCards });
          process.stdout.write("\n  [progress saved]\n");
        }
      }

      process.stdout.write("\n");
      console.log(`  ✓ ${newInExp} new cards added from expansion ${expId}`);

      doneSet.add(`exp:${expId}`);
      saveProgress({ done: [...doneSet], cards: allCards });

      await sleep(DELAY_MS * 2);
    }
  }

  // ── Phase 2: PR table (stamped promos + any missed PR cards) ─────────────

  if (!ARG_EXP) {
    console.log("\n▶  PR/promo table (/cardlist/card-pr)");
    const prCards = await scrapePrTable(seenCardNos);
    console.log(`  ${prCards.length} new cards from card-pr table`);

    let prNew = 0;
    for (let i = 0; i < prCards.length; i++) {
      const gCard = prCards[i];

      process.stdout.write(`  [${i + 1}/${prCards.length}] Scraping ${gCard.jpCardNo}...          \r`);

      const detail = await scrapeDetail(gCard.jpCardNo);
      await sleep(DELAY_MS);

      const card = buildCardEntry(gCard, detail);
      allCards.push(card);
      prNew++;
      totalNew++;

      if (totalNew % 50 === 0) {
        saveProgress({ done: [...doneSet], cards: allCards });
        process.stdout.write("\n  [progress saved]\n");
      }
    }

    process.stdout.write("\n");
    console.log(`  ✓ ${prNew} new PR/promo cards added`);
    saveProgress({ done: [...doneSet], cards: allCards });
  }

  // ── Sort and write ────────────────────────────────────────────────────────

  allCards.sort((a, b) => {
    const sc = (a.setCode ?? "").localeCompare(b.setCode ?? "");
    if (sc !== 0) return sc;
    return (a.cardNumber ?? "").localeCompare(b.cardNumber ?? "", undefined, { numeric: true });
  });

  fs.writeFileSync(OUT_FULL, JSON.stringify(allCards, null, 2));

  console.log("\n═══════════════════════════════════════════════════");
  console.log(`✅  Done. ${allCards.length} total cards (+${totalNew} new this run).`);
  console.log(`   cards_jp.json: ${OUT_FULL} (${(fs.statSync(OUT_FULL).size / 1024).toFixed(0)} KB)`);
  console.log("═══════════════════════════════════════════════════");

  if (!ARG_EXP && !ARG_PR_ONLY && fs.existsSync(RESUME_FILE)) {
    fs.unlinkSync(RESUME_FILE);
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────

if (ARG_RETRY_FAILED) {
  console.log("═══════════════════════════════════════════════════");
  console.log("  Vanguard JP Database Builder — retry-failed mode");
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
