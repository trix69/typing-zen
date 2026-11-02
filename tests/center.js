const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  for (const [w, h, who] of [[1180, 820, 'back'], [932, 430, 'back'], [1366, 1024, 'new'], [390, 844, 'back'], [1180, 820, 'switch']]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    if (who !== 'new') await ctx.addInitScript((K) => { speechSynthesis.speak = () => {}; if (!localStorage.getItem(K)) localStorage.setItem(K, JSON.stringify({ current: 'u', users: { u: { name: 'Luke', year: 'Y4', bucket: 'Y4', lang: 'en', id: 'u', sessions: [] } } })); }, KEY);
    const p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(400);
    if (who === 'switch') { await p.click('#switchBtn'); await p.waitForTimeout(200); }
    const r = await p.evaluate(() => { const card = [...document.querySelectorAll('#welcome .intro')].find((e) => !e.hidden).getBoundingClientRect();
      const gear = document.querySelector('#welcomeSettingsBtn').getBoundingClientRect(), h1 = document.querySelector('#welcome .brand').getBoundingClientRect();
      return { cl: Math.round(card.left), cr: Math.round(card.right), gr: Math.round(gear.right), bl: Math.round(h1.left), mid: Math.round((card.left + card.right) / 2), half: innerWidth / 2, sw: document.documentElement.scrollWidth }; });
    const T = `${w}x${h} ${who}`;
    ok(Math.abs(r.mid - r.half) <= 1, `${T}: card centred (middle ${r.mid}, page ${r.half})`);
    ok(r.gr === r.cr && r.bl === r.cl, `${T}: header spans the card (gear right ${r.gr} = card right ${r.cr}, title left ${r.bl} = card left ${r.cl})`);
    ok(r.sw <= w, `${T}: no sideways scroll`);
    if (w === 1180 && who === 'back') await p.screenshot({ path: 'center-1180.png' });
    await ctx.close();
  }
  await b.close();
})();
