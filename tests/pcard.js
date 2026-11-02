// Home Practice card: greyed out once today's missed words are all practised; earlier days still from the stats.
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const day = (n) => { const d = new Date(); d.setHours(10, 0, 0, 0); d.setDate(d.getDate() - n); return d; };
const sess = (d, again) => ({ date: d.toISOString(), game: 'spell', level: 'Y3', minutes: 10, length: 10, finished: true, firstTry: 0, struggled: again.length, firstTryWords: [], struggledWords: again });
(async () => {
  const b = await chromium.launch(); const errs = [];
  const today = day(0).toDateString(), yday = day(1).toDateString();
  for (const [lang, practised, want, enabled] of [
    ['en', {}, '3 words today, 5 times each', true],
    ['en', { [today]: { answer: 5 } }, '2 of 3 words left today', true],
    ['en', { [today]: { answer: 5, young: 5, remember: 5 } }, 'All 3 practised today ✓', false],
    ['da', { [today]: { answer: 5, young: 5, remember: 5 } }, 'Alle 3 øvet i dag ✓', false],
    ['en', 'one', 'Practised today ✓', false], ['da', 'one', 'Øvet i dag ✓', false]]) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript(([K, v]) => { speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(), 5); if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify(v)); },
      [KEY, { current: 'u', users: { u: { name: 'Luke', year: 'Y3', bucket: 'Y3', lang, id: 'u', practised: practised === 'one' ? { [today]: { answer: 5 } } : practised,
        sessions: [sess(day(1), ['because']), sess(day(0), practised === 'one' ? ['answer'] : ['answer', 'young', 'remember'])] } } }]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(400); await p.click('#continueBtn'); await p.waitForTimeout(300);
    const info = await p.textContent('#practiseInfo'), dis = await p.$eval('#practiseBtn', (x) => x.disabled);
    ok(info === want && dis === !enabled, `${lang} ${practised === 'one' ? 'one word done' : JSON.stringify(practised[today] || {})}: "${info}", ${enabled ? 'active' : 'greyed out'}`);
    if (!enabled) {
      // Yesterday's word is still not practised: View stats can start it.
      await p.click('#viewStatsBtn, #statsBtn, button:has-text("View stats"), button:has-text("Se statistik")'); await p.waitForTimeout(300);
      await p.click('#missedBtn'); await p.waitForTimeout(300);
      const btns = await p.$$eval('.missed-day [data-day]', (l) => l.map((x) => x.dataset.day));
      ok(btns.includes(yday) && !btns.includes(today), `${lang}: View stats still offers yesterday's word (${btns.length} Practise button)`);
      await p.click(`.missed-day [data-day="${yday}"]`); await p.waitForTimeout(600);
      ok(await p.isVisible('#play'), `${lang}: and starts it`);
    }
    await ctx.close();
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
