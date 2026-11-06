// Silences speech in every browser the tests open. Headless Chromium on macOS speaks through the system voices,
// so without this the Mac reads each test round's words aloud (user report, 2026-11-06). A suite that checks
// speech installs its own speechSynthesis.speak afterwards, which replaces this one. Loaded by run.sh (node -r).
const pw = require('playwright');
const STUB = () => { try { speechSynthesis.speak = (u) => setTimeout(() => { u.onstart && u.onstart(); u.onend && u.onend(); }, 5); } catch (e) {} };
for (const name of ['chromium', 'webkit', 'firefox']) {
  const type = pw[name], launch = type.launch.bind(type);
  type.launch = async (...a) => {
    const b = await launch(...a), newContext = b.newContext.bind(b), newPage = b.newPage.bind(b);
    b.newContext = async (...o) => { const c = await newContext(...o); await c.addInitScript(STUB); return c; };
    b.newPage = async (...o) => { const p = await newPage(...o); await p.context().addInitScript(STUB); return p; };
    return b;
  };
}
