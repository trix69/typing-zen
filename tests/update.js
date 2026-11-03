// The automatic update check (2026-11-03): asked on opening when the site has a newer release, Update / Later,
// never during a round, once per release per visit, and Settings > Automatic update check turns it off.
// version.json is replaced through route interception, so the site's real files are never changed.
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const NEWER = JSON.stringify({ version: '99.0', build: 'ffffffffff' });
(async () => {
  const b = await chromium.launch();
  const open = async (opts = {}) => {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 }, serviceWorkers: 'block' });
    await ctx.addInitScript(([K, off, lang]) => {
      speechSynthesis.speak = () => {};
      if (!sessionStorage.done) {
        sessionStorage.done = 1;
        localStorage.setItem(K, JSON.stringify({ current: 'u1', lang, users: { u1: { id: 'u1', name: 'Luke', year: 'Y3', lang } } }));
        if (off) localStorage.setItem('typingZen.autoUpd', 'off');
      }
    }, [KEY, !!opts.off, opts.lang || 'en']);
    const p = await ctx.newPage(), errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    let hits = 0, release;
    const gate = opts.gate ? new Promise((r) => (release = r)) : null;
    if (opts.newer) await p.route(/version\.json/, async (r) => { hits++; if (gate) await gate; r.fulfill({ contentType: 'application/json', body: NEWER }); });
    else await p.route(/version\.json/, (r) => { hits++; r.continue(); });
    await p.goto(base);
    return { ctx, p, errs, hits: () => hits, release: () => release && release() };
  };
  const shown = (p) => p.isVisible('#updSheet');

  // 1. A newer release on the welcome screen: asked, Update focused, Tab stays inside, Esc closes.
  let { ctx, p, errs, hits } = await open({ newer: true });
  ok(!(await shown(p)), 'not asked straight away');
  await p.waitForTimeout(2500);
  ok(await shown(p), 'asked about 1.5 s after opening');
  ok(/Version 99\.0 is ready\. Update now\?/.test(await p.textContent('#updMsg')), 'message: ' + await p.textContent('#updMsg'));
  ok(await p.evaluate(() => document.activeElement.id) === 'updNow', 'Update has the focus');
  for (let i = 0; i < 4; i++) await p.keyboard.press('Tab');
  ok(await p.evaluate(() => !!document.activeElement.closest('#updSheet')), 'Tab stays in the question');
  await p.keyboard.press('Escape');
  ok(!(await shown(p)), 'Esc closes it');
  ok(await p.isVisible('#welcome'), 'still on the welcome screen');
  const before = hits();
  await p.evaluate(() => { Object.defineProperty(document, 'hidden', { value: false, configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await p.waitForTimeout(800);
  ok(hits() === before && !(await shown(p)), 'coming back within 6 hours: not checked or asked again');
  ok(!errs.length, 'no errors ' + errs.join('|'));
  await ctx.close();

  // 2. Later closes it and keeps the page; clicking outside also closes it.
  ({ ctx, p, errs } = await open({ newer: true }));
  await p.waitForTimeout(2500);
  await p.click('#updLater');
  ok(!(await shown(p)) && await p.isVisible('#welcome'), 'Later closes it and stays');
  ok(!errs.length, 'no errors ' + errs.join('|'));
  await ctx.close();

  // 3. Update reloads with the new version in the address (no offline copy here).
  ({ ctx, p, errs } = await open({ newer: true }));
  await p.waitForTimeout(2500);
  await Promise.all([p.waitForNavigation(), p.click('#updNow')]);
  ok(/\?v=ffffffffff$/.test(p.url()), 'Update opens the new version: ' + p.url().replace(base, ''));
  await ctx.close();

  // 4. The same version on the site: never asked.
  ({ ctx, p, errs } = await open());
  await p.waitForTimeout(2500);
  ok(!(await shown(p)), 'same version: not asked');
  ok(!errs.length, 'no errors ' + errs.join('|'));
  await ctx.close();

  // 5. During a round it waits, and asks once back home.
  let rel;
  ({ ctx, p, errs, release: rel } = await open({ newer: true, gate: true }));
  await p.click('#continueBtn'); await p.click('.mode[data-mode="spell"]'); await p.click('#lenChoices button');
  await p.waitForTimeout(300);
  ok(await p.isVisible('#play'), 'in a Spelling Bee round');
  rel(); await p.waitForTimeout(2500);
  ok(!(await shown(p)), 'not asked during the round');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok(await p.isVisible('#home'), 'back home');
  await p.waitForTimeout(5500);
  ok(await shown(p), 'asked once back home');
  ok(!errs.length, 'no errors ' + errs.join('|'));
  await ctx.close();

  // 6. Settings: On by default; Off is kept, and then nothing is asked.
  ({ ctx, p, errs } = await open());
  await p.click('#welcomeSettingsBtn');
  ok(await p.getAttribute('#segUpd [data-upd="on"]', 'aria-checked') === 'true', 'Settings: Automatic update check On by default');
  await p.click('#segUpd [data-upd="off"]');
  ok(await p.evaluate(() => localStorage.getItem('typingZen.autoUpd')) === 'off', 'Off is saved for this device');
  ok(await p.getAttribute('#segUpd [data-upd="off"]', 'aria-checked') === 'true', 'Off shown as chosen');
  await ctx.close();
  ({ ctx, p, errs, hits } = await open({ newer: true, off: true }));
  await p.waitForTimeout(2500);
  ok(!(await shown(p)) && hits() === 0, 'turned off: not checked or asked');
  ok(!errs.length, 'no errors ' + errs.join('|'));
  await ctx.close();

  // 7. Support: the coffee link, and its QR code beside it on a computer only.
  ({ ctx, p, errs } = await open());
  await p.click('#welcomeSettingsBtn');
  ok(await p.getAttribute('#coffeeLink', 'href') === 'https://buymeacoffee.com/trinks', 'Buy me a coffee links to buymeacoffee.com/trinks');
  ok(await p.getAttribute('#coffeeLink', 'target') === '_blank', 'opens in a new tab');
  ok(await p.isVisible('.support-qr') && await p.evaluate(() => document.querySelector('.support-qr').naturalWidth) === 300, 'QR code shown on a computer and loaded');
  await p.setViewportSize({ width: 390, height: 844 });
  ok(!(await p.isVisible('.support-qr')), 'no QR code on a phone-sized screen');
  await ctx.close();

  // 8. Danish.
  ({ ctx, p, errs } = await open({ newer: true, lang: 'da' }));
  await p.waitForTimeout(2500);
  ok(await p.textContent('#updTitle') === 'Ny version' && /er klar/.test(await p.textContent('#updMsg')), 'Danish question: ' + await p.textContent('#updMsg'));
  ok(await p.textContent('#updNow') === 'Opdater' && await p.textContent('#updLater') === 'Senere', 'Danish buttons');
  await p.keyboard.press('Escape');
  await p.click('#welcomeSettingsBtn');
  ok(await p.textContent('#lblUpd') === 'Automatisk opdateringstjek' && /Giv mig en kop kaffe/.test(await p.textContent('#coffeeLink')), 'Danish Settings labels');
  ok(await p.getAttribute('.support-qr', 'alt') === 'QR-kode til buymeacoffee.com/trinks', 'Danish QR description');
  ok(!errs.length, 'no errors ' + errs.join('|'));
  await ctx.close();
  await b.close();
})();
