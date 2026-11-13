// Each language keeps its own history (user's request, 2026-11-04), on one device and across two through Google
// sync (fake Firebase, as google.js). node langs.js base storageKey collection
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3], COL = process.argv[4] || 'typingZen.users';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-';

const FAKE = {
  app: `export function initializeApp(c, name = "[DEFAULT]") { return { name }; }`,
  auth: `
// One signed-in user per app, as Firebase keeps them: stored as fakeAuth (default app) or fakeAuth:<name>.
const key = (a) => (a.name === "[DEFAULT]" ? "fakeAuth" : "fakeAuth:" + a.name);
const auths = {};
export function getAuth(app) {
  if (!auths[app.name]) { const a = { name: app.name, user: JSON.parse(localStorage.getItem(key(app)) || "null") }; Object.defineProperty(a, "currentUser", { get() { return a.user; } }); auths[app.name] = a; }
  return auths[app.name];
}
const setUser = (a, u) => { a.user = u ? JSON.parse(JSON.stringify(u)) : null; if (u) localStorage.setItem(key(a), JSON.stringify(u)); else localStorage.removeItem(key(a)); return a.user; };
export function onAuthStateChanged(a, cb) { setTimeout(() => cb(a.user)); return () => {}; }
export class GoogleAuthProvider { setCustomParameters() {} static credential(t) { return { t }; } }
export async function signInWithPopup(a) {
  window.__popups = (window.__popups || 0) + 1;
  const u = window.__fakePopup ? await window.__fakePopup() : { uid: "g-pop", email: "p@example.com", displayName: "Pop Up" };
  if (!u) throw { code: "auth/popup-closed-by-user" };
  return { user: setUser(a, u) };
}
export async function signInWithCredential(a, c) { window.__creds = (window.__creds || 0) + 1; return { user: setUser(a, JSON.parse(atob(c.t))) }; }
export async function updateCurrentUser(a, u) { setUser(a, u); }
export async function signOut(a) { setUser(a, null); }`,
  firestore: `
const call = (op, a) => window.__fakeDb(op, a);
const join = (p, s) => (p && p.path ? p.path + "/" : "") + s.join("/");
export const getFirestore = () => ({});
export const doc = (p, ...s) => ({ path: join(p, s) });
export const collection = (p, ...s) => ({ path: join(p, s) });
export const where = (f, op, v) => ({ f, op, v: v && v.__ts !== undefined ? v.__ts : v });
export const query = (c, ...w) => ({ path: c.path, w });
export const Timestamp = { fromMillis: (m) => ({ __ts: m }) };
export const serverTimestamp = () => ({ __server: true });
const wrap = (d) => { if (d && d.up && "__ts" in d.up) { const m = d.up.__ts; d.up = { toMillis: () => m }; } return d; };
export async function getDoc(r) { const d = await call("get", r.path); return { exists: () => !!d, data: () => (d ? wrap(d) : undefined) }; }
export async function getDocs(q) { const l = await call("query", q); return { docs: l.map(([path, d]) => ({ ref: { path }, data: () => wrap(d) })) }; }
export function writeBatch() { const ops = []; return { set: (r, d) => ops.push(["set", r.path, d]), delete: (r) => ops.push(["del", r.path]), commit: () => call("commit", ops) }; }`,
};

const db = {}; let clock = 1000;
const ts = (v) => (v && typeof v === 'object' && '__ts' in v ? v.__ts : v);
function fakeDb(op, a) {
  if (op === 'get') return db[a] ? JSON.parse(JSON.stringify(db[a])) : null;
  if (op === 'query') {
    return Object.entries(db).filter(([p]) => p.startsWith(a.path + '/') && !p.slice(a.path.length + 1).includes('/'))
      .filter(([, d]) => a.w.every(({ f, op, v }) => (op === '>' ? ts(d[f]) > v : op === '<' ? ts(d[f]) < v : true)))
      .map(([p, d]) => [p, JSON.parse(JSON.stringify(d))]);
  }
  if (op === 'commit') {
    for (const [o, p, d] of a) {
      if (o === 'del') delete db[p];
      else db[p] = JSON.parse(JSON.stringify(d, (k, v) => (v && v.__server ? { __ts: ++clock } : v)));
    }
    return null;
  }
}
const LUKE = { uid: 'g-luke', email: 'luke@example.com', displayName: 'luke smith' };
const sessionsOf = (uid) => Object.keys(db).filter((p) => p.startsWith(`${COL}/${uid}/sessions/`));
const day = (n, m = 0) => new Date(Date.now() - n * 864e5 - m * 6e4).toISOString();
const sess = (date, first, struggled, lang) => ({ date, game: 'spell', ...(lang ? { lang } : {}), level: 'Y4', minutes: 10, length: 10, finished: true, firstTry: first, struggled, firstTryWords: [], struggledWords: [] });

const boardRows = {}; // id -> the last row written to the Worker
(async () => {
  const b = await chromium.launch();
  const errs = [];
  async function device(name, account) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript(() => { speechSynthesis.speak = () => {}; });
    await ctx.exposeFunction('__fakeDb', fakeDb);
    await ctx.exposeFunction('__fakePopup', () => account);
    for (const n of Object.keys(FAKE)) await ctx.route(SDK + n + '.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE[n] }));
    // The ranking board's Worker: keeps the last week written for each id (the board itself is tested in board.js).
    await ctx.route('https://typing-zen-board.trix69.workers.dev/**', (r) => { const q = r.request(); if (q.method() === 'POST') { const x = JSON.parse(q.postData()); boardRows[x.id] = x; }
      r.fulfill({ status: q.method() === 'OPTIONS' ? 204 : 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'Content-Type, X-Board-Key', 'content-type': 'application/json' }, body: q.method() === 'OPTIONS' ? '' : JSON.stringify({ ok: true, rows: [] }) }); });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.goto(base); await p.waitForTimeout(400);
    return { ctx, p };
  }
  const store = (p) => p.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY);
  const me = async (p) => { const s = await store(p); return s.users[s.current]; };
  const put = async (p, f) => { const s = await store(p); f(s.users[s.current]); await p.evaluate(([K, v]) => localStorage.setItem(K, JSON.stringify(v)), [KEY, s]); };
  const reopen = async (p) => { await p.reload(); await p.waitForTimeout(400); await p.click('#continueBtn'); await p.waitForTimeout(900); };
  const lang = async (p, l) => { await p.click('#settingsBtn'); await p.click(`#segLang [data-lang=${l}]`); await p.waitForTimeout(200); await p.click('#sheetDone'); await p.waitForTimeout(5000); };

  // 1. Device A: a Google user, English, with two sessions (one saved before sessions had a language).
  const A = await device('A', LUKE);
  await A.p.click('#googleNew'); await A.p.click('#gContinue'); await A.p.waitForTimeout(400);
  await A.p.click('#newYear button[data-year="Y4"]'); await A.p.click('#newForm [type=submit]'); await A.p.waitForTimeout(800);
  await put(A.p, (u) => { u.sessions = [sess(day(2), 8, 2), sess(day(0, 5), 6, 0, 'en')]; u.stars = 5; u.tricky = { because: 1 }; });
  await reopen(A.p);
  ok(sessionsOf('g-luke').length === 2, `A: 2 English sessions in the cloud (${sessionsOf('g-luke').length})`);

  // 2. A switches to 中文: nothing cleared, English put away; a Chinese session follows.
  await lang(A.p, 'zh');
  let u = await me(A.p);
  ok(u.lang === 'zh' && u.sessions.length === 0 && u.stars === 0 && u.byLang.en.sessions.length === 2 && u.byLang.en.stars === 5 && u.byLang.en.sessions.every((x) => x.lang === 'en'),
    `A: 中文 starts empty; English kept apart (${u.byLang.en.sessions.length} sessions, ${u.byLang.en.stars} stars, both tagged en)`);
  ok(db[`${COL}/g-luke`].p.lang === 'zh' && db[`${COL}/g-luke`].p.byLang.en.stars === 5 && !('sessions' in db[`${COL}/g-luke`].p.byLang.en),
    'cloud profile: lang zh, English scores under byLang (its sessions stay in the sessions collection)');
  await put(A.p, (u) => { u.sessions = [sess(day(0, 3), 4, 1, 'zh')]; u.stars = 2; });
  await reopen(A.p);
  ok(sessionsOf('g-luke').length === 3, `A: the Chinese session went up too (${sessionsOf('g-luke').length})`);
  ok(/5 words/.test(await A.p.textContent('#todayStats')), `A: today counts Chinese only: "${await A.p.textContent('#todayStats')}"`);

  // 3. Device B signs in: Chinese now, English apart, each with its own sessions.
  const B = await device('B', LUKE);
  await B.p.click('#googleNew'); await B.p.click('#gContinue'); await B.p.waitForTimeout(400); await B.p.waitForTimeout(1200);
  u = await me(B.p);
  ok(u.lang === 'zh' && u.sessions.length === 1 && u.sessions[0].lang === 'zh' && u.byLang.en && u.byLang.en.sessions.length === 2 && u.byLang.en.stars === 5,
    `B: 中文 with its 1 session; English apart with ${u.byLang.en && u.byLang.en.sessions.length} sessions and ${u.byLang.en && u.byLang.en.stars} stars`);

  // 4. B goes back to English: English's history is back, the week counts English only.
  await put(B.p, (u) => { u.share = true; });
  await B.p.reload(); await B.p.waitForTimeout(400); await B.p.click('#continueBtn'); await B.p.waitForTimeout(900);
  await lang(B.p, 'en');
  for (let t = 0; t < 20 && !boardRows['g:g-luke']; t++) await B.p.waitForTimeout(250);
  const entry = boardRows['g:g-luke'];
  const total = entry ? Object.values(entry.days).reduce((a, x) => a + x, 0) : -1;
  ok(total === 21, `the board adds every language's words (English 16 + Chinese 5 = ${total})`);
  u = await me(B.p);
  ok(u.lang === 'en' && u.sessions.length === 2 && u.stars === 5 && u.tricky.because === 1 && u.byLang.zh.sessions.length === 1 && u.byLang.zh.stars === 2,
    `B: English restored (${u.sessions.length} sessions, ${u.stars} stars, tricky kept); 中文 put away (${u.byLang.zh.sessions.length}, ${u.byLang.zh.stars} stars)`);
  await B.p.click('#statsBtn'); await B.p.waitForTimeout(300);
  ok(/16 words/.test(await B.p.textContent('#weekLine')), `B: last 7 days counts English only: "${await B.p.textContent('#weekLine')}"`);

  // 5. B chose English by hand after A chose 中文: A follows at its next sync (user's request, 2026-11-04: every setting
  // follows the cloud when the cloud's is newer); each language's history stays its own.
  await reopen(A.p); await A.p.waitForTimeout(1500);
  u = await me(A.p);
  ok(u.lang === 'en' && u.sessions.length === 2 && u.sessions.every((x) => x.lang === 'en') && u.stars === 5 && u.byLang.zh.sessions.length === 1 && u.byLang.zh.stars === 2,
    `A: follows B's later choice to English (${u.sessions.length} English sessions, ${u.stars} stars); 中文 kept (${u.byLang.zh.sessions.length} session, ${u.byLang.zh.stars} stars)`);

  // 5b. The bug (user's reports): A chooses 中文 and Random; B, still in English, then changes only its key sound and
  // syncs later. A must stay in 中文 with Random; B follows A's later choices.
  await lang(A.p, 'zh');
  await A.p.click('#settingsBtn'); await A.p.click('#segOrder [data-order=random]'); await A.p.waitForTimeout(200); await A.p.click('#sheetDone'); await A.p.waitForTimeout(5000);
  if (await B.p.isVisible('#continueBtn')) { await B.p.click('#continueBtn'); await B.p.waitForTimeout(600); }
  await B.p.click('#settingsBtn'); await B.p.click('#segSound button:last-child'); await B.p.waitForTimeout(200); await B.p.click('#sheetDone'); await B.p.waitForTimeout(5000);
  await reopen(A.p); await A.p.waitForTimeout(1500);
  const ua = await me(A.p);
  ok(ua.lang === 'zh' && ua.practiseOrder === 'random' && ua.voice === 'zh-female', `A: B's later activity leaves A in 中文, Random, Mandarin voice (${ua.lang}, ${ua.practiseOrder}, ${ua.voice})`);
  await reopen(B.p); await B.p.waitForTimeout(1500);
  const ub = await me(B.p);
  ok(ub.lang === 'zh' && ub.practiseOrder === 'random' && ub.sessions.length === 1 && ub.byLang.en.sessions.length === 2, `B: follows A's later choices (${ub.lang}, ${ub.practiseOrder}); histories intact`);
  ok(ua.keySound === ub.keySound || (await me(A.p)).keySound === ub.keySound, `B's key sound change is kept too (${ub.keySound})`);

  // 5c. Hermes R84.1: B chooses English while A is in a round, and A syncs mid-round. A keeps its round and language,
  // the cloud keeps B's choice (A doesn't write its copy over it), and A follows once the round is over.
  await A.p.click('.mode[data-mode="spell"]'); await A.p.click('#lenChoices button'); await A.p.waitForTimeout(600);
  await lang(B.p, 'en');
  const sync = (p) => p.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await sync(A.p); await A.p.waitForTimeout(2500);
  const mid = await me(A.p), cloud = db[`${COL}/g-luke`].p;
  ok(mid.lang === 'zh' && await A.p.isVisible('#play') && cloud.lang === 'en' && !!(cloud.setAt || {}).lang,
    `mid-round sync: A stays in 中文 in its round; the cloud still has B's English and its time (${cloud.lang}, ${!!(cloud.setAt || {}).lang})`);
  await A.p.keyboard.press('Escape'); await A.p.keyboard.press('Escape'); await A.p.waitForTimeout(400);
  await sync(A.p); await A.p.waitForTimeout(2500);
  ok((await me(A.p)).lang === 'en', `after the round A follows B to English (${(await me(A.p)).lang})`);

  // 6. Untagged sessions are English (user's request): a Danish user's old untagged session moves under English on load.
  { const ctx = await b.newContext(); const p = await ctx.newPage();
    await p.addInitScript(([K, v]) => { if (!sessionStorage.d) { sessionStorage.d = 1; localStorage.setItem(K, JSON.stringify(v)); } },
      [KEY, { current: 'u1', users: { u1: { id: 'u1', name: 'Rachel', year: 'Y3', lang: 'da', sessions: [sess(day(1), 3, 0), sess(day(0, 4), 2, 1, 'da')] } } }]);
    await p.goto(base); await p.waitForTimeout(500);
    const r = await me(p);
    ok(r.lang === 'da' && r.sessions.length === 1 && r.sessions[0].lang === 'da' && r.byLang.en.sessions.length === 1 && r.byLang.en.sessions[0].lang === 'en',
      `untagged session filed under English, the Danish one stays (${r.sessions.length} da, ${r.byLang.en.sessions.length} en)`);
    ok(!errs.length, 'no page errors ' + errs.join(' | '));
    await ctx.close(); }
  // 7. A Chinese round saved as English by 1.18 (a sync switched the language mid-round): moved back under Chinese
  // at load, and practised as pinyin (user's bug report, 2026-11-04: Practice asked for 思考 itself).
  { const ctx = await b.newContext(); const p = await ctx.newPage(); const e2 = [];
    p.on('pageerror', (e) => e2.push(e.message));
    await p.addInitScript(([K, v]) => { speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(), 5); if (!sessionStorage.d) { sessionStorage.d = 1; localStorage.setItem(K, JSON.stringify(v)); } },
      [KEY, { current: 'u1', users: { u1: { id: 'u1', name: 'Mei', year: 'Y4', lang: 'en', sessions: [sess(day(1), 3, 0, 'en'), { ...sess(day(0, 30), 1, 1, 'en'), firstTryWords: ['历史'], struggledWords: ['思考'] }],
        byLang: { zh: { stars: 1, sessions: [] } } } } }]);
    await p.goto(base); await p.waitForTimeout(500);
    let m = await me(p);
    ok(m.sessions.length === 1 && m.sessions[0].lang === 'en' && m.byLang.zh.sessions.length === 1 && m.byLang.zh.sessions[0].lang === 'zh',
      `the mis-filed Chinese session moved to Chinese (${m.sessions.length} en, ${m.byLang.zh.sessions.length} zh)`);
    await p.click('#continueBtn'); await p.click('#settingsBtn'); await p.click('#segLang [data-lang=zh]'); await p.waitForTimeout(200); await p.click('#sheetDone');
    await p.click('#statsBtn'); await p.waitForTimeout(300); await p.click('#missedBtn'); await p.waitForTimeout(300);
    await p.click('#missedDays button[data-day]'); await p.waitForTimeout(700);
    const pc = await p.evaluate(() => ({ hanzi: document.querySelector('#card .hanzi')?.textContent, line: document.querySelector('#line').textContent }));
    ok(pc.hanzi === '思考' && pc.line === 'sikao', `Practice: 思考 typed as ${pc.line}`);
    ok(!e2.length, 'no page errors ' + e2.join(' | '));
    await ctx.close(); }
  // 8. The stats card shows only the language on screen (user's request, 2026-11-04).
  { const ctx = await b.newContext(); const p = await ctx.newPage();
    await p.addInitScript(([K, v]) => { speechSynthesis.speak = () => {}; if (!sessionStorage.d) { sessionStorage.d = 1; localStorage.setItem(K, JSON.stringify(v)); } },
      [KEY, { current: 'u1', users: { u1: { id: 'u1', name: 'Mei', year: 'Y4', lang: 'en', sessions: [{ ...sess(day(0, 50), 2, 1, 'en'), firstTryWords: ['dog', 'cat'], struggledWords: ['because'] }],
        byLang: { zh: { sessions: [{ ...sess(day(0, 40), 3, 0, 'zh'), firstTryWords: ['你好', '朋友', '苹果'] }] } } } } }]);
    await p.goto(base); await p.waitForTimeout(500);
    const card = async () => { const w = await p.textContent('#weekLine'); await p.click('#missedBtn'); await p.waitForTimeout(300); const d = await p.textContent('#missedDays'); await p.keyboard.press('Escape'); await p.waitForTimeout(200); return [w, d]; };
    const en = await card();
    ok(/3 words/.test(en[0]) && /because/.test(en[1]) && !/你好/.test(en[1]), `English on screen: only English (${en[0].replace(/\s+/g, ' ')})`);
    await p.click('#welcomeSettingsBtn'); await p.click('#segLang [data-lang=zh]'); await p.click('#sheetDone'); await p.waitForTimeout(300);
    const zh = await card();
    ok(/3 words/.test(zh[0]) && /你好/.test(zh[1]) && !/because|dog/.test(zh[1]), `中文 on screen: only Chinese (${zh[1].replace(/\s+/g, ' ').slice(0, 60)})`);
    await ctx.close(); }
  // 9. Clear history clears every language.
  await A.p.click('#settingsBtn'); await A.p.click('#clearBtn'); await A.p.click('#clearYes'); await A.p.click('#clearYes'); await A.p.waitForTimeout(300);
  u = await me(A.p);
  ok(!u.sessions.length && !Object.keys(u.byLang).length, 'Clear history: every language cleared');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
