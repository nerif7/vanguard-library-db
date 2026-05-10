/**
 * Vanguard Library DB Viewer
 *
 * Load cards.json from GitHub raw URL, browse + filter + show stats.
 * Uses virtualized rendering for 24k+ rows.
 */

const DB_URL     = "https://raw.githubusercontent.com/nerif7/vanguard-library-db/main/cards.json";
const COMMIT_API = "https://api.github.com/repos/nerif7/vanguard-library-db/commits?path=cards.json&per_page=1";

// ── State ─────────────────────────────────────────────────────────────────────

let allCards = [];
let visibleCards = [];
let selectedId = null;
let searchDebounce = null;

// ── DOM ───────────────────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const totalCardsEl  = $("#totalCards");
const lastUpdateEl  = $("#lastUpdate");
const loadingEl     = $("#loading");
const loadingHintEl = $("#loadingHint");

const searchInput     = $("#searchInput");
const setFilter       = $("#setFilter");
const nationFilter    = $("#nationFilter");
const unitTypeFilter  = $("#unitTypeFilter");
const triggerFilter   = $("#triggerFilter");
const resultCountEl   = $("#resultCount");

const cardList        = $("#cardList");
const cardPreview     = $("#cardPreview");

const statsTotal      = $("#statsTotal");
const statsSetCount   = $("#statsSetCount");
const statsGrid       = $("#statsGrid");

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  setupTabs();
  setupFilters();
  setupScrollVirtualization();

  // Kick off parallel fetches
  const [dbResult, commitResult] = await Promise.allSettled([
    loadDatabase(),
    loadLastCommit(),
  ]);

  if (dbResult.status === "rejected") {
    loadingHintEl.textContent = "❌ Gagal memuat cards.json. Cek koneksi & coba reload.";
    console.error("DB load failed:", dbResult.reason);
    return;
  }

  // Render initial state
  populateFilters();
  applyFilters();
  renderStats();

  loadingEl.classList.add("hidden");
}

async function loadDatabase() {
  loadingHintEl.textContent = "Fetching cards.json (~10 MB)...";
  const res = await fetch(DB_URL, { cache: "default" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  loadingHintEl.textContent = "Parsing JSON...";
  allCards = await res.json();

  totalCardsEl.textContent = allCards.length.toLocaleString("id-ID");
}

async function loadLastCommit() {
  try {
    const res = await fetch(COMMIT_API, { headers: { Accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && data[0]?.commit?.committer?.date) {
      const date = new Date(data[0].commit.committer.date);
      lastUpdateEl.textContent = date.toLocaleDateString("id-ID", {
        year: "numeric", month: "short", day: "numeric"
      });
      lastUpdateEl.title = date.toLocaleString();
    }
  } catch (err) {
    lastUpdateEl.textContent = "—";
    console.warn("Couldn't fetch last commit:", err);
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".tab-panel").forEach((p) => {
        p.classList.toggle("active", p.dataset.panel === target);
      });
    });
  });
}

// ── Filter dropdowns: populate with options from data ─────────────────────────

function populateFilters() {
  // Set codes — sort with normal/promo first, then by alphabet
  const sets = new Set();
  const nations = new Set();
  for (const c of allCards) {
    if (c.setCode) sets.add(c.setCode);
    if (Array.isArray(c.nations)) {
      for (const n of c.nations) nations.add(n);
    }
  }

  // Populate set filter
  const sortedSets = [...sets].sort();
  for (const s of sortedSets) {
    setFilter.append(opt(s, s));
  }

  // Populate nation filter
  const sortedNations = [...nations].sort();
  for (const n of sortedNations) {
    nationFilter.append(opt(n, n));
  }
}

function opt(value, label) {
  const o = document.createElement("option");
  o.value = value;
  o.textContent = label;
  return o;
}

// ── Filter handlers ───────────────────────────────────────────────────────────

function setupFilters() {
  searchInput.addEventListener("input", () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(applyFilters, 200);
  });
  setFilter.addEventListener("change", applyFilters);
  nationFilter.addEventListener("change", applyFilters);
  unitTypeFilter.addEventListener("change", applyFilters);
  triggerFilter.addEventListener("change", applyFilters);
}

function applyFilters() {
  const q       = searchInput.value.trim().toLowerCase();
  const set     = setFilter.value;
  const nation  = nationFilter.value;
  const ut      = unitTypeFilter.value;
  const trigger = triggerFilter.value;

  visibleCards = allCards.filter((card) => {
    if (set !== "all" && card.setCode !== set) return false;
    if (ut !== "all" && card.unitType !== ut)  return false;

    if (trigger !== "all") {
      if (trigger === "__none__") {
        if (card.trigger) return false;
      } else if (card.trigger !== trigger) return false;
    }

    if (nation !== "all") {
      const list = Array.isArray(card.nations) ? card.nations : [];
      if (!list.includes(nation)) return false;
    }

    if (q) {
      const haystack = [
        card.name,
        card.enCardNo,
        card.unitType,
        ...(card.races ?? []),
        ...(card.clan ?? []),
        ...(card.nations ?? []),
      ].join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }

    return true;
  });

  resultCountEl.textContent = `${visibleCards.length.toLocaleString("id-ID")} kartu`;
  renderList();
}

// ── Virtualization ────────────────────────────────────────────────────────────
// We render only the rows visible in the viewport (+ buffer).
// Fixed row height (62px) makes math simple.

const ROW_HEIGHT = 62;
const BUFFER     = 6;
let scrollTimer  = null;

function setupScrollVirtualization() {
  cardList.addEventListener("scroll", () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(renderList, 8);
  });
}

function renderList() {
  // Total height = number of rows × row height
  // We use absolute positioning inside a tall container
  const total       = visibleCards.length;
  const totalHeight = total * ROW_HEIGHT;

  // Get current scroll viewport
  const scrollTop = cardList.scrollTop;
  const viewport  = cardList.clientHeight || 600;

  const firstIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER);
  const lastIdx  = Math.min(total - 1, Math.ceil((scrollTop + viewport) / ROW_HEIGHT) + BUFFER);

  // Build inner HTML
  cardList.innerHTML = "";
  if (total === 0) {
    cardList.innerHTML = `<div style="padding:40px;text-align:center;color:var(--text-tertiary)">Tidak ada hasil</div>`;
    return;
  }

  // Spacer container
  const spacer = document.createElement("div");
  spacer.style.height = totalHeight + "px";
  spacer.style.position = "relative";

  for (let i = firstIdx; i <= lastIdx; i++) {
    const card = visibleCards[i];
    const row  = buildRow(card);
    row.style.position = "absolute";
    row.style.top = (i * ROW_HEIGHT) + "px";
    row.style.left = "0";
    row.style.right = "0";
    row.style.height = ROW_HEIGHT + "px";
    spacer.append(row);
  }

  cardList.append(spacer);
}

function buildRow(card) {
  const row = document.createElement("div");
  row.className = "card-row";
  if (selectedId === card.enCardNo) row.classList.add("selected");

  // Column 1: code
  const codeEl = document.createElement("div");
  codeEl.className = "card-row-code";
  codeEl.textContent = card.enCardNo ?? "—";

  // Column 2: name + meta
  const middle = document.createElement("div");
  const name = document.createElement("div");
  name.className = "card-row-name";
  name.textContent = card.name ?? "(no name)";

  const meta = document.createElement("div");
  meta.className = "card-row-meta";
  const metaParts = [];
  if (card.unitType)             metaParts.push(card.unitType);
  if (card.grade != null)        metaParts.push(`G${card.grade}`);
  if (card.trigger)              metaParts.push(card.trigger);
  if (Array.isArray(card.nations) && card.nations.length > 0) metaParts.push(card.nations.join("/"));
  meta.textContent = metaParts.join(" · ");

  middle.append(name, meta);

  // Column 3: rarity
  const rarity = document.createElement("span");
  rarity.className = "card-row-rarity";
  rarity.textContent = card.rarity ?? "—";

  row.append(codeEl, middle, rarity);

  row.addEventListener("click", () => {
    selectedId = card.enCardNo;
    // Remove .selected from all
    cardList.querySelectorAll(".card-row.selected").forEach((r) => r.classList.remove("selected"));
    row.classList.add("selected");
    renderPreview(card);
  });

  return row;
}

// ── Preview pane ──────────────────────────────────────────────────────────────

function renderPreview(card) {
  cardPreview.innerHTML = "";

  // Art
  const art = document.createElement("div");
  art.className = "preview-art";
  if (card.imageUrlEn) {
    const probe = new Image();
    probe.onload = () => {
      art.style.backgroundImage = `url("${card.imageUrlEn}")`;
      art.textContent = "";
    };
    probe.onerror = () => {
      art.textContent = "🖼️ gambar tidak bisa dimuat";
    };
    probe.src = card.imageUrlEn;
    art.textContent = "memuat...";
  } else {
    art.textContent = "🚫 tidak ada imageUrl";
  }
  cardPreview.append(art);

  // Name
  const name = document.createElement("div");
  name.className = "preview-name";
  name.textContent = card.name ?? "—";
  cardPreview.append(name);

  // Code
  const code = document.createElement("div");
  code.className = "preview-code";
  code.textContent = card.enCardNo ?? "—";
  cardPreview.append(code);

  // Badges
  const badges = document.createElement("div");
  badges.className = "preview-badges";

  if (card.grade != null) badges.append(makeBadge("badge-grade",   `G${card.grade}`));
  if (card.trigger)       badges.append(makeBadge("badge-trigger", card.trigger));
  if (card.unitType)      badges.append(makeBadge("badge-unit",    card.unitType));
  if (card.rarity)        badges.append(makeBadge("badge-rarity",  card.rarity));

  for (const n of (card.nations ?? [])) badges.append(makeBadge("badge-nation", n));
  for (const c of (card.clan ?? []))    badges.append(makeBadge("badge-clan",   c));
  for (const r of (card.races ?? []))   badges.append(makeBadge("badge-race",   r));

  cardPreview.append(badges);

  // Detailed sections (setCode, image URL link)
  if (card.setCode) cardPreview.append(section("Set Code", card.setCode));
  if (card.cardNumber) cardPreview.append(section("Card Number", card.cardNumber));
  if (card.imageUrlEn) {
    const wrap = document.createElement("div");
    wrap.className = "preview-section";
    wrap.innerHTML = `
      <div class="preview-section-label">Image URL</div>
      <div class="preview-section-value">
        <a href="${escapeHtml(card.imageUrlEn)}" target="_blank" rel="noopener">open ↗</a>
      </div>
    `;
    cardPreview.append(wrap);
  }
}

function makeBadge(cls, text) {
  const el = document.createElement("span");
  el.className = `badge ${cls}`;
  el.textContent = text;
  return el;
}

function section(label, value) {
  const wrap = document.createElement("div");
  wrap.className = "preview-section";

  const lab = document.createElement("div");
  lab.className = "preview-section-label";
  lab.textContent = label;

  const val = document.createElement("div");
  val.className = "preview-section-value";
  val.textContent = value;

  wrap.append(lab, val);
  return wrap;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

// ── Stats tab ─────────────────────────────────────────────────────────────────

function renderStats() {
  // Group by setCode
  const bySet = {};
  for (const card of allCards) {
    const set = card.setCode || "(unknown)";
    if (!bySet[set]) bySet[set] = {
      total: 0,
      withImage: 0,
      withNations: 0,
      withClan: 0,
      withRaces: 0,
      withUnitType: 0,
      withRarity: 0,
    };
    const s = bySet[set];
    s.total++;
    if (card.imageUrlEn)                                     s.withImage++;
    if (Array.isArray(card.nations) && card.nations.length)  s.withNations++;
    if (Array.isArray(card.clan)    && card.clan.length)     s.withClan++;
    if (Array.isArray(card.races)   && card.races.length)    s.withRaces++;
    if (card.unitType)                                       s.withUnitType++;
    if (card.rarity)                                         s.withRarity++;
  }

  const setCodes = Object.keys(bySet).sort();
  statsTotal.textContent    = allCards.length.toLocaleString("id-ID");
  statsSetCount.textContent = setCodes.length.toLocaleString("id-ID");

  statsGrid.innerHTML = "";
  for (const set of setCodes) {
    statsGrid.append(buildStatsCard(set, bySet[set]));
  }
}

function buildStatsCard(setCode, stats) {
  const card = document.createElement("div");
  card.className = "stats-card";

  const head = document.createElement("div");
  head.className = "stats-card-head";

  const setEl = document.createElement("span");
  setEl.className = "stats-card-set";
  setEl.textContent = setCode;

  const countEl = document.createElement("span");
  countEl.className = "stats-card-count";
  countEl.innerHTML = `<strong>${stats.total}</strong> kartu`;

  head.append(setEl, countEl);
  card.append(head);

  // Coverage grid
  const cov = document.createElement("div");
  cov.className = "stats-coverage";

  const fields = [
    ["Image",     stats.withImage],
    ["UnitType",  stats.withUnitType],
    ["Nations",   stats.withNations],
    ["Rarity",    stats.withRarity],
    ["Clan",      stats.withClan],
    ["Races",     stats.withRaces],
  ];

  for (const [label, value] of fields) {
    const pct = stats.total === 0 ? 0 : Math.round((value / stats.total) * 100);
    const item = document.createElement("div");
    item.className = "stats-coverage-item";

    const lab = document.createElement("span");
    lab.className = "stats-coverage-label";
    lab.textContent = label;

    const val = document.createElement("span");
    val.className = "stats-coverage-value";
    if (pct === 100) val.classList.add("full");
    else if (pct < 80) val.classList.add("warn");
    val.textContent = `${pct}%`;

    item.append(lab, val);
    cov.append(item);
  }

  card.append(cov);

  // Click → jump to Browse tab with set filter applied
  card.style.cursor = "pointer";
  card.addEventListener("click", () => {
    setFilter.value = setCode;
    document.querySelector('.tab[data-tab="browse"]').click();
    applyFilters();
    // Scroll to top of list
    cardList.scrollTop = 0;
  });

  return card;
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
