const { chromium } = require('playwright');
const base = process.argv[2] || 'http://localhost:8800/';
const KEY = process.argv[3] || 'typingZen.v2';
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  for (const lang of ['da', 'en']) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await ctx.addInitScript(([lang, KEY]) => {
      localStorage.setItem(KEY, JSON.stringify({ current: 'u1', users: { u1: { id: 'u1', name: 'Rachel', year: 'Y6', lang } } }));
      const V = (name, lang, uri) => ({ name, lang, voiceURI: uri, localService: true, default: false });
      const list = [V('Sara', 'da-DK', 'com.apple.voice.compact.da-DK.Sara'), V('Sara', 'da-DK', 'com.apple.ttsbundle.Sara-compact'),
        V('Karen', 'en-AU', 'com.apple.voice.compact.en-AU.Karen'), V('Karen', 'en-AU', 'com.apple.ttsbundle.Karen-compact'),
        V('Daniel', 'en-GB', 'com.apple.voice.compact.en-GB.Daniel'), V('Samantha', 'en-US', 'com.apple.voice.compact.en-US.Samantha'),
        V('Moira', 'en-IE', 'com.apple.voice.compact.en-IE.Moira')];
      Object.defineProperty(speechSynthesis, 'getVoices', { value: () => list });
    }, [lang, KEY]);
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', e => errs.push(e.message));
    await p.goto(base); await p.waitForTimeout(400);
    await p.click('#continueBtn'); await p.click('#settingsBtn'); await p.waitForTimeout(200);
    const opts = await p.$$eval('#voiceSel option', (o) => o.map((x) => x.textContent));
    console.log('  ', lang, opts);
    const names = opts.map((t) => t.replace(/ \(.*$/, ''));
    ok(new Set(names).size === names.length, `${lang}: no name twice`);
    ok(lang === 'da' ? opts.length === 1 && opts[0] === 'Sara (dansk, kvinde)' : opts.length === 3 && names.includes('Karen'), `${lang}: expected list`);
    ok(!errs.length, `${lang}: no errors`);
    await ctx.close();
  }
  await b.close();
})();
