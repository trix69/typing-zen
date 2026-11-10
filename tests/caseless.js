// X-ray and Xbox: any capitalisation counts in Practice and the Spelling Bee. node caseless.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const key = async (p, ch) => { await p.keyboard.press(ch === '-' ? 'Minus' : /[A-Z]/.test(ch) ? 'Shift+' + ch : ch); await p.waitForTimeout(30); };
  const acc = (p) => p.evaluate(() => document.querySelector('#liveAcc').textContent);
  // Practice: X-ray missed today, typed "x-RAY".
  {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript((K) => { window.__said = []; speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); };
      if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y3', bucket: 'Y3', lang: 'en', id: 'u',
        sessions: [{ date: new Date().toISOString(), game: 'spell', lang: 'en', level: 'Y3', minutes: 10, length: 10, finished: true, firstTry: 0, struggled: 1, firstTryWords: [], struggledWords: ['X-ray'] }] } } })); }, KEY);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(400); await p.click('#continueBtn'); await p.waitForTimeout(300);
    await p.click('.mode[data-mode="practise"]'); await p.waitForTimeout(1600);
    for (const ch of 'x-RAY') await key(p, ch);
    await p.waitForTimeout(300);
    const a = await acc(p);
    ok(a === '100', `Practice: "x-RAY" for X-ray has no wrong keys (accuracy ${a}%)`);
    await ctx.close();
  }
  // Spelling Bee: X-ray (typed "x-RaY") or Xbox (typed "xbox", Hermes R86.1) as the only tricky word.
  // (capital.js checks a capital inside an ordinary word is still wrong.)
  for (const [WORD, LEVEL, TYPED] of [['X-ray', 'Y3', 'x-RaY'], ['Xbox', 'Y2', 'xbox']]) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript(([K, WORD, LEVEL]) => { window.__said = []; speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); };
      localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: LEVEL, bucket: LEVEL, lang: 'en', id: 'u', sessions: [], tricky: { [WORD]: 1 } } } })); }, [KEY, WORD, LEVEL]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(300);
    await p.click('#continueBtn'); await p.waitForTimeout(200); await p.click('.mode[data-mode="spell"]'); await p.waitForTimeout(200);
    await p.click('#lenChoices button'); await p.waitForTimeout(500);
    let seen = false;
    for (let i = 0; i < 15 && !seen; i++) {
      let cur;
      for (let t = 0; t < 40 && !cur; t++) { cur = (await p.evaluate(() => window.__said)).find((x) => !/ /.test(x)); if (!cur) await p.waitForTimeout(100); }
      await p.evaluate(() => { window.__said = []; });
      if (cur === WORD) {
        for (const ch of TYPED) await key(p, ch);
        await p.waitForTimeout(400);
        const [a, msg] = [await acc(p), await p.textContent('#msg')];
        ok(a === '100' && /^✓/.test(msg), `Spelling Bee: "${TYPED}" for ${WORD} is right first try (accuracy ${a}%, "${msg.slice(0, 40)}")`);
        seen = true;
      } else { for (const ch of cur) await key(p, ch); await p.waitForTimeout(1500); }
    }
    ok(seen, `${WORD} came up in the Spelling Bee`);
    await ctx.close();
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
