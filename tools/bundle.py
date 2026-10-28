#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML body for publishing as a claude.ai artifact.

Usage:  python3 tools/bundle.py OUT.html

Inlines style.css (with the fonts in fonts/ as data URIs), the four scripts, and the key sounds in
sounds/ (as window.TZ_SOUNDS, a map of path to data URI that app.js fetches from),
and drops the doctype/html/head/body wrapper (the artifact host adds its own). The GitHub Pages copy doesn't need this;
it serves the folder as it is.
"""
import base64
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ["words.js", "words-da.js", "data.js", "app.js"]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "style.css").read_text(encoding="utf-8")
    fonts = 0

    def inline_font(m):
        nonlocal fonts
        fonts += 1
        data = base64.b64encode((ROOT / "fonts" / m.group(1)).read_bytes()).decode()
        return f'url(data:font/woff2;base64,{data})'

    css = re.sub(r'url\("fonts/([\w.-]+\.woff2)"\)', inline_font, css)
    if fonts == 0 or 'url("fonts/' in css:
        sys.exit("style.css no longer has the expected url(\"fonts/...\") rules; update tools/bundle.py")
    js = "\n".join((ROOT / f).read_text(encoding="utf-8") for f in SCRIPTS)
    sounds = {
        p.relative_to(ROOT).as_posix(): "data:audio/mpeg;base64," + base64.b64encode(p.read_bytes()).decode()
        for p in sorted((ROOT / "sounds").rglob("*.mp3"))
    }
    if not sounds:
        sys.exit("no sounds/*.mp3 found; update tools/bundle.py")
    # The MIT licence asks for its notice in every copy, so the single-file artifact carries it too.
    notice = (ROOT / "sounds" / "LICENSE-kbsim.md").read_text(encoding="utf-8").replace("*/", "* /")
    js = ("/* Key sounds: recordings from kbsim by Thomas Lai, https://github.com/tplai/kbsim (see sounds/SOURCE.md).\n"
          + notice + "\n*/\nwindow.TZ_SOUNDS = " + json.dumps(sounds) + ";\n" + js)

    # The home-screen app and offline copy need real files beside the page; the artifact has none.
    html, n = re.subn(r"<!-- pwa:.*?<!-- /pwa -->\n", "", html, flags=re.S)
    if n != 1:
        sys.exit("index.html no longer has one <!-- pwa: ... <!-- /pwa --> block; update tools/bundle.py")
    html = re.sub(r'<!doctype html>\s*|</?html[^>]*>|</?head>|</?body>|<meta charset="utf-8">\s*|<meta name="viewport"[^>]*>\s*', "", html)
    html = re.sub(r'(href|src)="([\w.-]+)\?v=[^"]*"', r'\1="\2"', html)  # drop the cache stamps (see version.py)
    tags = "\n".join(f'<script src="{f}"></script>' for f in SCRIPTS)
    if tags not in html or '<link rel="stylesheet" href="style.css">' not in html:
        sys.exit("index.html no longer has the expected <link>/<script> tags; update tools/bundle.py")
    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "</style>")
    html = html.replace(tags, "<script>\n" + js + "</script>")
    Path(sys.argv[1]).write_text(html.strip() + "\n", encoding="utf-8")
    print(f"Wrote {sys.argv[1]} ({fonts} fonts and {len(sounds)} sounds inlined)")


if __name__ == "__main__":
    main()
