#!/usr/bin/env python3
"""Keep the app version in step across VERSION, version.json and index.html.

Usage:
  python3 tools/version.py           check that all agree (exits 1 if not), including the ?v= stamps and sw.js
  python3 tools/version.py bump      next version: 1.0, 1.01 ... 1.09, 1.10 ... 1.99, 2.0
  python3 tools/version.py set 1.0   set an exact version

Every push to main that changes the app is one version step: bump, commit
VERSION, version.json and index.html with the change, then tag it (v1.01).
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
VERSION = ROOT / "VERSION"
JSON = ROOT / "version.json"
HTML = ROOT / "index.html"
# The version line in the Settings sheet.
SHOWN = re.compile(r'(<span id="appVersion">)([^<]*)(</span>)')
# The files index.html loads carry ?v=<version>, so a new release is fetched fresh, not reused from the cache.
ASSETS = re.compile(r'((?:href|src)="(?:style\.css|words\.js|data\.js|app\.js))(?:\?v=[^"]*)?"')


def bumped(v):
    major, _, minor = v.partition(".")
    n = int(major) * 100 + int(minor.ljust(2, "0")) + 1
    return "%d.%s" % (n // 100, "0" if n % 100 == 0 else "%02d" % (n % 100))


def found():
    html = HTML.read_text(encoding="utf-8")
    m = SHOWN.search(html)
    stamps = set(re.findall(r'(?:style\.css|words\.js|data\.js|app\.js)\?v=([^"]*)"', html))
    return {
        "VERSION": VERSION.read_text(encoding="utf-8").strip(),
        "version.json": json.loads(JSON.read_text(encoding="utf-8"))["version"],
        "index.html": m.group(2) if m else None,
        "file stamps": stamps.pop() if len(stamps) == 1 and len(ASSETS.findall(html)) == 4 else "missing or mixed",
    }


def write(v):
    if not re.fullmatch(r"\d+\.(0|\d\d)", v):
        sys.exit(f"'{v}' is not a version like 1.0 or 1.01")
    VERSION.write_text(v + "\n", encoding="utf-8")
    JSON.write_text(json.dumps({"version": v}) + "\n", encoding="utf-8")
    html = HTML.read_text(encoding="utf-8")
    html, n = SHOWN.subn(r"\g<1>" + v + r"\g<3>", html)
    if n != 1:
        sys.exit('index.html needs exactly one <span id="appVersion">')
    html, n = ASSETS.subn(r'\g<1>?v=' + v + '"', html)
    if n != 4:
        sys.exit("index.html should load style.css, words.js, data.js and app.js; update tools/version.py")
    HTML.write_text(html, encoding="utf-8")
    print(f"Version {v}")
    # The offline copy lists the files with their new ?v= stamps, so sw.js changes with every version.
    import subprocess
    subprocess.check_call([sys.executable, str(ROOT / "tools" / "make_sw.py")])


def main():
    args = sys.argv[1:]
    if not args:
        seen = found()
        if len(set(seen.values())) != 1:
            sys.exit("Versions differ: " + ", ".join(f"{k} {v}" for k, v in seen.items()))
        # The offline copy must list today's files, or devices keep the old copy (Hermes' note on R28).
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(ROOT / "tools"))
        import make_sw
        if not (ROOT / "sw.js").exists() or (ROOT / "sw.js").read_text(encoding="utf-8") != make_sw.source(ROOT, make_sw.PREFIX):
            sys.exit("sw.js is out of date: run python3 tools/make_sw.py")
        print(f"Version {seen['VERSION']}, sw.js up to date")
    elif args == ["bump"]:
        write(bumped(found()["VERSION"]))
    elif len(args) == 2 and args[0] == "set":
        write(args[1])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
