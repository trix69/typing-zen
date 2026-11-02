// Reduce Motion: the last rule in style.css is present and stops animations. node motion.js base storageKey
const { chromium, webkit } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  for (const eng of [chromium, webkit]) {
    const b = await eng.launch();
    const ctx = await b.newContext({ viewport: { width: 1180, height: 760 }, reducedMotion: 'reduce' });
    await ctx.addInitScript(([K]) => { speechSynthesis.speak = () => {}; if (!sessionStorage.done) { sessionStorage.done = 1; localStorage.setItem(K, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en' } } })); } }, [KEY]);
    const p = await ctx.newPage();
    await p.goto(base); await p.waitForTimeout(300);
    await p.click('#continueBtn'); await p.click('.mode[data-mode="spell"]'); await p.click('#lenChoices button'); await p.waitForTimeout(400);
    const r = await p.evaluate(() => {
      const sheet = [...document.styleSheets].find((s) => /style\.css/.test(s.href || ''));
      const last = sheet.cssRules[sheet.cssRules.length - 1].cssText;
      const b = document.querySelector('.trail i.time b'); b.classList.add('ending');
      const cs = getComputedStyle(b);
      return { last: last.slice(0, 50), anim: cs.animationName, tr: cs.transitionDuration, key: getComputedStyle(document.querySelector('#kbd .key')).transitionDuration };
    });
    const n = eng.name();
    ok(/prefers-reduced-motion/.test(r.last), `${n}: last rule is the reduced-motion block (${r.last})`);
    ok(r.anim === 'none' && /^0s/.test(r.tr) && /^0s/.test(r.key), `${n}: ending bar animation ${r.anim}, bar transition ${r.tr}, key transition ${r.key}`);
    await b.close();
  }
})();
