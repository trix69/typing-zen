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
- progress is saved as typingZen.v1-test. Both sites share the trix69.github.io origin, so
  without this, trying the test site in Luke's browser would change his real progress.
  The theme (typingZen.theme) is a setting, so the two sites share it on purpose.
"""
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no tools/__pycache__ from importing version.py
sys.path.insert(0, str(Path(__file__).resolve().parent))
import version  # noqa: E402  (tools/version.py)

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "dist" / "test-site"
REPO = "https://github.com/trix69/typing-zen-test.git"
URL = "https://trix69.github.io/typing-zen-test/"
FILES = ["index.html", "style.css", "app.js", "data.js", "words.js", ".nojekyll"]
PROGRESS = "typingZen.v1"
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
    (out / "version.json").write_text('{"version": "%s"}\n' % shown, encoding="utf-8")

    html = (out / "index.html").read_text(encoding="utf-8")
    html = must(html, "<title>Typing Zen</title>", '<title>Typing Zen (Test)</title>\n<meta name="robots" content="noindex">', "<title>")
    html = must(html, "<body>\n", "<body>\n" + RIBBON, "<body>")
    html, n = version.SHOWN.subn(r"\g<1>" + shown + r"\g<3>", html)
    if n != 1:
        sys.exit('test build: index.html needs exactly one <span id="appVersion">')
    (out / "index.html").write_text(html, encoding="utf-8")

    # Keep the test site's progress apart from Luke's, and make any new storage key a conscious choice.
    js = (out / "app.js").read_text(encoding="utf-8")
    js = must(js, f'"{PROGRESS}"', f'"{PROGRESS}-test"', f'"{PROGRESS}" key in app.js')
    keys = set(re.findall(r"""["'`](typingZen[.\w-]*)""", js + html))
    unknown = sorted(k for k in keys if k not in SHARED and not k.endswith("-test"))
    if unknown:
        sys.exit("test build: decide whether these keys are shared settings or kept apart: " + ", ".join(unknown))
    (out / "app.js").write_text(js, encoding="utf-8")
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
    dirty = " + uncommitted changes" if git("status", "--porcelain", "--", *FILES, "fonts", cwd=ROOT) else ""
    git("add", "-A")
    if not git("status", "--porcelain"):
        print("Test site unchanged")
        return
    git("commit", "-q", "-m", f"Test build {shown} from typing-zen {src}{dirty}")
    git("push", "-q", "origin", "HEAD:main")
    print(f"Pushed test build {shown} from {src}{dirty} -> {URL}")


if __name__ == "__main__":
    main()
