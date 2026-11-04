#!/usr/bin/env python3
"""Builds words-zh.js from wordlist/zh/Y1.txt to Y6.txt (user's request, 2026-11-04).

Each line: characters|pinyin with tone marks, one syllable per character, spaces between|meaning in English.
The word is shown in characters and typed as its pinyin without tones on an English keyboard, so the typed
form (`type`) is the pinyin with the tone marks taken off, ü written v (as Chinese input methods do) and no
spaces: 绿色 lǜ sè -> lvse.

Checks, failing the build:
- one pinyin syllable per Chinese character (an erhua syllable like huìr covers 会儿);
- every syllable is a real one: its letters are in the set macOS's Mandarin-to-Latin transform gives for the
  20,902 common characters (wordlist/zh/pinyin.swift --syllables), with at most one tone mark;
- no word twice, in any year;
- each reading agrees with macOS's (pinyin.swift), letters and tones, unless the word is in allow.txt. A neutral
  tone where macOS gives a full one (朋友 péng you) and erhua (一会儿 yī huìr) count as agreeing. macOS reads
  character by character, so it gets polyphones wrong (银行 yín háng, not xíng); each such word was checked by
  hand and is listed in allow.txt with the reason.
Uses only the standard library and the Swift compiler that comes with Xcode's command-line tools.
"""
import json
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

HERE = Path(__file__).resolve().parent / "zh"
ROOT = HERE.parent.parent
HAN = re.compile(r"[一-鿿]")


def bare(p):
    """Pinyin without tone marks: ǚ -> ü."""
    out = []
    for c in unicodedata.normalize("NFD", p):
        if unicodedata.category(c) == "Mn" and c != "̈":  # keep the diaeresis of ü
            continue
        out.append(c)
    return unicodedata.normalize("NFC", "".join(out))


def agrees(ours, theirs):
    """Our reading is macOS's, or differs only by neutral tones (朋友 péng you: macOS gives yǒu) or by erhua
    (一会儿 yī huìr: macOS gives huì ér)."""
    a, b = ours.split(), theirs.split()
    if len(a) != len(b):
        return bare(ours).replace(" ", "") == bare(theirs).replace(" ", "").replace("er", "r")
    return all(x == y or x == bare(y) for x, y in zip(a, b))


def swift(args, text=None):
    r = subprocess.run(["swift", str(HERE / "pinyin.swift"), *args], input=text, capture_output=True, text=True)
    if r.returncode:
        sys.exit("pinyin.swift failed:\n" + r.stderr)
    return r.stdout


def main():
    toned = set(swift(["--syllables"]).split())
    plain = {bare(s) for s in toned}
    allow = {}
    for line in (HERE / "allow.txt").read_text(encoding="utf-8").splitlines():
        if line.strip() and not line.startswith("#"):
            w, _, why = line.partition("|")
            allow[w.strip()] = why.strip()
    errors, groups, seen = [], [], {}
    for n in range(1, 7):
        level = f"Y{n}"
        words = []
        for i, line in enumerate((HERE / f"{level}.txt").read_text(encoding="utf-8").splitlines(), 1):
            if not line.strip() or line.startswith("#"):
                continue
            parts = [x.strip() for x in line.split("|")]
            where = f"{level}.txt:{i}"
            if len(parts) != 3 or not all(parts):
                errors.append(f"{where}: want characters|pinyin|meaning: {line}")
                continue
            word, pinyin, meaning = parts
            pinyin = unicodedata.normalize("NFC", pinyin)
            if not all(HAN.match(c) for c in word):
                errors.append(f"{where}: {word}: only Chinese characters, please")
            if word in seen:
                errors.append(f"{where}: {word} is already in {seen[word]}")
            seen[word] = where
            sylls = pinyin.split()
            # An erhua syllable (huìr, diǎnr) is two characters, the second 儿.
            covers = sum(2 if s.endswith("r") and bare(s) not in plain else 1 for s in sylls)
            if covers != len(word):
                errors.append(f"{where}: {word} has {len(word)} characters but {pinyin} covers {covers}")
            for s in sylls:
                s0 = s[:-1] if s.endswith("r") and bare(s) not in plain else s
                marks = sum(1 for c in unicodedata.normalize("NFD", s0) if unicodedata.category(c) == "Mn" and c != "\u0308")
                if bare(s0) not in plain or marks > 1:
                    errors.append(f"{where}: {word}: {s0} is not a pinyin syllable")
            typed = bare(pinyin).replace("ü", "v").replace(" ", "")
            if not re.fullmatch(r"[a-z]+", typed):
                errors.append(f"{where}: {word}: typed form {typed!r} isn't plain a-z")
            words.append([word, meaning, "", "", pinyin, typed])
        groups.append({"group": n, "level": level, "words": words})
    # macOS's reading of every word, for the comparison.
    all_words = [w[0] for g in groups for w in g["words"]]
    mac = dict(line.split("\t") for line in swift([], "\n".join(all_words) + "\n").splitlines())
    differ = []
    for g in groups:
        for w in g["words"]:
            if not agrees(w[4], mac.get(w[0], "")) and w[0] not in allow:
                differ.append(f"{g['level']} {w[0]}: ours {w[4]} · macOS {mac.get(w[0])}")
    stale = sorted(set(allow) - set(all_words))
    if stale:
        errors.append("allow.txt lists words not in the lists: " + " ".join(stale))
    if differ:
        errors.append(f"{len(differ)} readings differ from macOS and aren't in allow.txt (check each, then list it):\n  "
                      + "\n  ".join(differ))
    if errors:
        sys.exit("\n".join(errors))
    out = ROOT / "words-zh.js"
    body = "".join(
        f'{{ "group": {g["group"]}, "level": "{g["level"]}", "words": [\n'
        + ",\n".join(json.dumps(w, ensure_ascii=False) for w in g["words"]) + "\n]}" + (",\n" if g["level"] != "Y6" else "\n")
        for g in groups)
    out.write_text("// Generated by wordlist/build_words_zh.py from wordlist/zh/Y1.txt to Y6.txt. Do not edit by hand.\n"
                   "// Chinese words (user's request, 2026-11-04): one group per level, Year 1 to Year 6.\n"
                   "// Each word: [characters, meaning, sentence, why, pinyin with tones, typed pinyin]\n"
                   "const WORD_GROUPS_ZH = [\n" + body + "];\n", encoding="utf-8")
    counts = ", ".join(f'{g["level"]} {len(g["words"])}' for g in groups)
    print(f"Wrote {out.name}: {len(all_words)} words ({counts})")


if __name__ == "__main__":
    main()
