#!/usr/bin/env python3
"""Build the test site and push it to trix69/typing-zen-test (served at trix69.github.io/typing-zen-test/).

Usage:
  python3 tools/deploy_test.py              build from the working tree and push the test site
  python3 tools/deploy_test.py --local DIR  only build the test copy into DIR (no git), to check it

dist/test-site/ is a clone of the test repo, made on first use (dist/ is git-ignored).
The live site (main, trix69.github.io/typing-zen/) and the artifact are not touched.

The test copy differs from the live one in a few ways:
- the title is "Typing Zen (Test)", it has an orange TEST ribbon and a noindex tag;
- the version shows as the coming number plus "-test" (1.01-test); VERSION is not bumped;
- a build stamp (a fingerprint of the app files, so the same code always gives the same stamp) goes in
  version.json, on the version line (data-build) and on the files' ?v=, so "Check for updates" sees each
  new test build and the browser fetches it fresh;
- Spelling Bee's two sessions last TEST_LENGTHS (1 and 2 minutes) instead of 10 and 20, so a whole session can be tried quickly;
- progress is saved as typingZen.v2-test (and a 1.0 profile is read from typingZen.v1-test). Both
  sites share the trix69.github.io origin, so without this, trying the test site in Luke's browser
  would change his real progress.
  The theme (typingZen.theme) is a setting, so the two sites share it on purpose.
"""
import hashlib
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no tools/__pycache__ from importing version.py
sys.path.insert(0, str(Path(__file__).resolve().parent))
import version  # noqa: E402  (tools/version.py)
import make_sw  # noqa: E402  (tools/make_sw.py)

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "dist" / "test-site"
REPO = "https://github.com/trix69/typing-zen-test.git"
URL = "https://trix69.github.io/typing-zen-test/"
FILES = ["index.html", "style.css", "app.js", "data.js", "words.js", ".nojekyll"]
PROGRESS = ["typingZen.v2", "typingZen.v1"]  # the users store, and the 1.0 profile it is made from
LIVE_LENGTHS, TEST_LENGTHS = "{ short: 10, long: 20 }", "{ short: 1, long: 2 }"  # Spelling Bee lengths in minutes: live and test
SHARED = {"typingZen.theme"}
RIBBON = ('<div class="test-ribbon" aria-hidden="true">TEST</div>\n'
          '<style>.test-ribbon { position: fixed; z-index: 300; top: 0; left: 50%; transform: translateX(-50%); '
          'padding: 2px 10px; border-radius: 0 0 8px 8px; background: #c2410c; color: #fff; '
          'font: 700 11px/1.4 ui-monospace, monospace; letter-spacing: .1em; pointer-events: none; }</style>\n')


def must(text, old, new, what):
    if text.count(old) != 1:
        sys.exit(f"test build: expected exactly one {what}; update tools/deploy_test.py")
    return text.replace(old, new)


def build(out):
    """Write the test copy of the site into out/, leaving out/.git alone."""
    shown = version.bumped(version.found()["VERSION"]) + "-test"
    for f in FILES:
        shutil.copy2(ROOT / f, out / f)
    if (out / "fonts").exists():
        shutil.rmtree(out / "fonts")
    shutil.copytree(ROOT / "fonts", out / "fonts")
    if (out / "sounds").exists():
        shutil.rmtree(out / "sounds")
    shutil.copytree(ROOT / "sounds", out / "sounds")
    if (out / "icons").exists():
        shutil.rmtree(out / "icons")
    shutil.copytree(ROOT / "icons", out / "icons")
    # Its own home-screen app: another name and id, so it installs beside the live one.
    manifest = (ROOT / "manifest.webmanifest").read_text(encoding="utf-8")
    manifest = must(manifest, '"name": "Typing Zen"', '"name": "Typing Zen (Test)"', "manifest name")
    manifest = must(manifest, '"short_name": "Typing Zen"', '"short_name": "TZ Test"', "manifest short_name")
    manifest = must(manifest, '"id": "/typing-zen/"', '"id": "/typing-zen-test/"', "manifest id")
    (out / "manifest.webmanifest").write_text(manifest, encoding="utf-8")
    stamp = hashlib.sha1(b"".join((ROOT / f).read_bytes() for f in FILES)).hexdigest()[:10]
    (out / "version.json").write_text('{"version": "%s", "build": "%s"}\n' % (shown, stamp), encoding="utf-8")

    html = (out / "index.html").read_text(encoding="utf-8")
    html = must(html, "<title>Typing Zen</title>", '<title>Typing Zen (Test)</title>\n<meta name="robots" content="noindex">', "<title>")
    html = must(html, "<body>\n", "<body>\n" + RIBBON, "<body>")
    html = must(html, '<meta name="apple-mobile-web-app-title" content="Typing Zen">', '<meta name="apple-mobile-web-app-title" content="TZ Test">', "home-screen title")
    html, n = version.SHOWN.subn(r"\g<1>" + shown + r"\g<3>", html)
    if n != 1:
        sys.exit('test build: index.html needs exactly one <span id="appVersion">')
    html = must(html, '<span id="appVersion">', f'<span id="appVersion" data-build="{stamp}">', "appVersion span")
    html, n = version.ASSETS.subn(r'\g<1>?v=' + stamp + '"', html)
    if n != 4:
        sys.exit("test build: index.html should load style.css, words.js, data.js and app.js with ?v=")
    (out / "index.html").write_text(html, encoding="utf-8")

    # Keep the test site's progress apart from Luke's, and make any new storage key a conscious choice.
    js = (out / "app.js").read_text(encoding="utf-8")
    for key in PROGRESS:
        js = must(js, f'"{key}"', f'"{key}-test"', f'"{key}" key in app.js')
    js = must(js, f"const LENGTHS = {LIVE_LENGTHS};", f"const LENGTHS = {TEST_LENGTHS}; // test build only (live: {LIVE_LENGTHS})", "LENGTHS line in app.js")
    keys = set(re.findall(r"""["'`](typingZen[.\w-]*)""", js + html))
    unknown = sorted(k for k in keys if k not in SHARED and not k.endswith("-test"))
    if unknown:
        sys.exit("test build: decide whether these keys are shared settings or kept apart: " + ", ".join(unknown))
    # Its own offline copies: the live site's sw.js and update button never touch typing-zen-test-*, nor this one theirs.
    js = must(js, 'const CACHE_PREFIX = "typing-zen-";', 'const CACHE_PREFIX = "typing-zen-test-";', "CACHE_PREFIX in app.js")
    (out / "app.js").write_text(js, encoding="utf-8")
    (out / "sw.js").write_text(make_sw.source(out, "typing-zen-test-"), encoding="utf-8")
    return shown


def git(*args, cwd=SITE):
    return subprocess.check_output(["git", *args], cwd=cwd, text=True).strip()


def main():
    args = sys.argv[1:]
    if args[:1] == ["--local"] and len(args) == 2:
        out = Path(args[1])
        out.mkdir(parents=True, exist_ok=True)
        print(f"Built test copy {build(out)} in {out}")
        return
    if args:
        sys.exit(__doc__)

    if not (SITE / ".git").is_dir():
        SITE.parent.mkdir(exist_ok=True)
        if subprocess.call(["git", "clone", "-q", REPO, str(SITE)]) != 0:
            sys.exit(f"Could not clone {REPO}. Does the repo exist, and can the token push to it?")
        git("config", "--local", "user.name", "trix69")
        git("config", "--local", "user.email", "56258450+trix69@users.noreply.github.com")
    git("pull", "-q", "--ff-only", "origin", "main") if git("ls-remote", "--heads", "origin", "main") else None

    shown = build(SITE)
    src = git("rev-parse", "--short", "HEAD", cwd=ROOT)
    dirty = " + uncommitted changes" if git("status", "--porcelain", "--", *FILES, "fonts", "sounds", "icons", "manifest.webmanifest", cwd=ROOT) else ""
    git("add", "-A")
    if not git("status", "--porcelain"):
        print("Test site unchanged")
        return
    git("commit", "-q", "-m", f"Test build {shown} from typing-zen {src}{dirty}")
    git("push", "-q", "origin", "HEAD:main")
    print(f"Pushed test build {shown} from {src}{dirty} -> {URL}")


if __name__ == "__main__":
    main()
