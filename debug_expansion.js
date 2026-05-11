#!/usr/bin/env node
/**
 * debug_expansion.js — Investigate apa isi gallery expansion=41
 *
 * Usage:
 *   node debug_expansion.js 41
 */

const https = require("https");

const expansionId = process.argv[2] || "41";
const url = `https://en.cf-vanguard.com/cardlist/cardsearch_ex/?expansion=${expansionId}&view=image&page=1`;

console.log(`\nFetching: ${url}\n`);

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    https.get(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 vanguard-library-db/2.0",
        "Accept": "text/html",
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        console.log(`Redirect ${res.statusCode} → ${res.headers.location}`);
        const newUrl = res.headers.location.startsWith("http")
          ? res.headers.location
          : "https://en.cf-vanguard.com" + res.headers.location;
        return fetchUrl(newUrl).then(resolve).catch(reject);
      }
      console.log(`Status: ${res.statusCode}`);
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    }).on("error", reject);
  });
}

(async () => {
  const html = await fetchUrl(url);

  // 1. Count ex-items
  const exItems = html.match(/<li class="ex-item">/g) || [];
  console.log(`\n1. <li class="ex-item"> count: ${exItems.length}`);

  // 2. Count cardno occurrences and group by setCode
  const allMatches = [...html.matchAll(/cardno=([A-Z0-9-]+)(?:%2F|\/)([A-Z0-9-]+)/g)];
  const setCodeCounts = {};
  const exampleCodes = {};
  for (const m of allMatches) {
    const sc = m[1];
    const num = m[2];
    setCodeCounts[sc] = (setCodeCounts[sc] || 0) + 1;
    if (!exampleCodes[sc]) exampleCodes[sc] = `${sc}/${num}`;
  }

  console.log(`\n2. setCode frequency in cardno links:`);
  const sorted = Object.entries(setCodeCounts).sort((a, b) => b[1] - a[1]);
  for (const [sc, count] of sorted) {
    console.log(`   ${sc.padEnd(15)} → ${count} occurrences  (e.g. ${exampleCodes[sc]})`);
  }

  // 3. Extract ex-item blocks and see what cardno they reference
  console.log(`\n3. First 5 ex-item links:`);
  const exItemMatches = [...html.matchAll(/<li class="ex-item">[\s\S]*?<\/li>/g)];
  for (let i = 0; i < Math.min(5, exItemMatches.length); i++) {
    const block = exItemMatches[i][0];
    const cardno = block.match(/cardno=([^"&]+)/);
    const title = block.match(/title="([^"]+)"|alt="([^"]+)"/);
    console.log(`   [${i + 1}] ${cardno ? decodeURIComponent(cardno[1]) : "(no cardno)"} — ${title ? (title[1] || title[2]) : "(no title)"}`);
  }

  // 4. Check page title to confirm
  const pageTitle = html.match(/<title>([^<]+)<\/title>/);
  console.log(`\n4. Page title: ${pageTitle ? pageTitle[1] : "(none)"}`);

  // 5. Check if there's an expansion name/header in page
  const expansionName = html.match(/<h2[^>]*>([^<]+)<\/h2>/);
  console.log(`\n5. First <h2>: ${expansionName ? expansionName[1] : "(none)"}`);
})();
