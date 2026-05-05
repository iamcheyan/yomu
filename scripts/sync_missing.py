#!/usr/bin/env python3
"""
从青空文库书库目录下载所有缺少的书籍。
用法：python3 scripts/sync_missing.py [--limit N] [--dry-run]
不传参数则下载全部书库中有振假名版本的书籍。
"""
import json
import os
import re
import sys
import time
import requests

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(SCRIPT_DIR)
DATA_DIR = os.path.join(ROOT_DIR, "data", "novels")
CATALOG_FILE = os.path.join(ROOT_DIR, "data", "aozora_catalog.json")

BASE_URL = "https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/cards/"


def get_local_books():
    """获取本地已有的书籍 ID"""
    if not os.path.exists(DATA_DIR):
        return set()
    return {f.replace(".json", "") for f in os.listdir(DATA_DIR) if f.endswith(".json")}


def get_catalog():
    """加载书库目录"""
    if not os.path.exists(CATALOG_FILE):
        print(f"错误: 目录文件不存在: {CATALOG_FILE}")
        sys.exit(1)
    with open(CATALOG_FILE, "r", encoding="utf-8") as f:
        return json.load(f)


def make_id(title):
    """从标题生成文件 ID"""
    # 移除括号内容和特殊字符
    clean = re.sub(r'[（(][^）)]*[）)]', '', title)
    clean = re.sub(r'[『』「」【】\s　]', '_', clean)
    clean = re.sub(r'[^a-zA-Z0-9_぀-ゟ゠-ヿ一-鿿]', '', clean)
    # 转小写
    clean = clean.lower()
    # 截断
    if len(clean) > 40:
        clean = clean[:40]
    return clean or "unknown"


def clean_aozora(text):
    """清洗青空文库文本"""
    parts = re.split(r'^-{5,}', text, flags=re.MULTILINE)
    if len(parts) >= 3:
        return parts[2].strip()
    elif len(parts) >= 2:
        return parts[1].strip()
    return text


def split_paragraphs(text):
    """按全角空格分段"""
    paragraphs = []
    current = ""
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped:
            if current:
                paragraphs.append(current)
                current = ""
            continue
        if stripped.startswith('　'):
            if current:
                paragraphs.append(current)
            current = stripped.lstrip('　')
        else:
            if current:
                paragraphs.append(current)
                current = ""
            paragraphs.append(stripped)
    if current:
        paragraphs.append(current)
    return paragraphs


def download_book(work_id, title, author, author_id, file_id):
    """下载一本书"""
    urls = [
        f"{BASE_URL}{author_id}/files/{file_id}/{file_id}.txt",
        f"{BASE_URL}{author_id}/files/{file_id}.txt",
        f"https://fastly.jsdelivr.net/gh/aozorahack/aozorabunko_text@master/cards/{author_id}/files/{file_id}/{file_id}.txt"
    ]

    filename = os.path.join(DATA_DIR, f"{work_id}.json")

    for url in urls:
        try:
            response = requests.get(url, timeout=15)
            if response.status_code == 200:
                content = response.content.decode('shift_jis', errors='replace')
                cleaned = clean_aozora(content)
                paragraphs = split_paragraphs(cleaned)

                if len(paragraphs) < 3:
                    return False, 0

                data = {
                    "id": work_id,
                    "title": title,
                    "author": author,
                    "paragraphs": paragraphs,
                    "translations": [[] for _ in paragraphs],
                    "desc": ""
                }

                os.makedirs(DATA_DIR, exist_ok=True)
                with open(filename, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)

                return True, len(paragraphs)
        except Exception:
            continue

    return False, 0


def main():
    dry_run = "--dry-run" in sys.argv
    limit = None
    for i, arg in enumerate(sys.argv):
        if arg == "--limit" and i + 1 < len(sys.argv):
            limit = int(sys.argv[i + 1])

    local_books = get_local_books()
    catalog = get_catalog()

    # 只选有振假名版本的书（质量更好）
    ruby_books = [c for c in catalog if "_ruby_" in c.get("fileId", "")]
    print(f"本地已有: {len(local_books)} 本")
    print(f"书库目录: {len(catalog)} 条 (有振假名: {len(ruby_books)} 条)")

    # 过滤出本地没有的
    to_sync = []
    seen_ids = set()
    for c in ruby_books:
        title = c.get("title", "")
        fid = c.get("fileId", "")
        aid = c.get("authorId", "")
        if not title or not fid:
            continue

        wid = make_id(title)
        # 处理同名书
        if wid in seen_ids or wid in local_books:
            continue
        seen_ids.add(wid)

        to_sync.append({
            "id": wid,
            "title": title,
            "author": c.get("author", ""),
            "authorId": aid,
            "fileId": fid,
        })

    if limit:
        to_sync = to_sync[:limit]

    print(f"待同步: {len(to_sync)} 本")

    if dry_run:
        print("\n[DRY RUN] 前 30 本:")
        for i, item in enumerate(to_sync[:30]):
            print(f"  {i+1:3d}. {item['title']}")
        if len(to_sync) > 30:
            print(f"  ... 还有 {len(to_sync) - 30} 本")
        return

    if not to_sync:
        print("没有需要同步的书籍。")
        return

    os.makedirs(DATA_DIR, exist_ok=True)
    success = 0
    failed = 0
    skipped = 0
    start_time = time.time()

    for i, item in enumerate(to_sync):
        elapsed = time.time() - start_time
        speed = success / elapsed * 60 if elapsed > 0 and success > 0 else 0
        print(f"[{i+1}/{len(to_sync)}] {item['title']} ... ", end="", flush=True)

        ok, paras = download_book(
            item["id"], item["title"], item.get("author", ""),
            item["authorId"], item["fileId"]
        )

        if ok:
            print(f"OK ({paras}段) [{speed:.0f}本/分]")
            success += 1
        else:
            print("跳过")
            failed += 1

        # 限速
        time.sleep(0.2)

    total_time = time.time() - start_time
    print(f"\n完成: 成功 {success}, 跳过 {failed}, 耗时 {total_time/60:.1f} 分钟")
    print(f"本地现有: {len(get_local_books())} 本")


if __name__ == "__main__":
    main()
