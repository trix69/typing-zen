// The ranking board (2026-11-13: every user can share, rows on the Worker, asked at word milestones), against the
// Worker's own code with an in-memory database, and a fake Firebase for Google sync. node board.js base storageKey collection
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
let failSync = false; // the user's own documents can't be read: the sync fails, the board still can be
function fakeDb(op, a) {
  if (failSync && (op === 'get' || op === 'query') && String(a.path || a).startsWith(COL + '/')) throw new Error('unavailable');
  if (op === 'get') return db[a] ? JSON.parse(JSON.stringify(db[a])) : null;
  if (op === 'query') {
    return Object.entries(db).filter(([p]) => p.startsWith(a.path + '/') && !p.slice(a.path.length + 1).includes('/'))
      .filter(([, d]) => a.w.every(({ f, op, v }) => (op === '>' ? ts(d[f]) > v : op === '<' ? ts(d[f]) < v : true)))
      .map(([p, d]) => [p, JSON.parse(JSON.stringify(d))]);
  }
  if (op === 'commit') {
    // commitDelay: real Firestore takes a second or so; a slow commit keeps a sync in flight (R89, Stella).
    if (commitDelay) return new Promise((r) => setTimeout(() => r(fakeDb('commitNow', a)), commitDelay));
    return fakeDb('commitNow', a);
  }
  if (op === 'commitNow') {
    for (const [o, p, d] of a) {
      if (o === 'del') delete db[p];
      else db[p] = JSON.parse(JSON.stringify(d, (k, v) => (v && v.__server ? { __ts: ++clock } : v)));
    }
    return null;
  }
}
let commitDelay = 0;
const LUKE = { uid: 'g-luke', email: 'luke@example.com', displayName: 'luke smith' };
const sessionsOf = (uid) => Object.keys(db).filter((p) => p.startsWith(`${COL}/${uid}/sessions/`));
// n days ago, m minutes before now (always in the past, and on today's date for n = 0 unless it is just after midnight)
const day = (n, m = 0) => new Date(Date.now() - n * 864e5 - m * 6e4).toISOString();
const sess = (date, first, struggled) => ({ date, game: 'spell', level: 'Year 4', minutes: 10, length: 10, finished: true, firstTry: first, struggled, firstTryWords: [], struggledWords: struggled ? ['because'] : [] });

(async () => {
  const b = await chromium.launch();
  const errs = [];
  const BOARD = COL.replace('users', 'board'); // Firestore's old board: read once more to move a row across
  const SITE = /typing-zen-test/.test(base) ? 'test' : 'live';
  const API = 'https://typing-zen-board.trix69.workers.dev';
  // The Worker's own code, with an in-memory D1.
  const { handle } = await import(require('path').join(__dirname, '..', 'worker', 'src', 'index.js'));
  const table = new Map();
  const D1 = { prepare: (sql) => ({ bind: (...a) => ({
    async all() { return { results: [...table.values()].filter((r) => r.site === a[0] && r.updated >= a[1]) }; },
    async first() { return table.get(a[0] + '|' + a[1]) || null; },
    async run() {
      if (/hits/.test(sql)) { hitCount++; return {}; } // launch counts: not part of the board
      if (/^INSERT/.test(sql)) { const k = a[0] + '|' + a[1], had = table.get(k); table.set(k, had ? { ...had, name: a[2], days: a[3], updated: a[5] } : { site: a[0], id: a[1], name: a[2], days: a[3], key_hash: a[4], updated: a[5] }); }
      if (/^DELETE/.test(sql)) table.delete(a[0] + '|' + a[1]);
      return {};
    } }) }) };
  let workerDown = false, workerCalls = 0, hitCount = 0;
  async function routeWorker(ctx) {
    await ctx.route(API + '/**', async (r) => {
      workerCalls++;
      if (workerDown) return r.abort('internetdisconnected');
      const q = r.request(), res = await handle(new Request(q.url(), { method: q.method(), headers: { ...q.headers(), origin: 'https://trix69.github.io' }, body: ['GET', 'HEAD', 'OPTIONS'].includes(q.method()) ? undefined : q.postData() }), { DB: D1 });
      const headers = Object.fromEntries(res.headers.entries()); headers['access-control-allow-origin'] = '*';
      r.fulfill({ status: res.status, headers, body: await res.text() });
    });
  }
  const row = (id) => { const x = table.get(SITE + '|' + id); return x ? { ...x, days: JSON.parse(x.days) } : null; };
  const sum = (x) => (x ? Object.values(x.days).reduce((a, n) => a + n, 0) : 0);
  const iso = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
  // Nine others on the board; one with only old days (8+ days ago) counts as 0 and is left out.
  const others = [['Am**y', 90], ['Be*n', 70], ['Ch*****e', 55], ['Da*d', 40], ['El**a', 33], ['Fi*n', 28], ['Ge*****e', 20], ['Ha****h', 9], ['Iv*n', 2]];
  const seed = () => {
    table.clear();
    others.forEach(([name, w], i) => table.set(`${SITE}|g:other${i}`, { site: SITE, id: `g:other${i}`, name, days: JSON.stringify({ [iso(i % 3)]: w }), key_hash: 'x', updated: Date.now() }));
    table.set(`${SITE}|g:oldone`, { site: SITE, id: 'g:oldone', name: 'Ol*d', days: JSON.stringify({ [iso(9)]: 500 }), key_hash: 'x', updated: Date.now() });
  };
  seed();
  // 9 words this week, all Spelling Bee: one more word reaches the first milestone, 10.
  const WEEK = [sess(day(1), 3, 0), sess(day(0, 2), 2, 0), sess(day(5), 4, 0)];
  const old = (n) => sess(day(20), n, 0); // counts towards the milestones, not this week
  const forget = () => { for (const k of Object.keys(db)) if (k.startsWith(`${COL}/g-luke`) || k === `${BOARD}/g-luke`) delete db[k]; };
  async function signedIn(name, extra = {}) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    ctx.account = LUKE;
    await ctx.addInitScript(([K, u]) => { window.__said = []; speechSynthesis.speak = (x) => { window.__said.push(x.text); setTimeout(() => x.onend && x.onend(), 5); };
      if (!localStorage.getItem(K)) { localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u } })); localStorage.setItem('fakeAuth:u-g-luke', JSON.stringify({ uid: 'g-luke', email: 'luke@example.com', displayName: 'Luke Smith' })); } },
      [KEY, { name: 'Luke Smith', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', sessions: WEEK, google: { uid: 'g-luke', email: 'luke@example.com' }, ...extra }]);
    await ctx.exposeFunction('__fakeDb', fakeDb);
    await ctx.exposeFunction('__fakePopup', () => LUKE);
    for (const n of Object.keys(FAKE)) await ctx.route(SDK + n + '.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE[n] }));
    await routeWorker(ctx);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.clock.install(); await p.goto(base); await p.clock.runFor(600);
    return { ctx, p };
  }
  // A typed-name user (or several) on one browser: nothing Google loads at all.
  async function typed(name, users, current = 'u') {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript(([K, users, current]) => { window.__said = []; speechSynthesis.speak = (x) => { window.__said.push(x.text); setTimeout(() => x.onend && x.onend(), 5); };
      if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current, users })); }, [KEY, users, current]);
    await routeWorker(ctx);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.clock.install(); await p.goto(base); await p.clock.runFor(600);
    return { ctx, p };
  }
  const mia = (extra = {}) => ({ u: { name: 'Mia', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', sessions: WEEK, ...extra } });
  // Spells one word (a Bee with no words done isn't asked about sharing), then lets the time run out.
  async function spellOne(p) {
    let w; for (let t = 0; t < 30 && !w; t++) { w = (await p.evaluate(() => (window.__said || []).find((x) => !/ /.test(x)))); if (!w) await p.clock.runFor(100); }
    if (w) { for (const ch of w) { await p.keyboard.press(ch); await p.clock.runFor(60); } await p.clock.runFor(1600); }
  }
  async function beeToEnd(p, words = true) {
    if (await p.isVisible('#continueBtn')) { await p.click('#continueBtn'); await p.clock.runFor(800); }
    if (await p.isVisible('#homeBtn')) { await p.click('#homeBtn'); await p.clock.runFor(300); }
    await p.click('.mode[data-mode="spell"]'); await p.clock.runFor(300);
    await p.evaluate(() => { window.__said = []; });
    await p.click('#lenChoices button'); await p.clock.runFor(900);
    if (words) await spellOne(p);
    await p.clock.fastForward('21:00'); await p.clock.runFor(3000);
  }
  // The board first syncs and writes, then loads: wait until it has rows or a message, then out the 2 s on Done.
  async function boardLoaded(p) {
    for (let t = 0; t < 40; t++) {
      await p.clock.runFor(250);
      if (await p.evaluate(() => !!document.querySelector('#boardBody .podium') || /Couldn't|offline/.test(document.querySelector('#boardBody')?.textContent || ''))) break;
      await p.waitForTimeout(50);
    }
    for (let t = 0; t < 12 && await p.evaluate(() => document.querySelector('#boardDone').disabled); t++) await p.clock.runFor(250);
  }
  const waitFor = async (p, f) => { for (let t = 0; t < 24 && !f(); t++) { await p.clock.runFor(250); await p.waitForTimeout(150); } return f(); };
  const store = (p) => p.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY);
  const vis = (p, s) => p.isVisible(s);

  // 1. A Google user's 10th word: asked, with their own masked name; Yes → the row on the Worker, then the board.
  let { ctx, p } = await signedIn('A');
  await beeToEnd(p);
  ok(await vis(p, '#results') && await vis(p, '#shareSheet'), 'the 10th word in Spelling Bee: asked on the results');
  ok(await p.textContent('#shareTitle') === 'Do you want to share your details with others and view your rank?', 'the question: ' + await p.textContent('#shareTitle'));
  ok(await p.textContent('#shareAbout') === 'Others will only see your name partly hidden, like Lu*******h.' && await p.textContent('#shareAbout b') === 'Lu*******h', `the line, with this user's own mask in bold: "${await p.textContent('#shareAbout')}"`);
  ok((await p.$$eval('#shareSheet button', (l) => l.map((x) => x.textContent))).join('|') === 'Yes, share|No', 'two choices: Yes, share / No');
  ok((await store(p)).users.u.shareAt === 10, 'shareAt = 10');
  await p.click('#shareYes'); await boardLoaded(p);
  ok(await vis(p, '#boardSheet'), 'Yes opens the board');
  const mine = row('g:g-luke');
  ok(mine && mine.name === 'Lu*******h' && sum(mine) === 10, `the row on the Worker: g:g-luke, masked "${mine && mine.name}", ${mine && JSON.stringify(mine.days)}`);
  const pod = await p.$$eval('.podium .spot', (l) => l.map((s) => [s.className, s.querySelector('.who')?.textContent, s.querySelector('.stair')?.textContent, Math.round(s.querySelector('.stair')?.getBoundingClientRect().height || 0)]));
  ok(JSON.stringify(pod.map((x) => x.slice(0, 3))) === JSON.stringify([['spot p2', 'Be*n', '2'], ['spot p1', 'Am**y', '1'], ['spot p3', 'Ch*****e', '3']]) && pod[1][3] > pod[0][3] && pod[0][3] > pod[2][3],
    `podium: 2 left, 1 middle and highest, 3 right and lowest ${JSON.stringify(pod)}`);
  const list = await p.$$eval('.board-list li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(JSON.stringify(list) === JSON.stringify(['#4Da*d40 words', '#5El**a33 words', '…', '#7Ge*****e20 words', '#8Luke Smith (you)10 words', '#9Ha****h9 words', '…']), `list: ${JSON.stringify(list)}`);
  ok((await p.textContent('#boardBody .note')) === "You're #8 of 10.", `"${await p.textContent('#boardBody .note')}" (the row with only old days is left out)`);
  await p.click('#boardDone'); await p.clock.runFor(200);
  ok(await vis(p, '#boardBtn'), 'results now show "See where you rank"');
  // Settings: Yes is chosen; No takes the row off and stops every later milestone.
  await p.click('#homeBtn'); await p.clock.runFor(300); await p.click('#settingsBtn'); await p.clock.runFor(200);
  ok(await p.$eval('#segShare [data-share="yes"]', (x) => x.getAttribute('aria-checked')) === 'true' && /Lu\*{7}h/.test(await p.textContent('#shareNote')), 'Settings shows Share: Yes, and the name as others see it');
  await p.click('#segShare [data-share="no"]'); await p.clock.runFor(1000);
  await waitFor(p, () => !row('g:g-luke'));
  ok(!row('g:g-luke') && (await store(p)).users.u.share === false, 'Settings No: the row is deleted from the Worker');
  await p.click('#sheetDone'); await p.clock.runFor(200);
  await p.evaluate((K) => { const s = JSON.parse(localStorage.getItem(K)); s.users.u.sessions.push({ date: new Date(Date.now() - 20 * 864e5).toISOString(), game: 'spell', level: 'Y4', minutes: 10, length: 10, finished: true, firstTry: 60, struggled: 0, firstTryWords: [], struggledWords: [] }); localStorage.setItem(K, JSON.stringify(s)); }, KEY);
  await p.reload(); await p.clock.runFor(600);
  await beeToEnd(p);
  ok(await vis(p, '#results') && !(await vis(p, '#shareSheet')) && !(await vis(p, '#boardBtn')), 'after No in Settings: not asked even past 50, no board button');
  await ctx.close();
  forget(); seed();

  // 2. The milestones: No at 10 → not asked at 11; asked at 50; a jump from 8 past 50 asks once, for 50; then 100, 200.
  ({ ctx, p } = await typed('M1', mia()));
  await beeToEnd(p);
  ok(await vis(p, '#shareSheet'), 'typed-name user: asked at 10 too');
  await p.click('#shareNo'); await p.clock.runFor(300);
  let st = await store(p);
  ok(st.users.u.share === undefined && st.users.u.shareAt === 10 && table.size === 10, 'No: nothing sent (the Worker has only the 10 seeded rows), shareAt 10');
  await beeToEnd(p);
  ok(!(await vis(p, '#shareSheet')), 'No at 10: not asked again at 11');
  await ctx.close();
  ({ ctx, p } = await typed('M2', mia({ sessions: [...WEEK, old(40)], shareAt: 10 })));
  await beeToEnd(p);
  ok(await vis(p, '#shareSheet') && (await store(p)).users.u.shareAt === 50, 'asked again at 50');
  await p.click('#shareNo'); await p.clock.runFor(300); await beeToEnd(p);
  ok(!(await vis(p, '#shareSheet')), 'No at 50: not at 51');
  await ctx.close();
  ({ ctx, p } = await typed('M3', mia({ sessions: [sess(day(1), 8, 0), old(46)] }))); // 54 words, never asked: one round crosses 10 and 50
  await beeToEnd(p);
  st = await store(p);
  ok(await vis(p, '#shareSheet') && st.users.u.shareAt === 50, `8 → 55 words in one go: asked once, for 50 (shareAt ${st.users.u.shareAt})`);
  await p.click('#shareNo'); await p.clock.runFor(300); await beeToEnd(p);
  ok(!(await vis(p, '#shareSheet')), 'and not asked again straight after (10 is behind it)');
  await ctx.close();
  for (const [have, at, next] of [[99, 50, 100], [199, 100, 200], [399, 200, 400], [1599, 800, 1600]]) {
    ({ ctx, p } = await typed('M' + next, mia({ sessions: [...WEEK, old(have - 9)], shareAt: at })));
    await beeToEnd(p);
    ok(await vis(p, '#shareSheet') && (await store(p)).users.u.shareAt === next, `${have} → ${have + 1} words: asked at ${next}`);
    await ctx.close();
  }
  ({ ctx, p } = await typed('M101', mia({ sessions: [...WEEK, old(91)], shareAt: 100 })));
  await beeToEnd(p);
  ok(!(await vis(p, '#shareSheet')), '100 → 101 with 100 already asked: not asked');
  await ctx.close();
  ({ ctx, p } = await typed('Mold', mia({ sessions: [...WEEK, old(91)], shareAsk: false })));
  await beeToEnd(p);
  ok(!(await vis(p, '#shareSheet')), 'the old "Don\'t remind me again": not asked at milestones either');
  await ctx.close();

  // 3. Never during a game; a question missed on the results comes on Home; the stats card never asks.
  ({ ctx, p } = await typed('N', mia()));
  ok(!(await vis(p, '#shareSheet')), 'stats card (Welcome back) with 9 words: not asked');
  await beeToEnd(p, false);
  ok(await vis(p, '#results') && !(await vis(p, '#shareSheet')), 'a Bee with no words done: not asked');
  await p.click('#homeBtn'); await p.clock.runFor(300);
  await p.click('.mode[data-mode="spell"]'); await p.clock.runFor(300); await p.evaluate(() => { window.__said = []; });
  await p.click('#lenChoices button'); await p.clock.runFor(900); await spellOne(p);
  await p.clock.fastForward('21:00'); await p.clock.runFor(100);
  await p.waitForFunction(() => !document.querySelector('#results').hidden, null, { timeout: 5000 }).catch(() => {});
  await p.keyboard.press('Enter'); await p.clock.runFor(1500); // straight into the next round, inside the 0.6 s
  const clock0 = await p.textContent('#clock'); await p.clock.runFor(3000);
  ok(await vis(p, '#play') && !(await vis(p, '#shareSheet')), `Enter inside the 0.6 s: the next round, no question over it (clock ${clock0} → ${await p.textContent('#clock')})`);
  await p.keyboard.press('Escape'); await p.clock.runFor(200); await p.keyboard.press('Escape'); await p.clock.runFor(1500);
  ok(await vis(p, '#home') && await vis(p, '#shareSheet'), 'the missed question comes once Home is shown');
  await p.keyboard.press('Escape'); await p.clock.runFor(200);
  ok(!(await vis(p, '#shareSheet')) && (await store(p)).users.u.shareAt === 10, 'Esc closes it (a No for this milestone)');
  await ctx.close();

  // 3b. A Spelling Bee left early (Esc twice, straight to Home) that reached a milestone: asked on Home.
  ({ ctx, p } = await typed('N2', mia()));
  await p.click('#continueBtn'); await p.clock.runFor(800);
  await p.click('.mode[data-mode="spell"]'); await p.clock.runFor(300); await p.evaluate(() => { window.__said = []; });
  await p.click('#lenChoices button'); await p.clock.runFor(900); await spellOne(p);
  await p.keyboard.press('Escape'); await p.clock.runFor(200); await p.keyboard.press('Escape'); await p.clock.runFor(1500);
  ok(await vis(p, '#home') && await vis(p, '#shareSheet') && (await store(p)).users.u.shareAt === 10, 'a Bee left early at the 10th word: asked on Home');
  await ctx.close();
  // 4. A typed-name user who says Yes: an l: row with this browser's install id; two users here are two rows; the
  // stats card has the rank button; Remove account deletes the row.
  ({ ctx, p } = await typed('T', { u: { name: 'Mia', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', sessions: WEEK }, v: { name: 'Noah', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'v', sessions: WEEK, share: true } }));
  await beeToEnd(p); await p.click('#shareYes'); await boardLoaded(p);
  const install = await p.evaluate((k) => localStorage.getItem(k), /typing-zen-test/.test(base) ? 'typingZen.install-test' : 'typingZen.install');
  const miaId = 'l:' + install + ':' + (await store(p)).users.u.localId;
  ok(/^[A-Za-z0-9_-]{24}$/.test(install) && row(miaId) && row(miaId).name === 'M*a' && sum(row(miaId)) === 10, `typed-name Yes: row ${miaId.slice(0, 12)}…, "M*a", ${sum(row(miaId))} words`);
  ok(/Mia \(you\)/.test(await p.textContent('#boardBody')), 'the board shows "Mia (you)"');
  await p.click('#boardDone'); await p.clock.runFor(200);
  await p.evaluate((K) => { const s = JSON.parse(localStorage.getItem(K)); s.current = 'v'; localStorage.setItem(K, JSON.stringify(s)); }, KEY);
  await p.reload(); await p.clock.runFor(600);
  ok(await vis(p, '#rankBtn'), 'stats card: a typed-name sharer has "See where you rank"');
  await p.click('#rankBtn'); await boardLoaded(p);
  const noahId = 'l:' + install + ':' + (await store(p)).users.v.localId;
  ok(noahId !== miaId && row(noahId) && row(noahId).name === 'N**h' && row(miaId), 'a second typed-name user on this browser: a second row, same install id');
  await p.click('#boardDone'); await p.clock.runFor(200);
  await p.click('#continueBtn'); await p.clock.runFor(600); await p.click('#settingsBtn'); await p.clock.runFor(200);
  await p.click('#logoutBtn'); await p.click('#logoutYes'); await p.click('#logoutYes'); await p.clock.runFor(300);
  await waitFor(p, () => !row(noahId));
  ok(!row(noahId) && !!row(miaId), 'Remove account: Noah\'s row deleted, Mia\'s kept');
  await ctx.close();

  // 5. Offline (the Worker unreachable): Yes doesn't hold anything up; "Couldn't load the board"; sent once back online.
  seed();
  ({ ctx, p } = await typed('O', mia()));
  await beeToEnd(p);
  workerDown = true;
  await p.click('#shareYes'); await boardLoaded(p);
  ok(/Couldn't load the board/.test(await p.textContent('#boardBody')) && !(await p.evaluate(() => document.querySelector('#boardDone').disabled)), 'Worker unreachable: "Couldn\'t load the board", Done free at once');
  await p.click('#boardDone'); await p.clock.runFor(200);
  ok(await vis(p, '#results') && (await store(p)).users.u.boardPending === true && table.size === 10, 'the results stay usable; the week waits as pending, nothing written');
  workerDown = false;
  await p.evaluate(() => window.dispatchEvent(new Event('online')));
  const miaId2 = 'l:' + await p.evaluate((k) => localStorage.getItem(k), /typing-zen-test/.test(base) ? 'typingZen.install-test' : 'typingZen.install') + ':' + (await store(p)).users.u.localId;
  await waitFor(p, () => !!row(miaId2));
  ok(sum(row(miaId2)) === 10 && (await store(p)).users.u.boardPending === false, 'back online: the pending week is written (10 words)');
  await ctx.close();

  // 6. Google: Yes while the sync after the round is still going (Stella, 2026-11-12): the row is still written.
  seed();
  {
    const saved = JSON.stringify(db);
    ({ ctx, p } = await signedIn('S'));
    await beeToEnd(p);
    commitDelay = 700;
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); // a sync starts and is in flight
    await p.clock.runFor(50);
    await p.click('#shareYes');
    await waitFor(p, () => !!row('g:g-luke'));
    ok(!!row('g:g-luke'), `Yes during a sync still writes the row (${row('g:g-luke') ? JSON.stringify(row('g:g-luke').days) : 'missing'})`);
    commitDelay = 0;
    await ctx.close();
    for (const k of Object.keys(db)) delete db[k];
    Object.assign(db, JSON.parse(saved));
  }
  // 7. The sync fails: the row is still written; a day the Worker already has higher keeps it. A Google sharer's old
  // Firestore row is counted in and deleted there.
  seed(); forget();
  {
    const KEYHEX = 'ab'.repeat(20);
    const h = require('crypto').createHash('sha256').update(KEYHEX).digest('hex');
    table.set(`${SITE}|g:g-luke`, { site: SITE, id: 'g:g-luke', name: 'Lu*******h', days: JSON.stringify({ [iso(0)]: 300 }), key_hash: h, updated: Date.now() });
    db[`${BOARD}/g-luke`] = { name: 'Lu*******h', days: { [iso(1)]: 77 }, updated: 'x' };
    ({ ctx, p } = await signedIn('T2', { share: true, boardKey: KEYHEX }));
    failSync = true;
    await p.click('#rankBtn'); await boardLoaded(p);
    failSync = false;
    const e = row('g:g-luke');
    ok(e.days[iso(0)] === 300 && e.days[iso(1)] === 77 && e.days[iso(5)] === 4, `sync failed, row still written: today keeps 300, the old Firestore day 77 is counted in, this device's day 5 added (${JSON.stringify(e.days)})`);
    ok(!db[`${BOARD}/g-luke`], 'the old Firestore row is deleted once moved');
    await ctx.close();
  }
  // 8. Clear history: the row goes, sharing is undecided again, and the rank button with it.
  seed(); forget();
  ({ ctx, p } = await signedIn('R', { share: true }));
  await p.click('#rankBtn'); await boardLoaded(p); await p.click('#boardDone'); await p.clock.runFor(200);
  const before = sum(row('g:g-luke'));
  await p.click('#continueBtn'); await p.clock.runFor(600);
  await p.click('#settingsBtn'); await p.clock.runFor(300);
  await p.click('#clearBtn'); await p.click('#clearYes'); await p.click('#clearYes'); await p.clock.runFor(300);
  await waitFor(p, () => !row('g:g-luke'));
  st = await store(p);
  ok(before > 0 && !row('g:g-luke') && st.users.u.share === null && st.users.u.shareAt === 0, `Clear history: the row (${before} words) is deleted, share undecided, shareAt 0`);
  await p.click('#sheetDone'); await p.clock.runFor(300); await p.reload(); await p.clock.runFor(600);
  ok(!(await vis(p, '#rankBtn')) && !row('g:g-luke'), 'after a reload: no rank button, and nothing brings the row back');
  await ctx.close();

  // 9. A sharer: never asked; the button; the row is rewritten after each Bee. Tab stays inside the board.
  seed(); forget();
  ({ ctx, p } = await signedIn('C', { share: true }));
  await beeToEnd(p);
  await waitFor(p, () => !!row('g:g-luke'));
  ok(!(await vis(p, '#shareSheet')) && await vis(p, '#boardBtn') && sum(row('g:g-luke')) === 10, 'a sharer: no question, the button, and the row written (10 words)');
  await p.click('#boardBtn'); await boardLoaded(p);
  const bucket0 = (await store(p)).users.u.bucket;
  const inBoard = []; for (let k = 0; k < 6; k++) { await p.keyboard.press('Tab'); inBoard.push(await p.evaluate(() => document.querySelector('#boardSheet').contains(document.activeElement))); }
  await p.keyboard.press('Enter'); await p.clock.runFor(300);
  ok(inBoard.every(Boolean) && (await store(p)).users.u.bucket === bucket0, `Tab x6 stays in the board, and Enter changes nothing behind it (${inBoard.join(',')})`);
  await ctx.close();
  // 10. The stats card: loading line, the 2 s Done, and it writes the row (synced first).
  seed(); forget();
  ({ ctx, p } = await signedIn('H', { share: true }));
  ok(await vis(p, '#intro-back') && await vis(p, '#rankBtn'), 'stats card: a sharer sees "See where you rank"');
  await p.click('#rankBtn');
  ok(/Loading this week's ranking/.test(await p.textContent('#boardBody')) && await p.isVisible('#boardBody .spinner'), 'while loading: "' + (await p.textContent('#boardBody')).trim() + '" with a spinner');
  ok(await p.textContent('#boardDone') === 'Done (2)' && await p.evaluate(() => document.querySelector('#boardDone').disabled), 'Done counts down from 2 and cannot be pressed yet');
  await p.keyboard.press('Escape'); await p.mouse.click(5, 5); await p.clock.runFor(1000);
  ok(await vis(p, '#boardSheet') && await p.textContent('#boardDone') === 'Done (1)', 'Esc and a click outside wait too; after 1 s "Done (1)"');
  for (let k = 0; k < 3; k++) await p.keyboard.press('Tab');
  ok(await p.evaluate(() => document.querySelector('#boardSheet').contains(document.activeElement)), 'Tab stays in the board while Done waits');
  await boardLoaded(p);
  ok(await p.textContent('#boardDone') === 'Done' && await p.evaluate(() => !document.querySelector('#boardDone').disabled && document.activeElement.id === 'boardDone'), 'after 2 s: "Done", pressable and focused');
  ok(/^You're #\d+ of 10\.$/.test(await p.textContent('#boardBody .note')) && /Luke Smith \(you\)/.test(await p.textContent('.board-list')), `stats card: the board, with Luke Smith (you) ("${await p.textContent('#boardBody .note')}")`);
  ok(sum(row('g:g-luke')) === 9, `stats card: the row is written so others see it (${sum(row('g:g-luke'))} words)`);
  await p.keyboard.press('Escape'); await p.clock.runFor(200);
  ok(!(await vis(p, '#boardSheet')) && (await p.evaluate(() => document.activeElement.id)) === 'rankBtn' && await vis(p, '#intro-back'), 'stats card: Esc closes it, focus back on the button');
  await ctx.close();
  forget();
  ({ ctx, p } = await signedIn('I'));
  ok(!(await vis(p, '#rankBtn')), 'stats card: no rank button before saying Yes');
  await ctx.close();
  ({ ctx, p } = await typed('J', mia({ share: false })));
  ok(!(await vis(p, '#rankBtn')), 'stats card: no rank button after No');
  await p.click('#continueBtn'); await p.clock.runFor(600); await p.click('#settingsBtn'); await p.clock.runFor(200);
  ok(!(await p.$eval('#segShare button', (x) => x.disabled)), 'typed-name user: the Settings toggle works (no Google needed)');
  await p.click('#segShare [data-share="yes"]'); await p.clock.runFor(300);
  const jId = 'l:' + await p.evaluate((k) => localStorage.getItem(k), /typing-zen-test/.test(base) ? 'typingZen.install-test' : 'typingZen.install') + ':' + (await store(p)).users.u.localId;
  await waitFor(p, () => !!row(jId));
  ok(!!row(jId), 'Settings Yes writes the row at once');
  await ctx.close();

  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
