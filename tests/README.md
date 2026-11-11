# Typing Zen tests

Browser tests for the app, run with [Playwright](https://playwright.dev) against a real copy of the site.
Each suite prints one `PASS` or `FAIL` line per check.

```
tests/run.sh            # the local server: python3 -m http.server 8801 --bind 127.0.0.1 in the repo
tests/run.sh test       # the test site, after tools/deploy_test.py
tests/run.sh live       # the live site, after a release
tests/run.sh local words mastery   # only some suites
```

`run.sh` fills in each suite's site address, storage key and the one extra value some need (the version for
`offline`, the Spelling Bee lengths for `lengths`, the mastery rule for `m2`, the Firestore collection for the
Google suites). It exits 1 if any check fails.

A suite can also be run by hand: `node tests/<suite>.js <site> <storage key> [extra]`, with Playwright on
`NODE_PATH` (here `~/tools/playwright/node_modules`).

Every suite is started through `quiet.js` (`node -r`), which silences the browser's speech (headless Chromium on
macOS speaks aloud) and accepts the privacy policy once per tab, so the suites start where they always did.

The Google suites (`google`, `multi`, `homeapp`, `reset`, `board`, `erase`) replace the Firebase SDK with an in-page
fake, so they never touch the real database. Every suite uses a fresh browser profile and seeds its own
made-up users, so none of them changes anyone's real progress.

| Suite | What it checks |
|---|---|
| offline | the offline copy, Check for updates |
| lengths | Spelling Bee length choices |
| m2 | how many right-first-try spellings make a word mastered |
| fill | the play screen fills tablets and computers |
| google, multi, homeapp, reset | Google sign-in and sync, two accounts on one device, home-screen sign-in, Clear history |
| remove | Log out and Remove account |
| board | sharing and the ranking board |
| update | the update question on opening and from Check for updates (no reload until Update), Automatic update check On/Off, Buy me a coffee |
| privacy | the privacy policy screen: first run, Decline, re-acceptance, #pp=reset, Danish, small screens, offline with no requests, docs/privacy.html with the service worker |
| erase | Delete my data from Google: asked twice, everything of the account deleted, Google refusing, offline |
| practice, practice2, pcard | Practice: counting, spoken spelling, the home card |
| gap | the pause before Practice spells a word |
| triumph | the fanfare for each star level |
| words, mastery, garden | the stats words and chart, mastered words, word picking |
| capital, bksp, center, theme | capital first letter, the backspace key, the welcome column, light by default |
| welcomeset, dk, r39fix | the welcome screen and its Settings, Danish |
| langs | each language keeps its own history: switching, sync between two devices, untagged sessions as English |
| zh | Chinese: 中文 in Settings, characters shown, pinyin typed (capitals, u for ü), the Mandarin voice, Practice and Word Garden |
| motion, interrupted, dupvoice, keylog2, noplay, fold | Reduce Motion, iPad audio, voices, the key log, small screens |
| caseless, practice3 | X-ray and Xbox in any case; renamed (American) spellings in old sessions |
