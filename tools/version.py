#!/usr/bin/env python3
"""Keep the app version in step across VERSION, version.json and index.html.

Usage:
  python3 tools/version.py           check that all agree (exits 1 if not), including the ?v= stamps and sw.js
  python3 tools/version.py bump      next version: 1.0, 1.01 ... 1.09, 1.10 ... 1.99, 2.0
  python3 tools/version.py set 1.0   set an exact version
  python3 tools/version.py pp        stamp PP_DATE (the privacy policy's date) into its three places

PP_DATE below is the privacy policy's date and its version: change it whenever docs/privacy.html changes in
substance, run `python3 tools/version.py pp`, and the app asks everyone to accept the policy again. The check
(no arguments) fails while docs/privacy.html, docs/privacy-version.json or index.html's data-pp disagree with it.

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
PP_DATE = "2026-11-13"  # the privacy policy's date (see the docstring)
PP_HTML = ROOT / "docs" / "privacy.html"
PP_JSON = ROOT / "docs" / "privacy-version.json"
# Where the date is written: the policy's meta tag and its visible date line, and <html data-pp> in index.html.
PP_META = re.compile(r'(<meta name="pp-version" content=")([^"]*)(">)')
PP_LINE = re.compile(r'(<time datetime=")([^"]*)(">)([^<]*)(</time>)')
PP_ATTR = re.compile(r'(<html lang="en-GB" data-pp=")([^"]*)(")')
# The version line in the Settings sheet.
SHOWN = re.compile(r'(<span id="appVersion">)([^<]*)(</span>)')
# The files index.html loads carry ?v=<version>, so a new release is fetched fresh, not reused from the cache.
ASSETS = re.compile(r'((?:href|src)="(?:style\.css|words\.js|words-da\.js|words-zh\.js|data\.js|app\.js))(?:\?v=[^"]*)?"')


def bumped(v):
    major, _, minor = v.partition(".")
    n = int(major) * 100 + int(minor.ljust(2, "0")) + 1
    return "%d.%s" % (n // 100, "0" if n % 100 == 0 else "%02d" % (n % 100))


def found():
    html = HTML.read_text(encoding="utf-8")
    m = SHOWN.search(html)
    stamps = set(re.findall(r'(?:style\.css|words\.js|words-da\.js|words-zh\.js|data\.js|app\.js)\?v=([^"]*)"', html))
    return {
        "VERSION": VERSION.read_text(encoding="utf-8").strip(),
        "version.json": json.loads(JSON.read_text(encoding="utf-8"))["version"],
        "index.html": m.group(2) if m else None,
        "file stamps": stamps.pop() if len(stamps) == 1 and len(ASSETS.findall(html)) == 6 else "missing or mixed",
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
    if n != 6:
        sys.exit("index.html should load style.css, words.js, words-da.js, words-zh.js, data.js and app.js; update tools/version.py")
    HTML.write_text(html, encoding="utf-8")
    print(f"Version {v}")
    # The offline copy lists the files with their new ?v= stamps, so sw.js changes with every version.
    import subprocess
    subprocess.check_call([sys.executable, str(ROOT / "tools" / "make_sw.py")])


def pp_found():
    html, page = HTML.read_text(encoding="utf-8"), PP_HTML.read_text(encoding="utf-8")
    meta, line, attr = PP_META.findall(page), PP_LINE.findall(page), PP_ATTR.findall(html)
    try:
        js = json.loads(PP_JSON.read_text(encoding="utf-8"))["version"]
    except (OSError, ValueError, KeyError):
        js = None
    return {
        "PP_DATE": PP_DATE,
        "privacy.html meta": meta[0][1] if len(meta) == 1 else "missing or repeated",
        "privacy.html date line": line[0][1] if len(line) == 1 and line[0][1] == line[0][3] else "missing, repeated or unlike its datetime",
        "privacy-version.json": js,
        "index.html data-pp": attr[0][1] if len(attr) == 1 else "missing or repeated",
    }


def pp_write():
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", PP_DATE):
        sys.exit(f"PP_DATE '{PP_DATE}' is not a date like 2026-11-12")
    page = PP_HTML.read_text(encoding="utf-8")
    page, a = PP_META.subn(r"\g<1>" + PP_DATE + r"\g<3>", page)
    page, b = PP_LINE.subn(r"\g<1>" + PP_DATE + r"\g<3>" + PP_DATE + r"\g<5>", page)
    html = HTML.read_text(encoding="utf-8")
    html, c = PP_ATTR.subn(r"\g<1>" + PP_DATE + r"\g<3>", html)
    if (a, b, c) != (1, 1, 1):
        sys.exit("docs/privacy.html needs one pp-version meta and one <time datetime>, index.html one <html lang=\"en-GB\" data-pp>")
    PP_HTML.write_text(page, encoding="utf-8")
    HTML.write_text(html, encoding="utf-8")
    PP_JSON.write_text(json.dumps({"version": PP_DATE}) + "\n", encoding="utf-8")
    print(f"Privacy policy date {PP_DATE}")


def main():
    args = sys.argv[1:]
    if not args:
        seen = found()
        if len(set(seen.values())) != 1:
            sys.exit("Versions differ: " + ", ".join(f"{k} {v}" for k, v in seen.items()))
        pp = pp_found()
        if len(set(pp.values())) != 1:
            sys.exit("Privacy policy dates differ (run python3 tools/version.py pp): " + ", ".join(f"{k} {v}" for k, v in pp.items()))
        # The offline copy must list today's files, or devices keep the old copy (Hermes' note on R28).
        sys.dont_write_bytecode = True
        sys.path.insert(0, str(ROOT / "tools"))
        import make_sw
        if not (ROOT / "sw.js").exists() or (ROOT / "sw.js").read_text(encoding="utf-8") != make_sw.source(ROOT, make_sw.PREFIX):
            sys.exit("sw.js is out of date: run python3 tools/make_sw.py")
        # An unmatched "}" silently ends a stylesheet: every rule after it is dropped (Hermes R47.1).
        css = re.sub(r"/\*.*?\*/", "", (ROOT / "style.css").read_text(encoding="utf-8"), flags=re.S)
        depth = 0
        for line_no, line in enumerate(css.split("\n"), 1):
            depth += line.count("{") - line.count("}")
            if depth < 0:
                sys.exit("style.css: unmatched } (rules after it are ignored by browsers)")
        if depth:
            sys.exit("style.css: unclosed {")
        print(f"Version {seen['VERSION']}, privacy policy {PP_DATE}, sw.js up to date, style.css braces balanced")
    elif args == ["pp"]:
        pp_write()
    elif args == ["bump"]:
        write(bumped(found()["VERSION"]))
    elif len(args) == 2 and args[0] == "set":
        write(args[1])
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
