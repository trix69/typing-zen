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

  const BOARD = COL.replace('users', 'board');
  const iso = (n) => { const d = new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - n); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); };
  // Nine others on the board; one with only old days (8+ days ago) counts as 0 and is left out.
  const others = [['Am**y', 90], ['Be*n', 70], ['Ch*****e', 55], ['Da*d', 40], ['El**a', 33], ['Fi*n', 28], ['Ge*****e', 20], ['Ha****h', 9], ['Iv*n', 2]];
  others.forEach(([name, w], i) => { db[`${BOARD}/g-o${i}`] = { name, days: { [iso(i % 3)]: w }, updated: new Date().toISOString() }; });
  db[`${BOARD}/g-old`] = { name: 'Ol*d', days: { [iso(9)]: 500 }, updated: '' };
  const lukeSessions = [sess(day(1), 3, 0), sess(day(0, 2), 2, 0)]; // 5 words this week: between Ha****h (9) and Iv*n (2)
  async function signedIn(name, extra = {}) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    ctx.account = LUKE;
    await ctx.addInitScript(([K, u]) => { speechSynthesis.speak = (x) => setTimeout(() => x.onend && x.onend(), 5);
      if (!localStorage.getItem(K)) { localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u } })); localStorage.setItem('fakeAuth:u-g-luke', JSON.stringify({ uid: 'g-luke', email: 'luke@example.com', displayName: 'Luke Smith' })); } },
      [KEY, { name: 'Luke Smith', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', sessions: lukeSessions, google: { uid: 'g-luke', email: 'luke@example.com' }, ...extra }]);
    await ctx.exposeFunction('__fakeDb', fakeDb);
    await ctx.exposeFunction('__fakePopup', () => LUKE);
    for (const n of Object.keys(FAKE)) await ctx.route(SDK + n + '.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE[n] }));
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(name + ': ' + e.message));
    await p.clock.install(); await p.goto(base); await p.clock.runFor(600);
    return { ctx, p };
  }
  async function beeToEnd(p) {
    await p.click('#continueBtn'); await p.clock.runFor(800); await p.click('.mode[data-mode="spell"]'); await p.clock.runFor(300);
    await p.click('#lenChoices button'); await p.clock.runFor(900);
    await p.clock.fastForward('21:00'); await p.clock.runFor(3000);
  }
  // 1. First Bee: asked, Yes → the board.
  let { ctx, p } = await signedIn('A');
  await beeToEnd(p);
  ok(await vis(p, '#results') && await vis(p, '#shareSheet'), 'after a Spelling Bee a Google user is asked to share');
  ok((await p.$$eval('#shareSheet button', (l) => l.map((x) => x.textContent))).join('|') === "Yes|No|Don't remind me again", 'three choices: Yes, No, Don\'t remind me again');
  await p.click('#shareYes'); await p.clock.runFor(1500);
  ok(await vis(p, '#boardSheet'), 'Yes opens the board');
  const mine = db[`${BOARD}/g-luke`];
  ok(mine && mine.name === 'Lu*******h' && Object.values(mine.days).reduce((a, x) => a + x, 0) === 5, `my entry on the server: masked "${mine && mine.name}", ${mine && JSON.stringify(mine.days)}`);
  const pod = await p.$$eval('.podium .spot', (l) => l.map((s) => [s.className, s.querySelector('.who')?.textContent, s.querySelector('.stair')?.textContent, Math.round(s.querySelector('.stair')?.getBoundingClientRect().height || 0)]));
  ok(JSON.stringify(pod.map((x) => x.slice(0, 3))) === JSON.stringify([['spot p2', 'Be*n', '2'], ['spot p1', 'Am**y', '1'], ['spot p3', 'Ch*****e', '3']]) && pod[1][3] > pod[0][3] && pod[0][3] > pod[2][3],
    `podium: 2 left, 1 middle and highest, 3 right and lowest ${JSON.stringify(pod)}`);
  const list = await p.$$eval('.board-list li', (l) => l.map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(JSON.stringify(list) === JSON.stringify(['#4Da*d40 words', '#5El**a33 words', '…', '#8Ha****h9 words', '#9Luke Smith (you)5 words', '#10Iv*n2 words']), `list: ${JSON.stringify(list)}`);
  ok((await p.textContent('#boardBody .note')) === "You're #9 of 10.", `"${await p.textContent('#boardBody .note')}" (the user with only old days is left out)`);
  await p.click('#boardDone'); await p.clock.runFor(200);
  ok(await vis(p, '#boardBtn'), 'results now show "See where you rank"');
  // Settings: Yes is chosen; No takes the entry off the board and stops the question.
  await p.click('#homeBtn'); await p.clock.runFor(300); await p.click('#settingsBtn'); await p.clock.runFor(200);
  ok(await p.$eval('#segShare [data-share="yes"]', (x) => x.getAttribute('aria-checked')) === 'true', 'Settings shows Share: Yes');
  await p.click('#segShare [data-share="no"]'); await p.clock.runFor(1000);
  let st = await store(p);
  ok(!db[`${BOARD}/g-luke`] && st.users.u.share === false && st.users.u.shareAsk === false, 'Settings No removes the entry from the board');
  await p.click('#sheetDone'); await p.clock.runFor(200);
  await p.click('.mode[data-mode="spell"]'); await p.clock.runFor(300); await p.click('#lenChoices button'); await p.clock.runFor(900);
  await p.clock.fastForward('21:00'); await p.clock.runFor(3000);
  ok(await vis(p, '#results') && !(await vis(p, '#shareSheet')) && !(await vis(p, '#boardBtn')), 'after No in Settings: no question, no board button');
  await ctx.close();
  // 2. No → asked again next time; Don't remind me again → never asked.
  ({ ctx, p } = await signedIn('B'));
  await beeToEnd(p); await p.click('#shareNo'); await p.clock.runFor(300);
  st = await store(p);
  ok(st.users.u.share === undefined && !(await vis(p, '#boardBtn')), 'No: nothing shared');
  await p.click('#againBtn'); await p.clock.runFor(300); await p.click('#lenChoices button').catch(() => {}); await p.clock.runFor(900);
  await p.clock.fastForward('21:00'); await p.clock.runFor(3000);
  ok(await vis(p, '#shareSheet'), 'No: asked again after the next Bee');
  await p.click('#shareNever'); await p.clock.runFor(300);
  await p.click('#againBtn'); await p.clock.runFor(300); await p.click('#lenChoices button').catch(() => {}); await p.clock.runFor(900);
  await p.clock.fastForward('21:00'); await p.clock.runFor(3000);
  st = await store(p);
  ok(!(await vis(p, '#shareSheet')) && st.users.u.shareAsk === false && st.users.u.share === undefined, "Don't remind me again: not asked any more");
  await ctx.close();
  // 3. Already sharing: never asked; the button is there and the week is updated.
  ({ ctx, p } = await signedIn('C', { share: true }));
  await beeToEnd(p);
  ok(!(await vis(p, '#shareSheet')) && await vis(p, '#boardBtn') && db[`${BOARD}/g-luke`], 'a sharer: no question, the button, and the entry written');
  await ctx.close();
  // 4. A typed-name user: never asked; Settings says sharing needs Google.
  const c4 = await b.newContext({ viewport: { width: 1180, height: 820 } });
  await c4.addInitScript((K) => { speechSynthesis.speak = (x) => setTimeout(() => x.onend && x.onend(), 5); if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Mia', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', sessions: [] } } })); }, KEY);
  const p4 = await c4.newPage(); p4.on('pageerror', (e) => errs.push('D: ' + e.message)); await p4.clock.install(); await p4.goto(base); await p4.clock.runFor(600);
  await beeToEnd(p4);
  ok(!(await vis(p4, '#shareSheet')) && !(await vis(p4, '#boardBtn')), 'typed-name user: not asked, no board button');
  await p4.click('#homeBtn'); await p4.clock.runFor(300); await p4.click('#settingsBtn'); await p4.clock.runFor(200);
  ok((await p4.textContent('#shareNote')) === 'Sharing needs a Google account.' && await p4.$eval('#segShare button', (x) => x.disabled), 'typed-name user: Settings toggle disabled, "Sharing needs a Google account."');
  await c4.close();
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
