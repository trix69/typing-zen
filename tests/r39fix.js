const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8800/';
const KEY = process.argv[3] || 'typingZen.v2';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const seed = (K, lang) => { if (!sessionStorage.done) { sessionStorage.done = 1; localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y3', lang, stars: 3, rounds: 2, sessions: [{ date: new Date().toISOString(), words: 5, first: 4, mode: 'spell' }] } } })); } };
(async () => {
  const b = await chromium.launch();
  // R39.1: welcome-screen pick survives reload, both directions; Continue puts screens back in the user's language.
  for (const [from, to, toLang, back] of [['en', 'da', 'da', 'Velkommen tilbage, Luke!'], ['da', 'en', 'en-GB', 'Welcome back, Luke!']]) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(([K, l]) => { if (!sessionStorage.done) { sessionStorage.done = 1; localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y3', lang: l, stars: 3 } } })); } }, [KEY, from]);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(300);
    await p.click('#welcomeSettingsBtn'); await p.click(`#segLang [data-lang="${to}"]`); await p.click('#sheetDone');
    await p.reload(); await p.waitForTimeout(300);
    ok((await p.evaluate(() => document.documentElement.lang)) === toLang && (await p.textContent('#intro-back h2')).trim() === back, `R39.1 ${from}->${to}: pick kept after reload (${(await p.textContent('#intro-back h2')).trim()})`);
    ok((await p.evaluate((K) => JSON.parse(localStorage.getItem(K)).users.u1.lang, KEY)) === from, `R39.1 ${from}->${to}: Luke's own language untouched`);
    await p.click('#continueBtn'); await p.waitForTimeout(200);
    await p.reload(); await p.waitForTimeout(300);
    ok((await p.evaluate(() => document.documentElement.lang)).startsWith(from), `R39.1 ${from}->${to}: after Continue, start screens back in Luke's language`);
    ok(!errs.length, 'no errors ' + errs.join('|'));
    await ctx.close();
  }
  // R39.1b: switching a user's language from home also sets the start screens for the next load.
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(([K]) => { if (!sessionStorage.done) { sessionStorage.done = 1; localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y3', lang: 'en' } } })); } }, [KEY]);
    const p = await ctx.newPage();
    await p.goto(base); await p.waitForTimeout(300);
    await p.click('#welcomeSettingsBtn'); await p.click('#segLang [data-lang="da"]'); await p.click('#sheetDone'); // store.lang = da
    await p.click('#continueBtn'); await p.click('#settingsBtn'); await p.click('#segLang [data-lang="da"]'); await p.waitForTimeout(100);
    if (await p.isVisible('#langConfirm')) await p.click('#langYes');
    await p.click('#sheetDone'); await p.reload(); await p.waitForTimeout(300);
    ok((await p.evaluate(() => document.documentElement.lang)) === 'da', 'R39.1b: Luke switched to Danish at home → Danish welcome after reload');
    await ctx.close();
  }
  // R39.2: View stats keeps Luke chosen.
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.addInitScript(([K]) => { if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y3', lang: 'en', stars: 3, rounds: 2, tricky: { because: 1 } } } })); }, [KEY]);
    await p.goto(base); await p.waitForTimeout(300);
    await p.click('#continueBtn'); await p.click('#statsBtn'); await p.waitForTimeout(200);
    await p.click('#welcomeSettingsBtn'); await p.waitForTimeout(150);
    const dis = await p.evaluate(() => [...document.querySelectorAll('#sheet .user-only button, #sheet .user-only select')].filter(e => e.disabled).length);
    ok(dis === 2 && await p.isHidden('#langNote'), `R39.2: from View stats, Luke's settings usable (${dis} disabled: only Share, which needs Google)`);
    await p.click('#segLang [data-lang="da"]'); await p.waitForTimeout(100);
    ok(await p.isVisible('#langConfirm'), 'R39.2: language change from View stats warns');
    await p.click('#langYes'); await p.waitForTimeout(150);
    ok((await p.evaluate((K) => JSON.parse(localStorage.getItem(K)).users.u1.lang, KEY)) === 'da', 'R39.2: Luke switched to Danish');
    await p.click('#sheetDone');
    ok(await p.evaluate(() => document.activeElement.id === 'welcomeSettingsBtn'), 'R39.2: focus back on the visible gear');
    ok((await p.textContent('#continueBtn')) === 'Fortsæt som Luke' && (await p.textContent('#intro-back h2')).includes('Velkommen'), 'R39.2: stats panel redrawn in Danish');
    await p.click('#switchBtn'); await p.click('#welcomeSettingsBtn'); await p.waitForTimeout(150);
    const dis2 = await p.evaluate(() => [...document.querySelectorAll('#sheet .user-only button, #sheet .user-only select')].filter(e => e.disabled).length);
    ok(dis2 === 21, `R39.2: Who's typing still greys out (${dis2})`);
    await p.keyboard.press('Escape');
    await p.click('#switchBack'); await p.click('#welcomeSettingsBtn'); await p.waitForTimeout(150);
    const dis3 = await p.evaluate(() => [...document.querySelectorAll('#sheet .user-only button, #sheet .user-only select')].filter(e => e.disabled).length);
    ok(dis3 === 21, `R39.2: Back from Who's typing greys out again (${dis3})`);
    ok(!errs.length, 'R39.2 no errors ' + errs.join('|'));
    await ctx.close();
  }
  await b.close();
})();
