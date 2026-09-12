#!/usr/bin/env python3
"""从 NDL Search 找适合人工确认的旧版书影候选。

只写候选元数据，不把来源不明的现代出版社封面下载进项目：
  python3 scripts/find_historical_covers.py --author 夏目漱石 --limit 20
  python3 scripts/find_historical_covers.py --authors-file /tmp/cover-authors.txt

结果写入 data/metadata/cover_candidates.json。候选会按作品名精确匹配、
出版年份优先、是否存在数字资料入口排序。NDL Search 的书影 API 已停止，
因此实际图片优先走数字馆藏 IIIF，而不是旧的 ISBN 缩略图接口。
"""

from __future__ import annotations

import argparse
import json
import re
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "data" / "aozora_catalog.json"
OUTPUT = ROOT / "data" / "metadata" / "cover_candidates.json"
API = "https://ndlsearch.ndl.go.jp/api/opensearch"
NS = {
    "dc": "http://purl.org/dc/elements/1.1/",
    "dcndl": "http://ndl.go.jp/dcndl/terms/",
    "dcterms": "http://purl.org/dc/terms/",
    "rdfs": "http://www.w3.org/2000/01/rdf-schema#",
}


def text(item: ET.Element, path: str) -> str:
    node = item.find(path, NS)
    return (node.text or "").strip() if node is not None else ""


def values(item: ET.Element, path: str) -> list[str]:
    return [(node.text or "").strip() for node in item.findall(path, NS) if node.text]


def get(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "yomu-cover-research/1.0"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def search(title: str, author: str, count: int) -> list[dict]:
    # NDL Search ranks broad matches first; request a wider page before applying
    # our exact title check locally.
    query = urllib.parse.urlencode({"title": title, "creator": author, "cnt": max(count, 50)})
    root = ET.fromstring(get(f"{API}?{query}"))
    result = []
    for item in root.findall("./channel/item"):
        found_title = text(item, "dc:title") or text(item, "title")
        if found_title != title:
            continue
        date = text(item, "dcterms:issued") or text(item, "pubDate")
        year_match = re.search(r"(1[0-9]{3}|20[0-9]{2})", date)
        year = int(year_match.group(1)) if year_match else None
        identifiers = values(item, "dc:identifier")
        digital_links = [
            n.attrib.get("{http://www.w3.org/1999/02/22-rdf-syntax-ns#}resource", "")
            for n in item.findall("rdfs:seeAlso", NS)
        ]
        link = text(item, "link")
        result.append({
            "title": found_title,
            "author": author,
            "foundAuthor": "; ".join(values(item, "dc:creator")),
            "year": year,
            "date": date,
            "publisher": text(item, "dc:publisher"),
            "identifiers": identifiers,
            "ndlUrl": link,
            "digitalLinks": [u for u in digital_links if u],
            "score": (100 if year and year <= 1950 else 0) + (20 if digital_links else 0),
        })
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--author", action="append", help="作者，可重复指定")
    parser.add_argument("--authors-file", type=Path, help="每行一个作者")
    parser.add_argument("--limit", type=int, default=20, help="每位作者最多查询多少本")
    parser.add_argument("--max-results", type=int, default=8, help="每本作品最多保留多少候选")
    args = parser.parse_args()

    authors = list(args.author or [])
    if args.authors_file:
        authors.extend(x.strip() for x in args.authors_file.read_text(encoding="utf-8").splitlines() if x.strip())
    if not authors:
        authors = ["夏目漱石", "芥川龍之介", "太宰治", "宮沢賢治", "森鴎外"]

    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    works = []
    seen = set()
    for book in catalog:
        if book.get("author") not in authors:
            continue
        key = (book.get("title", ""), book.get("author", ""))
        if key in seen or not key[0]:
            continue
        seen.add(key)
        works.append({"title": key[0], "author": key[1], "workId": book.get("workId", ""), "fileId": book.get("fileId", "")})

    # Keep the first N per author, preserving catalog order.
    selected = []
    counts = {author: 0 for author in authors}
    for work in works:
        if counts[work["author"]] >= args.limit:
            continue
        counts[work["author"]] += 1
        selected.append(work)

    output = []
    for index, work in enumerate(selected, 1):
        try:
            candidates = search(work["title"], work["author"], args.max_results)
        except (OSError, ET.ParseError) as error:
            print(f"FAIL {index}/{len(selected)} {work['title']}: {error}")
            continue
        output.append({**work, "candidates": sorted(candidates, key=lambda x: (-x["score"], -(x["year"] or 0)))})
        print(f"OK   {index}/{len(selected)} {work['author']} / {work['title']} -> {len(candidates)} 候选")
        time.sleep(0.25)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"写入 {OUTPUT.relative_to(ROOT)}：{len(output)} 部作品")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
