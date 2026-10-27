#!/usr/bin/env python3
"""Write sw.js, the service worker that keeps an offline copy of Typing Zen (like Violin Toolkit's).

Usage:
  python3 tools/make_sw.py           write sw.js in the repo root (do this when shipping, after version.py bump)
  python3 tools/make_sw.py --check   exit 1 if sw.js doesn't match the files (it must, on main)

The offline copy is every file the app uses: index.html, the four files it loads (with their ?v= stamps),
the manifest and icons, the fonts and the key sounds. The cache name is a prefix plus a fingerprint of all of
them, so any change makes a new sw.js, which phones notice and install; "Check for updates" in Settings asks
for it straight away. The test build (deploy_test.py) writes its own with the prefix typing-zen-test-, so the
two sites, which share trix69.github.io, never touch each other's caches.
"""
import hashlib
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PREFIX = "typing-zen-"
ASSET = re.compile(r'(?:href|src)="((?:style\.css|words\.js|data\.js|app\.js)\?v=[^"]*)"')


def files(root):
    """The paths the offline copy needs, as the page asks for them (relative to the site root)."""
    html = (root / "index.html").read_text(encoding="utf-8")
    assets = ASSET.findall(html)
    if len(assets) != 4:
        sys.exit("make_sw: index.html should load style.css, words.js, data.js and app.js with ?v=")
    rest = ["manifest.webmanifest"] + sorted(
        p.relative_to(root).as_posix()
        for d in ("icons", "fonts", "sounds")
        for p in (root / d).rglob("*")
        if p.is_file() and p.suffix in (".png", ".woff2", ".mp3")
    )
    return ["./", "index.html"] + assets + rest


def source(root, prefix):
    paths = files(root)
    h = hashlib.sha1()
    for p in paths[1:]:
        h.update(p.encode())
        h.update((root / p.split("?")[0]).read_bytes())
    version = prefix + h.hexdigest()[:10]
    listed = ",\n  ".join(f'"{p}"' for p in paths)
    return TEMPLATE.replace("%VERSION%", version).replace("%PREFIX%", re.escape(prefix)).replace("%FILES%", listed)


TEMPLATE = """/* Typing Zen service worker, written by tools/make_sw.py: do not edit by hand.
   It keeps an offline copy of every file the app uses. VERSION changes whenever any of them does. */
const VERSION = "%VERSION%";
/* Only this site's caches: the live and test sites share trix69.github.io, so never touch the other's. */
const MINE = (k) => /^%PREFIX%[0-9a-f]{10}$/.test(k);
const FILES = [
  %FILES%
];
self.addEventListener("install", (e) => {
  /* Everything at once, so a half-saved copy is never used; the old copy stays until this one is complete. */
  e.waitUntil(caches.open(VERSION)
    .then((c) => c.addAll(FILES.map((f) => new Request(f, { cache: "reload" }))))
    .then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== VERSION && MINE(k)).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || req.cache === "no-store") return; /* Settings > Check for updates asks the network */
  if (new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    /* Pages open from the saved copy (any ?v= in the address is ignored); files come from it too. */
    const hit = req.mode === "navigate" ? (await c.match("index.html")) : await c.match(req);
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch {
      return req.mode === "navigate"
        ? new Response("Typing Zen isn't saved on this device yet. Open it once with the internet on.",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
        : Response.error();
    }
  })());
});
"""


def main():
    text = source(ROOT, PREFIX)
    if sys.argv[1:] == ["--check"]:
        if (ROOT / "sw.js").read_text(encoding="utf-8") != text if (ROOT / "sw.js").exists() else True:
            sys.exit("sw.js is out of date: run python3 tools/make_sw.py")
        print("sw.js is up to date")
    elif not sys.argv[1:]:
        (ROOT / "sw.js").write_text(text, encoding="utf-8")
        print("Wrote sw.js", re.search(r'VERSION = "([^"]+)"', text).group(1))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
