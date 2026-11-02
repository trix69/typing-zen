// Play screen fills tablet/laptop screens: no scroll, keyboard wide, little empty space below.
// node fill.js base storageKey [shotPrefix]
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3], shot = process.argv[4];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const VPS = [[1180, 760, 'iPad Air landscape, Safari'], [1180, 820, 'iPad Air landscape, home screen'], [1366, 960, 'iPad Pro 12.9 landscape'],
  [1024, 700, 'iPad 9th landscape'], [1133, 680, 'iPad mini landscape'], [820, 1100, 'iPad Air portrait'], [1440, 800, 'laptop'], [1920, 1000, 'desktop']];
(async () => {
  const b = await chromium.launch();
  for (const [w, h, name] of VPS) {
    for (const mode of ['spell', 'words']) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, hasTouch: true });
      await ctx.addInitScript(([K]) => { speechSynthesis.speak = () => {}; if (!sessionStorage.done) { sessionStorage.done = 1; localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en' } } })); } }, [KEY]);
      const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
      await p.goto(base); await p.waitForTimeout(300);
      await p.click('#continueBtn');
      await p.click(`.mode[data-mode="${mode}"]`);
      if (mode === 'spell') await p.click('#lenChoices button');
      await p.waitForTimeout(400);
      // On-screen keyboard shown (as in the photo), even if this device started with its own.
      if (await p.evaluate(() => document.querySelector('#play').classList.contains('native'))) await p.click('#kbdToggle');
      await p.waitForTimeout(200);
      const m = await p.evaluate(() => {
        const r = (s) => document.querySelector(s).getBoundingClientRect();
        const kbd = r('#kbd'), tog = r('#kbdToggle'), stage = r('#play .stage');
        return { sh: document.documentElement.scrollHeight, kw: Math.max(...[...document.querySelectorAll('#kbd .row')].map((x) => x.getBoundingClientRect().width)), kb: kbd.bottom, bottom: Math.max(kbd.bottom, tog.bottom), stageH: stage.height,
          line: parseFloat(getComputedStyle(document.querySelector('#line')).fontSize), key: document.querySelector('#kbd .key').getBoundingClientRect().height };
      });
      const tag = `${name} ${w}x${h} ${mode}`;
      ok(m.sh <= h, `${tag}: no scroll (page ${m.sh})`);
      if (w > h && w <= 1600) ok(m.kw >= 0.8 * w, `${tag}: keyboard ${Math.round(m.kw)} px = ${Math.round(100 * m.kw / w)}% of width`);
      ok(m.bottom >= h - 40 || w > 1600, `${tag}: content ends at ${Math.round(m.bottom)} of ${h} (key ${Math.round(m.key)} px, word ${m.line}px, stage ${Math.round(m.stageH)})`);
      ok(!errs.length, `${tag}: no errors`);
      if (shot && mode === 'spell') await p.screenshot({ path: `${shot}-${w}x${h}.png` });
      await ctx.close();
    }
  }
  await b.close();
})();
