// Settings > Delete my data from Google (2026-11-12, for the privacy policy), against a fake Firebase.
// node erase.js base storageKey collection
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3], COL = process.argv[4] || 'typingZen.users';
const BOARD = COL.replace('users', 'board');
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-';

// The same fake as google.js, plus deleteUser (window.__noDelete makes Google refuse it, as it does without a
// recent sign-in).
const FAKE = {
  app: `export function initializeApp(c, name = "[DEFAULT]") { return { name }; }`,
  auth: `
const key = (a) => (a.name === "[DEFAULT]" ? "fakeAuth" : "fakeAuth:" + a.name);
const auths = {};
export function getAuth(app) {
  if (!auths[app.name]) { const a = { name: app.name, user: JSON.parse(localStorage.getItem(key(app)) || "null") }; Object.defineProperty(a, "currentUser", { get() { return a.user; } }); auths[app.name] = a; }
  return auths[app.name];
}
const setUser = (a, u) => { a.user = u ? JSON.parse(JSON.stringify(u)) : null; if (u) localStorage.setItem(key(a), JSON.stringify(u)); else localStorage.removeItem(key(a)); return a.user; };
export function onAuthStateChanged(a, cb) { setTimeout(() => cb(a.user)); return () => {}; }
export class GoogleAuthProvider { setCustomParameters() {} static credential(t) { return { t }; } }
export async function signInWithPopup(a) { throw { code: "auth/popup-closed-by-user" }; }
export async function signInWithCredential(a, c) { throw { code: "x" }; }
export async function updateCurrentUser(a, u) { setUser(a, u); }
export async function signOut(a) { setUser(a, null); }
export async function deleteUser(u) {
  if (window.__noDelete) throw { code: "auth/requires-recent-login" };
  window.__deleted = (window.__deleted || []).concat(u.uid);
  for (const a of Object.values(auths)) if (a.user && a.user.uid === u.uid) setUser(a, null);
}`,
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
export async function getDocs(q) { const l = await call("query", { path: q.path, w: q.w || [] }); return { docs: l.map(([path, d]) => ({ ref: { path }, data: () => wrap(d) })) }; }
export function writeBatch() { const ops = []; return { set: (r, d) => ops.push(["set", r.path, d]), delete: (r) => ops.push(["del", r.path]), commit: () => call("commit", ops) }; }`,
};

let db = {}, clock = 1000;
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
const LUKE = { uid: 'g-luke', email: 'luke@example.com', displayName: 'Luke' };
const mine = () => Object.keys(db).filter((p) => p.startsWith(`${COL}/g-luke`) || p === `${BOARD}/g-luke`);
const iso = (m) => new Date(Date.now() - m * 6e4).toISOString();
const sess = (m) => ({ date: iso(m), game: 'spell', lang: 'en', level: 'Y4', minutes: 10, length: 10, finished: true, firstTry: 3, struggled: 0, firstTryWords: ['because'], struggledWords: [] });

(async () => {
  const b = await chromium.launch();
  const errs = [];
  async function device({ refuse = false } = {}) {
    // The cloud: Luke's record, 3 rounds, his ranking entry, and someone else's (which must stay).
    db = { [`${COL}/g-luke`]: { p: { year: 'Y4' }, updated: iso(10), resetAt: '' }, [`${BOARD}/g-luke`]: { name: 'L***e', days: {}, updated: iso(5) },
      [`${BOARD}/g-other`]: { name: 'O***r', days: {}, updated: iso(5) }, [`${COL}/g-other`]: { p: {}, updated: '', resetAt: '' } };
    for (const m of [30, 20, 10]) db[`${COL}/g-luke/sessions/${iso(m)}`] = { ...sess(m), up: { __ts: ++clock } };
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript(([K, L, refuse]) => {
      speechSynthesis.speak = () => {};
      if (refuse) window.__noDelete = true;
      if (!sessionStorage.seeded) {
        sessionStorage.seeded = 1;
        localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', google: { uid: L.uid, email: L.email }, sessions: [] } } }));
        localStorage.setItem('fakeAuth:u-' + L.uid, JSON.stringify(L));
      }
    }, [KEY, LUKE, refuse]);
    await ctx.exposeFunction('__fakeDb', fakeDb);
    for (const n of Object.keys(FAKE)) await ctx.route(SDK + n + '.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE[n] }));
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(400);
    await p.click('#continueBtn'); await p.waitForTimeout(1500);
    await p.click('#settingsBtn'); await p.waitForTimeout(300);
    return { ctx, p };
  }
  const users = (p) => p.evaluate((K) => Object.keys(JSON.parse(localStorage.getItem(K)).users), KEY);

  // 1. The whole way: asked twice, then everything of Luke's goes, Google's sign-in too; OK takes him off the device.
  let { ctx, p } = await device();
  ok(await p.isVisible('#eraseBtn'), `the button is shown for a Google user: "${await p.textContent('#eraseBtn')}"`);
  const before = mine().length;
  await p.click('#eraseBtn'); await p.waitForTimeout(200);
  ok(/Delete everything Typing Zen keeps for Luke/.test(await p.textContent('#eraseAsk')) && mine().length === before, `asked first, nothing deleted yet (${before} documents)`);
  await p.click('#eraseYes'); await p.waitForTimeout(200);
  ok(/Are you sure/.test(await p.textContent('#eraseAsk')) && mine().length === before, 'asked a second time, still nothing deleted');
  await p.click('#eraseYes'); await p.waitForTimeout(1500);
  ok(mine().length === 0, `everything of Luke's deleted (${before} → ${mine().length}: record, 3 rounds, ranking entry)`);
  ok(!!db[`${BOARD}/g-other`] && !!db[`${COL}/g-other`], "someone else's documents untouched");
  ok(JSON.stringify(await p.evaluate(() => window.__deleted)) === '["g-luke"]', 'Google sign-in deleted too');
  ok(/has been deleted from Google's servers, with the Google sign-in/.test(await p.textContent('#eraseAsk')), 'says so: ' + await p.textContent('#eraseAsk'));
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(5500);
  ok(mine().length === 0, 'nothing goes up again before OK (a sync was triggered and 5.5 s passed)');
  await p.click('#eraseYes'); await p.waitForTimeout(400);
  ok(await p.isVisible('#welcome') && (await users(p)).length === 0, 'OK: Luke leaves this device, back to the welcome screen');
  await ctx.close();

  // 1b. The outcome showing, Settings closed another way (Escape, Done) instead of OK: finished all the same (Hermes R88.1).
  for (const how of ['Escape', 'Done']) {
    ({ ctx, p } = await device());
    await p.click('#eraseBtn'); await p.click('#eraseYes'); await p.click('#eraseYes'); await p.waitForTimeout(1500);
    ok(mine().length === 0 && /Deleted from Google/.test(await p.textContent('#syncNote')), `${how}: deleted, and the note no longer says synced ("${await p.textContent('#syncNote')}")`);
    if (how === 'Escape') await p.keyboard.press('Escape'); else await p.click('#sheetDone');
    await p.waitForTimeout(400);
    ok(!(await p.isVisible('#sheet')) && await p.isVisible('#welcome') && (await users(p)).length === 0, `${how} instead of OK: Luke leaves this device too`);
    await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(1500);
    ok(mine().length === 0, `${how}: nothing goes up afterwards`);
    await ctx.close();
  }

  // 2. Google refuses to delete its sign-in (needs a recent sign-in): the data still goes, signed out, told to e-mail.
  ({ ctx, p } = await device({ refuse: true }));
  await p.click('#eraseBtn'); await p.click('#eraseYes'); await p.click('#eraseYes'); await p.waitForTimeout(1500);
  ok(mine().length === 0, 'refused sign-in delete: the data is still deleted');
  ok(/trinks\.wang@gmail\.com/.test(await p.textContent('#eraseAsk')), 'and the user is told to e-mail: ' + await p.textContent('#eraseAsk'));
  ok(await p.evaluate(() => !localStorage.getItem('fakeAuth:u-g-luke')), 'and signed out on this device');
  await ctx.close();

  // 3. Offline: nothing deleted, the user stays, a message says why.
  ({ ctx, p } = await device());
  const n0 = mine().length;
  await ctx.setOffline(true);
  await p.route(SDK + 'firestore.js', (r) => r.abort());
  await p.evaluate(() => { window.__fakeDbReal = window.__fakeDb; window.__fakeDb = () => Promise.reject(new Error('offline')); });
  await p.click('#eraseBtn'); await p.click('#eraseYes'); await p.click('#eraseYes'); await p.waitForTimeout(1500);
  ok(mine().length === n0 && (await users(p)).length === 1, `offline: nothing deleted (${n0} documents), Luke still here`);
  ok(/offline/i.test(await p.textContent('#syncNote')), 'offline message: ' + await p.textContent('#syncNote'));
  await ctx.close();

  // 3b. A sync stuck on Firestore (an iPhone, 2026-11-13): deletion waits for it at most 8 s, then goes ahead (Hermes R93.1).
  ({ ctx, p } = await device());
  await p.evaluate(() => { window.__fakeDbReal = window.__fakeDb; window.__fakeDb = () => new Promise(() => {}); });
  await p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await p.waitForTimeout(300);
  await p.evaluate(() => { window.__fakeDb = window.__fakeDbReal; });
  await p.click('#eraseBtn'); await p.click('#eraseYes'); await p.click('#eraseYes');
  for (let t = 0; t < 30 && mine().length; t++) await p.waitForTimeout(500);
  ok(mine().length === 0 && /has been deleted from Google's servers/.test(await p.textContent('#eraseAsk')), `stuck sync: still deleted, within ~9 s ("${await p.textContent('#eraseAsk')}")`);
  await ctx.close();

  // 4. A typed-name user has no such button.
  ctx = await b.newContext();
  await ctx.addInitScript((K) => { speechSynthesis.speak = () => {}; localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Mia', year: 'Y2', lang: 'en' } } })); }, KEY);
  p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(400); await p.click('#continueBtn'); await p.waitForTimeout(300); await p.click('#settingsBtn'); await p.waitForTimeout(300);
  ok(!(await p.isVisible('#eraseBtn')), 'typed-name user: no Delete my data from Google');
  await ctx.close();

  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
