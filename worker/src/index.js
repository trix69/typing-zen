/* Typing Zen ranking board (user's request, 2026-11-13): one board for every user who says Yes, Google or not.
 *
 *   GET    /board?site=live              the week's rows: [{ h, name, days }]
 *   POST   /board  { site, id, name, days, key? }
 *                                        upsert one row; the first write mints its key and returns it once
 *   DELETE /board/<id>?site=live         withdraw a row (header X-Board-Key)
 *
 * id: "g:<Google uid>" for a Google user, "l:<install id>:<local id>" for a typed-name user. Others never see an id:
 * each row comes back with h, the first 16 hex of sha256(id), so a device can find its own row. name is masked on
 * the device (Lu*******h). days: {"YYYY-MM-DD": words tested} for the last 7 days of the writer's calendar.
 * The key is stored only as sha256(key); without it a row can't be changed or deleted.
 *
 * Kept: those fields and the time of the last write. Not kept: IP address, user agent, referrer, cookies; nothing is
 * logged. site is "live" or "test" (the test build rewrites it), so test rounds never reach the live board.
 * Storage: D1 (one table, see schema.sql). If it is down, reads and writes answer 503 and the app says so. */
const ORIGINS = ['https://trix69.github.io'];
const SITES = ['live', 'test'];
const ID_OK = /^(g:[A-Za-z0-9_-]{6,128}|l:[A-Za-z0-9_-]{20,64}:[A-Za-z0-9_-]{8,64})$/;
const NAME_OK = /^[\p{L}\p{M}\p{N}' .*-]{1,40}$/u;
const DAY_OK = /^\d{4}-\d{2}-\d{2}$/;
const KEY_OK = /^[0-9a-f]{40}$/;
// MAX_WORDS: what one day can claim (a 20-minute Spelling Bee is well under 200 words; Hermes R91.1). MAX_ROWS per
// site bounds the board; rows not written for KEEP_DAYS are deleted (Hermes R91.2, in the privacy policy).
const MAX_BODY = 2048, MAX_WORDS = 500, WINDOW_DAYS = 9, MAX_ROWS = 5000, KEEP_DAYS = 30;

const cors = (req) => {
  const o = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(o) ? o : ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, DELETE',
    'Access-Control-Allow-Headers': 'Content-Type, X-Board-Key',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
};
const json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const newKey = () => [...crypto.getRandomValues(new Uint8Array(20))].map((b) => b.toString(16).padStart(2, '0')).join('');
const dayNum = (s) => Math.floor(Date.parse(s + 'T00:00:00Z') / 864e5);

// Only the days that can still count: within the last WINDOW_DAYS (time zones on either side), whole numbers.
function cleanDays(days, now = Date.now()) {
  if (!days || typeof days !== 'object' || Array.isArray(days)) return null;
  const today = Math.floor(now / 864e5), out = {};
  const entries = Object.entries(days);
  if (entries.length > 10) return null;
  for (const [d, n] of entries) {
    if (!DAY_OK.test(d) || !Number.isInteger(n) || n < 0 || n > MAX_WORDS) return null;
    const k = dayNum(d);
    if (!(k >= today - WINDOW_DAYS && k <= today + 1)) continue;
    if (n > 0) out[d] = n;
  }
  return out;
}

async function rows(env, site, now = Date.now()) {
  const since = now - WINDOW_DAYS * 864e5;
  const r = await env.DB.prepare('SELECT id, name, days FROM rows WHERE site = ?1 AND updated >= ?2').bind(site, since).all();
  const out = [];
  for (const x of r.results || []) {
    let days = {};
    try { days = cleanDays(JSON.parse(x.days), now) || {}; } catch { /* a damaged row counts as none */ }
    out.push({ h: (await sha256(x.id)).slice(0, 16), name: x.name, days });
  }
  return out;
}

export async function handle(req, env, now = Date.now()) {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(req) });
  const path = url.pathname.replace(/\/+$/, '');
  if (!env.DB) return json(req, 503, { error: 'store' });
  // Writes only from the app's own pages (not authentication, which a typed-name user can't have, but it keeps a
  // stray script or a pasted curl from writing; Hermes R91.1).
  if (req.method === 'POST' || req.method === 'DELETE') { if (!ORIGINS.includes(req.headers.get('Origin') || '')) return json(req, 403, { error: 'origin' }); }
  try {
    if (req.method === 'GET' && path === '/board') {
      const site = url.searchParams.get('site') || '';
      if (!SITES.includes(site)) return json(req, 400, { error: 'site' });
      return json(req, 200, { rows: await rows(env, site, now) });
    }
    if (req.method === 'POST' && path === '/board') {
      const text = await req.text();
      if (text.length > MAX_BODY) return json(req, 413, { error: 'size' });
      let b;
      try { b = JSON.parse(text); } catch { return json(req, 400, { error: 'json' }); }
      const site = String(b.site || ''), id = String(b.id || ''), name = String(b.name || ''), key = b.key == null ? '' : String(b.key);
      if (!SITES.includes(site)) return json(req, 400, { error: 'site' });
      if (!ID_OK.test(id)) return json(req, 400, { error: 'id' });
      if (!NAME_OK.test(name) || !name.includes('*')) return json(req, 400, { error: 'name' });
      if (key && !KEY_OK.test(key)) return json(req, 400, { error: 'key' });
      const days = cleanDays(b.days, now);
      if (!days) return json(req, 400, { error: 'days' });
      const had = await env.DB.prepare('SELECT key_hash FROM rows WHERE site = ?1 AND id = ?2').bind(site, id).first();
      let minted = null;
      if (had) {
        if (!key || (await sha256(key)) !== had.key_hash) return json(req, 403, { error: 'key' });
      } else {
        // A new row must have words this week, and the board has room for it (Hermes R91.1).
        if (!Object.keys(days).length) return json(req, 400, { error: 'empty' });
        const n = await env.DB.prepare('SELECT COUNT(*) AS n FROM rows WHERE site = ?1').bind(site).first();
        if (n && n.n >= MAX_ROWS) return json(req, 503, { error: 'full' });
        minted = key || newKey(); // a row seen for the first time: its key is the one given, or a new one
      }
      const hash = had ? had.key_hash : await sha256(minted);
      await env.DB.prepare('INSERT INTO rows (site, id, name, days, key_hash, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
        'ON CONFLICT (site, id) DO UPDATE SET name = ?3, days = ?4, updated = ?6').bind(site, id, name, JSON.stringify(days), hash, now).run();
      // Rows not written for KEEP_DAYS go (Hermes R91.2): one write in 20 tidies up.
      if (Math.random() < 0.05) await env.DB.prepare('DELETE FROM rows WHERE updated < ?1').bind(now - KEEP_DAYS * 864e5).run();
      return json(req, 200, { ok: true, ...(minted && !key ? { key: minted } : {}), h: (await sha256(id)).slice(0, 16), rows: await rows(env, site, now) });
    }
    if (req.method === 'POST' && path === '/hit') return hit(req, env, now);
    if (req.method === 'GET' && path === '/stats') return stats(url, env, now);
    const del = path.match(/^\/board\/([^/]+)$/);
    if (req.method === 'DELETE' && del) {
      const site = url.searchParams.get('site') || '', id = decodeURIComponent(del[1]), key = req.headers.get('X-Board-Key') || '';
      if (!SITES.includes(site)) return json(req, 400, { error: 'site' });
      if (!ID_OK.test(id)) return json(req, 400, { error: 'id' });
      const had = await env.DB.prepare('SELECT key_hash FROM rows WHERE site = ?1 AND id = ?2').bind(site, id).first();
      if (!had) return json(req, 200, { ok: true, gone: true });
      if (!KEY_OK.test(key) || (await sha256(key)) !== had.key_hash) return json(req, 403, { error: 'key' });
      await env.DB.prepare('DELETE FROM rows WHERE site = ?1 AND id = ?2').bind(site, id).run();
      return json(req, 200, { ok: true });
    }
    return json(req, 404, { error: 'not found' });
  } catch {
    return json(req, 503, { error: 'store' });
  }
}

// ---- Launch counts (Trix, 2026-11-13). POST /hit {site, id, c, v, u}: one launch while online, after the privacy
// policy is accepted. id: this browser's random install id; c: "web" (a browser tab) or "pwa" (home-screen app);
// v: the app version; u: "google" (a Google user is on this device), "typed" (only typed names), "none" (no user yet).
// Stored per UTC day as a count; nothing else (no IP, user agent, referrer or cookies). Rows older than 400 days go.
const CLIENTS = ['web', 'pwa'], WHO = ['google', 'typed', 'none'];
const INSTALL_OK = /^[A-Za-z0-9_-]{24}$/, VER_OK = /^[0-9][0-9.]{0,7}(-test)?$/;
async function hit(req, env, now) {
  const text = await req.text();
  if (text.length > 512) return json(req, 413, { error: 'size' });
  let b;
  try { b = JSON.parse(text); } catch { return json(req, 400, { error: 'json' }); }
  const site = String(b.site || ''), id = String(b.id || ''), c = String(b.c || ''), v = String(b.v || ''), u = String(b.u || '');
  if (!SITES.includes(site) || !INSTALL_OK.test(id) || !CLIENTS.includes(c) || !VER_OK.test(v) || !WHO.includes(u)) return json(req, 400, { error: 'field' });
  const day = new Date(now).toISOString().slice(0, 10);
  await env.DB.prepare('INSERT INTO hits (site, day, install, client, version, who, n) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1) ' +
    'ON CONFLICT (site, day, install, client, version, who) DO UPDATE SET n = n + 1').bind(site, day, id, c, v, u).run();
  if (Math.random() < 0.01) await env.DB.prepare('DELETE FROM hits WHERE day < ?1').bind(new Date(now - 400 * 864e5).toISOString().slice(0, 10)).run();
  return json(req, 200, { ok: true });
}

// ---- GET /stats?k=<STATS_KEY>[&site=test]: Trix's private page of totals. Counts only, never an id. Wrong key: 404.
function same(a, b) { // compared without an early exit
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const esc = (x) => String(x).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const CNAME = { web: 'Browser', pwa: 'Home-screen app' }, CCOL = { web: '#4C7EA8', pwa: '#3F8F7A' };
const WNAME = { google: 'Google user', typed: 'Typed name only', none: 'No user yet' };
async function stats(url, env, now) {
  if (!env.STATS_KEY || !same(url.searchParams.get('k') || '', env.STATS_KEY)) return new Response('Not found', { status: 404 });
  const site = url.searchParams.get('site') === 'test' ? 'test' : 'live';
  const dayAgo = (d) => new Date(now - d * 864e5).toISOString().slice(0, 10);
  const q = (sql, ...a) => env.DB.prepare(sql).bind(...a).all().then((r) => r.results || []);
  const span = (from) => q('SELECT COUNT(DISTINCT install) AS vis, SUM(n) AS visits FROM hits WHERE site = ?1 AND day >= ?2', site, from);
  const [d1, d7, d30, daily, byClient7, byClient30, versions, who, board] = await Promise.all([
    span(dayAgo(0)), span(dayAgo(6)), span(dayAgo(29)),
    q('SELECT day, client, COUNT(DISTINCT install) AS vis, SUM(n) AS visits FROM hits WHERE site = ?1 AND day >= ?2 GROUP BY day, client ORDER BY day', site, dayAgo(29)),
    q('SELECT client, COUNT(DISTINCT install) AS vis, SUM(n) AS visits FROM hits WHERE site = ?1 AND day >= ?2 GROUP BY client', site, dayAgo(6)),
    q('SELECT client, COUNT(DISTINCT install) AS vis, SUM(n) AS visits FROM hits WHERE site = ?1 AND day >= ?2 GROUP BY client', site, dayAgo(29)),
    q('SELECT version, COUNT(DISTINCT install) AS vis, SUM(n) AS visits FROM hits WHERE site = ?1 AND day >= ?2 GROUP BY version ORDER BY version DESC', site, dayAgo(6)),
    q('SELECT who, COUNT(DISTINCT install) AS vis, SUM(n) AS visits FROM hits WHERE site = ?1 AND day >= ?2 GROUP BY who', site, dayAgo(6)),
    rows(env, site, now),
  ]);
  const num = (x) => Math.round(+x || 0);
  const card = (lab, r) => `<div class="card"><span class="lab">${lab}</span><b>${num((r[0] || {}).vis)}</b><span>unique visitors</span><em>${num((r[0] || {}).visits)} visits</em></div>`;
  // Per day: visits as a pale bar, unique visitors stacked by app type in front.
  const days = {}, list = [];
  for (let i = 29; i >= 0; i--) { const d = dayAgo(i); days[d] = {}; list.push(d); }
  for (const r of daily) if (days[r.day]) days[r.day][r.client] = r;
  const tot = (d, f) => CLIENTS.reduce((t, c) => t + num((days[d][c] || {})[f]), 0);
  const H = 170, W = list.length * 22, max = Math.max(1, ...list.map((d) => tot(d, 'visits')));
  let bars = '';
  list.forEach((d, i) => {
    const tv = tot(d, 'visits'), hv = tv / max * (H - 30);
    if (tv) bars += `<rect x="${i * 22 + 2}" y="${(H - 18 - hv).toFixed(1)}" width="20" height="${hv.toFixed(1)}" fill="currentColor" opacity=".13"><title>${d}: ${tv} visits</title></rect>`;
    let y = H - 18;
    for (const c of CLIENTS) { const v = num((days[d][c] || {}).vis); if (!v) continue; const h = v / max * (H - 30); y -= h; bars += `<rect x="${i * 22 + 6}" y="${y.toFixed(1)}" width="12" height="${h.toFixed(1)}" fill="${CCOL[c]}"><title>${d} ${CNAME[c]}: ${v} unique visitors</title></rect>`; }
    if (i % 5 === 0 || i === list.length - 1) bars += `<text x="${i * 22 + 12}" y="${H - 4}" font-size="9" text-anchor="middle" fill="currentColor" opacity=".6">${d.slice(5)}</text>`;
  });
  const legend = '<div class="legend"><span><i class="key" style="background:currentColor;opacity:.2"></i>Visits</span>' + CLIENTS.map((c) => `<span><i class="key" style="background:${CCOL[c]}"></i>${CNAME[c]} visitors</span>`).join('') + '</div>';
  const by = (rs, k) => Object.fromEntries(rs.map((r) => [r[k], r]));
  const m7 = by(byClient7, 'client'), m30 = by(byClient30, 'client');
  const sumR = (rs, f) => rs.reduce((t, r) => t + num(r[f]), 0);
  const appT = '<h2>By app type</h2><div class="wrap"><table><tr><th rowspan="2">App</th><th colspan="2">Last 7 days</th><th colspan="2">Last 30 days</th></tr><tr><th>Visitors</th><th>Visits</th><th>Visitors</th><th>Visits</th></tr>' +
    CLIENTS.map((c) => `<tr><td><i class="key" style="background:${CCOL[c]}"></i>${CNAME[c]}</td><td>${num((m7[c] || {}).vis)}</td><td>${num((m7[c] || {}).visits)}</td><td>${num((m30[c] || {}).vis)}</td><td>${num((m30[c] || {}).visits)}</td></tr>`).join('') +
    `<tr class="tot"><td>Total</td><td>${num((d7[0] || {}).vis)}</td><td>${num((d7[0] || {}).visits)}</td><td>${num((d30[0] || {}).vis)}</td><td>${num((d30[0] || {}).visits)}</td></tr></table></div>`;
  const mw = by(who, 'who');
  const whoT = '<h2>Signed in or not (last 7 days)</h2><table><tr><th>On the device</th><th>Visitors</th><th>Visits</th></tr>' +
    WHO.map((w) => `<tr><td>${WNAME[w]}</td><td>${num((mw[w] || {}).vis)}</td><td>${num((mw[w] || {}).visits)}</td></tr>`).join('') + '</table>' +
    '<p class="note">Per launch: Google user = a Google-signed-in user is on the device; Typed name only = users, none with Google; No user yet = the first-visit form. A device whose kind changed in the week is counted in each.</p>';
  const verT = versions.length ? '<h2>Versions in use (last 7 days)</h2><table><tr><th>Version</th><th>Visitors</th><th>Visits</th></tr>' + versions.map((r) => `<tr><td>${esc(r.version)}</td><td>${num(r.vis)}</td><td>${num(r.visits)}</td></tr>`).join('') + '</table>' : '';
  const recent = list.slice(-14).reverse();
  const daysT = '<h2>Daily (last 14 days)</h2><div class="wrap"><table><tr><th>Day</th><th>Visitors</th><th>Visits</th>' + CLIENTS.map((c) => `<th>${c === 'web' ? 'Browser' : 'App'}</th>`).join('') + '</tr>' +
    recent.map((d) => `<tr><td>${d.slice(5)}</td><td><b>${tot(d, 'vis')}</b></td><td>${tot(d, 'visits')}</td>` + CLIENTS.map((c) => `<td>${num((days[d][c] || {}).vis)}</td>`).join('') + '</tr>').join('') + '</table></div>' +
    '<p class="note">Days are UTC. A day\'s visitors can add up to more than the total when a device used both the browser and the app.</p>';
  // The ranking board: who shares, and this week's words.
  const iso = (dd) => new Date(now - dd * 864e5).toISOString().slice(0, 10), wk = new Set([...Array(8)].map((_, i) => iso(i)));
  const words = (r) => Object.entries(r.days).reduce((t, [d, x]) => t + (wk.has(d) ? x : 0), 0);
  const active = board.filter((r) => words(r) > 0);
  const all = await q("SELECT SUBSTR(id, 1, 2) AS kind, COUNT(*) AS n FROM rows WHERE site = ?1 AND updated >= ?2 GROUP BY kind", site, now - WINDOW_DAYS * 864e5);
  const mk = by(all, 'kind');
  const boardT = '<h2>Ranking board</h2><div class="cards">' +
    `<div class="card"><span class="lab">Sharing</span><b>${num((mk['g:'] || {}).n) + num((mk['l:'] || {}).n)}</b><span>rows on the board</span><em>${num((mk['g:'] || {}).n)} Google · ${num((mk['l:'] || {}).n)} typed name</em></div>` +
    `<div class="card"><span class="lab">This week</span><b>${active.length}</b><span>with words tested</span><em>${active.reduce((t, r) => t + words(r), 0)} words in all</em></div>` +
    `<div class="card"><span class="lab">Top this week</span><b>${active.length ? Math.max(...active.map(words)) : 0}</b><span>words, the leader</span><em>${active.length ? esc(active.sort((a, b2) => words(b2) - words(a))[0].name) : '–'}</em></div></div>`;
  const body = '<div class="cards">' + card('Today (UTC)', d1) + card('Last 7 days', d7) + card('Last 30 days', d30) + '</div>' +
    `<h2>Per day (last 30 days)</h2><div class="chart"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Visits and unique visitors per day by app type">${bars}</svg>${legend}</div>` +
    appT + whoT + daysT + verT + boardT;
  const other = site === 'live' ? `<a href="?k=${encodeURIComponent(url.searchParams.get('k'))}&site=test">Test site →</a>` : `<a href="?k=${encodeURIComponent(url.searchParams.get('k'))}">← Live site</a>`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Typing Zen stats</title><style>
:root { --bg: #ffffff; --fg: #1f2421; --muted: #5b625e; --panel: #f5f7f6; --line: #e3e7e4; }
@media (prefers-color-scheme: dark) { :root { --bg: #111613; --fg: #e9ece9; --muted: #a3aba6; --panel: #182019; --line: #2a322d; } }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
main { max-width: 760px; margin: 0 auto; padding: 20px 16px 40px; }
h1 { font-size: 22px; margin: 0 0 4px; } h2 { font-size: 16px; margin: 26px 0 10px; } .sub, .note { color: var(--muted); font-size: 13px; } a { color: #2f6f4a; }
.cards { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px; min-width: 0; }
.card b { display: block; font-size: 28px; line-height: 1.2; } .card span { color: var(--muted); font-size: 13px; display: block; } .card .lab { color: var(--fg); font-weight: 600; margin-bottom: 4px; }
.card em { display: block; font-style: normal; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--line); font-size: 14px; overflow-wrap: anywhere; }
.chart { background: var(--panel); border: 1px solid var(--line); border-radius: 12px; padding: 12px; overflow-x: auto; }
.wrap { overflow-x: auto; border-radius: 12px; }
table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; font-size: 14px; }
th, td { text-align: right; padding: 7px 10px; border-bottom: 1px solid var(--line); white-space: nowrap; } th:first-child, td:first-child { text-align: left; }
th { color: var(--muted); font-weight: 600; } th[colspan] { text-align: center; } .tot td { font-weight: 600; }
.key { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 6px; }
.legend { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: 13px; color: var(--muted); margin-top: 8px; }
@media (max-width: 480px) { th, td { padding: 6px 5px; font-size: 13px; } .card { padding: 10px; } .card b { font-size: 24px; } }
</style></head><body><main><h1>Typing Zen stats${site === 'test' ? ' · test site' : ''}</h1><p class="sub">Visits are launches while online (after the privacy policy is accepted; again on coming back after 6 hours away); unique visitors are different devices. Updated ${new Date(now).toISOString().slice(0, 16).replace('T', ' ')} UTC. ${other}</p>${body}
<h2>What these numbers miss</h2><p class="note">Launches while offline send nothing. A device that hasn't accepted the privacy policy isn't counted until it does. Clearing site data gives a device a new id. The claude.ai copy isn't counted. Ids are never shown here.</p></main></body></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
}

export default { fetch: (req, env) => handle(req, env) };
