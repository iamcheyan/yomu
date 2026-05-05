#!/usr/bin/env python3
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "data" / "aozora_catalog.json"
PREVIEW = ROOT / "data" / "aozora_catalog_preview.json"
COMPACT = ROOT / "data" / "aozora_catalog_compact.json"
PREVIEW_COUNT = 100


def main():
    with SOURCE.open(encoding="utf-8") as handle:
        catalog = json.load(handle)

    with PREVIEW.open("w", encoding="utf-8") as handle:
        json.dump(catalog[:PREVIEW_COUNT], handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")

    with COMPACT.open("w", encoding="utf-8") as handle:
        json.dump(catalog, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")

    print(f"Wrote {PREVIEW.relative_to(ROOT)} ({PREVIEW_COUNT} entries)")
    print(f"Wrote {COMPACT.relative_to(ROOT)} ({len(catalog)} entries)")


if __name__ == "__main__":
    main()
