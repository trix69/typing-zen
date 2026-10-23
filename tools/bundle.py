#!/usr/bin/env python3
"""Bundle the app into one self-contained HTML body for publishing as a claude.ai artifact.

Usage:  python3 tools/bundle.py OUT.html

Inlines style.css and the three scripts, and drops the doctype/html/head/body
wrapper (the artifact host adds its own). The NAS copy doesn't need this; it
serves the folder as it is.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCRIPTS = ["words.js", "data.js", "app.js"]


def main():
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    css = (ROOT / "style.css").read_text(encoding="utf-8")
    js = "\n".join((ROOT / f).read_text(encoding="utf-8") for f in SCRIPTS)

    html = re.sub(r'<!doctype html>\s*|</?html[^>]*>|</?head>|</?body>|<meta charset="utf-8">\s*|<meta name="viewport"[^>]*>\s*', "", html)
    tags = "\n".join(f'<script src="{f}"></script>' for f in SCRIPTS)
    if tags not in html or '<link rel="stylesheet" href="style.css">' not in html:
        sys.exit("index.html no longer has the expected <link>/<script> tags; update tools/bundle.py")
    html = html.replace('<link rel="stylesheet" href="style.css">', "<style>\n" + css + "</style>")
    html = html.replace(tags, "<script>\n" + js + "</script>")
    Path(sys.argv[1]).write_text(html.strip() + "\n", encoding="utf-8")
    print(f"Wrote {sys.argv[1]}")


if __name__ == "__main__":
    main()
