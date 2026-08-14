#!/usr/bin/env python3
"""
build_dict.py — Yomu 词典数据构建脚本 (A3)

从 EDRDG JMdict 构建 yomu 的按需小词典 data/dict/jmdict.json。

数据来源 (source):
  https://www.edrdg.org/pub/Nihongo/JMdict_e.gz
  JMdict_e — JMdict project, Electronic Dictionary Research and Development Group
  (© James Breen and the EDRDG, 1991-2026).

许可证 (license):
  JMdict is distributed under the Creative Commons Attribution-ShareAlike
  Licence (CC BY-SA 4.0), a derivative of the EDRDG licence.
  See https://www.edrdg.org/edrdg/licence.html
  → 本仓库分发其精简派生物时必须保留本说明（data/dict/README.md 同步记录）。

体积策略:
  默认仅收录「常用语」条目（JMdict 的 ichi1/news1/spec1..2/gai1..2 优先级标记），
  约为全量的 ~1/3，JSON 约 4–6MB，按需 fetch + SW cache-first 离线可用。
  --all 可收录全量（体积更大，不推荐随仓库分发）。

用法:
  python3 scripts/build_dict.py                 # 常用语词典 -> data/dict/jmdict.json
  python3 scripts/build_dict.py --all           # 全量（评测用）
  python3 scripts/build_dict.py --limit 500     # 小样本（管线验证）
  python3 scripts/build_dict.py --keep-cache    # 复用 /tmp 缓存的 JMdict_e.gz

输出格式 (data/dict/jmdict.json):
  {
    "meta": { source, license, generated, common_only, entries, version },
    "entries": [ { "k": [kanji forms], "r": [readings], "g": ["gloss", ...] } ],
    "index": { "<normalized key>": [entry indices...] }
  }
  index key = 假名化（片假名→平假名）后的見出し語/読み，值为 entries 下标。
  运行时 js/dict.js 只做 O(1) 精确查表。
"""

import argparse
import gzip
import io
import json
import sys
import time
import urllib.request
import xml.etree.ElementTree as ET
from datetime import date
from pathlib import Path

SOURCE_URL = "https://www.edrdg.org/pub/Nihongo/JMdict_e.gz"
LICENSE = (
    "JMdict (CC BY-SA 4.0) - Electronic Dictionary Research and Development Group. "
    "https://www.edrdg.org/edrdg/licence.html"
)
OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "dict" / "jmdict.json"
CACHE_PATH = Path("/tmp/yomu_JMdict_e.gz")

# JMdict 优先级标记：出现任意一个即视为常用语
COMMON_PRI = {"ichi1", "news1", "news2", "spec1", "spec2", "gai1", "gai2"}


def to_hira(s: str) -> str:
    """katakana -> hiragana (U+30A1..U+30F6 -> U+3041..U+3096); ー kept as-is."""
    out = []
    for ch in s:
        o = ord(ch)
        if 0x30A1 <= o <= 0x30F6:
            out.append(chr(o - 0x60))
        else:
            out.append(ch)
    return "".join(out)


def fetch_source(keep_cache: bool) -> bytes:
    if keep_cache and CACHE_PATH.exists():
        print(f"[dict] using cached {CACHE_PATH}")
        return CACHE_PATH.read_bytes()
    print(f"[dict] downloading {SOURCE_URL} ...")
    req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "yomu-build-script/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    CACHE_PATH.write_bytes(data)
    print(f"[dict] downloaded {len(data)} bytes (cached at {CACHE_PATH})")
    return data


def entry_is_common(entry) -> bool:
    for tag in ("ke_pri", "re_pri"):
        for pri in entry.iter(tag):
            if (pri.text or "") in COMMON_PRI:
                return True
    return False


def build(data_gz: bytes, common_only: bool, limit):
    entries = []
    index = {}
    n_total = 0

    def add_key(key, i):
        k = to_hira(key)
        if not k:
            return
        bucket = index.get(k)
        if bucket is None:
            index[k] = [i]
        elif bucket[-1] != i:
            bucket.append(i)

    raw = gzip.decompress(data_gz)
    for _, entry in ET.iterparse(io.BytesIO(raw), events=("end",)):
        if entry.tag != "entry":
            # NOTE: do not clear child elements here — their text is read
            # when the enclosing <entry> end event arrives.
            continue
        n_total += 1
        if common_only and not entry_is_common(entry):
            entry.clear()
            continue

        kanji = [k.text for k in entry.iter("keb") if k.text]
        readings = [r.text for r in entry.iter("reb") if r.text]
        glosses = []
        for g in entry.iter("gloss"):
            t = (g.text or "").strip()
            if t:
                glosses.append(t)
            if len(glosses) >= 3:
                break

        if not readings and not kanji:
            entry.clear()
            continue

        i = len(entries)
        entries.append({"k": kanji, "r": readings, "g": glosses})
        for k in kanji:
            add_key(k, i)
        for r in readings:
            add_key(r, i)

        entry.clear()
        if limit is not None and len(entries) >= limit:
            break

    return entries, index, n_total


def main():
    ap = argparse.ArgumentParser(description="Build data/dict/jmdict.json from EDRDG JMdict_e")
    ap.add_argument("--all", action="store_true", help="include non-common entries (large!)")
    ap.add_argument("--limit", type=int, default=None, help="cap entry count (pipeline smoke test)")
    ap.add_argument("--keep-cache", action="store_true", help="reuse /tmp/yomu_JMdict_e.gz if present")
    args = ap.parse_args()

    data = fetch_source(args.keep_cache)
    t0 = time.time()
    entries, index, n_total = build(data, common_only=not args.all, limit=args.limit)
    dt = time.time() - t0

    doc = {
        "meta": {
            "source": SOURCE_URL,
            "license": LICENSE,
            "generated": date.today().isoformat(),
            "common_only": not args.all,
            "entries": len(entries),
            "source_entries": n_total,
            "version": 1,
        },
        "entries": entries,
        "index": index,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(doc, ensure_ascii=False, separators=(",", ":"))
    OUT_PATH.write_text(payload, encoding="utf-8")

    size = OUT_PATH.stat().st_size
    print(f"[dict] parsed {n_total} source entries in {dt:.1f}s")
    print(f"[dict] wrote {len(entries)} entries, {len(index)} index keys -> {OUT_PATH}")
    print(f"[dict] size: {size/1024/1024:.2f} MB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
