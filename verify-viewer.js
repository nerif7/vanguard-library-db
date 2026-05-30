/**
 * Temporary data verification viewer — serves a browser UI to audit trigger data.
 * Usage: node verify-viewer.js
 * Then open: http://localhost:3333
 *
 * Safe to delete after data fix is verified.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');

const PORT        = 3334;
const CARDS_FILE  = path.join(__dirname, 'cards.json');
const BACKUP_FILE = path.join(__dirname, 'cards.json.trigger-before');

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Trigger Data Verifier</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: monospace; font-size: 13px; background: #0f0f0f; color: #d4d4d4; }
  header { padding: 12px 16px; background: #1a1a2e; border-bottom: 1px solid #333; display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  header h1 { font-size: 15px; color: #7ec8e3; }
  .controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  select, input { background: #222; color: #d4d4d4; border: 1px solid #444; padding: 4px 8px; border-radius: 3px; font: inherit; }
  label { color: #888; font-size: 12px; }
  #stats { margin-left: auto; color: #888; font-size: 12px; }
  .badge { display: inline-block; padding: 1px 6px; border-radius: 10px; font-size: 11px; font-weight: bold; }
  .badge-over     { background: #5c1e1e; color: #ff6b6b; }
  .badge-heal     { background: #1e4a2a; color: #6bffb8; }
  .badge-critical { background: #4a2a1e; color: #ffb86b; }
  .badge-draw     { background: #1e3a4a; color: #6bb8ff; }
  .badge-front    { background: #3a1e4a; color: #d06bff; }
  .badge-sentinel { background: #4a4a1e; color: #fffb6b; }
  .badge-null     { background: #222; color: #555; }
  .badge-warn     { background: #5c3a00; color: #ffcc44; }
  table { width: 100%; border-collapse: collapse; }
  thead th { position: sticky; top: 0; background: #111; padding: 6px 10px; text-align: left; color: #888; border-bottom: 1px solid #333; white-space: nowrap; }
  tbody tr { border-bottom: 1px solid #1a1a1a; }
  tbody tr:hover { background: #1a1a1a; }
  tbody tr.anomaly { background: #1a1000; }
  tbody tr.anomaly:hover { background: #2a1a00; }
  td { padding: 5px 10px; white-space: nowrap; }
  td.name { max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #ccc; }
  td.card-id { color: #7ec8e3; }
  td.grade { text-align: center; }
  .grade-warn { color: #ffcc44; font-weight: bold; }
  #container { height: calc(100vh - 56px); overflow-y: auto; }
  .tab-bar { display: flex; border-bottom: 1px solid #333; background: #111; }
  .tab { padding: 8px 16px; cursor: pointer; color: #888; font-size: 12px; border-right: 1px solid #222; }
  .tab.active { color: #7ec8e3; background: #0f0f0f; border-bottom: 1px solid #0f0f0f; margin-bottom: -1px; }
  .pane { display: none; }
  .pane.active { display: block; }
</style>
</head>
<body>
<header>
  <h1>Trigger Data Verifier</h1>
  <div class="controls">
    <label>View
      <select id="viewMode">
        <option value="anomaly">Anomalies (non-Grade-0 with trigger)</option>
        <option value="all">All cards with trigger</option>
        <option value="null_trigger_unit">Missing trigger (Trigger Unit)</option>
        <option value="all_cards">All cards</option>
      </select>
    </label>
    <label>Set
      <select id="filterSet"><option value="">All sets</option></select>
    </label>
    <label>Trigger
      <select id="filterTrigger">
        <option value="">All</option>
        <option>Critical</option><option>Draw</option><option>Heal</option>
        <option>Front</option><option>Over</option><option>Sentinel</option>
        <option value="null">null</option>
      </select>
    </label>
    <label>Search <input id="search" type="text" placeholder="name / card no" style="width:160px"></label>
  </div>
  <span id="stats"></span>
</header>
<div class="tab-bar">
  <div class="tab active" data-pane="pane-audit">Audit</div>
  <div class="tab" data-pane="pane-compare">Before / After <span id="compare-count" style="color:#555;font-size:11px"></span></div>
</div>
<div id="container" style="height:calc(100vh - 80px)">
  <div id="pane-audit" class="pane active">
    <table>
      <thead>
        <tr>
          <th>Card No</th><th>Name</th><th>Set</th><th>Grade</th>
          <th>Unit Type</th><th>Trigger</th><th>Rarity</th><th>Note</th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>
  </div>
  <div id="pane-compare" class="pane">
    <table>
      <thead>
        <tr>
          <th>Card No</th><th>Name</th><th>Set</th><th>Grade</th>
          <th>Before</th><th>After</th>
        </tr>
      </thead>
      <tbody id="compare-body"><tr><td colspan="6" style="padding:20px;color:#555">Click this tab to load comparison.</td></tr></tbody>
    </table>
  </div>
</div>
<script>
let ALL = [];

function triggerBadge(t) {
  if (!t) return '<span class="badge badge-null">null</span>';
  return '<span class="badge badge-' + t.toLowerCase() + '">' + t + '</span>';
}

function isAnomaly(c) {
  // Grade > 0 with a trigger set — almost always wrong
  return c.trigger !== null && c.grade !== null && c.grade > 0;
}

function isMissingTrigger(c) {
  // Has Trigger Unit in raw data — but we lost that info in schema.
  // Approximate: grade 3+ with trigger null but name suggests trigger unit
  // Actually we detect based on what scraper would give us.
  // For now just show cards where trigger is null and grade === 0
  // but we flag grade-0 null cards as potentially missing
  return c.trigger === null && c.grade === 0;
}

function render() {
  const mode    = document.getElementById('viewMode').value;
  const setF    = document.getElementById('filterSet').value;
  const trigF   = document.getElementById('filterTrigger').value;
  const search  = document.getElementById('search').value.toLowerCase();

  let rows = ALL;

  if (mode === 'anomaly')          rows = rows.filter(isAnomaly);
  if (mode === 'all')              rows = rows.filter(c => c.trigger !== null);
  if (mode === 'null_trigger_unit')rows = rows.filter(c => c.trigger === null && c.grade === 0);

  if (setF)   rows = rows.filter(c => c.setCode === setF);
  if (trigF === 'null') rows = rows.filter(c => c.trigger === null);
  else if (trigF) rows = rows.filter(c => c.trigger === trigF);
  if (search) rows = rows.filter(c =>
    (c.name || '').toLowerCase().includes(search) ||
    (c.enCardNo || '').toLowerCase().includes(search)
  );

  document.getElementById('stats').textContent = rows.length + ' cards';

  const tbody = document.getElementById('tbody');
  tbody.innerHTML = rows.map(c => {
    const anom = isAnomaly(c);
    const gradeClass = anom ? ' class="grade-warn"' : '';
    const note = anom
      ? '<span class="badge badge-warn">grade ' + c.grade + ' has trigger</span>'
      : (c.grade === 0 && c.trigger === null ? '<span style="color:#555">Grade 0, no trigger</span>' : '');
    return '<tr class="' + (anom ? 'anomaly' : '') + '">' +
      '<td class="card-id">' + (c.enCardNo||'') + '</td>' +
      '<td class="name" title="' + (c.name||'') + '">' + (c.name||'') + '</td>' +
      '<td>' + (c.setCode||'') + '</td>' +
      '<td class="grade"' + gradeClass + '>' + (c.grade === null ? 'null' : c.grade) + '</td>' +
      '<td>' + (c.unitType||'') + '</td>' +
      '<td>' + triggerBadge(c.trigger) + '</td>' +
      '<td>' + (c.rarity||'') + '</td>' +
      '<td>' + note + '</td>' +
    '</tr>';
  }).join('');
}

fetch('/cards.json')
  .then(r => r.json())
  .then(data => {
    ALL = data;
    // Populate set filter
    const sets = [...new Set(data.map(c => c.setCode).filter(Boolean))].sort();
    const sel = document.getElementById('filterSet');
    sets.forEach(s => { const o = document.createElement('option'); o.value = o.textContent = s; sel.appendChild(o); });
    render();
  });

['viewMode','filterSet','filterTrigger'].forEach(id =>
  document.getElementById(id).addEventListener('change', render));
document.getElementById('search').addEventListener('input', render);

// ── Before/After compare tab ──────────────────────────────────────────────────
let BEFORE = null;

async function loadCompare() {
  const out = document.getElementById('compare-body');
  if (!BEFORE) {
    try {
      const r = await fetch('/cards_before.json');
      if (!r.ok) throw new Error('backup not found');
      BEFORE = await r.json();
    } catch {
      out.innerHTML = '<tr><td colspan="6" style="padding:20px;color:#888">Run <code>node rescrape_triggers.js</code> first to generate the backup snapshot, then reload this tab.</td></tr>';
      return;
    }
  }

  // Build lookup for after (current cards.json = ALL)
  const afterMap = {};
  ALL.forEach(c => { afterMap[c.enCardNo] = c.trigger; });

  const diffs = BEFORE
    .filter(c => afterMap[c.enCardNo] !== undefined && c.trigger !== afterMap[c.enCardNo])
    .map(c => ({ enCardNo: c.enCardNo, name: c.name, setCode: c.setCode, grade: c.grade, before: c.trigger, after: afterMap[c.enCardNo] }));

  document.getElementById('compare-count').textContent = diffs.length + ' changes';

  if (diffs.length === 0) {
    out.innerHTML = '<tr><td colspan="6" style="padding:20px;color:#888">No differences found between before and after snapshots.</td></tr>';
    return;
  }

  out.innerHTML = diffs.map(d => {
    const arrow = String(d.before) + ' → ' + String(d.after);
    const cls   = d.after === null ? 'badge-warn' : 'badge-' + (d.after||'null').toLowerCase();
    return '<tr>' +
      '<td class="card-id">' + d.enCardNo + '</td>' +
      '<td class="name" title="' + d.name + '">' + d.name + '</td>' +
      '<td>' + d.setCode + '</td>' +
      '<td class="grade">' + d.grade + '</td>' +
      '<td><span style="color:#ff6b6b">' + String(d.before) + '</span></td>' +
      '<td><span class="badge ' + cls + '">' + String(d.after) + '</span></td>' +
    '</tr>';
  }).join('');
}

document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.pane').forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    const pane = document.getElementById(tab.dataset.pane);
    pane.classList.add('active');
    if (tab.dataset.pane === 'pane-compare') loadCompare();
  });
});
</script>
</body>
</html>`;

function serveJson(res, filePath, label) {
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end(`${label} not found`); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }
  if (req.url === '/cards.json')        { serveJson(res, CARDS_FILE,  'cards.json'); return; }
  if (req.url === '/cards_before.json') { serveJson(res, BACKUP_FILE, 'cards.json.trigger-before'); return; }
  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`Verify viewer running at http://localhost:${PORT}`);
  const hasBackup = fs.existsSync(BACKUP_FILE);
  console.log(`Before/after compare: ${hasBackup ? 'available (backup found)' : 'not yet — run rescrape_triggers.js first'}`);
  console.log('Press Ctrl+C to stop.');
});
