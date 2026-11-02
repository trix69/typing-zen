// A capital first letter counts when the word starts its sentence. node capital.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch(); const errs = [];
  // Find a Y4 word whose sentence starts with it, and one whose sentence doesn't.
  const c0 = await b.newContext(); const p0 = await c0.newPage(); await p0.goto(base);
  const pairs = await p0.evaluate(() => { const ws = WORD_GROUPS.filter((g) => g.level === 'Y2').flatMap((g) => g.words);
    const start = ws.find((w) => /^[a-z]{3,}$/.test(w[0]) && w[2].toLowerCase().startsWith(w[0] + ' '));
    const mid = ws.find((w) => /^[a-z]{3,}$/.test(w[0]) && !w[2].toLowerCase().startsWith(w[0]));
    return [start[0], mid[0]]; });
  await c0.close();
  for (const [word, startsSentence] of [[pairs[0], true], [pairs[1], false]]) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    // Only this word is left in the level: every other Y2 word mastered and done twice today, so it comes first.
    await ctx.addInitScript(([K, w]) => { window.__said = []; speechSynthesis.speak = (u) => { window.__said.push(u.text); setTimeout(() => u.onend && u.onend(), 5); };
      localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y2', bucket: 'Y2', lang: 'en', id: 'u', sessions: [], tricky: { [w]: 1 } } } })); }, [KEY, word]);
    const p = await ctx.newPage(); p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(300);
    await p.click('#continueBtn'); await p.waitForTimeout(200); await p.click('.mode[data-mode="spell"]'); await p.waitForTimeout(200);
    await p.click('#lenChoices button'); await p.waitForTimeout(500);
    // Skip words until ours (it is a tricky word, so it is in the first round).
    let seenIt = false;
    for (let i = 0; i < 12; i++) {
      let cur;
      for (let t = 0; t < 40 && !cur; t++) { cur = (await p.evaluate(() => window.__said)).find((x) => !/ /.test(x)); if (!cur) await p.waitForTimeout(100); }
      await p.evaluate(() => { window.__said = []; });
      if (cur === word) {
        await p.keyboard.press('Shift+' + word[0].toUpperCase()); await p.waitForTimeout(80);
        const after = await p.evaluate(() => [document.querySelector('.line').textContent, document.querySelector('#liveAcc').textContent]);
        for (const ch of word.slice(1)) { await p.keyboard.press(ch); await p.waitForTimeout(30); }
        await p.waitForTimeout(300);
        const msg = await p.textContent('#msg');
        if (startsSentence) ok(after[0].startsWith(word[0]) && after[1] === '100' && /^✓/.test(msg), `"${word}" starts its sentence: capital ${word[0].toUpperCase()} accepted (line "${after[0]}", accuracy ${after[1]}%, "${msg.slice(0, 40)}")`);
        else ok(after[1] !== '100', `"${word}" inside its sentence: capital ${word[0].toUpperCase()} still wrong (accuracy ${after[1]}%)`);
        seenIt = true; break;
      }
      for (const ch of cur) { await p.keyboard.press(ch); await p.waitForTimeout(20); }
      await p.waitForTimeout(1500);
    }
    ok(seenIt, `"${word}" came up`);
    await ctx.close();
  }
  ok(!errs.length, 'no page errors ' + errs.join(' | '));
  await b.close();
})();
