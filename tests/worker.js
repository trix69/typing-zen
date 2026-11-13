// The ranking board's Worker (worker/src/index.js), run in Node against an in-memory stand-in for D1.
// node worker.js   (no site needed; run.sh passes its usual arguments, which are ignored)
const path = require('path');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };

// Just the four statements the Worker uses.
function fakeD1(fail = false) {
  const table = new Map(); // "site|id" -> row
  const hits = new Map();
  const stmt = (sql) => ({
    bind: (...a) => ({
      async all() {
        if (fail) throw new Error('down');
        if (/FROM hits/.test(sql)) {
          const hs = [...hits.values()].filter((h) => h.site === a[0] && h.day >= a[1]);
          const g = /GROUP BY (\w+)(, (\w+))?/.exec(sql), keys = g ? [g[1], g[3]].filter(Boolean) : [];
          const out = {};
          for (const h of hs) { const k = keys.map((x) => h[x]).join('|'); const o = out[k] || (out[k] = { ...Object.fromEntries(keys.map((x) => [x, h[x]])), ids: new Set(), visits: 0 }); o.ids.add(h.install); o.visits += h.n; }
          return { results: Object.values(out).map((o) => { const { ids, ...r } = o; return { ...r, vis: ids.size }; }) };
        }
        if (/SUBSTR\(id/.test(sql)) { const c = {}; for (const r of table.values()) if (r.site === a[0]) c[r.id.slice(0, 2)] = (c[r.id.slice(0, 2)] || 0) + 1; return { results: Object.entries(c).map(([kind, n]) => ({ kind, n })) }; }
        return { results: [...table.values()].filter((r) => r.site === a[0] && r.updated >= a[1]) };
      },
      async first() { if (fail) throw new Error('down'); return table.get(a[0] + '|' + a[1]) || null; },
      async run() {
        if (fail) throw new Error('down');
        if (/^INSERT/.test(sql)) { const k = a[0] + '|' + a[1], had = table.get(k); table.set(k, had ? { ...had, name: a[2], days: a[3], updated: a[5] } : { site: a[0], id: a[1], name: a[2], days: a[3], key_hash: a[4], updated: a[5] }); }
        if (/^INSERT INTO hits/.test(sql)) { const k = a.join('|'), h = hits.get(k); hits.set(k, h ? { ...h, n: h.n + 1 } : { site: a[0], day: a[1], install: a[2], client: a[3], version: a[4], who: a[5], n: 1 }); return {}; }
        if (/^DELETE FROM hits/.test(sql)) { for (const [k, h] of hits) if (h.day < a[0]) hits.delete(k); return {}; }
        if (/^DELETE/.test(sql)) table.delete(a[0] + '|' + a[1]);
        return {};
      },
    }),
  });
  return { prepare: stmt, table, hits };
}

(async () => {
  const { handle } = await import(path.join(__dirname, '..', 'worker', 'src', 'index.js'));
  const env = { DB: fakeD1() };
  const ORIGIN = 'https://trix69.github.io';
  const req = (method, p, body, headers = {}) => new Request('https://w.example' + p, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers }, body: body == null ? undefined : JSON.stringify(body) });
  const call = async (...a) => { const r = await handle(req(...a), env); return { status: r.status, body: await r.json().catch(() => null), headers: r.headers }; };
  const today = new Date().toISOString().slice(0, 10), old = new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 10);
  const L1 = 'l:' + 'a'.repeat(24) + ':' + 'b'.repeat(10), L2 = 'l:' + 'a'.repeat(24) + ':' + 'c'.repeat(10), G = 'g:' + 'x'.repeat(28);

  // A first write mints a key, returned once; the row comes back with h, never the id.
  let r = await call('POST', '/board', { site: 'live', id: L1, name: 'Lu**e', days: { [today]: 5, [old]: 9 } });
  ok(r.status === 200 && /^[0-9a-f]{40}$/.test(r.body.key), `first write: 200 and a new key (${r.status})`);
  const k1 = r.body.key;
  ok(r.body.rows.length === 1 && r.body.rows[0].name === 'Lu**e' && JSON.stringify(r.body.rows[0].days) === JSON.stringify({ [today]: 5 }) && !('id' in r.body.rows[0]) && r.body.rows[0].h === r.body.h,
    'the row: masked name, only recent days (20-day-old one dropped), no id, its h returned: ' + JSON.stringify(r.body.rows[0]));
  ok(![...env.DB.table.values()].some((x) => JSON.stringify(x).includes(k1)), 'the key is stored only as a hash');
  // Updates need the key.
  r = await call('POST', '/board', { site: 'live', id: L1, name: 'Lu**e', days: { [today]: 99 } });
  ok(r.status === 403, `update without the key: 403 (${r.status})`);
  r = await call('POST', '/board', { site: 'live', id: L1, name: 'Lu**e', days: { [today]: 99 }, key: 'f'.repeat(40) });
  ok(r.status === 403, `update with a wrong key: 403 (${r.status})`);
  r = await call('POST', '/board', { site: 'live', id: L1, name: 'Lu**e', days: { [today]: 7 }, key: k1 });
  ok(r.status === 200 && !r.body.key && r.body.rows[0].days[today] === 7, 'update with the key: 200, no new key, 7 words');
  // A second user on the same install is a second row; a Google id is a row too.
  r = await call('POST', '/board', { site: 'live', id: L2, name: 'Mi*a', days: { [today]: 3 } });
  const k2 = r.body.key;
  r = await call('POST', '/board', { site: 'live', id: G, name: 'Zh*******g', days: { [today]: 12 }, key: 'd'.repeat(40) });
  ok(r.status === 200 && !r.body.key && r.body.rows.length === 3, 'a Google row with a key of its own (synced between its devices): stored, 3 rows');
  // Test and live are apart.
  r = await call('GET', '/board?site=test');
  ok(r.status === 200 && r.body.rows.length === 0, 'the test site sees none of the live rows');
  r = await call('GET', '/board?site=live');
  ok(r.status === 200 && r.body.rows.length === 3, 'GET: the 3 live rows');
  // Validation.
  const bad = [[{ site: 'prod', id: L1, name: 'Lu**e', days: {} }, 'site'], [{ site: 'live', id: 'l:short:x', name: 'Lu**e', days: {} }, 'id'],
    [{ site: 'live', id: L1, name: 'Luke', days: {}, key: k1 }, 'name without a mask'], [{ site: 'live', id: L1, name: 'L'.repeat(41) + '*', days: {}, key: k1 }, 'name too long'],
    [{ site: 'live', id: L1, name: '<b>*', days: {}, key: k1 }, 'name with markup'], [{ site: 'live', id: L1, name: 'Lu**e', days: { [today]: -1 }, key: k1 }, 'negative count'],
    [{ site: 'live', id: L1, name: 'Lu**e', days: { [today]: 1.5 }, key: k1 }, 'fraction'], [{ site: 'live', id: L1, name: 'Lu**e', days: { [today]: 50000 }, key: k1 }, 'too many words'],
    [{ site: 'live', id: L1, name: 'Lu**e', days: { 'not-a-day': 1 }, key: k1 }, 'bad date']];
  for (const [b, what] of bad) { r = await call('POST', '/board', b); ok(r.status === 400, `rejected: ${what} (${r.status} ${JSON.stringify(r.body)})`); }
  const big = await handle(new Request('https://w.example/board', { method: 'POST', headers: { Origin: ORIGIN }, body: 'x'.repeat(3000) }), env);
  ok(big.status === 413, `a body over 2 KB: 413 (${big.status})`);
  // Delete needs the key; a missing row is fine.
  r = await call('DELETE', '/board/' + encodeURIComponent(L2) + '?site=live');
  ok(r.status === 403, 'delete without the key: 403');
  r = await call('DELETE', '/board/' + encodeURIComponent(L2) + '?site=live', null, { 'X-Board-Key': k2 });
  ok(r.status === 200 && (await call('GET', '/board?site=live')).body.rows.length === 2, 'delete with the key: gone (2 rows left)');
  r = await call('DELETE', '/board/' + encodeURIComponent(L2) + '?site=live', null, { 'X-Board-Key': k2 });
  ok(r.status === 200 && r.body.gone, 'deleting it again: 200, already gone');
  // CORS: only the app's origin.
  r = await call('GET', '/board?site=live');
  ok(r.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'CORS allows https://trix69.github.io');
  const other = await handle(new Request('https://w.example/board?site=live', { headers: { Origin: 'https://evil.example' } }), env);
  ok(other.headers.get('Access-Control-Allow-Origin') === ORIGIN, 'any other origin is not echoed back');
  // Nothing about the caller is stored.
  const stored = JSON.stringify([...env.DB.table.values()]);
  ok(!/evil|trix69|Mozilla|127\.0\.0\.1/.test(stored) && Object.keys([...env.DB.table.values()][0]).join() === 'site,id,name,days,key_hash,updated', 'a row holds only site, id, name, days, key_hash, updated');
  // A dead store answers 503, never an empty board.
  const dead = await handle(req('GET', '/board?site=live'), { DB: fakeD1(true) });
  ok(dead.status === 503, `store down: GET 503 (${dead.status})`);
  const dead2 = await handle(req('POST', '/board', { site: 'live', id: L1, name: 'Lu**e', days: {}, key: k1 }), { DB: fakeD1(true) });
  ok(dead2.status === 503, `store down: POST 503 (${dead2.status})`);
  const none = await handle(req('GET', '/board?site=live'), {});
  ok(none.status === 503, 'no database bound: 503');
  // Launch counts: POST /hit, one row per device, day, app type, version and kind of user; n counts launches.
  const I1 = 'A'.repeat(24), I2 = 'B'.repeat(24);
  for (const b of [{ id: I1, c: 'pwa', v: '1.22', u: 'google' }, { id: I1, c: 'pwa', v: '1.22', u: 'google' }, { id: I2, c: 'web', v: '1.21', u: 'typed' }]) {
    r = await call('POST', '/hit', { site: 'live', ...b });
    if (r.status !== 200) ok(false, 'hit ' + r.status);
  }
  await call('POST', '/hit', { site: 'test', id: I2, c: 'web', v: '1.22-test', u: 'none' });
  const H = [...env.DB.hits.values()];
  ok(H.length === 3 && H.find((h) => h.install === I1).n === 2 && Object.keys(H[0]).join() === 'site,day,install,client,version,who,n', `3 rows (one device launched twice → n 2), only site/day/install/client/version/who/n: ${JSON.stringify(H.map((h) => [h.site, h.client, h.version, h.who, h.n]))}`);
  const badHits = [{ site: 'live', id: 'short', c: 'web', v: '1.22', u: 'none' }, { site: 'live', id: I1, c: 'ios', v: '1.22', u: 'none' }, { site: 'live', id: I1, c: 'web', v: '<b>', u: 'none' }, { site: 'live', id: I1, c: 'web', v: '1.22', u: 'admin' }, { site: 'prod', id: I1, c: 'web', v: '1.22', u: 'none' }];
  let rej = 0; for (const b of badHits) if ((await call('POST', '/hit', b)).status === 400) rej++;
  ok(rej === 5, `hit: bad id, app type, version, user kind and site all rejected (${rej}/5)`);
  // The stats page: 404 without the key, totals with it, never an id.
  const envK = { DB: env.DB, STATS_KEY: 'k'.repeat(48) };
  const st = async (p) => { const res = await handle(new Request('https://w.example' + p), envK); return { status: res.status, text: await res.text() }; };
  ok((await st('/stats')).status === 404 && (await st('/stats?k=wrong')).status === 404 && (await handle(new Request('https://w.example/stats?k=x'), env)).status === 404, 'stats: 404 without the right key (and when no key is set)');
  const page = await st('/stats?k=' + 'k'.repeat(48));
  const cardsTxt = page.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  ok(page.status === 200 && /Today \(UTC\) 2 unique visitors 3 visits/.test(cardsTxt), 'stats: today 2 unique visitors, 3 visits: ' + (cardsTxt.match(/Today \(UTC\)[^L]*/) || [''])[0].trim());
  ok(/Google user 1 2/.test(cardsTxt) && /Typed name only 1 1/.test(cardsTxt) && /1\.22 1 2/.test(cardsTxt), 'stats: signed in or not, and versions');
  ok(/rows on the board/.test(cardsTxt) && /1 Google · 1 typed name/.test(cardsTxt), 'stats: the board block (1 Google row, 1 typed-name row left from above)');
  ok(!page.text.includes(I1) && !page.text.includes(I2) && !page.text.includes(G) && !page.text.includes(L1), 'stats: no install id or board id anywhere on the page');
  const tpage = await st('/stats?k=' + 'k'.repeat(48) + '&site=test');
  ok(/test site/.test(tpage.text) && /Today \(UTC\) 1 unique visitors 1 visits/.test(tpage.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')), 'stats: the test site separately (1 visitor)');
})();
