import requests
import re
import os
import json
import sys

# Constants
BASE_URL = "https://raw.githubusercontent.com/aozorahack/aozorabunko_text/master/cards/"
DATA_DIR = "data/novels/"

# 预设书籍列表 - 文件ID已验证
TOP_WORKS = [
    ("rashomon", "羅生門", "芥川龍之介", "000879", "127_ruby_150", "平安末期の荒廃した羅生門を舞台に、生きるための悪を描いた傑作。"),
    ("hashire_melos", "走れメロス", "太宰治", "000035", "1567_ruby_4948", "友情と信頼を貫こうとする青年の物語。"),
    ("bocchan", "坊っちゃん", "夏目漱石", "000148", "752_ruby_2438", "無鉄砲な教師が田舎の学校で騒動を巻き起こす。"),
    ("sangetsuki", "山月記", "中島敦", "000119", "624_ruby_5668", "自尊心ゆえに虎になった男の悲哀。"),
    ("mai_hime", "舞姫", "森鷗外", "000129", "2078_ruby_15898", "ドイツ留学中のエリートと踊り子の悲恋。"),
    ("ningen_shikkaku", "人間失格", "太宰治", "000035", "301_ruby_5915", "「恥の多い生涯を送ってきました」。"),
    ("kokoro", "こころ", "夏目漱石", "000148", "773_ruby_5968", "先生の遺書を通じて描かれる孤独とエゴイズム。"),
    ("gingatetsudo", "銀河鉄道の夜", "宮沢賢治", "000081", "43737_ruby_19028", "星空を駆ける幻想的な鉄道旅。"),
    ("kumo_no_ito", "蜘蛛の糸", "芥川龍之介", "000879", "92_ruby_164", "地獄に垂らされた一本の糸とカンダタの物語。"),
    ("kazetachinu", "風立ちぬ", "堀辰雄", "001030", "4803_ruby_14149", "美しくも切ない愛と死の物語。"),
    ("lemon", "檸檬", "梶井基次郎", "000074", "424_ruby_19825", "鬱屈した感情がレモン一つで晴れる瞬間。"),
    ("yodaka_no_hoshi", "よだかの星", "宮沢賢治", "000081", "473_ruby_467", "醜いよだかが星になるまでの純粋な魂。"),
    ("takasebune", "高瀬舟", "森鷗外", "000129", "45245_ruby_21882", "安楽死をテーマにした深い問いかけ。"),
    ("gakumon_no_susume", "学問のすすめ", "福沢諭吉", "000296", "47061_ruby_28378", "「天は人の上に人を造らず」。現代日本の礎。")
]

def clean_aozora(text):
    """
    Basic cleaning of Aozora Bunko text.
    - Remove notes [＃...]
    - KEEP ruby markers 《...》 and ｜ (useful for Japanese learners)
    """
    # 移除页眉页脚 (根据分隔线)
    parts = re.split(r'^-{5,}', text, flags=re.MULTILINE)

    if len(parts) >= 3:
        # parts[0]=标题/作者, parts[1]=符号说明, parts[2]=正文
        content = parts[2].strip()
    elif len(parts) >= 2:
        content = parts[1].strip()
    else:
        content = text

    # Keep all annotations ［＃...］ for learning purposes
    # Keep ruby 《...》 and ｜ markers for learning purposes
    return content

def sync_book(work_id, title, author, author_id, file_id, desc):
    """
    Fetch a single book from GitHub and save as JSON.
    """
    os.makedirs(DATA_DIR, exist_ok=True)
    filename = f"{DATA_DIR}{work_id}.json"
    
    # Construct potential URLs
    urls = [
        f"{BASE_URL}{author_id}/files/{file_id}/{file_id}.txt",
        f"{BASE_URL}{author_id}/files/{file_id}.txt",
        f"https://fastly.jsdelivr.net/gh/aozorahack/aozorabunko_text@master/cards/{author_id}/files/{file_id}/{file_id}.txt"
    ]
    
    print(f"Syncing: {title} ({author}) ...")
    
    for url in urls:
        try:
            response = requests.get(url, timeout=10)
            if response.status_code == 200:
                # Aozora files are typically Shift_JIS
                content = response.content.decode('shift_jis', errors='replace')
                
                cleaned_body = clean_aozora(content)

                # Split into paragraphs by full-width space indentation
                paragraphs = []
                current_para = ""
                for line in cleaned_body.splitlines():
                    stripped = line.strip()
                    if not stripped:
                        if current_para:
                            paragraphs.append(current_para)
                            current_para = ""
                        continue
                    if stripped.startswith('　'):
                        if current_para:
                            paragraphs.append(current_para)
                        current_para = stripped.lstrip('　')
                    else:
                        if current_para:
                            paragraphs.append(current_para)
                            current_para = ""
                        paragraphs.append(stripped)
                if current_para:
                    paragraphs.append(current_para)
                
                data = {
                    "id": work_id,
                    "title": title,
                    "author": author,
                    "paragraphs": paragraphs,
                    "desc": desc
                }
                
                with open(filename, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                    
                print(f"  Saved to {filename}")
                return True
        except Exception as e:
            continue
            
    print(f"  Failed to sync {title}")
    return False

def main():
    # If arguments are provided, sync specific books from catalog
    if len(sys.argv) > 1:
        try:
            with open('data/aozora_catalog.json', 'r', encoding='utf-8') as f:
                catalog = json.load(f)
        except FileNotFoundError:
            print("Catalog not found. Please run scripts/build_catalog.py first.")
            return

        targets = sys.argv[1:]
        for target in targets:
            book = next((b for b in catalog if b['workId'] == target or b['title'] == target), None)
            if book:
                sync_book(book['workId'], book['title'], book['author'], book['authorId'], book['fileId'], book.get('desc', ''))
            else:
                print(f"Book '{target}' not found in catalog.")
        return

    # Default: sync preset books
    for work_id, title, author, author_id, file_id, desc in TOP_WORKS:
        sync_book(work_id, title, author, author_id, file_id, desc)

if __name__ == "__main__":
    main()
