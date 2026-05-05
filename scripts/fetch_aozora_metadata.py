#!/usr/bin/env python3
import csv
import io
import json
import re
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path


CATALOG_URL = "https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip"
ROOT = Path(__file__).resolve().parents[1]
NOVELS_DIR = ROOT / "data" / "novels"
OUTPUT_DIR = ROOT / "data" / "metadata"
WORK_METADATA_PATH = OUTPUT_DIR / "aozora_work_metadata.json"
LOCAL_PREVIEW_PATH = OUTPUT_DIR / "aozora_local_enrichment_preview.json"
REPORT_PATH = OUTPUT_DIR / "aozora_local_match_report.json"


def normalize_work_id(value):
    digits = re.sub(r"\D", "", str(value or ""))
    return digits.zfill(6) if digits else ""


def work_id_from_local_id(value):
    match = re.match(r"^(\d+)(?:_|$)", str(value or ""))
    return normalize_work_id(match.group(1)) if match else ""


def compact(value):
    return str(value or "").strip()


def has_value(value):
    if value in ("", [], {}, None):
        return False
    if isinstance(value, dict):
        return any(has_value(item) for item in value.values())
    if isinstance(value, list):
        return any(has_value(item) for item in value)
    return True


def prune_empty(value):
    if isinstance(value, dict):
        pruned = {key: prune_empty(item) for key, item in value.items()}
        return {key: item for key, item in pruned.items() if has_value(item)}
    if isinstance(value, list):
        pruned = [prune_empty(item) for item in value]
        return [item for item in pruned if has_value(item)]
    return value


def person_name(row):
    last = compact(row.get("姓"))
    first = compact(row.get("名"))
    return f"{last}{first}" if (last or first) else ""


def person_kana(row):
    last = compact(row.get("姓読み"))
    first = compact(row.get("名読み"))
    return f"{last}{first}" if (last or first) else ""


def person_roman(row):
    last = compact(row.get("姓ローマ字"))
    first = compact(row.get("名ローマ字"))
    return " ".join(part for part in [first, last] if part)


def get_text_file_id(text_url):
    match = re.search(r"/files/([^/.]+)\.", text_url or "")
    return match.group(1) if match else ""


def load_aozora_rows():
    print(f"Downloading Aozora metadata CSV: {CATALOG_URL}")
    with urllib.request.urlopen(CATALOG_URL, timeout=60) as response:
        body = response.read()

    with zipfile.ZipFile(io.BytesIO(body)) as archive:
        csv_name = archive.namelist()[0]
        text = archive.read(csv_name).decode("utf-8-sig")

    reader = csv.DictReader(io.StringIO(text))
    return list(reader), reader.fieldnames or []


def build_work_metadata(rows):
    grouped = defaultdict(list)
    for row in rows:
        work_id = normalize_work_id(row.get("作品ID"))
        if work_id:
            grouped[work_id].append(row)

    works = {}
    for work_id, work_rows in grouped.items():
        primary = work_rows[0]
        people = []
        authors = []

        for row in work_rows:
            role = compact(row.get("役割フラグ"))
            name = person_name(row)
            person = {
                "personId": normalize_work_id(row.get("人物ID")),
                "name": name,
                "kana": person_kana(row),
                "roman": person_roman(row),
                "role": role,
                "birthDate": compact(row.get("生年月日")),
                "deathDate": compact(row.get("没年月日")),
                "copyright": compact(row.get("人物著作権フラグ")),
            }
            people.append(person)
            if role == "著者" and name:
                authors.append(person)

        if not authors:
            authors = [p for p in people if p.get("name")]

        author_names = []
        for person in authors:
            if person["name"] and person["name"] not in author_names:
                author_names.append(person["name"])

        text_url = compact(primary.get("テキストファイルURL"))
        works[work_id] = {
            "workId": work_id,
            "title": compact(primary.get("作品名")),
            "titleKana": compact(primary.get("作品名読み")),
            "sortKana": compact(primary.get("ソート用読み")),
            "subtitle": compact(primary.get("副題")),
            "subtitleKana": compact(primary.get("副題読み")),
            "originalTitle": compact(primary.get("原題")),
            "firstAppearance": compact(primary.get("初出")),
            "ndc": compact(primary.get("分類番号")),
            "orthography": compact(primary.get("文字遣い種別")),
            "workCopyright": compact(primary.get("作品著作権フラグ")),
            "publishedAt": compact(primary.get("公開日")),
            "updatedAt": compact(primary.get("最終更新日")),
            "cardUrl": compact(primary.get("図書カードURL")),
            "textUrl": text_url,
            "textFileId": get_text_file_id(text_url),
            "htmlUrl": compact(primary.get("XHTML/HTMLファイルURL")),
            "inputBy": compact(primary.get("入力者")),
            "proofreadBy": compact(primary.get("校正者")),
            "baseBook1": {
                "title": compact(primary.get("底本名1")),
                "publisher": compact(primary.get("底本出版社名1")),
                "firstPublishedAt": compact(primary.get("底本初版発行年1")),
                "inputEdition": compact(primary.get("入力に使用した版1")),
                "proofreadEdition": compact(primary.get("校正に使用した版1")),
            },
            "baseBook2": {
                "title": compact(primary.get("底本名2")),
                "publisher": compact(primary.get("底本出版社名2")),
                "firstPublishedAt": compact(primary.get("底本初版発行年2")),
                "inputEdition": compact(primary.get("入力に使用した版2")),
                "proofreadEdition": compact(primary.get("校正に使用した版2")),
            },
            "author": "、".join(author_names),
            "authors": authors,
            "people": people,
            "source": "aozora_list_person_all_extended_utf8",
        }

    return works


def load_local_novel(path):
    try:
        with path.open(encoding="utf-8") as handle:
            return json.load(handle)
    except Exception:
        return {}


def build_local_preview(works):
    by_title = defaultdict(list)
    for meta in works.values():
        if meta["title"]:
            by_title[meta["title"]].append(meta)

    preview = []
    stats = Counter()
    matched_fields = Counter()
    unmatched_samples = []
    title_ambiguous_samples = []

    for path in sorted(NOVELS_DIR.glob("*.json")):
        local = load_local_novel(path)
        local_id = compact(local.get("id")) or path.stem
        title = compact(local.get("title"))
        candidate_id = work_id_from_local_id(local_id) or work_id_from_local_id(path.stem)

        match = works.get(candidate_id)
        confidence = "id" if match else ""

        if not match and title:
            title_matches = by_title.get(title, [])
            if len(title_matches) == 1:
                match = title_matches[0]
                confidence = "title"
            elif len(title_matches) > 1:
                stats["title_ambiguous"] += 1
                if len(title_ambiguous_samples) < 20:
                    title_ambiguous_samples.append({
                        "file": path.name,
                        "localId": local_id,
                        "title": title,
                        "candidateWorkIds": [m["workId"] for m in title_matches[:8]],
                    })

        if match:
            stats[f"matched_{confidence}"] += 1
            enrichment = prune_empty({key: value for key, value in match.items() if key != "people"})
            for key, value in enrichment.items():
                if key not in {"source", "authors"} and has_value(value):
                    matched_fields[key] += 1
            preview.append({
                "file": path.name,
                "localId": local_id,
                "localTitle": title,
                "matchConfidence": confidence,
                "metadata": enrichment,
            })
        else:
            stats["unmatched"] += 1
            if len(unmatched_samples) < 50:
                unmatched_samples.append({
                    "file": path.name,
                    "localId": local_id,
                    "title": title,
                    "candidateWorkId": candidate_id,
                })

    stats["total_local_files"] = len(list(NOVELS_DIR.glob("*.json")))
    stats["matched_total"] = stats["matched_id"] + stats["matched_title"]

    return preview, {
        "summary": dict(stats),
        "fieldCoverageOnMatched": dict(sorted(matched_fields.items())),
        "unmatchedSamples": unmatched_samples,
        "titleAmbiguousSamples": title_ambiguous_samples,
    }


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    rows, fieldnames = load_aozora_rows()
    works = build_work_metadata(rows)
    preview, report = build_local_preview(works)

    report["source"] = {
        "url": CATALOG_URL,
        "csvRows": len(rows),
        "workCount": len(works),
        "csvFields": fieldnames,
    }

    with WORK_METADATA_PATH.open("w", encoding="utf-8") as handle:
        json.dump(works, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    with LOCAL_PREVIEW_PATH.open("w", encoding="utf-8") as handle:
        json.dump(preview, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    with REPORT_PATH.open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    summary = report["summary"]
    print(f"Wrote {WORK_METADATA_PATH.relative_to(ROOT)}")
    print(f"Wrote {LOCAL_PREVIEW_PATH.relative_to(ROOT)}")
    print(f"Wrote {REPORT_PATH.relative_to(ROOT)}")
    print(
        "Matched "
        f"{summary.get('matched_total', 0)}/{summary.get('total_local_files', 0)} "
        f"(id={summary.get('matched_id', 0)}, title={summary.get('matched_title', 0)}, "
        f"unmatched={summary.get('unmatched', 0)})"
    )


if __name__ == "__main__":
    main()
