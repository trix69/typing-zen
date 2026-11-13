// The privacy policy (2026-11-12): accepted before the app runs, asked again when its date changes, no network
// needed, and docs/privacy.html opens as itself with the service worker active. node privacy.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
const TEST = /typing-zen-test/.test(base), PPK = TEST ? 'typingZen.pp-test' : 'typingZen.pp';

(async () => {
  const b = await chromium.launch();
  const errs = [];
  // stored: what typingZen.pp holds when the page first opens (null = never accepted); run.sh's helper has
  // already accepted the current date, so this replaces it once per context.
  async function open({ stored = null, lang = 'en', vw = 1180, vh = 820, sw = false, hash = '' } = {}) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, serviceWorkers: sw ? 'allow' : 'block' });
    await ctx.addInitScript(([K, PPK, stored, lang]) => {
      if (sessionStorage.ppSeeded) return;
      sessionStorage.ppSeeded = 1;
      for (const k of ['typingZen.pp', 'typingZen.pp-test']) localStorage.removeItem(k);
      if (stored) localStorage.setItem(PPK, stored);
      localStorage.setItem(K, JSON.stringify({ current: null, lang, users: {} }));
    }, [KEY, PPK, stored, lang]);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('dialog', (d) => { errs.push('dialog: ' + d.message()); d.dismiss(); });
    await p.goto(base + hash); await p.waitForTimeout(500);
    return { ctx, p };
  }
  const shown = (p) => p.isVisible('#ppSheet');
  const saved = (p) => p.evaluate((k) => localStorage.getItem(k), PPK);

  // 0. The date the page carries.
  let { ctx, p } = await open();
  const PP = await p.evaluate(() => document.documentElement.dataset.pp);
  ok(/^\d{4}-\d{2}-\d{2}$/.test(PP), 'index.html carries the policy date: ' + PP);

  // 1. A fresh device: the policy first, over a page that can't be reached; Escape and a click outside do nothing.
  ok(await shown(p), 'fresh: the policy screen shows on opening');
  ok(await p.textContent('#ppTitle') === 'Privacy policy' && await p.textContent('#ppDate') === 'Last updated ' + PP, `title "${await p.textContent('#ppTitle')}", "${await p.textContent('#ppDate')}"`);
  ok(await p.evaluate(() => !!document.querySelector('#welcome').closest('[inert]') && !document.querySelector('#ppSheet').closest('[inert]')), 'the welcome screen behind is inert, the policy is not');
  ok(await p.evaluate(() => { const r = document.querySelector('#welcome h1, #welcome .brand, #welcome').getBoundingClientRect(); const top = document.elementFromPoint(r.left + 5, r.top + 5); return !!top.closest('#ppSheet'); }), 'the welcome screen is covered (the policy is on top)');
  ok(await p.evaluate(() => document.activeElement.id) === 'ppAccept', 'Accept has the focus');
  ok(!/Google|sync/i.test(await p.textContent('#ppSheet')), 'the first-launch screen says nothing about Google: "' + (await p.textContent('#ppText')).trim() + '"');
  await p.keyboard.press('Escape'); await p.waitForTimeout(150);
  ok(await shown(p), 'Escape does nothing');
  await p.mouse.click(5, 5); await p.waitForTimeout(150);
  ok(await shown(p), 'a click outside the card does nothing');
  for (let i = 0; i < 6; i++) await p.keyboard.press('Tab');
  ok(await p.evaluate(() => !!document.activeElement.closest('#ppSheet')), 'Tab stays inside');
  await p.keyboard.type('abc');
  ok(await p.inputValue('#newName').catch(() => '') === '', 'typing reaches nothing behind it');
  ok(await p.getAttribute('#ppLink', 'href') === 'docs/privacy.html' && await p.getAttribute('#ppLink', 'target') === '_blank', '"Read the full policy" opens docs/privacy.html in a new tab');
  // Decline: nothing saved, a message, Accept still there.
  await p.click('#ppDecline'); await p.waitForTimeout(150);
  ok(await shown(p) && await p.isVisible('#ppNeed') && await saved(p) === null, `Decline: "${await p.textContent('#ppNeed')}", nothing saved, still shown`);
  ok(await p.isVisible('#ppAccept') && await p.evaluate(() => document.activeElement.id) === 'ppAccept', 'Accept still there, focused');
  await p.reload(); await p.waitForTimeout(500);
  ok(await shown(p), 'declined then reloaded: asked again');
  await p.click('#ppAccept'); await p.waitForTimeout(200);
  ok(!(await shown(p)) && await saved(p) === PP, `Accept: closed, ${PPK} = ${await saved(p)}`);
  ok(await p.evaluate(() => !document.querySelector('[inert]')), 'nothing left inert');
  ok(await p.isVisible('#welcome') && await p.isVisible('#newName'), 'the welcome screen is usable');
  await p.reload(); await p.waitForTimeout(500);
  ok(!(await shown(p)), 'reloaded after Accept: not asked');
  // Settings: the accepted date, and a button that shows the policy again.
  await p.click('#welcomeSettingsBtn'); await p.waitForTimeout(300);
  ok(await p.textContent('#ppState') === 'Accepted on this device: ' + PP, 'Settings: ' + await p.textContent('#ppState'));
  await p.click('#ppOpen'); await p.waitForTimeout(200);
  ok(await shown(p) && await p.textContent('#ppTitle') === 'Privacy policy', 'Settings reopens the policy, over Settings');
  await p.click('#ppAccept'); await p.waitForTimeout(200);
  ok(!(await shown(p)) && await p.isVisible('#sheet'), 'Accept returns to Settings');
  await ctx.close();

  // 1b. Launch counts (2026-11-13): nothing before the policy is accepted; one POST /hit after Accept; none offline.
  {
    ({ ctx, p } = await open());
    const sent = [];
    await ctx.route('https://typing-zen-board.trix69.workers.dev/**', (r) => { const q = r.request(); if (q.method() === 'POST') sent.push(JSON.parse(q.postData())); r.fulfill({ status: q.method() === 'OPTIONS' ? 204 : 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'Content-Type', 'access-control-allow-methods': 'POST', 'content-type': 'application/json' }, body: '{"ok":true}' }); });
    await p.waitForTimeout(2500);
    ok(sent.length === 0, `not accepted: no launch count sent (${sent.length})`);
    await p.click('#ppAccept'); await p.waitForTimeout(800);
    const h = sent[0] || {};
    ok(sent.length === 1 && /^[A-Za-z0-9_-]{24}$/.test(h.id) && h.c === 'web' && h.u === 'none' && h.v === (await p.textContent('#appVersion')).trim() && Object.keys(h).sort().join() === 'c,id,site,u,v',
      `Accept: one launch count, only site/id/c/v/u (${JSON.stringify({ ...h, id: h.id && h.id.slice(0, 4) + '…' })})`);
    await p.reload(); await p.waitForTimeout(2500);
    ok(sent.length === 2, `the next launch: counted once more (${sent.length})`);
    // Offline with the offline copy installed is section 5: 0 requests, so no launch count either.
    await ctx.close();
  }

  // 2. An older date accepted: asked again, titled "updated"; Accept saves the new date.
  ({ ctx, p } = await open({ stored: '2020-01-01' }));
  ok(await shown(p) && await p.textContent('#ppTitle') === 'Privacy policy updated', 'older date accepted: "' + await p.textContent('#ppTitle') + '"');
  await p.click('#ppAccept'); await p.waitForTimeout(200);
  ok(await saved(p) === PP, `Accept replaces 2020-01-01 with ${await saved(p)}`);
  await ctx.close();
  // #pp=reset: asked for this visit, and the saved acceptance is left as it was until Accept.
  ({ ctx, p } = await open({ stored: PP, hash: '#pp=reset' }));
  ok(await shown(p) && await saved(p) === PP && !/#/.test(p.url()), '#pp=reset: asked, saved date untouched, the address cleaned');
  await ctx.close();

  // 3. Danish.
  ({ ctx, p } = await open({ lang: 'da' }));
  ok(await p.textContent('#ppTitle') === 'Privatlivspolitik' && await p.textContent('#ppDate') === 'Sidst opdateret ' + PP, 'Danish title and date');
  ok(/^Typing Zen gemmer din fremgang på denne enhed/.test(await p.textContent('#ppText')) && await p.textContent('#ppLink') === 'Læs hele politikken', 'Danish text and link');
  ok(await p.textContent('#ppAccept') === 'Accepter' && await p.textContent('#ppDecline') === 'Afvis', 'Danish buttons');
  await ctx.close();

  // 4. Small and phone screens, English and Danish: date and both buttons on screen, nothing behind scrolls.
  for (const [vw, vh] of [[320, 568], [402, 874]]) for (const lang of ['en', 'da']) {
    ({ ctx, p } = await open({ lang, vw, vh }));
    const r = await p.evaluate(() => {
      const box = (s) => { const x = document.querySelector(s).getBoundingClientRect(); return x.top >= 0 && x.bottom <= innerHeight && x.left >= 0 && x.right <= innerWidth; };
      return { date: box('#ppDate'), accept: box('#ppAccept'), decline: box('#ppDecline'), scroll: document.scrollingElement.scrollTop, wide: document.documentElement.scrollWidth - innerWidth };
    });
    ok(r.date && r.accept && r.decline && r.scroll === 0 && r.wide <= 0, `${vw}×${vh} ${lang}: date, Accept, Decline on screen, no page scroll (${JSON.stringify(r)})`);
    await ctx.close();
  }

  // 4b. Sign in with Google: a reminder first, every time; Cancel opens nothing, Continue goes on to Google.
  {
    ({ ctx, p } = await open({ stored: PP }));
    let sdk = 0;
    await ctx.route(/gstatic\.com\/firebasejs/, (r) => { sdk++; r.abort(); });
    ok(!(await shown(p)) && await p.isVisible('#googleNew'), 'accepted: the new-user form with Sign in with Google');
    await p.click('#googleNew'); await p.waitForTimeout(200);
    ok(await p.isVisible('#gSheet') && /follow you to your other devices/.test(await p.textContent('#gText')) && /Sydney/.test(await p.textContent('#gText')), 'Sign in with Google: the reminder about Google first');
    ok(await p.evaluate(() => document.activeElement.id) === 'gContinue' && await p.textContent('#gContinue') === 'Continue' && await p.textContent('#gCancel') === 'Cancel', 'Continue (focused) and Cancel');
    for (let i = 0; i < 3; i++) await p.keyboard.press('Tab');
    ok(await p.evaluate(() => !!document.activeElement.closest('#gSheet')), 'Tab stays inside, the policy link included');
    await p.click('#gCancel'); await p.waitForTimeout(400);
    ok(!(await p.isVisible('#gSheet')) && sdk === 0, `Cancel: closed, Google not contacted (${sdk} SDK requests)`);
    await p.click('#googleNew'); await p.waitForTimeout(200); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    ok(!(await p.isVisible('#gSheet')) && sdk === 0, 'asked again on the next click; Escape cancels too');
    await p.click('#googleNew'); await p.waitForTimeout(200); await p.click('#gContinue'); await p.waitForTimeout(800);
    ok(!(await p.isVisible('#gSheet')) && sdk > 0, `Continue: sign-in starts (${sdk} SDK requests)`);
    await ctx.close();
    ({ ctx, p } = await open({ stored: PP, lang: 'da' }));
    await p.click('#googleNew'); await p.waitForTimeout(200);
    ok(/^Når du logger ind med Google/.test(await p.textContent('#gText')) && await p.textContent('#gContinue') === 'Fortsæt' && await p.textContent('#gCancel') === 'Annuller', 'Danish reminder');
    await ctx.close();
  }

  // 5. Offline. With the policy accepted and the offline copy installed: no screen, and not one request leaves.
  ({ ctx, p } = await open({ stored: PP, sw: true }));
  await p.evaluate(() => navigator.serviceWorker.ready); await p.reload(); await p.waitForTimeout(800);
  ok(await p.evaluate(() => !!navigator.serviceWorker.controller), 'the offline copy controls the page');
  await ctx.setOffline(true);
  const net = [], failed = [];
  ctx.on('requestfinished', async (r) => { const res = await r.response(); if (res && !res.fromServiceWorker()) net.push(r.url()); });
  ctx.on('requestfailed', (r) => failed.push(r.url()));
  await p.reload(); await p.waitForTimeout(2500); // past the automatic update check at 1.5 s
  ok(!(await shown(p)) && await p.isVisible('#welcome'), 'offline, accepted: no policy screen, the app opens');
  ok(net.length === 0 && failed.length === 0, `offline, accepted: ${net.length} requests to the network, ${failed.length} failed ${JSON.stringify([...net, ...failed].slice(0, 4))}`);
  // Offline without acceptance: the screen works, the summary reads, the link fails quietly in its own tab.
  await p.evaluate((k) => localStorage.removeItem(k), PPK);
  await p.reload(); await p.waitForTimeout(800);
  ok(await shown(p) && (await p.textContent('#ppText')).length > 100, 'offline, not accepted: the screen and its summary');
  const [tab] = await Promise.all([ctx.waitForEvent('page'), p.click('#ppLink')]);
  await tab.waitForLoadState().catch(() => {}); await p.waitForTimeout(500);
  ok(await shown(p) && !errs.some((e) => /dialog/.test(e)), 'the link opens a tab of its own; the app shows no error dialog');
  await tab.close();
  await p.click('#ppAccept'); await p.waitForTimeout(200);
  ok(await saved(p) === PP && !(await shown(p)), 'offline Accept works');
  await ctx.setOffline(false);

  // 6. docs/privacy.html with the service worker in control: the policy itself, not the app.
  const pol = await ctx.newPage();
  await pol.goto(base + 'docs/privacy.html'); await pol.waitForTimeout(300);
  const meta = await pol.evaluate(() => [document.title, (document.querySelector('meta[name="pp-version"]') || {}).content, !!document.querySelector('#ppSheet'), !!navigator.serviceWorker.controller]);
  ok(/privacy policy/i.test(meta[0]) && meta[1] === PP && !meta[2], `with the service worker active, docs/privacy.html is the policy (title "${meta[0]}", date ${meta[1]}, app markup ${meta[2]})`);
  const ver = await pol.evaluate(async () => (await (await fetch('privacy-version.json', { cache: 'no-store' })).json()).version);
  ok(ver === PP, 'docs/privacy-version.json says ' + ver);
  await ctx.close();

  ok(!errs.length, 'no page errors or dialogs ' + errs.join(' | '));
  await b.close();
})();
