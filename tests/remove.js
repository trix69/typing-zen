// Settings: Remove account for a typed-name user (warned), Log out for a Google user (asked). node remove.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const lang of ['en', 'da']) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript(([K, l]) => { speechSynthesis.speak = () => {}; if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'a', users: {
      a: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: l, id: 'a', stars: 9, rounds: 3, sessions: [] },
      b: { name: 'Ella', year: 'Y2', bucket: 'Y2', lang: l, id: 'b', sessions: [] } } })); }, [KEY, lang]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(400); await p.click('#continueBtn'); await p.waitForTimeout(300);
    await p.click('#settingsBtn'); await p.waitForTimeout(200);
    const T = (m) => `${lang}: ${m}`;
    const label = await p.textContent('#logoutBtn');
    ok(await p.isVisible('#logoutBtn') && label === (lang === 'en' ? 'Remove account' : 'Fjern konto'), T(`typed-name user: "${label}"`));
    await p.click('#logoutBtn'); await p.waitForTimeout(150);
    const ask = await p.textContent('#logoutAsk'), yes = await p.textContent('#logoutYes');
    ok(lang === 'en' ? /^Remove Luke\? .*deleted from this device\. This can't be undone\.$/.test(ask) && yes === 'Yes, remove' : /^Fjern Luke\? .*Det kan ikke fortrydes\.$/.test(ask) && yes === 'Ja, fjern', T(`warning: "${ask.slice(0, 70)}…" / "${yes}"`));
    await p.click('#logoutNo'); await p.waitForTimeout(150);
    ok(await p.evaluate((K) => !!JSON.parse(localStorage.getItem(K)).users.a, KEY) && !(await p.isVisible('#logoutConfirm')), T('Cancel keeps Luke'));
    await p.click('#logoutBtn'); await p.waitForTimeout(150); await p.click('#logoutYes'); await p.waitForTimeout(200);
    const ask2 = await p.textContent('#logoutAsk'), yes2 = await p.textContent('#logoutYes');
    ok((lang === 'en' ? ask2 === "Are you sure? This can't be undone." && yes2 === 'Yes, remove Luke' : ask2 === 'Er du sikker? Det kan ikke fortrydes.' && yes2 === 'Ja, fjern Luke')
      && await p.evaluate((K) => !!JSON.parse(localStorage.getItem(K)).users.a, KEY), T(`second step: "${ask2}" / "${yes2}", Luke still there`));
    await p.click('#logoutNo'); await p.waitForTimeout(150);
    ok(await p.evaluate((K) => !!JSON.parse(localStorage.getItem(K)).users.a, KEY), T('Cancel at the second step keeps Luke'));
    await p.click('#logoutBtn'); await p.waitForTimeout(150);
    ok((await p.textContent('#logoutYes')) === (lang === 'en' ? 'Yes, remove' : 'Ja, fjern'), T('opening again starts at the first step'));
    await p.click('#logoutYes'); await p.waitForTimeout(150); await p.click('#logoutYes'); await p.waitForTimeout(500);
    const st = await p.evaluate((K) => JSON.parse(localStorage.getItem(K)), KEY);
    ok(!st.users.a && st.users.b && st.current === 'b' && await p.isVisible('#welcome'), T(`Luke removed, Ella kept, welcome shown (current ${st.current})`));
    // With no one chosen (the welcome screen's gear), there is nothing to remove.
    await p.click('#welcomeSettingsBtn'); await p.waitForTimeout(200);
    ok(!(await p.isVisible('#logoutBtn')), T('no Remove account with no one chosen'));
    await ctx.close();
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
