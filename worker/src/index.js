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
const MAX_BODY = 2048, MAX_WORDS = 20000, WINDOW_DAYS = 9;

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
      } else minted = key || newKey(); // a row seen for the first time: its key is the one given, or a new one
      const hash = had ? had.key_hash : await sha256(minted);
      await env.DB.prepare('INSERT INTO rows (site, id, name, days, key_hash, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
        'ON CONFLICT (site, id) DO UPDATE SET name = ?3, days = ?4, updated = ?6').bind(site, id, name, JSON.stringify(days), hash, now).run();
      return json(req, 200, { ok: true, ...(minted && !key ? { key: minted } : {}), h: (await sha256(id)).slice(0, 16), rows: await rows(env, site, now) });
    }
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

export default { fetch: (req, env) => handle(req, env) };
