const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8800/';
const KEY = process.argv[3] || 'typingZen.v2';
const ver = process.argv[4] || '1.05';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
  // A profile as 1.04 saved it: no lang field, no store.lang.
  await ctx.addInitScript((K) => { if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y3', bucket: 'Y3', stars: 9, rounds: 4, voice: 'au-female', keySound: 'red', tricky: { because: 2 }, sessions: [] } } })); }, KEY);
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(base); await p.waitForTimeout(500);
  ok((await p.textContent('#appVersion')).startsWith(ver), 'version line ' + await p.textContent('#appVersion'));
  ok((await p.textContent('#intro-back h2')).trim() === 'Welcome back, Luke!', '1.04 profile: English welcome back');
  await p.click('#continueBtn');
  const u = await p.evaluate((K) => JSON.parse(localStorage.getItem(K)).users.u1, KEY);
  ok(u.lang === 'en' && u.stars === 9 && u.rounds === 4, '1.04 profile kept, lang en');
  await p.evaluate(() => navigator.serviceWorker.ready); await p.waitForTimeout(1500);
  await ctx.setOffline(true);
  await p.reload(); await p.waitForTimeout(500);
  ok(await p.isVisible('#intro-back'), 'opens offline');
  ok((await p.evaluate(() => typeof WORD_GROUPS_DA)) === 'object', 'Danish words available offline');
  await p.click('#welcomeSettingsBtn'); await p.click('#segLang [data-lang="da"]'); await p.click('#sheetDone');
  ok((await p.textContent('#continueBtn')) === 'Fortsæt som Luke', 'Danish start screen offline');
  ok(!errs.length, 'no errors ' + errs.join('|'));
  await b.close();
})();
