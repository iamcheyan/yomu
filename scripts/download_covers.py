#!/usr/bin/env python3
"""Download openly hosted cover/scan thumbnails from Wikimedia Commons."""
import json, re, time, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
META = ROOT / 'data/metadata/cover_candidates.json'
OUT = ROOT / 'assets/covers'
REPORT = ROOT / 'data/metadata/downloaded_covers.json'
API = 'https://commons.wikimedia.org/w/api.php'
UA = 'yomu-cover-downloader/1.0 (offline reader project)'

def get_json(params):
    url = API + '?' + urllib.parse.urlencode({**params, 'format': 'json'})
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.load(r)

def clean(s):
    return re.sub(r'\s+', ' ', s or '').strip()

def search(title, author):
    q = clean(f'{title} {author}')
    data = get_json({'action':'query', 'generator':'search', 'gsrsearch':q,
                     'gsrnamespace':6, 'gsrlimit':10, 'prop':'imageinfo',
                     'iiprop':'url', 'iiurlwidth':500})
    pages = data.get('query', {}).get('pages', {}).values()
    for page in pages:
        name = page.get('title', '')
        info = (page.get('imageinfo') or [{}])[0]
        thumb = info.get('thumburl')
        if not thumb or not name.lower().endswith(('.jpg', '.jpeg', '.png', '.pdf')):
            continue
        # Prefer works whose title appears in the Commons filename.
        if title in name or any(x in name for x in title[:4]):
            return thumb, name
    return None, None

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    works = json.loads(META.read_text())
    report = []
    for i, work in enumerate(works, 1):
        title, author, file_id = work['title'], work['author'], work['fileId']
        try:
            url, source = search(title, author)
            if not url:
                print(f'[{i}/{len(works)}] MISS {title} / {author}', flush=True)
                continue
            path = OUT / f'{file_id}.jpg'
            req = urllib.request.Request(url, headers={'User-Agent': UA})
            with urllib.request.urlopen(req, timeout=30) as r:
                data = r.read()
            if len(data) < 1000 or not data.startswith(b'\xff\xd8'):
                print(f'[{i}/{len(works)}] SKIP invalid {title}', flush=True)
                continue
            path.write_bytes(data)
            report.append({'fileId': file_id, 'title': title, 'author': author,
                           'path': f'assets/covers/{path.name}', 'source': source,
                           'sourceUrl': url})
            print(f'[{i}/{len(works)}] OK {title} -> {path.name}', flush=True)
            time.sleep(.15)
        except Exception as e:
            print(f'[{i}/{len(works)}] ERROR {title}: {e}', flush=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(f'Downloaded {len(report)} covers; report: {REPORT}', flush=True)

if __name__ == '__main__':
    main()
