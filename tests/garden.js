// Word Garden words in Spelling Bee (at most 2 a round) and Word Garden's own picks. node garden.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const at = (n, h = 10) => { const d = new Date(); d.setHours(h, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString(); };
const sess = (date, first) => ({ date, game: 'spell', level: 'Y4', minutes: 10, length: 10, finished: true, firstTry: first.length, struggled: 0, firstTryWords: first, struggledWords: [] });
(async () => {
  const b = await chromium.launch(); const errs = [];
  const Y4 = await (async () => { const c = await b.newContext(); const p = await c.newPage(); await p.goto(base);
    const w = await p.evaluate(() => WORD_GROUPS.filter((g) => g.level === 'Y4').flatMap((g) => g.words.map((x) => x[0]))); await c.close(); return w; })();
  async function round(user, mode) {
    const ctx = await b.newContext();
    await ctx.addInitScript(([K, v]) => { speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(), 5); localStorage.setItem(K, JSON.stringify(v)); },
      [KEY, { current: 'u', users: { u: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', ...user } } }]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(300);
    await p.click('#continueBtn'); await p.waitForTimeout(200);
    await p.click(`.mode[data-mode="${mode}"]`); await p.waitForTimeout(250);
    if (mode === 'spell') { await p.click('#lenChoices button'); await p.waitForTimeout(400); }
    const seen = await p.evaluate((K) => JSON.parse(localStorage.getItem(K)).users.u.seen, KEY);
    await ctx.close();
    return Object.keys(seen);
  }
  const learnedWords = Y4.slice(0, 8), learned = Object.fromEntries(learnedWords.map((w) => [w, at(1)]));
  // Spelling Bee: 8 garden words waiting, no misses or tricky words: each round of 10 takes exactly 2 of them.
  const counts = [];
  for (let i = 0; i < 8; i++) { const words = await round({ learned, sessions: [] }, 'spell'); counts.push([words.length, words.filter((w) => learnedWords.includes(w)).length]); }
  ok(counts.every(([n, l]) => n === 10 && l >= 2 && l <= 4), `Spelling Bee rounds [words, garden words]: ${JSON.stringify(counts)} (2 favoured, the rest by the normal draw)`);
  // One garden word waiting: it comes in the round (still a little sooner than the others).
  const one = await round({ learned: { [Y4[5]]: at(0) }, sessions: [] }, 'spell');
  ok(one.includes(Y4[5]) && one.length === 10, 'a single garden word is in the next round');
  // A garden word older than 7 days is just a normal word: 20 rounds take it about 10/251 of the time, not always.
  let old = 0; for (let i = 0; i < 6; i++) if ((await round({ learned: { [Y4[6]]: at(9) }, sessions: [] }, 'spell')).includes(Y4[6])) old++;
  ok(old <= 2, `a garden word from 9 days ago is not favoured (${old} of 6 rounds)`);
  // Word Garden: words still waiting from the garden are not taught again, and mastered words come rarely.
  const mastered = Y4.slice(8, 200), many = Object.fromEntries(Y4.slice(200, 230).map((w) => [w, at(1)]));
  const g = [];
  for (let i = 0; i < 6; i++) g.push(await round({ learned: many, sessions: [sess(at(4), mastered), sess(at(3), mastered), sess(at(2), mastered)] }, 'words'));
  const waitingTaught = g.flat().filter((w) => many[w]).length, masteredTaught = g.map((r) => r.filter((w) => mastered.includes(w)).length);
  ok(g.every((r) => r.length === 10), `garden rounds of 10 (${g.map((r) => r.length).join(',')})`);
  ok(waitingTaught === 0, `garden words still waiting are not taught again (${waitingTaught})`);
  ok(masteredTaught.every((n) => n <= 1), `mastered words at most 1 a garden round (${masteredTaught.join(',')})`);
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
