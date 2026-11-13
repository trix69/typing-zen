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
  // WebKit here doesn't route cross-origin fetches through Playwright, so the Worker is answered in the page itself.
  try { if (!/Chrome/.test(navigator.userAgent)) { const real = window.fetch.bind(window);
    window.fetch = (u, o) => (String(u && u.url || u).startsWith('https://typing-zen-board.trix69.workers.dev/') ? Promise.resolve(new Response('{"ok":true,"rows":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } })) : real(u, o)); } } catch (e) {}
  try { if (${JSON.stringify(PP)} && !sessionStorage.__ppAccepted) { sessionStorage.__ppAccepted = 1; for (const k of ['typingZen.pp', 'typingZen.pp-test']) localStorage.setItem(k, ${JSON.stringify(PP)}); } } catch (e) {} })();`;
// 3. The ranking board's Worker answers every suite with an empty board (a route in Chromium; in WebKit, which
//    doesn't route cross-origin fetches here, a fetch wrapper in the page), so no test run is ever counted as a launch or
//    reaches the real board. A suite that routes the Worker itself (board.js, langs.js) registers later and wins.
const WORKER = 'https://typing-zen-board.trix69.workers.dev/**';
const quietWorker = (r) => r.fulfill({ status: r.request().method() === 'OPTIONS' ? 204 : 200, body: r.request().method() === 'OPTIONS' ? '' : '{"ok":true,"rows":[]}',
  headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, DELETE', 'access-control-allow-headers': 'Content-Type, X-Board-Key', 'content-type': 'application/json' } });
for (const name of ['chromium', 'webkit', 'firefox']) {
  const type = pw[name], launch = type.launch.bind(type);
  type.launch = async (...a) => {
    const b = await launch(...a), newContext = b.newContext.bind(b), newPage = b.newPage.bind(b);
    b.newContext = async (...o) => { const c = await newContext(...o); await c.addInitScript(STUB); await c.route(WORKER, quietWorker); return c; };
    b.newPage = async (...o) => { const p = await newPage(...o); await p.context().addInitScript(STUB); await p.context().route(WORKER, quietWorker); return p; };
    return b;
  };
}
