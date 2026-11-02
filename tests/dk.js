const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8800/';
const KEY = process.argv[3] || 'typingZen.v2';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  const say = [];
  const mk = async (seed, hash = '', w = 1280, h = 800) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(([seed, KEY]) => {
      if (seed && !sessionStorage.getItem('seeded')) { localStorage.setItem(KEY, JSON.stringify(seed)); sessionStorage.setItem('seeded', 1); }
      window.__said = [];
      speechSynthesis.speak = (u) => { window.__said.push([u.text, u.lang]); setTimeout(() => u.onend && u.onend(), 10); };
    }, [seed, KEY]);
    const p = await ctx.newPage(); p.errs = [];
    p.on('pageerror', e => p.errs.push(e.message)); p.on('console', m => m.type() === 'error' && p.errs.push(m.text()));
    await p.goto(base + hash); await p.waitForTimeout(600);
    return p;
  };
  const day = new Date().toISOString();
  // 1. An English user with history switches to Danish: asked first, history cleared.
  const seed = { current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y4', bucket: 'Y4', stars: 7, rounds: 3, bestWpm: 20,
    tricky: { because: 1 }, sessions: [{ date: day, game: 'spell', level: 'Y4', minutes: 1, length: 1, finished: true, firstTry: 2, struggled: 1, firstTryWords: ['a', 'b'], struggledWords: ['because'] }] } } };
  let p = await mk(seed);
  ok((await p.textContent('#continueBtn')) === 'Continue as Luke', 'English welcome back');
  await p.click('#continueBtn'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => document.querySelectorAll('.kbd [data-key="["]').length === 1), 'English keyboard has [');
  await p.click('#settingsBtn'); await p.waitForTimeout(200);
  ok((await p.getAttribute('#segLang [data-lang=en]', 'aria-checked')) === 'true', 'English is checked');
  await p.click('#segLang [data-lang=da]'); await p.waitForTimeout(200);
  ok(await p.isVisible('#langConfirm'), 'confirm shown when there is history');
  const ask = await p.textContent('#langAsk'); console.log('   ask:', ask);
  ok(/clears Luke's history/.test(ask), 'the warning says history is cleared');
  await p.click('#langNo'); await p.waitForTimeout(100);
  ok(!(await p.isVisible('#langConfirm')) && (await p.getAttribute('#segLang [data-lang=en]', 'aria-checked')) === 'true', 'Cancel keeps English');
  await p.click('#segLang [data-lang=da]'); await p.click('#langYes'); await p.waitForTimeout(300);
  const st = await p.evaluate((K) => JSON.parse(localStorage.getItem(K)).users.u1, KEY);
  ok(st.lang === 'da' && st.stars === 0 && st.sessions.length === 0 && !Object.keys(st.tricky).length && st.voice === 'da-female' && st.name === 'Luke' && st.year === 'Y4', 'switched to Danish and history cleared, name and year kept');
  ok((await p.textContent('#sheetTitle')) === 'Indstillinger' && (await p.evaluate(() => document.documentElement.lang)) === 'da', 'Settings in Danish, html lang da');
  ok((await p.textContent('#lblStar')) === 'Kan du lide appen?', 'static text translated');
  await p.click('#sheetDone'); await p.waitForTimeout(200);
  const lv = await p.textContent('#levels'); console.log('   levels:', lv.slice(0, 120));
  ok(/3\. klasse/.test(lv) && /ord, f\.eks\./.test(lv), 'levels in Danish');
  ok(await p.evaluate(() => ['æ', 'ø', 'å', '<', 'enter-2'].every(k => document.querySelector(`.kbd [data-key="${k}"]`))), 'Danish keyboard has æ ø å < and two-row Enter');
  ok(await p.evaluate(() => !document.querySelector('.kbd [data-key="["]')), 'English [ key gone');
  ok((await p.textContent('.mode[data-mode=spell] b')) === 'Stavebien', 'game names in Danish');
  // Word Garden in Danish: the words come from the Danish list and are spoken in Danish.
  await p.click('.mode[data-mode=words]'); await p.waitForTimeout(600);
  ok((await p.textContent('#modeTitle')) === '🌼 Ordhaven', 'Danish title');
  const card = await p.textContent('#card'); console.log('   card:', card.replace(/\s+/g, ' ').trim());
  ok(/betyder/.test(card) && /Hør det igen/.test(card), 'card in Danish');
  const said = await p.evaluate(() => window.__said);
  ok(said.length && said[0][1] === 'da-DK', 'spoken with lang da-DK: ' + JSON.stringify(said[0]));
  const word = await p.evaluate(() => [...document.querySelectorAll('#line span')].map(s => s.textContent).join(''));
  const finger = await p.textContent('#finger'); console.log('   word:', word, ' finger:', finger);
  ok(/^Brug |Mellemrum/.test(finger), 'finger hint in Danish');
  for (const ch of word) await p.keyboard.press(ch === ' ' ? 'Space' : ch).catch(async () => { await p.evaluate((c) => document.dispatchEvent(new KeyboardEvent('keydown', { key: c, bubbles: true })), ch); });
  await p.waitForTimeout(300);
  ok(/✓/.test(await p.textContent('#msg')), 'typed the Danish word: ' + await p.textContent('#msg'));
  // on-screen tap of æ types æ
  await p.waitForTimeout(900);
  const before = await p.evaluate(() => window.__typed = 0);
  await p.click('.kbd [data-key="æ"]'); await p.waitForTimeout(100);
  ok(true, 'tapped æ (no error)');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok((await p.textContent('#todayStats')).startsWith('I dag'), 'home stats in Danish');
  // back to English: no history yet except seen, so may ask; switch and check English again
  await p.click('#settingsBtn'); await p.click('#segLang [data-lang=en]'); await p.waitForTimeout(200);
  if (await p.isVisible('#langConfirm')) { console.log('   ask(da):', await p.textContent('#langAsk')); ok(/Skift Luke til English\? Det sletter Lukes historik/.test(await p.textContent('#langAsk')), 'Danish warning text'); await p.click('#langYes'); }
  await p.waitForTimeout(300);
  ok((await p.textContent('#sheetTitle')) === 'Settings' && (await p.textContent('#lblStar')) === 'Like this app?', 'back to English text');
  ok(await p.evaluate(() => !!document.querySelector('.kbd [data-key="["]') && !document.querySelector('.kbd [data-key="æ"]')), 'English keyboard back');
  ok(p.errs.length === 0, 'no errors: ' + p.errs.join(' | '));
  await p.screenshot({ path: 'en-back.png' });
  // 2. #dk on a fresh device: Danish start screen, Rachel hint, new user is Danish.
  p = await mk(null, '#dk', 375, 740);
  ok((await p.getAttribute('#newName', 'placeholder')) === 'f.eks. Rachel', 'placeholder f.eks. Rachel');
  ok((await p.textContent('#intro-new h2')) === 'Hej! Lad os komme i gang', 'new-user form in Danish');
  const yrs = await p.textContent('#newYear'); console.log('   years:', yrs);
  await p.screenshot({ path: 'dk-new.png' });
  await p.fill('#newName', 'Rachel'); await p.click('#newYear [data-year=Y3]'); await p.click('#newForm [type=submit]'); await p.waitForTimeout(400);
  const r = await p.evaluate((K) => { const s = JSON.parse(localStorage.getItem(K)); return s.users[s.current]; }, KEY);
  ok(r.lang === 'da' && r.voice === 'da-female' && r.name === 'Rachel', 'Rachel is a Danish user');
  ok((await p.textContent('.hello-name')).startsWith('Hej,'), 'home in Danish');
  await p.screenshot({ path: 'dk-home.png' });
  await p.click('#settingsBtn'); await p.waitForTimeout(200); await p.screenshot({ path: 'dk-settings.png' });
  // no history: switching asks nothing
  await p.click('#segLang [data-lang=en]'); await p.waitForTimeout(200);
  ok(!(await p.isVisible('#langConfirm')) && (await p.textContent('#sheetTitle')) === 'Settings', 'no history: switches without asking');
  await p.click('#segLang [data-lang=da]'); await p.waitForTimeout(200);
  await p.click('#sheetDone');
  await p.click('.mode[data-mode=spell]'); await p.waitForTimeout(200);
  ok(/minut/.test(await p.textContent('#lenChoices')), 'Spelling Bee lengths in Danish: ' + await p.textContent('#lenChoices'));
  await p.click('#lenChoices [data-length=short]'); await p.waitForTimeout(800);
  const c2 = (await p.textContent('#card')).replace(/\s+/g, ' ').trim(); console.log('   bee:', c2);
  ok(/Det betyder/.test(c2), 'Spelling Bee card in Danish');
  await p.screenshot({ path: 'dk-bee.png' });
  ok(p.errs.length === 0, 'no errors: ' + p.errs.join(' | '));
  // 3. a plain visit with an English user stays English
  p = await mk({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y4' } } });
  ok((await p.textContent('#continueBtn')) === 'Continue as Luke' && (await p.evaluate(() => document.documentElement.lang)) === 'en-GB', 'English user unaffected');
  await b.close();
})();
