const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  for (const [q, want] of [['?keylog', 'auto']]) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript(([K]) => { navigator.audioSession = { type: 'auto' }; speechSynthesis.speak = () => {}; if (!sessionStorage.done) { sessionStorage.done = 1; localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y3', lang: 'en' } } })); } }, [KEY]);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(base + q); await p.waitForTimeout(300);
    await p.click('#continueBtn'); await p.click('.mode[data-mode="spell"]'); await p.click('#lenChoices button'); await p.waitForTimeout(300);
    const w = () => p.evaluate(() => [...document.querySelector('#keylog').textContent.matchAll(/want="(.)"/g)].pop()?.[1] || 'q');
    await p.keyboard.press('q'); await p.keyboard.press(await w()); await p.waitForTimeout(100);
    ok((await p.evaluate(() => navigator.audioSession.type)) === want, `${q}: audio mode after sounds = ${await p.evaluate(() => navigator.audioSession.type)}`);
    ok(new RegExp('audio=' + want).test(await p.textContent('#keylog')), `${q}: log shows audio=${want}`);
    ok(!errs.length, 'no errors ' + errs.join('|')); await ctx.close();
  }
  await b.close();
})();
