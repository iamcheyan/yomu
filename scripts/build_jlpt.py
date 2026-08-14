#!/usr/bin/env python3
"""
build_jlpt.py — Yomu JLPT 词表构建脚本 (B5)

数据来源 (source):
  Bluskyo/JLPT_Vocabulary — data/vocab/results/JLPT_vocab_ALL.json
  https://github.com/Bluskyo/JLPT_Vocabulary (MIT)
  其数据出自 Jonathan Waller (tanos.co.uk) 的 JLPT 词汇表，
  以 Creative Commons BY 授权发布。

许可证 (license):
  - 仓库代码: MIT (见上方仓库)
  - 词汇数据: CC-BY — Jonathan Waller / tanos.co.uk
  → 派生分发需保留来源署名（data/dict/README.md 同步记录）。

口径 (不猜级别):
  - 仅收录词表中明确分级（N5..N1）的 见出し語。
  - 同一词形多个读音/级别全部保留；运行时精确匹配（词形+读音 或 词形）。
  - 不在词表中的词运行时显示「級外」，绝不推断级别。

用法:
  python3 scripts/build_jlpt.py [--keep-cache]

输出 (data/dict/jlpt.json):
  { "meta": {...}, "voc": { "見出し語": [ ["読み", 級], ... ] } }
  级数字 1..5 对应 N1..N5。
"""

import argparse
import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

SOURCE_URL = "https://raw.githubusercontent.com/Bluskyo/JLPT_Vocabulary/main/data/vocab/results/JLPT_vocab_ALL.json"
SOURCE_REPO = "https://github.com/Bluskyo/JLPT_Vocabulary"
LICENSE = (
    "JLPT vocabulary by Jonathan Waller (tanos.co.uk), CC-BY; "
    "compiled by Bluskyo/JLPT_Vocabulary (MIT)."
)
OUT_PATH = Path(__file__).resolve().parent.parent / "data" / "dict" / "jlpt.json"
CACHE_PATH = Path("/tmp/yomu_jlpt_all.json")


def main():
    ap = argparse.ArgumentParser(description="Build data/dict/jlpt.json")
    ap.add_argument("--keep-cache", action="store_true")
    args = ap.parse_args()

    if args.keep_cache and CACHE_PATH.exists():
        raw = CACHE_PATH.read_bytes()
    else:
        print(f"[jlpt] downloading {SOURCE_URL} ...")
        req = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "yomu-build-script/1.0"})
        with urllib.request.urlopen(req, timeout=120) as resp:
            raw = resp.read()
        CACHE_PATH.write_bytes(raw)
        print(f"[jlpt] downloaded {len(raw)} bytes")

    src = json.loads(raw)

    voc = {}
    n_entries = 0
    for word, entries in src.items():
        w = (word or "").strip()
        if not w or not isinstance(entries, list):
            continue
        rows = []
        for e in entries:
            reading = str(e.get("reading") or "").strip()
            level = e.get("level")
            if level not in (1, 2, 3, 4, 5):
                continue
            rows.append([reading, int(level)])
            n_entries += 1
        if rows:
            voc[w] = rows

    doc = {
        "meta": {
            "source": SOURCE_REPO,
            "sourceData": SOURCE_URL,
            "license": LICENSE,
            "generated": date.today().isoformat(),
            "words": len(voc),
            "entries": n_entries,
            "version": 1,
        },
        "voc": voc,
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    size = OUT_PATH.stat().st_size
    print(f"[jlpt] wrote {len(voc)} words / {n_entries} entries -> {OUT_PATH}")
    print(f"[jlpt] size: {size/1024:.1f} KB")
    return 0


if __name__ == "__main__":
    sys.exit(main())
