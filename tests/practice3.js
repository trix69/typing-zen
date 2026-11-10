// A word missed under a spelling since taken out of the list (colorful) comes back in Practice in the list's UK
// spelling, with its meaning (Hermes R86.2). node practice3.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const NEW = { colourful: 'full of bright colours', aeroplane: 'a machine with wings that flies' };
(async () => {
  const b = await chromium.launch(); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
  await ctx.addInitScript((K) => { window.__said = []; speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); };
    if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u',
      sessions: [{ date: new Date().toISOString(), game: 'spell', lang: 'en', level: 'Y4', minutes: 10, length: 10, finished: true, firstTry: 0, struggled: 2, firstTryWords: [], struggledWords: ['colorful', 'airplane'] }] } } })); }, KEY);
  const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(base); await p.waitForTimeout(400);
  await p.click('#missedBtn'); await p.waitForTimeout(300);
  const stats = await p.evaluate(() => document.body.innerText);
  ok(/colourful/.test(stats) && /aeroplane/.test(stats) && !/colorful|airplane/.test(stats), 'the stats word lists use the UK spellings');
  await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  await p.click('#continueBtn'); await p.waitForTimeout(300);
  await p.click('.mode[data-mode="practise"]'); await p.waitForTimeout(1600);
  const said = await p.evaluate(() => window.__said.splice(0));
  const card = await p.textContent('#card');
  const w = said[0];
  ok(w in NEW, `Practice says the UK spelling: ${JSON.stringify(said)}`);
  ok(w in NEW && card.includes(NEW[w]), `the card shows its meaning: "${card.replace(/\s+/g, ' ').slice(0, 90)}"`);
  ok(!/colorful|airplane/.test(card + said.join(' ')), 'no old spelling on the card or in the speech');
  await ctx.close();
  // Counts saved under the old spelling still count (Hermes R86.3): 5 of 5 keeps the day finished, 3 of 5 resumes.
  for (const n of [5, 3]) {
    const c = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await c.addInitScript(([K, n]) => { speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(), 5);
      if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u',
        practised: { [new Date().toDateString()]: { airplane: n } },
        sessions: [{ date: new Date().toISOString(), game: 'spell', lang: 'en', level: 'Y4', minutes: 10, length: 10, finished: true, firstTry: 0, struggled: 1, firstTryWords: [], struggledWords: ['airplane'] }] } } })); }, [KEY, n]);
    const q = await c.newPage(); q.on('pageerror', (e) => errs.push(e.message));
    await q.goto(base); await q.waitForTimeout(400);
    await q.click('#missedBtn'); await q.waitForTimeout(300);
    const sheet = (await q.evaluate(() => document.querySelector('#missedDays').innerText)).replace(/\s+/g, ' ');
    await q.keyboard.press('Escape'); await q.waitForTimeout(200);
    await q.click('#continueBtn'); await q.waitForTimeout(300);
    const dis = await q.$eval('#practiseBtn', (x) => x.disabled);
    if (n === 5) ok(/Practised \(1\)[^]*aeroplane/.test(sheet) && !/To practise/.test(sheet) && dis, `airplane done 5 times: the day stays finished (Practice card ${dis ? 'disabled' : 'enabled'}; "${(sheet.match(/(Practised|To practise)[^.]{0,40}/) || [''])[0]}")`);
    else ok(/aeroplane 3\/5/.test(sheet) && !dis, `airplane done 3 times: shows "aeroplane 3/5" and Practice is open (${(sheet.match(/aeroplane[^ ]* ?\S*/) || [''])[0]})`);
    await c.close();
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
