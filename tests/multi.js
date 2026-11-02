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

  const TRIX = { uid: 'g-trix', email: 'trix@example.com', displayName: 'Trix' };
  const note = (p) => p.evaluate(() => { document.querySelector('#settingsBtn').click(); const t = document.querySelector('#syncNote').textContent; document.querySelector('#sheetDone').click(); return t; });
  // One device: Luke signs in and is set up, then Trix signs in as a second user.
  const A = await device('A', LUKE);
  await A.p.click('#googleNew'); await A.p.waitForTimeout(400);
  await A.p.click('#newYear button[data-year="Y4"]'); await A.p.click('#newForm [type=submit]'); await settle(A.p, 600);
  A.ctx.account = TRIX;
  await A.p.click('#settingsBtn'); await A.p.waitForTimeout(200); await A.p.click('#switchUserBtn, [id*=switch i]').catch(() => {});
  await A.p.evaluate(() => { const s = document.querySelector('#sheet'); if (s && !s.hidden) document.querySelector('#sheetDone').click(); });
  await A.p.goto(base); await A.p.waitForTimeout(400); await A.p.click('#switchBtn'); await A.p.waitForTimeout(200);
  await A.p.click('#googleSwitch'); await A.p.waitForTimeout(500);
  await A.p.click('#newYear button[data-year="Y5"]'); await A.p.click('#newForm [type=submit]'); await settle(A.p, 600);
  let s = await store(A.p);
  ok(Object.values(s.users).length === 2, `two Google users on one device (${Object.values(s.users).map((u) => u.name).join(', ')})`);
  ok(/Synced with Google \(trix@example.com\)/.test(await note(A.p)), 'Trix syncs');
  // Back to Luke: still signed in, still syncing.
  await A.p.goto(base); await A.p.waitForTimeout(400); await A.p.click('#switchBtn'); await A.p.waitForTimeout(200);
  await A.p.click('#userList .user >> text=Luke'); await settle(A.p, 1500);
  ok(/Synced with Google \(luke@example.com\)/.test(await note(A.p)), `Luke still syncs after Trix signed in: "${await note(A.p)}"`);
  s = await store(A.p);
  const keys = await A.p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('fakeAuth')).sort());
  ok(JSON.stringify(keys) === '["fakeAuth:u-g-luke","fakeAuth:u-g-trix"]', `each user has their own sign-in, the front door is empty: ${JSON.stringify(keys)}`);
  // Log out Trix: Luke stays signed in.
  await A.p.goto(base); await A.p.waitForTimeout(400); await A.p.click('#switchBtn'); await A.p.waitForTimeout(200);
  await A.p.click('#userList .user >> text=Trix'); await settle(A.p, 800);
  await A.p.click('#settingsBtn'); await A.p.waitForTimeout(200); await A.p.click('#logoutBtn'); await A.p.waitForTimeout(200); await A.p.click('#logoutYes'); await A.p.waitForTimeout(1200);
  const keys2 = await A.p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('fakeAuth')).sort());
  ok(JSON.stringify(keys2) === '["fakeAuth:u-g-luke"]', `logging Trix out leaves Luke signed in: ${JSON.stringify(keys2)}`);
  await A.ctx.close();
  // An older build's sign-in (on the default app) moves to the user's own app on the next sync.
  const B = await device('B', LUKE);
  await B.p.click('#googleNew'); await settle(B.p, 800); // Luke's progress is in the cloud: straight to home
  await B.p.evaluate(() => { const v = localStorage.getItem('fakeAuth:u-g-luke'); localStorage.removeItem('fakeAuth:u-g-luke'); localStorage.setItem('fakeAuth', v); });
  await B.p.reload(); await B.p.waitForTimeout(400); await B.p.click('#continueBtn'); await settle(B.p, 1500);
  ok(/Synced with Google \(luke@example.com\)/.test(await note(B.p)), 'an old-style sign-in still syncs');
  const keys3 = await B.p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('fakeAuth')).sort());
  ok(JSON.stringify(keys3) === '["fakeAuth:u-g-luke"]', `and has moved to its own app: ${JSON.stringify(keys3)}`);
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
