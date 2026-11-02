const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3], want = process.argv[4].split(','), shot = process.argv[5];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  for (const [lang, vp] of [['en', { width: 1280, height: 800 }], ['da', { width: 375, height: 812 }]]) {
    const ctx = await b.newContext({ viewport: vp });
    await ctx.addInitScript(([K, l]) => { if (!sessionStorage.done) { sessionStorage.done = 1; localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y3', lang: l } } })); } }, [KEY, lang]);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(300);
    await p.click('#continueBtn'); await p.click('.mode[data-mode="spell"]'); await p.waitForTimeout(150);
    const labels = await p.$$eval('#lenChoices button', bs => bs.map(x => x.textContent));
    const mins = labels.map(t => t.match(/\d+/)[0]);
    ok(mins.join(',') === want.join(','), `${lang}: buttons ${JSON.stringify(labels)}`);
    ok(await p.evaluate(() => document.activeElement === document.querySelector('#lenChoices button')), `${lang}: first choice focused`);
    const rows = await p.$$eval('#lenChoices button', bs => new Set(bs.map(x => Math.round(x.getBoundingClientRect().top))).size);
    ok(rows === 1 && await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${lang}: one row, no sideways scroll`);
    if (shot) await p.screenshot({ path: `${shot}-${lang}.png` });
    // Each button starts a session of that many minutes; Play again keeps it.
    for (let i = 0; i < want.length; i++) {
      if (i) { await p.keyboard.press('Escape'); await p.waitForTimeout(100); if (await p.isVisible('#leaveYes')) await p.click('#leaveYes'); else await p.keyboard.press('Escape'); await p.waitForTimeout(150); await p.click('.mode[data-mode="spell"]'); await p.waitForTimeout(100); }
      await p.click(`#lenChoices button:nth-child(${i + 1})`); await p.waitForTimeout(300);
      const clock = (await p.textContent('#clock')).trim();
      ok(clock.startsWith(String(want[i] - 1) + ':5') || clock === want[i] + ':00', `${lang}: choice ${i + 1} clock ${clock}`);
    }
    ok(!errs.length, `${lang}: no page errors ${errs.join('|')}`);
    await ctx.close();
  }
  await b.close();
})();
