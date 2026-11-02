// Spelling Bee results play the triumph sound for the stars earned. node triumph.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  async function round(plan, mute = false) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript(([K, m]) => { window.__said = []; speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); };
      window.__notes = []; const st = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { window.__notes.push([Math.round(this.frequency.value), this.type]); return st.apply(this, a); };
      if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', mute: m, keySound: 'off', sessions: [] } } })); }, [KEY, mute]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.clock.install(); await p.goto(base); await p.clock.runFor(500);
    await p.click('#continueBtn'); await p.clock.runFor(300); await p.click('.mode[data-mode="spell"]'); await p.clock.runFor(300);
    await p.click('#lenChoices button'); await p.clock.runFor(900);
    for (const how of plan) {
      let w; for (let t = 0; t < 30 && !w; t++) { w = (await p.evaluate(() => window.__said)).find((x) => !/ /.test(x)); if (!w) await p.clock.runFor(100); }
      await p.evaluate(() => { window.__said = []; });
      if (how !== 'ok') for (let k = 0; k < (how === 'many' ? 12 : 4); k++) { await p.keyboard.press(w[0] === 'q' ? 'z' : 'q'); await p.clock.runFor(200); }
      for (const ch of w) { await p.keyboard.press(ch); await p.clock.runFor(300); }
      await p.clock.runFor(1700);
    }
    await p.evaluate(() => { window.__notes = []; });
    await p.clock.fastForward('11:00'); await p.clock.runFor(3000);
    const r = await p.evaluate(() => ({ notes: window.__notes, stars: document.querySelectorAll('#stars span:not(.off)').length, title: document.querySelector('#resTitle').textContent }));
    await ctx.close(); return r;
  }
  const melody = (r) => r.notes.filter(([, t]) => t === 'triangle').map(([f]) => f);
  let r = await round(['ok', 'ok', 'ok']);
  ok(r.stars === 3 && JSON.stringify(melody(r).slice(0, 6)) === '[523,659,784,1047,1319,1568]' && r.notes.filter(([, t]) => t === 'sine').length >= 9 + 10, `3 stars (${r.title}): rocket run ${JSON.stringify(melody(r).slice(0, 6))}, chord and sparkle (${r.notes.length} oscillators)`);
  // The words are random, so a round with a few wrong keys can land on 1 or 2 stars: the sound must match what's shown.
  const WANT = { 1: '[523,659,784]', 2: '[523,659,784,1047,523,659,784,1047]' };
  const seen = new Set();
  for (let k = 0; k < 4 && !seen.has(2); k++) {
    r = await round(['typos', 'ok', 'ok']);
    seen.add(r.stars);
    ok(WANT[r.stars] === JSON.stringify(melody(r)), `${r.stars} star${r.stars === 1 ? '' : 's'} (${r.title}): ${JSON.stringify(melody(r))}`);
  }
  ok(seen.has(2), 'a 2-star round was reached and heard');
  r = await round(['many']);
  ok(r.stars === 1 && JSON.stringify(melody(r)) === '[523,659,784]', `1 star (${r.title}): three rising notes ${JSON.stringify(melody(r))}`);
  r = await round([]);
  ok(r.stars === 0 && melody(r).length === 0, `no words: no triumph (${r.notes.length} oscillators)`);
  r = await round(['ok'], true);
  ok(r.stars === 3 && melody(r).length === 10, `muted user: Spelling Bee's triumph still plays (${melody(r).length} melody notes)`);
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
