#!/usr/bin/env python3
"""Build words.js from the spelling spreadsheet and meanings.txt.

Usage:  python3 wordlist/build_words.py

Reads wordlist/Spelling_Word_List_Grouped.xlsx ("Word List" sheet: Group,
Difficulty Level, Word, Why it's tricky), wordlist/meanings.txt
(word|meaning|example sentence, one per line) and wordlist/years.txt (the
school year, Y1 to Y6, for every word). Writes words.js next to index.html,
with one group per year. Uses only the Python standard library.

To change the list: edit the spreadsheet, add a line to meanings.txt and put
the word under a year in years.txt for any new word, then run this script
again. It stops and lists any problems.
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

HERE = Path(__file__).resolve().parent
XLSX = HERE / "Spelling_Word_List_Grouped.xlsx"
MEANINGS = HERE / "meanings.txt"
YEARS = HERE / "years.txt"
OUT = HERE.parent / "words.js"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

# The spreadsheet stores some words in lower case or without punctuation.
# Correct them so the child learns the proper spelling.
FIXES = {"i": "I", "i'd": "I'd", "i've": "I've", "i'll": "I'll", "xbox": "Xbox", "xray": "X-ray"}


def read_sheet(path):
    z = zipfile.ZipFile(path)
    strings = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall("m:si", NS):
            strings.append("".join(t.text or "" for t in si.iter("{%s}t" % NS["m"])))
    # The first sheet is "Word List".
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    rows = []
    for row in sheet.iter("{%s}row" % NS["m"]):
        cells = {}
        for c in row.findall("m:c", NS):
            col = re.match(r"[A-Z]+", c.get("r")).group()
            v = c.find("m:v", NS)
            if c.get("t") == "s" and v is not None:
                cells[col] = strings[int(v.text)]
            elif c.get("t") == "inlineStr":
                cells[col] = "".join(t.text or "" for t in c.iter("{%s}t" % NS["m"]))
            elif v is not None:
                cells[col] = v.text
        rows.append(cells)
    header = rows[0]
    col = {name: key for key, name in header.items()}
    out = []
    for r in rows[1:]:
        word = (r.get(col["Word"]) or "").strip()
        if not word:
            continue
        out.append({
            "group": int(float(r[col["Group"]])),
            "level": r.get(col["Difficulty Level"], ""),
            "word": FIXES.get(word, word),
            "why": (r.get(col["Why it's tricky"]) or "").strip(),
        })
    return out


def read_years(path):
    """Map each word to its year (1-6) from years.txt, and list any duplicates."""
    years, year, dups = {}, None, []
    for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.fullmatch(r"Y([1-6]):", line)
        if m:
            year = int(m.group(1))
            continue
        if year is None:
            sys.exit(f"years.txt line {n}: words before the first Y1: to Y6: line")
        for word in line.split():
            if word in years:
                dups.append(word)
            years[word] = year
    return years, dups


def main():
    words = read_sheet(XLSX)
    years, dups = read_years(YEARS)
    meanings = {}
    for n, line in enumerate(MEANINGS.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        parts = line.split("|")
        if len(parts) != 3:
            sys.exit(f"meanings.txt line {n}: expected word|meaning|sentence")
        meanings[parts[0].strip()] = (parts[1].strip(), parts[2].strip())

    problems, groups, seen = [f"'{w}' is in years.txt more than once" for w in dups], {}, set()
    for w in words:
        word = w["word"]
        if word in seen:
            continue  # a word listed twice keeps its first (easier) group
        seen.add(word)
        if word not in meanings:
            problems.append(f"no meaning for '{word}'")
            continue
        meaning, sentence = meanings[word]
        if not re.search(r"(?<![\w'-])" + re.escape(word) + r"(?![\w'-])", sentence, re.I):
            problems.append(f"sentence for '{word}' does not contain the word: {sentence}")
        if not sentence[0].isupper() or sentence[-1] not in ".?!":
            problems.append(f"sentence for '{word}' needs a capital letter and end punctuation")
        if word not in years:
            problems.append(f"'{word}' has no year in years.txt")
            continue
        groups.setdefault(years[word], []).append([word, meaning, sentence, w["why"]])

    unused = set(meanings) - seen
    extra = set(years) - seen
    if extra:
        problems.append("years.txt has words not in the spreadsheet: " + ", ".join(sorted(extra)))
    if unused:
        problems.append("meanings.txt has words not in the spreadsheet: " + ", ".join(sorted(unused)))
    if problems:
        sys.exit("Problems found:\n  " + "\n  ".join(problems))

    data = [{"group": y, "level": f"Y{y}", "words": groups[y]} for y in sorted(groups)]
    OUT.write_text(
        "// Generated by wordlist/build_words.py from Spelling_Word_List_Grouped.xlsx, meanings.txt and years.txt. Do not edit by hand.\n"
        "// One group per school year (Y1 to Y6).\n"
        "// Each word: [word, meaning, example sentence, why it's tricky]\n"
        "const WORD_GROUPS = " + json.dumps(data, ensure_ascii=False, indent=0) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {OUT.name}: {len(seen)} words in {len(data)} years")


if __name__ == "__main__":
    main()
