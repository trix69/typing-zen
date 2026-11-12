// Google sign-in and sync, against a fake Firebase (auth + Firestore) shared by two "devices" (browser contexts).
// node google.js base storageKey collection
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
// n days ago, m minutes before now (always in the past, and on today's date for n = 0 unless it is just after midnight)
const day = (n, m = 0) => new Date(Date.now() - n * 864e5 - m * 6e4).toISOString();
const sess = (date, first, struggled) => ({ date, game: 'spell', level: 'Year 4', minutes: 10, length: 10, finished: true, firstTry: first, struggled, firstTryWords: [], struggledWords: struggled ? ['because'] : [] });

(async () => {
  const b = await chromium.launch();
  const errs = [];
  async function device(name, account) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    ctx.account = account;
    await ctx.addInitScript(() => { speechSynthesis.speak = () => {}; });
    await ctx.exposeFunction('__fakeDb', fakeDb);
    await ctx.exposeFunction('__fakePopup', () => ctx.account);
    for (const n of Object.keys(FAKE)) await ctx.route(SDK + n + '.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE[n] }));
    await ctx.route(/\/app\.js(\?|$)/, async (r) => {
      const res = await r.fetch(); let js = await res.text();
      js = js.replace('const FIREBASE = null;', 'const FIREBASE = { apiKey: "x", projectId: "fake" };');
      r.fulfill({ response: res, body: js });
    });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.goto(base); await p.waitForTimeout(400);
    return { ctx, p };
  }
  const store = (p) => p.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY);
  const settle = (p, ms = 5500) => p.waitForTimeout(ms);
  const vis = (p, s) => p.isVisible(s);
  // R46.4: Clear history on a Google user stays cleared after the sync, here and in the cloud.
  const A = await device('A', LUKE);
  await A.p.click('#googleNew'); await A.p.click('#gContinue'); await A.p.waitForTimeout(400);
  await A.p.click('#newYear button[data-year="Y4"]'); await A.p.click('#newForm [type=submit]'); await A.p.waitForTimeout(300);
  let s = await store(A.p); const id = s.current;
  Object.assign(s.users[id], { stars: 12, bestWpm: 31, rounds: 5, tricky: { because: 2 }, seen: { because: 3 }, learned: { because: '2026-10-30' },
    sessions: [sess(day(1), 8, 2)], updated: new Date().toISOString() });
  await A.p.evaluate(([K, v]) => localStorage.setItem(K, JSON.stringify(v)), [KEY, s]);
  await A.p.reload(); await A.p.waitForTimeout(400); await A.p.click('#continueBtn');
  await A.p.evaluate(() => window.dispatchEvent(new Event('online'))); await settle(A.p, 1500);
  const before = db[`${COL}/g-luke`];
  ok(before && before.p.stars === 12 && before.p.bestWpm === 31 && sessionsOf('g-luke').length === 1, `cloud before: stars ${before && before.p.stars}, best ${before && before.p.bestWpm}, sessions ${sessionsOf('g-luke').length}`);
  // Clear history (asked twice).
  await A.p.evaluate(() => { document.querySelector('#settingsBtn, [aria-label="Settings"]')?.click(); });
  await A.p.waitForTimeout(300);
  await A.p.click('#clearBtn'); await A.p.waitForTimeout(200);
  await A.p.click('#clearYes'); await A.p.waitForTimeout(200);
  await A.p.click('#clearYes'); await A.p.waitForTimeout(200);
  s = await store(A.p); let u = s.users[id];
  ok(u.stars === 0 && u.bestWpm === 0 && u.rounds === 0 && u.resetAt, `right after clearing: ${u.stars}/${u.bestWpm}/${u.rounds}`);
  await settle(A.p, 5500);
  s = await store(A.p); u = s.users[id];
  ok(u.stars === 0 && u.bestWpm === 0 && u.rounds === 0, `5.5 s later, here: stars ${u.stars}, best ${u.bestWpm}, rounds ${u.rounds}`);
  ok(!Object.keys(u.seen).length && !Object.keys(u.learned).length && !Object.keys(u.tricky).length, `5.5 s later, here: seen ${JSON.stringify(u.seen)} learned ${JSON.stringify(u.learned)} tricky ${JSON.stringify(u.tricky)}`);
  const after = db[`${COL}/g-luke`];
  ok(after.p.stars === 0 && after.p.bestWpm === 0 && after.p.rounds === 0 && after.resetAt === u.resetAt, `cloud after: stars ${after.p.stars}, best ${after.p.bestWpm}, rounds ${after.p.rounds}`);
  ok(!Object.keys(after.p.seen || {}).length && sessionsOf('g-luke').length === 0, `cloud after: seen ${JSON.stringify(after.p.seen)}, sessions ${sessionsOf('g-luke').length}`);
  ok(u.year === 'Y4', `year kept: ${u.year}`);
  // A second device signing in now gets the cleared copy.
  const B = await device('B', LUKE);
  await B.p.click('#googleNew'); await B.p.click('#gContinue'); await settle(B.p, 1200);
  const sb = await store(B.p); const ub = sb.users[sb.current];
  ok(ub.stars === 0 && ub.bestWpm === 0 && ub.sessions.length === 0, `device B: ${ub.stars}/${ub.bestWpm}/${ub.sessions.length}`);
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
