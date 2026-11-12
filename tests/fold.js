// R46.1/R46.2: first-screen fold with a Firebase config, and the Who's typing tile for a long Google name.
const { chromium } = require('playwright');
const base = process.argv[2];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/firebase-';
const FAKE = {
  app: `export function initializeApp() { return {}; }`,
  auth: `let user = null; const auth = { get currentUser() { return user; } };
export function getAuth() { return auth; } export function onAuthStateChanged(a, cb) { setTimeout(() => cb(user)); return () => {}; }
export class GoogleAuthProvider { setCustomParameters() {} }
export async function signInWithPopup() { user = { uid: "g1", email: "r@example.com", displayName: window.__name }; return { user }; }
export async function updateCurrentUser(a, u) { user = u; }
export async function signOut() { user = null; }`,
  firestore: `export const getFirestore = () => ({}); export const doc = () => ({ path: "x" }); export const collection = () => ({});
export const where = () => ({}); export const query = () => ({}); export const Timestamp = { fromMillis: () => ({}) }; export const serverTimestamp = () => ({});
export async function getDoc() { return { exists: () => false, data: () => undefined }; }
export async function getDocs() { return { docs: [] }; }
export function writeBatch() { return { set() {}, delete() {}, commit: async () => {} }; }`,
};
(async () => {
  const b = await chromium.launch();
  async function page(vp, name) {
    const ctx = await b.newContext({ viewport: vp });
    await ctx.addInitScript((n) => { window.__name = n; speechSynthesis.speak = () => {}; }, name || 'x');
    for (const n of Object.keys(FAKE)) await ctx.route(SDK + n + '.js', (r) => r.fulfill({ contentType: 'text/javascript', body: FAKE[n] }));
    await ctx.route(/\/app\.js(\?|$)/, async (r) => { const res = await r.fetch(); r.fulfill({ response: res, body: (await res.text()).replace('const FIREBASE = null;', 'const FIREBASE = { apiKey: "x" };') }); });
    const p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(400); return { ctx, p };
  }
  for (const [w, h] of [[375, 667], [360, 640], [414, 736], [320, 568]]) {
    for (const lang of ['', '#dk']) {
      const { ctx, p } = await page({ width: w, height: h });
      if (lang) { await p.goto(base + lang); await p.reload(); await p.waitForTimeout(400); }
      const r = await p.evaluate(() => ({ parts: [...document.querySelectorAll('#googleNewRow > *')].map(e => e.id + e.className + ':' + Math.round(e.getBoundingClientRect().height)).join(' '), row: document.querySelector('#googleNewRow').getBoundingClientRect().height, btn: document.querySelector('#newForm [type=submit]').getBoundingClientRect().bottom, page: document.documentElement.scrollHeight, shown: !document.querySelector('#googleNewRow').hidden }));
      const fits = r.btn <= h;
      if (w >= 360) ok(r.shown && fits, `${w}x${h}${lang}: row ${Math.round(r.row)} px, Let's start bottom ${Math.round(r.btn)} (fold ${h}), page ${r.page} [${r.parts}]`);
      else console.log(`INFO ${w}x${h}${lang}: row ${Math.round(r.row)}, button bottom ${Math.round(r.btn)}, page ${r.page} [${r.parts}]`);
      await ctx.close();
    }
  }
  for (const [name, want] of [['Rachel Alexandra Smithson', 'Rachel'], ['luke smith', 'Luke smith'], ['Christopher Montgomery-Smith', 'Christopher'], ['Abcdefghijklmnopqrstuvwxyz', 'Abcdefghijklmnopqrst']]) {
    const { ctx, p } = await page({ width: 1280, height: 800 }, name);
    await p.click('#googleNew'); await p.click('#gContinue'); await p.waitForTimeout(300);
    const v = await p.inputValue('#newName');
    ok(v === want && v.length <= 20, `Google name "${name}" -> "${v}"`);
    await p.click('#newYear button[data-year="Y3"]'); await p.click('#newForm [type=submit]'); await p.waitForTimeout(200);
    await p.evaluate(() => document.querySelector('#switchUserBtn').click()); await p.waitForTimeout(200);
    const lines = await p.$eval('#userList .user b', (e) => Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight || 24)));
    const hgt = await p.$eval('#userList .user b', (e) => e.getBoundingClientRect().height);
    ok(hgt <= 50, `tile name box ${hgt} px for "${v}"`);
    await ctx.close();
  }
  await b.close();
})();
