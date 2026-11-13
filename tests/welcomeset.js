const { chromium, devices } = require('playwright');
const base = process.argv[2] || 'http://localhost:8800/';
const KEY = process.argv[3] || 'typingZen.v2';
const shots = ''; // screenshots go to the folder the suite runs from (run.sh uses a throwaway one), never the repo
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const greyed = (p) => p.evaluate(() => {
  const s = document.querySelector('#sheet');
  const els = [...s.querySelectorAll('.user-only button, .user-only select')];
  return { noUser: s.classList.contains('no-user'), all: els.length, disabled: els.filter(e => e.disabled).length,
    clear: document.querySelector('#clearBtn').disabled, lang: [...document.querySelectorAll('#segLang button')].every(b => !b.disabled),
    note: !document.querySelector('#langNote').hidden, checked: s.querySelectorAll('.user-only [aria-checked=true]').length };
});
(async () => {
  const b = await chromium.launch();
  // 1. First visit, no users, on a phone.
  {
    const ctx = await b.newContext(devices['iPhone 13']); const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(300);
    ok(await p.isVisible('#welcomeSettingsBtn'), 'new: gear shown on welcome');
    await p.fill('#newName', 'Rach');
    await p.click('#newYear button[data-year="Y3"]');
    await p.click('#welcomeSettingsBtn'); await p.waitForTimeout(200);
    let g = await greyed(p);
    ok(g.noUser && g.disabled === g.all && g.all > 10 && g.clear && g.lang && g.note && !g.checked, 'new: user settings greyed, language open ' + JSON.stringify(g));
    await p.screenshot({ path: shots + 'ws-new-en.png', fullPage: false });
    await p.click('#segLang [data-lang="da"]'); await p.waitForTimeout(200);
    ok(await p.isHidden('#langConfirm'), 'new: no clear-history warning');
    ok((await p.evaluate(() => document.documentElement.lang)) === 'da', 'new: page now Danish');
    ok((await p.textContent('#sheetTitle')) === 'Indstillinger', 'new: Settings title in Danish');
    ok((await p.textContent('#langNote')).startsWith('Vælger'), 'new: note in Danish');
    await p.screenshot({ path: shots + 'ws-new-da.png' });
    await p.click('#sheetDone');
    ok(await p.evaluate(() => document.activeElement.id === 'welcomeSettingsBtn'), 'new: focus back on welcome gear');
    ok((await p.inputValue('#newName')) === 'Rach', 'new: typed name kept');
    ok((await p.getAttribute('#newYear button[data-year="Y3"]', 'aria-checked')) === 'true', 'new: chosen year kept');
    ok((await p.getAttribute('#newName', 'placeholder')) === 'f.eks. Rachel', 'new: name hint is Rachel');
    await p.reload(); await p.waitForTimeout(300);
    ok((await p.evaluate(() => document.documentElement.lang)) === 'da', 'new: Danish kept after reload');
    await p.fill('#newName', 'Rach'); await p.click('#newYear button[data-year="Y3"]'); await p.click('#newForm [type=submit]'); await p.waitForTimeout(300);
    const u = await p.evaluate((K) => Object.values(JSON.parse(localStorage.getItem(K)).users)[0], KEY);
    ok(u.lang === 'da' && u.voice === 'da-female', 'new: user made in Danish');
    await p.click('#settingsBtn'); await p.waitForTimeout(200);
    g = await greyed(p);
    ok(!g.noUser && g.disabled === 0 && g.note === false, 'home: settings all usable (Share too, for a typed name since 2026-11-13) ' + JSON.stringify(g));
    ok(!errs.length, 'new: no errors ' + errs.join('|'));
    await ctx.close();
  }
  // 2. Welcome back, an English user with history, desktop.
  {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript((K) => { if (!sessionStorage.done) { sessionStorage.done = 1; localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y4', lang: 'en', rounds: 3, stars: 5, tricky: { because: 2 }, sessions: [] } } })); } }, KEY);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(300);
    ok(await p.isVisible('#intro-back') && await p.isVisible('#welcomeSettingsBtn'), 'back: gear shown on Welcome back');
    await p.click('#welcomeSettingsBtn'); await p.waitForTimeout(200);
    let g = await greyed(p);
    ok(g.noUser && g.disabled === g.all && g.clear && !g.checked, 'back: user settings greyed ' + JSON.stringify(g));
    await p.screenshot({ path: shots + 'ws-back.png' });
    await p.click('#clearBtn', { force: true }).catch(() => {});
    ok(await p.isHidden('#clearConfirm'), 'back: Clear history does nothing');
    await p.click('#segLang [data-lang="da"]'); await p.waitForTimeout(200);
    ok(await p.isHidden('#langConfirm'), 'back: no clear warning');
    await p.click('#sheetDone');
    ok((await p.textContent('#continueBtn')) === 'Fortsæt som Luke', 'back: welcome text in Danish');
    const u = await p.evaluate((K) => JSON.parse(localStorage.getItem(K)).users.u1, KEY);
    ok(u.lang === 'en' && u.stars === 5 && u.rounds === 3, "back: Luke's language and history untouched");
    await p.click('#continueBtn'); await p.waitForTimeout(200);
    ok((await p.evaluate(() => document.documentElement.lang)) === 'en-GB', 'back: Continue goes back to Luke\'s English');
    await p.click('#settingsBtn'); await p.waitForTimeout(200);
    g = await greyed(p);
    ok(!g.noUser && g.disabled === 0 && g.checked >= 2, 'home: settings usable, Luke\'s picks shown ' + JSON.stringify(g));
    await p.click('#switchUserBtn'); await p.waitForTimeout(200);
    await p.click('#welcomeSettingsBtn'); await p.waitForTimeout(200);
    g = await greyed(p);
    ok(g.noUser && g.disabled === g.all, 'switch panel: greyed again');
    await p.keyboard.press('Escape');
    ok(await p.evaluate(() => document.activeElement.id === 'welcomeSettingsBtn'), 'switch panel: Esc returns focus to welcome gear');
    await p.click('#userList .user'); await p.waitForTimeout(200);
    await p.click('#settingsBtn'); await p.click('#segLang [data-lang="da"]'); await p.waitForTimeout(100);
    ok((await p.evaluate((K) => { const s = JSON.parse(localStorage.getItem(K)); return s.users[s.current].lang; }, KEY)) === 'da', 'home: switching a user\'s language switches it (no warning, history kept per language)');
    ok(!errs.length, 'back: no errors ' + errs.join('|'));
    await ctx.close();
  }
  await b.close();
})();
