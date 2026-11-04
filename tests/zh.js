// Chinese (user's request, 2026-11-04): Settings > Language 中文, words-zh.js's words shown in characters and typed
// as pinyin without tones on the English keyboard, with a Mandarin voice. node zh.js base storageKey
const { chromium } = require('playwright');
const base = process.argv[2], KEY = process.argv[3];
const ok = (c, m) => { console.log((c ? 'PASS ' : 'FAIL ') + m); if (!c) process.exitCode = 1; };
(async () => {
  const b = await chromium.launch();
  const mk = async (seed, hash = '', w = 1180, h = 820) => {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(([seed, KEY]) => {
      if (seed && !sessionStorage.getItem('seeded')) { localStorage.setItem(KEY, JSON.stringify(seed)); sessionStorage.setItem('seeded', 1); }
      window.__said = [];
      speechSynthesis.speak = (u) => { window.__said.push([u.text, u.lang]); setTimeout(() => u.onend && u.onend(), 10); };
    }, [seed, KEY]);
    const p = await ctx.newPage(); p.errs = [];
    p.on('pageerror', (e) => p.errs.push(e.message));
    await p.goto(base + hash); await p.waitForTimeout(600);
    return p;
  };
  const day = new Date().toISOString();
  // The word list itself.
  let p = await mk(null);
  const list = await p.evaluate(() => WORD_GROUPS_ZH.map((g) => [g.level, g.words.length, g.words.every((w) => /^[a-z]+( [a-z]+)*$/.test(w[5]) && w[5].split(' ').reduce((n, sy) => n + (/r$/.test(sy) && sy !== 'er' ? 2 : 1), 0) === [...w[0]].length && w[1] && w[2].includes(w[0]))]));
  const total = list.reduce((n, x) => n + x[1], 0);
  ok(list.length === 6 && list.every((x, i) => x[0] === 'Y' + (i + 1) && x[1] >= 230 && x[2]) && total >= 1450,
    `words-zh.js: Year 1-6, ${total} words (${list.map((x) => x[1]).join('/')}), every one with a meaning, a-z pinyin with one syllable per character, and a sentence containing it`);
  await p.context().close();

  // 1. An English user with history switches to 中文: asked first, history cleared, Mandarin voice.
  const seed = { current: 'u1', users: { u1: { id: 'u1', name: 'Luke', year: 'Y2', bucket: 'Y2', stars: 7, rounds: 3,
    sessions: [{ date: day, game: 'spell', level: 'Y2', minutes: 1, length: 1, finished: true, firstTry: 1, struggled: 1, firstTryWords: ['dog'], struggledWords: ['because'] }] } } };
  p = await mk(seed);
  await p.click('#continueBtn'); await p.waitForTimeout(300);
  await p.click('#settingsBtn'); await p.waitForTimeout(200);
  ok(await p.isVisible('#segLang [data-lang=zh]') && (await p.textContent('#segLang [data-lang=zh]')) === '中文', 'Settings > Language has 中文');
  const row = await p.$$eval('#segLang button', (l) => l.map((x) => Math.round(x.getBoundingClientRect().top)));
  ok(new Set(row).size === 1, 'English, Dansk and 中文 on one row');
  await p.click('#segLang [data-lang=zh]'); await p.waitForTimeout(300);
  const st = await p.evaluate((K) => JSON.parse(localStorage.getItem(K)).users.u1, KEY);
  ok(st.lang === 'zh' && st.voice === 'zh-female' && st.sessions.length === 0 && st.year === 'Y2' && st.byLang.en.stars === 7 && st.byLang.en.sessions.length === 1,
    'switched without asking: lang zh, Mandarin voice, a fresh Chinese history, English kept apart, year kept');
  ok((await p.textContent('#sheetTitle')) === 'Settings' && (await p.getAttribute('#segLang [data-lang=zh]', 'aria-checked')) === 'true', 'the page text stays English; 中文 is chosen');
  await p.click('#sheetDone'); await p.waitForTimeout(200);
  const lvl = await p.textContent('.level[data-bucket="Y2"]');
  ok(/Year 2/.test(lvl) && /时间, 帮助, 漂亮/.test(lvl), 'level button: Year 2 with Chinese sample words: ' + lvl.replace(/\s+/g, ' '));
  ok(await p.evaluate(() => document.querySelectorAll('.kbd [data-key="["]').length === 1), 'English keyboard');

  // 2. Spelling Bee: the characters and meaning, no pinyin shown; typed as pinyin; capitals and u for ü count.
  await p.click('.mode[data-mode="spell"]'); await p.click('#lenChoices button'); await p.waitForTimeout(900);
  const card = await p.evaluate(() => ({ hanzi: document.querySelector('#card .hanzi')?.textContent, meaning: document.querySelector('#card .meaning')?.textContent, pinyin: !!document.querySelector('#card .pinyin'), sentence: document.querySelectorAll('[data-say="sentence"]').length, clue: document.querySelector('#card .zh-clue')?.textContent, pin: document.querySelector('#card .hint-pinyin')?.textContent, mark: document.querySelector('#card .zh-clue mark')?.textContent }));
  const word = await p.evaluate((h) => WORD_GROUPS_ZH.flatMap((g) => g.words).find((w) => w[0] === h), card.hanzi);
  const typed = word[5].replace(/ /g, '');
  const brk = await p.evaluate(() => [...document.querySelectorAll('#line .brk')].map((x) => [...x.parentNode.children].indexOf(x)));
  const want = []; { let at = 0; for (const sy of word[5].split(' ').slice(0, -1)) want.push((at += sy.length) - 1); }
  ok(JSON.stringify(brk) === JSON.stringify(want) && (await p.$$eval('#line span', (l) => l.length)) === typed.length,
    `the line: ${typed.length} dashes, a gap after each syllable of "${word[5]}" (${JSON.stringify(brk)}), no space to type`);
  ok(/Type its pinyin, without tones \(ü is v\)/.test(await p.textContent('#finger')), 'hint: ' + await p.textContent('#finger'));
  ok(word && /^It means /.test(card.meaning), `card: ${card.hanzi} "${card.meaning}"`);
  // Only the tone marks show above the line, over the letters that carry them (user's request, 2026-11-04).
  const tones = await p.evaluate(() => [...document.querySelectorAll('#line span')].map((x, i) => [i, x.dataset.tone || '', x.textContent]).filter((x) => x[1]));
  const wantT = []; { let n = 0; for (const c of word[4].normalize('NFD')) { const m = { '\u0304': 'ˉ', '\u0301': 'ˊ', '\u030c': 'ˇ', '\u0300': 'ˋ' }[c]; if (m) wantT.push([n - 1, m]); else if (/[a-z]/i.test(c)) n++; } }
  ok(JSON.stringify(tones.map((x) => [x[0], x[1]])) === JSON.stringify(wantT) && tones.every((x) => x[2] === '_') && !(await p.$('#card .hint-pinyin')) && !(await p.textContent('#card')).includes(word[4]),
    `tone marks only, over the right dashes: ${word[4]} -> ${JSON.stringify(tones.map((x) => x[0] + x[1]))}; no pinyin letters shown`);
  const above = await p.evaluate(() => { const s = document.querySelector('#line span[data-tone]'); if (!s) return true; const b = getComputedStyle(s, '::before'); const mask = b.maskImage || b.webkitMaskImage || ''; return /^url\(/.test(mask) && b.position === 'absolute' && parseFloat(b.bottom) > 0; });
  ok(above, 'the mark is drawn (a shape, not a font glyph) above its dash');
  ok(card.clue === word[2] && card.mark === card.hanzi && card.sentence === 1, `example sentence with the word marked: ${card.clue}, and a Hear the sentence button`);
  const said = await p.evaluate(() => window.__said);
  await p.waitForTimeout(1300);
  const said2 = await p.evaluate(() => window.__said);
  ok(said2.length >= 2 && said2[0][0] === card.hanzi && said2[1][0] === word[2] && said2.every((x) => /^zh/.test(x[1])), `spoken in Mandarin, the word then its sentence: ${JSON.stringify(said2.slice(0, 2))}`);
  const gaps = await p.evaluate(() => document.querySelector('#line').textContent.length);
  ok(gaps >= typed.length, `the line has room for ${typed} (${gaps})`);
  // Type it in capitals, ü as u.
  for (const ch of typed) await p.keyboard.press(ch === 'v' ? 'U' : ch.toUpperCase()), await p.waitForTimeout(30);
  await p.waitForTimeout(400);
  const first = await p.evaluate(() => (window.__test_first = document.querySelector('#msg').textContent));
  ok(!(await p.evaluate(() => document.querySelector('#line .miss'))) && /./.test(first), `typed ${typed.toUpperCase()} (capitals, u for v, no spaces): done, "${first}"`);
  await p.waitForTimeout(1500);
  const next = await p.textContent('#card .hanzi');
  ok(next && next !== card.hanzi, 'the next word comes: ' + next);
  // A wrong key is a miss.
  await p.keyboard.press('q'); await p.keyboard.press('q'); await p.waitForTimeout(100);
  const nw = await p.evaluate((h) => WORD_GROUPS_ZH.flatMap((g) => g.words).find((w) => w[0] === h)[5].replace(/ /g, ''), next);
  ok(nw[0] === 'q' || /type the orange letter/.test(await p.textContent('#msg')), 'two wrong keys show the orange hint');
  await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  ok(await p.isVisible('#home') || await p.isVisible('#results'), 'left the round');
  ok(!p.errs.length, 'no errors ' + p.errs.join(' | '));
  await p.context().close();

  // 3. Practice and Word Garden show the pinyin with tones; Practice says the word, not its letters.
  const zseed = (sessions) => ({ current: 'u1', lang: 'zh', users: { u1: { id: 'u1', name: 'Mei', year: 'Y1', bucket: 'Y1', lang: 'zh', voice: 'zh-female', sessions } } });
  p = await mk(zseed([{ date: day, game: 'spell', level: 'Y1', minutes: 1, length: 1, finished: true, firstTry: 1, struggled: 1, firstTryWords: ['你好'], struggledWords: ['绿色'], lang: 'zh' }]));
  ok((await p.textContent('#continueBtn')) === 'Continue as Mei', 'a Chinese user: the start screens are in English');
  await p.click('#missedBtn'); await p.waitForTimeout(300);
  const days = (await p.textContent('#missedDays')).replace(/\s+/g, ' ');
  ok(/你好/.test(days) && /绿色/.test(days), 'See the words lists the characters: ' + days.slice(0, 80));
  await p.click('#missedDays button[data-day]'); await p.waitForTimeout(600);
  const pc = await p.evaluate(() => ({ hanzi: document.querySelector('#card .hanzi')?.textContent, pinyin: document.querySelector('#card .pinyin')?.textContent, line: document.querySelector('#line').textContent }));
  ok(pc.hanzi === '绿色' && pc.pinyin === 'lǜ sè' && pc.line === 'lvse' && (await p.$$eval('#line .brk', (l) => l.length)) === 1, `Practice: 绿色 with "lǜ sè", type ${pc.line}, drawn with a gap after lv`);
  const ps = await p.evaluate(() => window.__said.map((x) => x[0]));
  ok(ps.length >= 1 && ps.every((x) => x === '绿色'), 'Practice says the word, not its letters: ' + JSON.stringify(ps));
  for (const ch of 'lvse') await p.keyboard.press(ch), await p.waitForTimeout(30);
  await p.waitForTimeout(400);
  ok((await p.$$eval('#card .reps i.on', (l) => l.length)) === 1, 'a clean go fills a dot');
  await p.waitForFunction(() => document.querySelector('#line .caret, #line .cur') && !document.querySelector('#line .done'), null, { timeout: 4000 }).catch(() => {});
  await p.waitForTimeout(300);
  for (const ch of 'luse') await p.keyboard.press(ch), await p.waitForTimeout(30);
  await p.waitForTimeout(400);
  ok((await p.$$eval('#card .reps i.on', (l) => l.length)) === 2, 'ü typed as u (luse) counts as a clean go too');
  ok(!p.errs.length, 'no errors ' + p.errs.join(' | '));
  await p.context().close();
  p = await mk(zseed([]));
  await p.click('#continueBtn'); await p.waitForTimeout(300);
  await p.click('.mode[data-mode="words"]'); await p.waitForTimeout(700);
  const g = await p.evaluate(() => ({ hanzi: document.querySelector('#card .hanzi')?.textContent, pinyin: document.querySelector('#card .pinyin')?.textContent }));
  const gw = await p.evaluate((h) => WORD_GROUPS_ZH[0].words.find((w) => w[0] === h), g.hanzi);
  ok(gw && g.pinyin === gw[4] && await p.textContent('#card .zh-clue') === gw[2], `Word Garden: ${g.hanzi} with its pinyin ${g.pinyin} and sentence ${gw[2]}`);
  ok(!p.errs.length, 'no errors ' + p.errs.join(' | '));
  await p.context().close();

  // 4. #zh opens the start screens with 中文 chosen, and a new user made there starts in Chinese.
  p = await mk(null, '#zh');
  await p.fill('#newName', 'Lin'); await p.click('#newYear button[data-year="Y3"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(400);
  const nu = await p.evaluate((K) => Object.values(JSON.parse(localStorage.getItem(K)).users)[0], KEY);
  ok(nu && nu.lang === 'zh' && nu.voice === 'zh-female', '#zh: a new user starts in Chinese');
  ok(!p.errs.length, 'no errors ' + p.errs.join(' | '));
  await p.context().close();

  // 5. Phone size: the characters fit.
  p = await mk(zseed([]), '', 375, 667);
  await p.click('#continueBtn'); await p.waitForTimeout(300);
  await p.click('.mode[data-mode="spell"]'); await p.click('#lenChoices button'); await p.waitForTimeout(900);
  const fit = await p.evaluate(() => { const r = document.querySelector('#card .hanzi').getBoundingClientRect(); return [r.width, document.documentElement.scrollWidth]; });
  ok(fit[0] <= 375 && fit[1] <= 375, `375 px: characters ${Math.round(fit[0])} px wide, page ${fit[1]} px`);
  await p.context().close();
  // A real phone (touch) starts on its own keyboard; with the on-screen one shown, the space bar must be on screen
  // (Hermes R79.2, measured as R80 advised: a non-touch window always fills exactly, so it can't catch this).
  { const ctx = await b.newContext({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });
    await ctx.addInitScript(([K, seed]) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem(K, JSON.stringify(seed)); sessionStorage.setItem('seeded', 1); }
      speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(), 5); }, [KEY, zseed([])]);
    p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(500);
    await p.tap('#continueBtn'); await p.waitForTimeout(300);
    await p.tap('.mode[data-mode="spell"]'); await p.tap('#lenChoices button'); await p.waitForTimeout(900);
    if (await p.isVisible('#kbdToggle') && !(await p.isVisible('.kbd'))) { await p.tap('#kbdToggle'); await p.waitForTimeout(300); }
    const space = await p.evaluate(() => { window.scrollTo(0, 0); const k = document.querySelector('.kbd [data-key=" "]') || [...document.querySelectorAll('.kbd .key')].pop(); return Math.round(k.getBoundingClientRect().bottom); });
    ok(space <= 667, `375x667 touch, on-screen keyboard shown: the space bar ends at ${space} px (Hermes R79.2)`);
    await ctx.close(); }
  // 6. Wide, short screens: the characters, sentence and keyboard fit without scrolling (like English).
  for (const [w, h] of [[1024, 700], [1366, 768], [1180, 820]]) {
    p = await mk(zseed([]), '', w, h);
    await p.click('#continueBtn'); await p.waitForTimeout(300);
    await p.click('.mode[data-mode="spell"]'); await p.click('#lenChoices button'); await p.waitForTimeout(900);
    const sh = await p.evaluate(() => document.documentElement.scrollHeight);
    ok(sh <= h, `${w}x${h}: no scrolling (page ${sh} px)`);
    await p.context().close();
  }
  // 7. No Mandarin voice on the device (Hermes R79.1): the note says Chinese; with Tingting it is hidden.
  for (const [names, want] of [[['Daniel|en-GB', 'Samantha|en-US', 'Karen|en-AU'], true], [['Daniel|en-GB', 'Tingting|zh-CN'], false]]) {
    const ctx = await b.newContext({ viewport: { width: 1180, height: 820 } });
    await ctx.addInitScript(([K, seed, names]) => {
      if (!sessionStorage.getItem('seeded')) { localStorage.setItem(K, JSON.stringify(seed)); sessionStorage.setItem('seeded', 1); }
      const vs = names.map((x) => { const [name, lang] = x.split('|'); return { name, lang, voiceURI: name, localService: true, default: false }; });
      speechSynthesis.getVoices = () => vs; speechSynthesis.speak = (u) => setTimeout(() => u.onend && u.onend(), 5);
    }, [KEY, zseed([]), names]);
    p = await ctx.newPage(); await p.goto(base); await p.waitForTimeout(500);
    await p.click('#continueBtn'); await p.click('#settingsBtn'); await p.waitForTimeout(300);
    const note = await p.isVisible('#voiceNote') ? await p.textContent('#voiceNote') : '';
    ok(want ? /no Chinese voice/.test(note) : !note, `${names.join(', ')}: ${want ? 'the note names Chinese: ' + note : 'no note'}`);
    await ctx.close();
  }
  await b.close();
})();
