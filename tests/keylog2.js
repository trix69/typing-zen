const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, hasTouch: true });
  await ctx.addInitScript(([K]) => { if (!sessionStorage.done) { sessionStorage.done = 1; localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y3', lang: 'en' } } })); } }, [KEY]);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base + '?keylog'); await p.waitForTimeout(300);
  await p.click('#continueBtn'); await p.click('.mode[data-mode="spell"]'); await p.click('#lenChoices button'); await p.waitForTimeout(300);
  await p.keyboard.press('x');
  await p.evaluate(() => { window.dispatchEvent(new FocusEvent('blur')); window.dispatchEvent(new FocusEvent('focus')); document.dispatchEvent(new Event('visibilitychange')); });
  await p.mouse.click(600, 300);
  const log = await p.textContent('#keylog'); console.log(log);
  ok(/keydown key="x"/.test(log) && /blur window/.test(log) && /focus window/.test(log) && /visibility=visible/.test(log) && /pointerdown mouse on=/.test(log), 'log has key, window blur/focus, visibility and pointerdown');
  await p.goto(base); await p.waitForTimeout(200);
  ok(!(await p.$('#keylog')), 'no log without ?keylog');
  ok(!errs.length, 'no errors ' + errs.join('|')); await b.close();
})();
