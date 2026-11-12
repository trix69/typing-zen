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

  // 1. Device A, first visit: the Google button is offered; a new Google account fills a locked name.
  const A = await device('A', LUKE);
  ok(await vis(A.p, '#googleNew'), 'A: Sign in with Google shown on the new-user form');
  ok(await vis(A.p, '#newName') && !(await A.p.$eval('#newName', (e) => e.readOnly)), 'A: typed name box editable before Google');
  await A.p.click('#googleNew'); await A.p.click('#gContinue'); await A.p.waitForTimeout(400);
  ok((await A.p.inputValue('#newName')) === 'Luke smith', `A: name from Google = "${await A.p.inputValue('#newName')}"`);
  ok(await A.p.$eval('#newName', (e) => e.readOnly), 'A: name box is read-only');
  ok(await vis(A.p, '#googleAs') && !(await vis(A.p, '#googleNewRow')), 'A: "name comes from Google" shown, Google button hidden');
  await A.p.fill('#newName', 'Hacker').catch(() => {});
  ok((await A.p.inputValue('#newName')) === 'Luke smith', 'A: typing into the name box changes nothing');
  await A.p.click('#newYear button[data-year="Y4"]'); await A.p.click('#newForm [type=submit]'); await A.p.waitForTimeout(300);
  ok(await vis(A.p, '#home'), 'A: home after Let\'s start');
  await settle(A.p, 600);
  const doc = db[`${COL}/g-luke`];
  ok(doc && doc.p.year === 'Y4', `A: cloud profile written (year ${doc && doc.p.year})`);

  // 2. A has 3 sessions (2 today, 1 three days ago): reopen, Continue, and they go up.
  let s = await store(A.p); const idA = s.current;
  s.users[idA].sessions = [sess(day(3), 8, 2), sess(day(0, 3), 10, 0), sess(day(0, 2), 5, 5)];
  await A.p.evaluate(([K, v]) => localStorage.setItem(K, JSON.stringify(v)), [KEY, s]);
  await A.p.reload(); await A.p.waitForTimeout(400); await A.p.click('#continueBtn'); await settle(A.p, 800);
  ok(sessionsOf('g-luke').length === 3, `A: 3 sessions in the cloud (${sessionsOf('g-luke').length})`);

  // 3. Device B signs in with the same account from Who's typing: no form, straight in, 7 days synced.
  const B = await device('B', LUKE);
  await B.p.click('#googleNew'); await B.p.click('#gContinue'); await B.p.waitForTimeout(400); await settle(B.p, 800);
  ok(await vis(B.p, '#home'), 'B: same Google account goes straight to home');
  let sb = await store(B.p); let ub = sb.users[sb.current];
  ok(ub.name === 'Luke smith' && ub.year === 'Y4' && ub.sessions.length === 3, `B: name/year/sessions = ${ub.name}/${ub.year}/${ub.sessions.length}`);
  await B.p.reload(); await B.p.waitForTimeout(400);
  const week = await B.p.textContent('#weekLine');
  ok(/30 words/.test(week), `B: welcome back 7 days synced: "${week}"`);
  ok((await B.p.$$eval('#weekChart li', (l) => l.length)) === 7, 'B: 7-day chart drawn');
  await B.p.click('#continueBtn'); await settle(B.p, 600);

  // 4. Settings on B: sync note and Log out; year change goes to A.
  await B.p.click('#settingsBtn'); await B.p.waitForTimeout(200);
  ok(await vis(B.p, '#logoutBtn'), 'B: Log out in Settings');
  ok(/Synced with Google \(luke@example\.com\)/.test(await B.p.textContent('#syncNote')), `B: sync note "${await B.p.textContent('#syncNote')}"`);
  await B.p.click('#segYear button[data-year="Y5"]'); await settle(B.p);
  ok(db[`${COL}/g-luke`].p.year === 'Y5', 'B: year change reached the cloud');
  // Meanwhile A finishes another session (offline from B's point of view).
  s = await store(A.p); s.users[idA].sessions.push(sess(day(0, 1), 4, 1));
  await A.p.evaluate(([K, v]) => localStorage.setItem(K, JSON.stringify(v)), [KEY, s]);
  await A.p.reload(); await A.p.waitForTimeout(400); await A.p.click('#continueBtn'); await settle(A.p, 800);
  s = await store(A.p);
  ok(s.users[idA].year === 'Y5', `A: picked up B's year (${s.users[idA].year})`);
  ok(sessionsOf('g-luke').length === 4, `cloud has 4 sessions (${sessionsOf('g-luke').length})`);
  await B.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await settle(B.p, 800);
  sb = await store(B.p);
  ok(sb.users[sb.current].sessions.length === 4, `B: got A's new session (${sb.users[sb.current].sessions.length})`);

  // 5. Clear history on B (Google wording), and A follows.
  await B.p.click('#clearBtn');
  ok(/every device signed in/.test(await B.p.textContent('#clearAsk')), 'B: clear warns it clears every device');
  await B.p.click('#clearYes'); await B.p.click('#clearYes'); await settle(B.p);
  ok(sessionsOf('g-luke').length === 0, `cloud sessions after clear: ${sessionsOf('g-luke').length}`);
  await A.p.evaluate(() => document.dispatchEvent(new Event('visibilitychange'))); await settle(A.p, 800);
  s = await store(A.p);
  ok(s.users[idA].sessions.length === 0 && s.users[idA].year === 'Y5', `A: cleared too (${s.users[idA].sessions.length} sessions, year kept ${s.users[idA].year})`);

  // 6. Log out on A: warning first, then the user leaves this device and Google is signed out.
  await A.p.click('#settingsBtn'); await A.p.waitForTimeout(200);
  await A.p.click('#logoutBtn');
  const ask = await A.p.textContent('#logoutAsk');
  ok(/^Are you sure you want to log out\? .*progress is still saved, and carries on from whichever device/.test(ask), 'A: log out asks to be sure; progress stays saved');
  await A.p.click('#logoutNo');
  ok(!(await vis(A.p, '#logoutConfirm')), 'A: Cancel keeps the user');
  await A.p.click('#logoutBtn'); await A.p.click('#logoutYes'); await A.p.waitForTimeout(800);
  s = await store(A.p);
  ok(!s.users[idA] && Object.keys(s.users).length === 0, 'A: user removed from this device');
  ok(await vis(A.p, '#intro-new'), 'A: back on the new-user form');
  ok(!(await A.p.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('fakeAuth') && localStorage.getItem(k).includes('g-luke')))), 'A: signed out of Google');
  ok(!!db[`${COL}/g-luke`], 'cloud copy kept after log out');

  // 7. A typed-name user on A: no Google settings, name editable, no sync.
  await A.p.fill('#newName', 'rachel'); await A.p.click('#newYear button[data-year="Y2"]'); await A.p.click('#newForm [type=submit]'); await A.p.waitForTimeout(300);
  await A.p.click('#settingsBtn'); await A.p.waitForTimeout(200);
  ok((await A.p.textContent('#logoutBtn')) === 'Remove account' && !(await vis(A.p, '#syncRow')), 'A: typed user has Remove account, no sync note');
  ok(Object.keys(db).every((k) => !k.includes('rachel')), 'typed user never sent to the cloud');
  await A.p.click('#sheetDone');
  // Who's typing offers Google too; signing in again brings Luke back with his year.
  await A.p.click('#settingsBtn'); await A.p.click('#switchUserBtn'); await A.p.waitForTimeout(200);
  ok(await vis(A.p, '#googleSwitch'), 'A: Who\'s typing has Sign in with Google');
  await A.p.click('#googleSwitch'); await A.p.click('#gContinue'); await settle(A.p, 800);
  s = await store(A.p);
  const back = Object.values(s.users).find((u) => u.google);
  ok(back && back.year === 'Y5' && (await vis(A.p, '#home')), 'A: Luke back after signing in again, year Y5');
  ok((await A.p.textContent('#userName')) === 'Luke smith', 'A: home shows Google name');

  // 8. A cancelled popup shows nothing.
  const C = await device('C', null);
  await C.p.click('#googleNew'); await C.p.click('#gContinue'); await C.p.waitForTimeout(300);
  ok(!(await vis(C.p, '#googleErr')) && (await vis(C.p, '#intro-new')), 'C: closing the Google window is silent');
  await C.ctx.close();

  // 9. Danish text.
  const D = await device('D', LUKE);
  await D.p.goto(base + '#dk'); await D.p.reload(); await D.p.waitForTimeout(400);
  ok((await D.p.textContent('#googleNew')).includes('Log ind med Google'), 'D: Danish button text');

  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
