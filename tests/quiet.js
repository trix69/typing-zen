// Loaded by run.sh (node -r) before every suite. Two things for every browser context the suites open:
// 1. Silences speech. Headless Chromium on macOS speaks through the system voices, so without this the Mac reads
//    each test round's words aloud (user report, 2026-11-06). A suite that checks speech installs its own
//    speechSynthesis.speak afterwards, which replaces this one.
// 2. Accepts the privacy policy (typingZen.pp and the test site's typingZen.pp-test = index.html's data-pp), so
//    the suites start where they always did: once per tab, so a reload sees what the page itself saved.
//    tests/privacy.js removes it to test the policy screen itself.
const pw = require('playwright');
const PP = (require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8').match(/data-pp="([^"]*)"/) || [])[1] || '';
const STUB = `(() => { try { speechSynthesis.speak = (u) => setTimeout(() => { u.onstart && u.onstart(); u.onend && u.onend(); }, 5); } catch (e) {}
  try { if (${JSON.stringify(PP)} && !sessionStorage.__ppAccepted) { sessionStorage.__ppAccepted = 1; for (const k of ['typingZen.pp', 'typingZen.pp-test']) localStorage.setItem(k, ${JSON.stringify(PP)}); } } catch (e) {} })();`;
for (const name of ['chromium', 'webkit', 'firefox']) {
  const type = pw[name], launch = type.launch.bind(type);
  type.launch = async (...a) => {
    const b = await launch(...a), newContext = b.newContext.bind(b), newPage = b.newPage.bind(b);
    b.newContext = async (...o) => { const c = await newContext(...o); await c.addInitScript(STUB); return c; };
    b.newPage = async (...o) => { const p = await newPage(...o); await p.context().addInitScript(STUB); return p; };
    return b;
  };
}
