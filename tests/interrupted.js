// Safari's "interrupted" audio state: key sounds must resume it. node interrupted.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(([K]) => {
    speechSynthesis.speak = () => {};
    window.__resumes = 0; window.__fake = null;
    const real = Object.getOwnPropertyDescriptor(BaseAudioContext.prototype, 'state').get;
    Object.defineProperty(BaseAudioContext.prototype, 'state', { get() { return window.__fake || real.call(this); } });
    const r = AudioContext.prototype.resume;
    AudioContext.prototype.resume = function () { window.__resumes++; window.__fake = null; return r.call(this); };
    if (!sessionStorage.done) { sessionStorage.done = 1; localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', keySound: 'red' } } })); }
  }, [KEY]);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base + '?keylog'); await p.waitForTimeout(400);
  await p.click('#continueBtn'); await p.click('.mode[data-mode="spell"]'); await p.click('#lenChoices button'); await p.waitForTimeout(1000);
  const want = () => p.evaluate(() => [...document.querySelector('#keylog').textContent.matchAll(/want="(.)"/g)].pop()?.[1]);
  await p.keyboard.press('q'); await p.waitForTimeout(200);
  await p.evaluate(() => { window.__fake = 'interrupted'; window.__resumes = 0; });
  const k = await want(); await p.keyboard.press(k); await p.waitForTimeout(200);
  ok((await p.evaluate(() => window.__resumes)) >= 1, `key press resumes an "interrupted" audio context (${await p.evaluate(() => window.__resumes)} resume)`);
  ok(/ctx=running/.test(await p.textContent('#keylog')), 'key log shows ctx=running');
  ok(!errs.length, 'no errors ' + errs.join('|'));
  await b.close();
})();
