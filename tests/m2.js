// Mastery after N right-first-try spellings in a row: node m2.js base storageKey N
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3], N = +process.argv[4];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const at = (n) => { const d = new Date(); d.setHours(10, 0, 0, 0); d.setDate(d.getDate() - n); return d.toISOString(); };
const sess = (date, first, again = []) => ({ date, game: 'spell', level: 'Y4', minutes: 10, length: 10, finished: true, firstTry: first.length, struggled: again.length, firstTryWords: first, struggledWords: again });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
  // a: right N times; b: right N-1 times; c: right N times but missed last
  const hist = [];
  for (let i = 0; i < N; i++) hist.push(sess(at(5 - i), ['because', 'friend'].concat(i < N - 1 ? ['island'] : [])));
  hist.push(sess(at(1), [], ['friend']));
  await ctx.addInitScript(([K, v]) => { speechSynthesis.speak = () => {}; localStorage.setItem(K, JSON.stringify(v)); }, [KEY, { current: 'u', users: { u: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', sessions: hist } } }]);
  const p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(400);
  const line = await p.textContent('#masterLine');
  ok(/\(1 of \d+\)/.test(line), `${N} in a row masters "because" only: "${line}" (island has ${N - 1}, friend missed last)`);
  await b.close();
})();
