// The backspace key: ⌫ on phones, the word on wider screens; the label stays inside the key. node bksp.js base storageKey
const { chromium, webkit } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  for (const [en, engine] of [['chromium', chromium], ['webkit', webkit]]) {
    const b = await engine.launch();
    for (const lang of ['en', 'da']) for (const [w, h] of [[320, 568], [375, 667], [390, 844], [430, 932], [480, 900], [481, 900], [499, 900], [500, 900], [600, 900], [744, 1133], [760, 900], [768, 1024], [1180, 820]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h } });
      await ctx.addInitScript(([K, l]) => { speechSynthesis.speak = () => {}; localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: l, id: 'u', sessions: [] } } })); }, [KEY, lang]);
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(base); await p.waitForTimeout(400);
      await p.click('#continueBtn'); await p.waitForTimeout(300);
      await p.click('.mode[data-mode="spell"]'); await p.waitForTimeout(300);
      await p.click('#lenChoices button'); await p.waitForTimeout(600);
      const r = await p.$eval('.kbd [data-key="backspace"]', (k) => {
        const kb = k.getBoundingClientRect(), after = getComputedStyle(k, '::after');
        const range = document.createRange(); range.selectNodeContents(k); const tb = range.getBoundingClientRect();
        return { kw: Math.round(kb.width), shown: after.content !== 'none' && after.content !== 'normal' ? after.content : k.textContent, afterFont: after.fontSize, textW: Math.round(tb.width), fs: getComputedStyle(k).fontSize, over: tb.right > kb.right - 3 };
      });
      const phone = w <= 499;
      const T = `${en} ${lang} ${w}x${h}`;
      ok(phone ? r.shown === '"⌫"' && r.fs === '0px' : r.shown === 'backspace', `${T}: shows ${r.shown} (key ${r.kw}px)`);
      ok(phone || !r.over, `${T}: label inside the key (text ${r.textW}px, key ${r.kw}px)`);
      if (phone) await p.screenshot({ path: `bksp-${en}-${lang}-${w}.png`, clip: { x: 0, y: (await p.$eval('.kbd', (k) => k.getBoundingClientRect().top)) - 4, width: w, height: 70 } });
      // Backspace still works as before: a tap types nothing.
      const before = await p.$eval('.line', (l) => l.textContent);
      await p.click('.kbd [data-key="backspace"]'); await p.waitForTimeout(150);
      ok((await p.$eval('.line', (l) => l.textContent)) === before && !errs.length, `${T}: tap types nothing, 0 errors`);
      await ctx.close();
    }
    await b.close();
  }
})();
