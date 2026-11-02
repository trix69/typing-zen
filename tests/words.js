// Stats: the words of the last 7 days, right first try and needs more practice. node words.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const day = (n, h = 0) => { const d = new Date(); d.setHours(10 + h, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString(); };
const sess = (date, first, again) => ({ date, game: 'spell', level: 'Year 4', minutes: 10, length: 10, finished: true,
  firstTry: first.length, struggled: again.length, firstTryWords: first, struggledWords: again });
(async () => {
  const b = await chromium.launch(); const errs = [];
  for (const lang of ['en', 'da']) {
    for (const [vw, vh] of [[1180, 820], [375, 667]]) {
      const ctx = await b.newContext({ viewport: { width: vw, height: vh } });
      const user = { name: 'Luke', year: 'Y4', bucket: 'Y4', lang, id: 'u1', created: day(9), lastUsed: day(0),
        sessions: [sess(day(0), ['because', 'friend', 'protect'], ['island']), sess(day(0, 1), ['island', 'example', 'friend'], ['answer']),
          sess(day(1), ['early'], []), sess(day(2), [], ['library']), sess(day(3), [], ['kat', 'hund']), sess(day(9), ['old'], ['older'])],
        practised: { [new Date(day(0)).toDateString()]: { answer: 5 }, [new Date(day(3)).toDateString()]: { kat: 5, hund: 5 } } };
      await ctx.addInitScript(([K, v]) => { if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify(v)); speechSynthesis.speak = () => {}; },
        [KEY, { current: 'u1', users: { u1: user } }]);
      const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(base); await p.waitForTimeout(500);
      const T = (m) => `${lang} ${vw}: ${m}`;
      const btn = await p.textContent('#missedBtn');
      ok(await p.isVisible('#missedBtn') && btn === (lang === 'en' ? 'See the words' : 'Se ordene'), T(`button "${btn}"`));
      const bar = await p.$eval('#weekChart li:last-child', (li) => ({ parts: [...li.querySelectorAll('.bar i')].map((i) => [i.className, Math.round(i.getBoundingClientRect().height), getComputedStyle(i).backgroundColor]), said: li.getAttribute('aria-label') }));
      ok(JSON.stringify(bar.parts.map((x) => x[0])) === JSON.stringify(['again', 'practised', 'first']) && new Set(bar.parts.map((x) => x[2])).size === 3, T(`today's bar: ${JSON.stringify(bar.parts)}`));
      ok(bar.parts[2][1] > 4 * bar.parts[1][1] - 3 && Math.abs(bar.parts[0][1] - bar.parts[1][1]) <= 1, T('bar heights 6 : 1 : 1'));
      ok(/6 (right first try|rigtigt).*1 (practised|øvet).*1 (to practise|skal øves)/.test(bar.said), T(`bar label: ${bar.said}`));
      const key = await p.$$eval('#weekKey span', (l) => l.map((x) => x.textContent));
      ok(key.length === 3, T(`key: ${key.join(' / ')}`));
      await p.screenshot({ path: `chart-${lang}-${vw}.png` });
      await p.click('#missedBtn'); await p.waitForTimeout(300);
      const secs = await p.$$eval('.missed-day', (l) => l.map((s) => ({ h: s.querySelector('h3').textContent,
        labels: [...s.querySelectorAll('.words-label')].map((x) => x.textContent),
        lists: [...s.querySelectorAll('.tricky-list')].map((x) => [...x.children].map((c) => c.textContent.trim())), btn: !!s.querySelector('[data-day]') })));
      ok(secs.length === 4, T(`4 days (${secs.map((s) => s.h).join(' | ')})`));
      const t = secs[0] || { lists: [], labels: [] };
      ok(JSON.stringify(t.lists[0]) === JSON.stringify(['because', 'friend', 'protect', 'example']), T(`today right first try: ${JSON.stringify(t.lists[0])} (island left out: it needed another try)`));
      ok(JSON.stringify(t.lists[1]) === JSON.stringify(['✓ answer']) && JSON.stringify(t.lists[2]) === JSON.stringify(['island']), T(`today practised ${JSON.stringify(t.lists[1])}, to practise ${JSON.stringify(t.lists[2])}`));
      ok(/\(4\)/.test(t.labels[0]) && /^(Practised|Øvet) \(1\)$/.test(t.labels[1]) && /^(To practise|Skal øves) \(1\)$/.test(t.labels[2]) && t.btn && /^(Today|I dag)$/.test(t.h), T(`labels ${JSON.stringify(t.labels)} / ${t.h}`));
      const dots = await p.$$eval('.missed-day:first-child .words-label i', (l) => l.map((i) => getComputedStyle(i).backgroundColor));
      ok(new Set(dots).size === 3, T(`three label colours ${dots.join(' ')}`));
      const y = secs[1] || {}; ok(y.lists && y.lists.length === 1 && y.lists[0][0] === 'early' && !y.btn, T('a day with only right-first-try words: one list, no Practise button'));
      const z = secs[2] || {}; ok(z.lists && z.lists.length === 1 && z.lists[0][0] === 'library' && z.btn, T('a day with only missed words: one list and Practise'));
      const w = secs[3] || {}; ok(w.lists && w.lists.length === 1 && w.labels[0].includes('(2)') && !w.btn, T(`a day with every missed word practised: ${JSON.stringify(w.labels)}, no Practise button (${w.btn})`));
      const edge = await p.$eval('.missed-day:first-child .words-label i.practised', (i) => getComputedStyle(i).boxShadow);
      ok(/inset/.test(edge), T(`practised swatch has an edge: ${edge}`));
      ok(!(await p.textContent('#missedSheet')).includes('older'), T('nothing older than 7 days'));
      const over = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(over <= 0, T(`no sideways scroll (${over})`));
      await p.screenshot({ path: `words-${lang}-${vw}.png` });
      // Practise still opens Practice with that day's words.
      await p.click('.missed-day [data-day]'); await p.waitForTimeout(400);
      ok(await p.isVisible('#play'), T('Practise opens the game'));
      await ctx.close();
    }
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
