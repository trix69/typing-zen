// Practice speech: the word then its spelling, again after a slip; no Play again at the end. node practice2.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const [lang, word, spelled] of [['en', "let's", "L E T apostrophe S"], ['en', 'joyfully', 'J O Y F U L L Y'], ['da', 'måske', 'M Å S K E']]) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript(([K, w, l]) => { window.__said = []; speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); };
      if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y2', bucket: 'Y2', lang: l, id: 'u',
        sessions: [{ date: new Date().toISOString(), game: 'spell', lang: l, level: 'Y2', minutes: 10, length: 10, finished: true, firstTry: 0, struggled: 1, firstTryWords: [], struggledWords: [w] }] } } })); }, [KEY, word, lang]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(400); await p.click('#continueBtn'); await p.waitForTimeout(300);
    await p.click('.mode[data-mode="practise"]'); await p.waitForTimeout(1600);
    const said = () => p.evaluate(() => window.__said.splice(0));
    const type = async (s) => { for (const ch of s) { if (/^[a-z']$/.test(ch)) await p.keyboard.press(ch === "'" ? "Quote" : ch); else await p.evaluate((c) => (document.activeElement || document).dispatchEvent(new KeyboardEvent('keydown', { key: c, bubbles: true, cancelable: true })), ch); await p.waitForTimeout(25); } };
    const T = (m) => `${lang} ${word}: ${m}`;
    let s = await said();
    ok(JSON.stringify(s) === JSON.stringify([word, spelled]), T(`first go says the word then spells it: ${JSON.stringify(s)}`));
    await type(word); await p.waitForTimeout(1800);
    s = await said();
    ok(s.length === 0, T(`after a clean go, the next go is quiet (${JSON.stringify(s)})`));
    await type(word[0] === 'x' ? 'z' : 'x'); await type(word); await p.waitForTimeout(2500);
    s = await said();
    ok(JSON.stringify(s) === JSON.stringify([word, spelled]), T(`after a slip, the next go says it and spells it again: ${JSON.stringify(s)}`));
    await p.click('#card [data-say="word"]'); await p.waitForTimeout(1500);
    s = await said();
    ok(JSON.stringify(s) === JSON.stringify([word, spelled]), T(`the Hear button says and spells it: ${JSON.stringify(s)}`));
    for (let k = 0; k < 4; k++) { await type(word); await p.waitForTimeout(1200); } // goes 2..5
    await p.waitForTimeout(1500);
    ok(await p.isVisible('#results') && !(await p.isVisible('#againBtn')) && await p.isVisible('#homeBtn'), T('the end shows Home and no Play again'));
    await p.keyboard.press('Enter'); await p.waitForTimeout(400);
    ok(await p.isVisible('#home'), T('Enter there goes Home'));
    await ctx.close();
  }
  // Other games still offer Play again.
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript((K) => { speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(), 5);
    if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y2', bucket: 'Y2', lang: 'en', id: 'u', sessions: [] } } })); }, KEY);
  const p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(400); await p.click('#continueBtn'); await p.waitForTimeout(300);
  await p.click('.mode[data-mode="words"]'); await p.waitForTimeout(600);
  for (let i = 0; i < 10; i++) { const t = await p.evaluate(() => document.querySelector('.card .word, .card b')?.textContent || ''); const w = await p.evaluate(() => document.querySelector('#line').textContent.replace(/[^a-z' -]/gi, '')); for (const ch of w) { await p.keyboard.press(ch === "'" ? 'Quote' : ch === ' ' ? 'Space' : ch); await p.waitForTimeout(15); } await p.waitForTimeout(900); }
  await p.waitForTimeout(800);
  ok(!(await p.isVisible('#results')) || await p.isVisible('#againBtn'), 'Word Garden still offers Play again');
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
