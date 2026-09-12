#!/usr/bin/env python3
"""检查并发布青空文库目录中缺少的正文文件。

默认只做检查，不联网下载：
  python3 scripts/sync_catalog.py --author 夏目漱石

明确指定 --download 后才会写入 data/novels/：
  python3 scripts/sync_catalog.py --author 夏目漱石 --download
  python3 scripts/sync_catalog.py --download --limit 20

文件名使用目录中的 fileId，与前端 data/novels/{fileId}.json 的约定一致。
来源是 aozorahack/aozorabunko_text 的公开文本镜像；下载后的 JSON 仍需人工检查后再提交。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
CATALOG = ROOT / "data" / "aozora_catalog.json"
NOVELS = ROOT / "data" / "novels"
MIRROR = "https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/cards"


def load_catalog() -> list[dict]:
    with CATALOG.open(encoding="utf-8") as f:
        return json.load(f)


def local_ids() -> set[str]:
    return {p.stem for p in NOVELS.glob("*.json")}


def candidates(catalog: Iterable[dict], args: argparse.Namespace, existing: set[str]) -> list[dict]:
    result = []
    seen = set()
    for book in catalog:
        file_id = str(book.get("fileId") or "").strip()
        author_id = str(book.get("authorId") or "").strip()
        title = str(book.get("title") or "").strip()
        if not file_id or not author_id or not title:
            continue
        if not args.include_non_ruby and "_ruby_" not in file_id:
            continue
        if args.author and args.author not in book.get("author", ""):
            continue
        if args.title and args.title not in title:
            continue
        if file_id in existing and not args.refresh:
            continue
        if file_id in seen:
            continue
        seen.add(file_id)
        result.append(book)
    return result[:args.limit] if args.limit else result


def source_urls(book: dict) -> list[str]:
    author_id = book["authorId"]
    file_id = book["fileId"]
    return [
        f"{MIRROR}/{author_id}/files/{file_id}/{file_id}.txt",
        f"{MIRROR}/{author_id}/files/{file_id}.txt",
        f"https://fastly.jsdelivr.net/gh/aozorahack/aozorabunko_text@master/cards/{author_id}/files/{file_id}/{file_id}.txt",
    ]


def parse_text(raw: bytes) -> list[str]:
    text = raw.decode("shift_jis", errors="replace")
    parts = re.split(r"^-{5,}", text, flags=re.MULTILINE)
    body = parts[2] if len(parts) >= 3 else parts[1] if len(parts) >= 2 else text

    paragraphs: list[str] = []
    current = ""
    for line in body.strip().splitlines():
        line = line.rstrip()
        if not line.strip():
            if current:
                paragraphs.append(current)
                current = ""
            continue
        # Aozora uses full-width indentation for a new paragraph.
        if line.startswith("　"):
            if current:
                paragraphs.append(current)
            current = line.lstrip("　")
        else:
            current += line.strip()
    if current:
        paragraphs.append(current)
    return paragraphs


def fetch(book: dict, opener: urllib.request.OpenerDirector) -> tuple[list[str] | None, str | None]:
    for url in source_urls(book):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": "yomu-catalog-sync/1.0"})
            with opener.open(request, timeout=30) as response:
                if response.status == 200:
                    paragraphs = parse_text(response.read())
                else:
                    continue
                if len(paragraphs) >= 3:
                    return paragraphs, url
        except (urllib.error.URLError, TimeoutError):
            continue
    return None, None


def write_book(book: dict, paragraphs: list[str], source_url: str) -> Path:
    NOVELS.mkdir(parents=True, exist_ok=True)
    path = NOVELS / f"{book['fileId']}.json"
    data = {
        "id": book["fileId"],
        "title": book.get("title", ""),
        "author": book.get("author", ""),
        "paragraphs": paragraphs,
        "translations": [[] for _ in paragraphs],
        "desc": book.get("desc", ""),
        "workId": book.get("workId", ""),
        "authorId": book.get("authorId", ""),
        "fileId": book["fileId"],
        "cardUrl": book.get("cardUrl", ""),
        "textUrl": f"https://www.aozora.gr.jp/cards/{book['authorId']}/files/{book['fileId']}.zip",
        "sourceUrl": source_url,
    }
    with path.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--download", action="store_true", help="实际下载并写入 data/novels")
    parser.add_argument("--refresh", action="store_true", help="重新下载已有文件（谨慎使用）")
    parser.add_argument("--limit", type=int, help="最多处理多少本")
    parser.add_argument("--author", help="只处理作者名包含此文字的作品")
    parser.add_argument("--title", help="只处理书名包含此文字的作品")
    parser.add_argument("--include-non-ruby", action="store_true", help="也检查没有振假名版本的 txt 作品")
    args = parser.parse_args()
    if args.refresh and not args.download:
        parser.error("--refresh 必须和 --download 一起使用")

    catalog = load_catalog()
    existing = local_ids()
    todo = candidates(catalog, args, existing)
    print(f"目录：{len(catalog)} 条；本地正文：{len(existing)} 本；待处理：{len(todo)} 本")
    if not todo:
        return 0

    if not args.download:
        for book in todo[:30]:
            print(f"CHECK  {book['fileId']}\t{book.get('author', '')}\t{book['title']}")
        if len(todo) > 30:
            print(f"... 其余 {len(todo) - 30} 本未展开；加 --download 执行下载")
        return 0

    opener = urllib.request.build_opener()
    ok = failed = 0
    for index, book in enumerate(todo, 1):
        label = f"[{index}/{len(todo)}] {book.get('author', '')} / {book['title']}"
        paragraphs, source = fetch(book, opener)
        if paragraphs is None or source is None:
            failed += 1
            print(f"FAIL  {label}", flush=True)
            continue
        path = write_book(book, paragraphs, source)
        ok += 1
        print(f"OK    {label} -> {path.relative_to(ROOT)} ({len(paragraphs)}段)", flush=True)
        time.sleep(0.2)

    print(f"完成：成功 {ok}，失败 {failed}；本地正文约 {len(local_ids())} 本")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
