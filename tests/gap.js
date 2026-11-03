// The pause between the word and its spelling in Practice (short), and word → sentence in Spelling Bee (1 s).
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  async function run(mode) {
    const ctx = await b.newContext();
    await ctx.addInitScript((K) => { window.__said = []; speechSynthesis.speak = (u) => { window.__said.push([u.text, performance.now()]); setTimeout(() => u.onend && u.onend(), 5); };
      if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u',
        sessions: [{ date: new Date().toISOString(), game: 'spell', level: 'Y4', minutes: 10, length: 10, finished: true, firstTry: 0, struggled: 1, firstTryWords: [], struggledWords: ['joyfully'] }] } } })); }, KEY);
    const p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(400); await p.click('#continueBtn'); await p.waitForTimeout(300);
    await p.click(`.mode[data-mode="${mode}"]`); await p.waitForTimeout(300);
    if (mode === 'spell') await p.click('#lenChoices button');
    await p.waitForTimeout(2000);
    const s = await p.evaluate(() => window.__said); await ctx.close(); return s;
  }
  const pr = await run('practise');
  const g = pr[1][1] - pr[0][1];
  ok(pr[1][0] === 'J O Y F U L L Y' && g < 800, `Practice: word → spelling after ${Math.round(g)} ms (was about 1030)`);
  const sb = await run('spell');
  const g2 = sb[1][1] - sb[0][1];
  ok(g2 > 950, `Spelling Bee: word → sentence still after ${Math.round(g2)} ms`);
  await b.close();
})();
