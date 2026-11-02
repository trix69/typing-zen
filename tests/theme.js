// Light is the default appearance; a saved choice is kept. node theme.js base
const { chromium } = require('playwright');
const base = process.argv[2];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  for (const [saved, scheme, wantAttr, wantMode] of [[null, 'dark', 'light', 'light'], [null, 'light', 'light', 'light'], ['auto', 'dark', null, 'auto'], ['dark', 'light', 'dark', 'dark'], ['light', 'dark', 'light', 'light']]) {
    const ctx = await b.newContext({ colorScheme: scheme });
    if (saved) await ctx.addInitScript((v) => { if (!sessionStorage.getItem('x')) { localStorage.setItem('typingZen.theme', v); sessionStorage.setItem('x', 1); } }, saved);
    const p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(300);
    const r = await p.evaluate(() => ({ attr: document.documentElement.getAttribute('data-theme'), mode: THEME.mode, bg: getComputedStyle(document.body).backgroundColor, bar: document.querySelector('meta[name="theme-color"]').content }));
    ok(r.attr === wantAttr && r.mode === wantMode, `saved ${saved}, device ${scheme}: mode ${r.mode}, data-theme ${r.attr}, background ${r.bg}, bar ${r.bar}`);
    if (!saved) {
      await p.click('#welcomeSettingsBtn'); await p.waitForTimeout(200);
      const on = await p.$eval('#segApp [aria-checked="true"]', (x) => x.dataset.themeMode);
      ok(on === 'light', `Settings shows ${on} chosen`);
    }
    await ctx.close();
  }
  await b.close();
})();
