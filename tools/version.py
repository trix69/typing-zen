#!/usr/bin/env python3
"""Keep the app version in step across VERSION, version.json and index.html.

Usage:
  python3 tools/version.py           check that all three agree (exits 1 if not)
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


def bumped(v):
    major, _, minor = v.partition(".")
    n = int(major) * 100 + int(minor.ljust(2, "0")) + 1
    return "%d.%s" % (n // 100, "0" if n % 100 == 0 else "%02d" % (n % 100))


def found():
    html = HTML.read_text(encoding="utf-8")
    m = SHOWN.search(html)
    return {
        "VERSION": VERSION.read_text(encoding="utf-8").strip(),
        "version.json": json.loads(JSON.read_text(encoding="utf-8"))["version"],
        "index.html": m.group(2) if m else None,
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
    HTML.write_text(html, encoding="utf-8")
    print(f"Version {v}")


def main():
    args = sys.argv[1:]
    if not args:
        seen = found()
        if len(set(seen.values())) != 1:
            sys.exit("Versions differ: " + ", ".join(f"{k} {v}" for k, v in seen.items()))
        print(f"Version {seen['VERSION']}")
    elif args == ["bump"]:
        write(bumped(found()["VERSION"]))
    elif len(args) == 2 and args[0] == "set":
        write(args[1])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
