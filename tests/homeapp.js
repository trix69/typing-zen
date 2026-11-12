// Google sign-in from the home screen (standalone): the app goes to Google's page and comes back with an ID token.
// node homeapp.js base storageKey collection
const { chromium, webkit } = require('playwright');
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
export const where = (f, op, v) => ({ f, op, v });
export const query = (c, ...w) => ({ path: c.path, w });
export const Timestamp = { fromMillis: (m) => ({ __ts: m }) };
export const serverTimestamp = () => ({ __server: true });
export async function getDoc(r) { const d = await call("get", r.path); return { exists: () => !!d, data: () => d || undefined }; }
export async function getDocs(q) { return { docs: [] }; }
export function writeBatch() { const ops = []; return { set: (r, d) => ops.push(["set", r.path, d]), delete: (r) => ops.push(["del", r.path]), commit: () => call("commit", ops) }; }`,
};
const db = {};
function fakeDb(op, a) {
  if (op === 'get') return db[a] ? JSON.parse(JSON.stringify(db[a])) : null;
  if (op === 'commit') for (const [o, p, d] of a) { if (o === 'del') delete db[p]; else db[p] = JSON.parse(JSON.stringify(d)); }
  return null;
}
(async () => {
  for (const [ename, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    for (const k of Object.keys(db)) delete db[k];
    const b = await engine.launch();
    const errs = [];
    async function device(account, { standalone = true, answer = 'token' } = {}) {
      const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });
      ctx.google = [];
      await ctx.addInitScript((sa) => { speechSynthesis.speak = () => {}; if (sa) Object.defineProperty(navigator, 'standalone', { value: true }); }, standalone);
      await ctx.exposeFunction('__fakeDb', fakeDb);
      for (const n of Object.keys(FAKE)) await ctx.route(SDK + n + '.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE[n] }));
      await ctx.route('https://accounts.google.com/**', (r) => {
        const q = new URL(r.request().url()).searchParams; ctx.google.push(Object.fromEntries(q));
        const st = answer === 'badstate' ? 'nope' : q.get('state');
        const h = answer === 'cancel' ? `state=${st}&error=access_denied` : `state=${st}&id_token=${Buffer.from(JSON.stringify(account)).toString('base64')}`;
        r.fulfill({ contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(q.get('redirect_uri') + '#' + h)})</script>` });
      });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errs.push(e.message)); if (process.env.DBG) { p.on('console', (m) => console.log('LOG', m.text())); p.on('requestfailed', (r) => console.log('RF', r.url(), r.failure().errorText)); }
      await p.goto(base); await p.waitForTimeout(500);
      return { ctx, p };
    }
    const vis = (p, s) => p.isVisible(s);
    const T = (m) => `${ename}: ${m}`;

    // 1. A new Google account from the home screen: off to Google and back, the name filled in and locked.
    const A = await device({ uid: 'g-new', email: 'new@example.com', displayName: 'new kid' });
    await A.p.click('#googleNew'); await A.p.click('#gContinue'); await A.p.waitForTimeout(3000);
    const g = A.ctx.google[0] || {};
    ok(A.ctx.google.length === 1, T('went to Google once'));
    ok(g.client_id === '264177378932-18e7s9sn645bslvufmr48gkk75c0lib9.apps.googleusercontent.com' && g.response_type === 'id_token' && g.nonce && g.state && g.prompt === 'select_account', T('Google request: client, id_token, nonce, state'));
    ok(g.redirect_uri === new URL(base).origin + new URL(base).pathname.replace(/index\.html$/, ''), T(`redirect_uri ${g.redirect_uri}`));
    ok((await A.p.inputValue('#newName')) === 'New kid' && await A.p.$eval('#newName', (e) => e.readOnly), T(`name from Google, locked: "${await A.p.inputValue('#newName')}"`));
    ok(await vis(A.p, '#googleAs'), T('"name comes from your Google account" shown'));
    ok(!(await A.p.evaluate(() => location.hash)), T('token gone from the address'));
    ok(!(await A.p.evaluate(() => localStorage.getItem('typingZen.google'))), T('pending sign-in cleared'));
    await A.p.click('#newYear button[data-year="Y4"]'); await A.p.click('#newForm [type=submit]'); await A.p.waitForTimeout(5000);
    ok(await vis(A.p, '#home') && db[`${COL}/g-new`], T('home, and the profile reached the cloud'));
    await A.ctx.close();

    // 2. An account with progress elsewhere: straight to home.
    db[`${COL}/g-old`] = { p: { year: 'Y5', stars: 7 }, updated: new Date().toISOString(), resetAt: '' };
    const B = await device({ uid: 'g-old', email: 'old@example.com', displayName: 'Old Hand' });
    await B.p.click('#googleNew'); await B.p.click('#gContinue'); await B.p.waitForTimeout(3000);
    const sb = await B.p.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY); const ub = sb.users[sb.current] || {};
    ok(await vis(B.p, '#home') && ub.name === 'Old Hand' && ub.year === 'Y5', T(`existing account straight to home (${ub.name}/${ub.year})`));
    await B.ctx.close();

    // 3. Cancelled at Google: back on the form, no error, nobody signed in.
    const C = await device({ uid: 'g-x' }, { answer: 'cancel' });
    await C.p.click('#googleNew'); await C.p.click('#gContinue'); await C.p.waitForTimeout(3000);
    ok(await vis(C.p, '#googleNewRow') && !(await C.p.textContent('#googleErr')).trim() && !(await C.p.evaluate(() => window.__creds)), T('cancel: form again, no error, no sign-in'));
    ok(!(await C.p.evaluate(() => location.hash)), T('cancel: address cleaned'));
    await C.ctx.close();

    // 4. A token whose state doesn't match is ignored.
    const D = await device({ uid: 'g-evil', email: 'e@example.com', displayName: 'Evil' }, { answer: 'badstate' });
    await D.p.click('#googleNew'); await D.p.click('#gContinue'); await D.p.waitForTimeout(3000);
    ok(!(await D.p.evaluate(() => window.__creds)) && !(await D.p.$eval('#newName', (e) => e.readOnly)), T('wrong state: token not used'));
    ok(!(await D.p.evaluate(() => location.hash)), T(`wrong state: token gone from the address ("${await D.p.evaluate(() => location.hash)}")`));
    await D.ctx.close();

    // 5. In the browser (not from the home screen) the Google window is still used.
    const E = await device({ uid: 'g-pop' }, { standalone: false });
    await E.p.click('#googleNew'); await E.p.click('#gContinue'); await E.p.waitForTimeout(800);
    ok(E.ctx.google.length === 0 && (await E.p.evaluate(() => window.__popups)) === 1, T('browser: Google window, no page change'));
    await E.ctx.close();

    ok(!errs.length, T(`no page errors ${errs.join(' | ')}`));
    await b.close();
  }
})();
