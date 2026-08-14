#!/usr/bin/env python3
"""Build store catalogs (preview + compact) from the source Aozora catalog.

Each entry gains an `available` flag: true when `data/novels/{fileId}.json`
exists in the repo (web fetches it locally; Android falls back to GitHub raw,
which serves the same repo). Unavailable entries are kept for browsing but the
UI must present them as 未収録 instead of a fake network error.

Prints a coverage report (catalog vs novels) on every run.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "aozora_catalog.json"
PREVIEW = ROOT / "data" / "aozora_catalog_preview.json"
COMPACT = ROOT / "data" / "aozora_catalog_compact.json"
NOVELS_DIR = ROOT / "data" / "novels"
PREVIEW_COUNT = 100

# Aozora file ids look like `773_ruby_5968` / `57975_txt_63036` / `1234_html_5678.html`.
STANDARD_FILE_ID = re.compile(r"^\d+_(?:txt|ruby|html)_\d+(?:\.html)?$")


def main() -> int:
    with SOURCE.open(encoding="utf-8") as handle:
        catalog = json.load(handle)

    novels = {p.stem for p in NOVELS_DIR.glob("*.json")}

    standard = 0
    non_standard = 0
    available = 0
    for entry in catalog:
        file_id = entry.get("fileId") or ""
        if STANDARD_FILE_ID.match(file_id):
            standard += 1
        else:
            non_standard += 1
        entry["available"] = file_id in novels
        if entry["available"]:
            available += 1

    with PREVIEW.open("w", encoding="utf-8") as handle:
        json.dump(catalog[:PREVIEW_COUNT], handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")

    with COMPACT.open("w", encoding="utf-8") as handle:
        json.dump(catalog, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")

    total = len(catalog)
    print(f"Wrote {PREVIEW.relative_to(ROOT)} ({min(PREVIEW_COUNT, total)} entries)")
    print(f"Wrote {COMPACT.relative_to(ROOT)} ({total} entries)")
    print("--- catalog <-> novels coverage report ---")
    print(f"catalog entries:        {total}")
    print(f"local novels on disk:   {len(novels)}")
    print(f"available=true:         {available} ({available * 100 // total}%)")
    print(f"available=false:        {total - available} ({(total - available) * 100 // total}%)")
    print(f"standard fileIds:       {standard}")
    print(f"non-standard fileIds:   {non_standard} (kept, shown as 未収録)")
    referenced = {e.get("fileId") for e in catalog}
    orphans = sorted(novels - referenced)
    print(f"novels not in catalog:  {len(orphans)}")
    if orphans[:10]:
        print(f"  sample: {', '.join(orphans[:10])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
