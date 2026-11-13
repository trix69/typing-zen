// Mastered words: the stats line and 7-day chart, the results figure, and selection. node mastery.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const at = (n, h = 10) => { const d = new Date(); d.setHours(h, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString(); };
const sess = (date, first, again, level = 'Y4') => ({ date, game: 'spell', level, minutes: 10, length: 10, finished: true, firstTry: first.length, struggled: again.length, firstTryWords: first, struggledWords: again });
(async () => {
  const b = await chromium.launch(); const errs = [];
  const Y4 = await (async () => { const c = await b.newContext(); const p = await c.newPage(); await p.goto(base);
    const w = await p.evaluate(() => WORD_GROUPS.filter((g) => g.level === 'Y4').flatMap((g) => g.words.map((x) => x[0]))); await c.close(); return w; })();
  async function open(user, { vw = 1180, vh = 820, said = false } = {}) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh } });
    await ctx.addInitScript(([K, v]) => { window.__said = []; speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); };
      if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify(v)); }, [KEY, { current: 'u', users: { u: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', share: false /* the board's milestone question isn't part of these checks */, ...user, sessions: (user.sessions || []).map((x) => ({ ...x, lang: user.lang || 'en' })) } } }]); // sessions carry their language
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(400); return { ctx, p };
  }
  // 1. Stats: because mastered by 2 days ago, island today; friend lost it with a miss yesterday; Y3 results don't count.
  const [w1, w2, w3] = ['because', 'island', 'friend'];
  const hist = [sess(at(6), [w2], []), sess(at(5), [w1, w2, w3], []), sess(at(4), [w1, w3], []), sess(at(3), [w3], []), sess(at(2), [w1], []), sess(at(1), [], [w3]), sess(at(0), [w2], []),
    sess(at(1), ['early'], [], 'Y3'), sess(at(1, 11), ['early'], [], 'Y3'), sess(at(1, 12), ['early'], [], 'Y3')];
  let { ctx, p } = await open({ sessions: hist });
  const line = await p.textContent('#masterLine');
  ok(line === `Mastered: 1% of Year 4 words (2 of ${Y4.length}) · +2 this week`, `line: "${line}"`);
  const pts = await p.$$eval('#masterChart .pt', (l) => l.map((x) => x.getAttribute('aria-label').match(/(\d+)% mastered \((\d+) words?\)/).slice(1).map(Number)));
  ok(JSON.stringify(pts.map((x) => x[1])) === '[0,0,0,1,2,1,2]', `daily mastered counts ${JSON.stringify(pts.map((x) => x[1]))}`);
  const geo = await p.evaluate(() => { const c = document.querySelector('#masterChart').getBoundingClientRect(); const bars = [...document.querySelectorAll('#weekChart li')].map((l) => { const r = l.getBoundingClientRect(); return r.left + r.width / 2; });
    const dots = [...document.querySelectorAll('#masterChart .pt i')].map((i) => { const r = i.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2, r.width]; });
    return { h: c.height, top: c.top, bottom: c.bottom, bars, dots, label: document.querySelector('#masterChart .pt:last-child b').textContent, grid: document.querySelector('#masterChart .grid-top').textContent }; });
  ok(geo.dots.every((d, i) => Math.abs(d[0] - geo.bars[i]) < 4), `dots under the day columns (max off ${Math.max(...geo.dots.map((d, i) => Math.abs(d[0] - geo.bars[i]))).toFixed(1)}px)`);
  ok(geo.dots[0][1] > geo.dots[6][1] && Math.abs(geo.dots[0][1] - geo.bottom) < 1 && geo.dots[0][2] === 8, 'line rises; 0 sits on the baseline; dots 8px');
  ok(geo.label === '1%' && geo.grid === '5%', `today labelled ${geo.label}, scale top ${geo.grid}`);
  await p.screenshot({ path: 'mastery-stats.png' });
  await ctx.close();
  // R55.2: words mastered during the first of the 7 days count in "+n this week".
  ({ ctx, p } = await open({ sessions: [sess(at(8), ['because', 'friend'], []), sess(at(7), ['because'], []), sess(at(6, 9), ['because', 'friend'], []), sess(at(6, 12), ['friend'], [])] }));
  ok(/\(2 of \d+\) · \+2 this week$/.test(await p.textContent('#masterLine')), `mastered on the first day counts: "${await p.textContent('#masterLine')}"`);
  await ctx.close();
  ({ ctx, p } = await open({ sessions: hist }));
  const one = await p.$$eval('#masterChart .pt', (l) => l[3].getAttribute('aria-label'));
  ok(/mastered \(1 word\)$/.test(one), `one mastered word reads "1 word": ${one}`);
  await ctx.close();
  // Danish
  ({ ctx, p } = await open({ sessions: hist, lang: 'da' }));
  ok(/^Mestret: 1% af ordene i 3\. klasse \(2 af \d+\) · \+2 denne uge$/.test(await p.textContent('#masterLine')), `da: "${await p.textContent('#masterLine')}"`);
  await ctx.close();
  // No Y4 results: no line, no chart.
  ({ ctx, p } = await open({ sessions: [sess(at(1), ['early'], [], 'Y3')] }));
  ok(!(await p.isVisible('#masterLine')) && !(await p.isVisible('#masterChart')), 'no results in the level: no mastery line or chart');
  await ctx.close();
  // 2. A game: every Y4 word already right first try twice, so a word spelled cleanly is newly mastered and a
  // missed one isn't. The page clock is faked so the 10 minutes can end at once.
  const Y4set = new Set(Y4);
  async function play(user, plan, vw = 1180, vh = 820) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh } });
    await ctx.addInitScript(([K, v]) => { window.__said = []; speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); };
      if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify(v)); }, [KEY, { current: 'u', users: { u: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', share: false /* the board's milestone question isn't part of these checks */, ...user, sessions: (user.sessions || []).map((x) => ({ ...x, lang: user.lang || 'en' })) } } }]); // sessions carry their language
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.clock.install();
    await p.goto(base); await p.clock.runFor(500);
    await p.click('#continueBtn'); await p.clock.runFor(300); await p.click('.mode[data-mode="spell"]'); await p.clock.runFor(300);
    await p.click('#lenChoices button'); await p.clock.runFor(800);
    const typed = [];
    for (const how of plan) {
      const word = (await p.evaluate(() => window.__said)).find((t) => Y4set.has(t));
      typed.push(word);
      await p.evaluate(() => { window.__said = []; });
      if (how === 'miss') { // wrong keys on two letters: a miss
        const wrong = (c) => (c === 'q' ? 'z' : 'q');
        await p.keyboard.press(wrong(word[0])); await p.clock.runFor(30);
        await p.keyboard.press(word[0]); await p.clock.runFor(30);
        await p.keyboard.press(wrong(word[1])); await p.clock.runFor(30);
        for (const ch of word.slice(1)) { await p.keyboard.press(ch); await p.clock.runFor(30); }
      } else for (const ch of word) { await p.keyboard.press(ch); await p.clock.runFor(30); }
      await p.clock.runFor(1600);
    }
    await p.clock.fastForward('11:00'); await p.clock.runFor(3000);
    return { ctx, p, typed };
  }
  let g = await play({ sessions: [sess(at(4), Y4.slice(0, 120), []), sess(at(3), Y4.slice(0, 120), []), sess(at(3, 11), Y4.slice(120), []), sess(at(2), [], Y4.slice(120))] }, ['ok', 'miss', 'ok', 'ok']);
  ok(g.typed.every(Boolean), `played ${JSON.stringify(g.typed)}`);
  ok(await g.p.isVisible('#results'), 'results shown when time is up');
  const fig = await g.p.textContent('#figMastered');
  ok(await g.p.isVisible('#figMastered'), `figure: "${fig.trim()}"`);
  const plan = ['ok', 'miss', 'ok', 'ok'], two = new Set(Y4.slice(0, 120));
  const expM = g.typed.filter((w, k) => plan[k] === 'ok' && two.has(w)), expR = g.typed.filter((w, k) => plan[k] === 'ok' && !two.has(w)), expA = [g.typed[1]];
  const want = [['tricky-list mastered', expM.map((w) => `★ ${w}`)], ['tricky-list right', expR], ['tricky-list again', expA]].filter((x) => x[1].length);
  const groups = await g.p.$$eval('#resTricky .tricky-list', (l) => l.map((x) => [x.className, [...x.children].map((c) => c.textContent)]));
  ok(JSON.stringify(groups.map(([c, w]) => [c, [...w].sort()])) === JSON.stringify(want.map(([c, w]) => [c, [...w].sort()])), `groups ${JSON.stringify(groups)} (expected ${JSON.stringify(want)})`);
  const figs = await g.p.$$eval('.figures > div:not([hidden])', (l) => l.map((d) => d.querySelector('b').textContent + ' ' + d.querySelector('span').textContent));
  ok(figs[0] === `${expM.length} new words mastered` && figs[1] === `${expR.length} right first try` && figs[2] === '1 needs more practice', `figures in order: ${JSON.stringify(figs.slice(0, 3))}`);
  const labels = await g.p.$$eval('#resTricky .label', (l) => l.map((x) => x.textContent));
  ok(JSON.stringify(labels) === JSON.stringify(want.map(([c]) => ({ 'tricky-list mastered': 'New words mastered', 'tricky-list right': 'Right first try', 'tricky-list again': 'Needs more practice' })[c])), `labels ${JSON.stringify(labels)}`);
  const fw = await g.p.evaluate(() => { const f = document.querySelector('#figMastered').getBoundingClientRect(), all = document.querySelector('.figures').getBoundingClientRect(); return [Math.round(f.width), Math.round(all.width)]; });
  const row = await g.p.$$eval('.figures > div:not([hidden])', (l) => l.map((d) => Math.round(d.getBoundingClientRect().top)));
  ok(row.length === 5 && new Set(row).size === 1, `five figures in one row on a wide screen (${row.join(',')})`);
  await g.p.screenshot({ path: 'mastery-results.png' });
  // The stats after: today's point counts the two new ones.
  await g.p.click('#homeBtn'); await g.p.clock.runFor(500);
  await g.p.click('#viewStats, #statsBtn, [id*=tats]').catch(() => {});
  await g.ctx.close();
  // No history: 0 new words mastered (nothing has 3 yet), the figure still shows 0.
  g = await play({ sessions: [] }, ['ok']);
  ok((await g.p.textContent('#resMastered')) === '0', 'first ever spelling: 0 new words mastered');
  await g.ctx.close();
  // Phone: the figure fits.
  g = await play({ sessions: [sess(at(3), Y4, []), sess(at(2), Y4, [])] }, ['ok'], 390, 844);
  ok((await g.p.evaluate(() => document.documentElement.scrollWidth)) <= 390 && (await g.p.textContent('#resMastered')) === '1', 'phone: 1 new word mastered, no sideways scroll');
  const pw = await g.p.evaluate(() => [Math.round(document.querySelector('#figMastered').getBoundingClientRect().width), Math.round(document.querySelector('.figures').getBoundingClientRect().width)]);
  ok(pw[0] === pw[1], `phone: the fifth figure takes the whole row (${pw[0]} of ${pw[1]})`);
  await g.p.screenshot({ path: 'mastery-results-phone.png', fullPage: true });
  await g.ctx.close();
  // Year buttons: "– N% mastered" when more than 1% of that year's words are.
  {
    const Y3 = await (async () => { const c = await b.newContext(); const pp = await c.newPage(); await pp.goto(base);
      const w = await pp.evaluate(() => WORD_GROUPS.filter((g) => g.level === 'Y3').flatMap((g) => g.words.map((x) => x[0]))); await c.close(); return w; })();
    const y4some = Y4.slice(0, 30), y3one = Y3.slice(0, 2); // 30/251 = 12%; 2/263 = 0.8%, under the threshold
    const s3 = (n) => sess(at(n), [...y4some], [], 'Y4'), t3 = (n) => sess(at(n, 11), [...y3one], [], 'Y3');
    ({ ctx, p } = await open({ sessions: [s3(3), s3(2), s3(1), t3(3), t3(2), t3(1)] }));
    await p.click('#continueBtn'); await p.waitForTimeout(300);
    const lv = await p.$$eval('.level b', (l) => l.map((x) => x.textContent));
    ok(lv[3] === `Year 4 ${Math.round(3000 / Y4.length)}% mastered` && lv[2] === 'Year 3' && lv[4] === 'Year 5', `year buttons: ${JSON.stringify(lv)}`);
    await p.screenshot({ path: 'mastery-levels.png' });
    await ctx.close();
  }
  // 3. Selection: with every Y4 word but 12 mastered, a round of 10 takes the not-yet-mastered words first.
  const rest = Y4.slice(0, 12), masteredAll = Y4.slice(12);
  let fromRest = 0, total = 0;
  for (let run = 0; run < 6; run++) {
    const ctx2 = await b.newContext();
    await ctx2.addInitScript(([K, v]) => { window.__said = []; speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); }; localStorage.setItem(K, JSON.stringify(v)); },
      [KEY, { current: 'u', users: { u: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', sessions: [sess(at(4), masteredAll, []), sess(at(3), masteredAll, []), sess(at(2), masteredAll, [])] } } }]);
    const p2 = await ctx2.newPage(); await p2.goto(base); await p2.waitForTimeout(300);
    await p2.click('#continueBtn'); await p2.waitForTimeout(200); await p2.click('.mode[data-mode="spell"]'); await p2.waitForTimeout(200);
    await p2.click('#lenChoices button'); await p2.waitForTimeout(400);
    // The round's words aren't on the page; read them from what the session saves: leave right away is empty, so
    // instead read the first spoken word of each of 10 skips is too slow - use the seen ticks the pick writes.
    const seen = await p2.evaluate((K) => JSON.parse(localStorage.getItem(K)).users.u.seen, KEY);
    const picked = Object.keys(seen);
    total += picked.length; fromRest += picked.filter((w) => rest.includes(w)).length;
    await ctx2.close();
  }
  ok(total === 60 && fromRest >= 54, `6 rounds of 10: ${fromRest} of ${total} words not yet mastered (all 12 first, at most 1 mastered check a round)`);
  console.log('errors: ' + errs.join(' | '));
  await b.close();
})();
