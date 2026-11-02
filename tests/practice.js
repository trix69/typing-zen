// Practice: one typo is a mistake (count restarts); Spelling Bee still forgives one. node practice.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const word = 'because', today = new Date().toDateString();
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript(([K, w]) => { speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(), 5);
    if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y2', bucket: 'Y2', lang: 'en', id: 'u',
      sessions: [{ date: new Date().toISOString(), game: 'spell', level: 'Y2', minutes: 10, length: 10, finished: true, firstTry: 0, struggled: 1, firstTryWords: [], struggledWords: [w] }] } } })); }, [KEY, word]);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base); await p.waitForTimeout(400);
  await p.click('#continueBtn'); await p.waitForTimeout(300);
  await p.click('.mode[data-mode="practise"]'); await p.waitForTimeout(800);
  const saved = () => p.evaluate(([K, d, w]) => ((JSON.parse(localStorage.getItem(K)).users.u.practised || {})[d] || {})[w] || 0, [KEY, today, word]);
  const type = async (s) => { for (const ch of s) { await p.keyboard.press(ch); await p.waitForTimeout(25); } };
  await type(word); await p.waitForTimeout(250);
  ok(/1 of 5/.test(await p.textContent('#msg')) && (await saved()) === 1, `clean go counts: "${await p.textContent('#msg')}", saved ${await saved()}`);
  await p.waitForTimeout(900);
  await type('x'); await type(word); await p.waitForTimeout(250); // one typo, put right at once
  const m = await p.textContent('#msg');
  const dots = await p.$$eval('.reps i.on, .reps .on', (l) => l.length).catch(() => -1);
  ok(/^Not counted: there was a slip\. Still 1 of 5\./.test(m) && (await saved()) === 1, `one typo isn't counted, the count stays: "${m}", saved ${await saved()}`);
  await p.waitForTimeout(1500);
  await type(word); await p.waitForTimeout(250);
  ok(/2 of 5/.test(await p.textContent('#msg')) && (await saved()) === 2, `the next clean go makes 2: "${await p.textContent('#msg')}", saved ${await saved()}`);
  await ctx.close();
  // Spelling Bee: one typo put right at once is still right first try.
  const c2 = await b.newContext({ viewport: { width: 1180, height: 820 } });
  await c2.addInitScript((K) => { window.__said = []; speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); };
    if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y2', bucket: 'Y2', lang: 'en', id: 'u', sessions: [] } } })); }, KEY);
  const q = await c2.newPage(); q.on('pageerror', (e) => errs.push(e.message));
  await q.goto(base); await q.waitForTimeout(400);
  await q.click('#continueBtn'); await q.waitForTimeout(300); await q.click('.mode[data-mode="spell"]'); await q.waitForTimeout(300);
  await q.click('#lenChoices button'); await q.waitForTimeout(800);
  let w; for (let t = 0; t < 30 && !w; t++) { w = (await q.evaluate(() => window.__said)).find((x) => !/ /.test(x)); if (!w) await q.waitForTimeout(100); }
  await q.keyboard.press(w[0] === 'x' ? 'z' : 'x'); for (const ch of w) { await q.keyboard.press(ch); await q.waitForTimeout(25); }
  await q.waitForTimeout(400); await q.click('#backBtn'); await q.waitForTimeout(500);
  const s = await q.evaluate((K) => JSON.parse(localStorage.getItem(K)).users.u.sessions.at(-1), KEY);
  ok(s && s.firstTryWords.includes(w) && !s.struggledWords.includes(w), `Spelling Bee still forgives one typo: "${w}" right first try`);
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
