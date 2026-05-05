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
    ("gakumon_no_susume", "学問のすすめ", "福沢諭吉", "000296", "47061_ruby_28378", "「天は人の上に人を造らず」。現代日本の礎。"),
    # 追加作品
    ("wagahai_neko", "吾輩は猫である", "夏目漱石", "000148", "789_ruby_5639", "猫の視点から人間社会を風刺した漱石の出世作。"),
    ("sanshiro", "三四郎", "夏目漱石", "000148", "58842_ruby_76723", "地方出身の大学生が東京で揺れ動く青春。"),
    ("chumon_ryori", "注文の多い料理店", "宮沢賢治", "000081", "1927_ruby_17835", "注文が次々と出てくる不思議な料理店。"),
    ("taketori", "竹取物語", "作者不詳", "001072", "48310_ruby_42452", "日本最古の物語。かぐや姫の伝説。"),
    ("futon", "蒲団", "島崎藤村", "001397", "49871_ruby_71865", "日本自然主義文学の出発点となった私小説。"),
    ("takekurabe", "たけくらべ", "樋口一葉", "000064", "56041_ruby_54720", "吉原の裏町で揺れる少女たちの青春。"),
    ("musashino", "武蔵野", "国木田独歩", "000038", "329_ruby_5709", "武蔵野の自然を描いた日本抒情文学の傑作。"),
    ("ukigumo", "浮雲", "二葉亭四迷", "000291", "52236_ruby_58892", "日本近代文学の出発点。近代人の苦悩。"),
    ("kingin_yakusha", "金色夜叉", "尾崎紅葉", "000091", "522_ruby_3355", "金と愛の間で揺れる男女の悲恋。"),
    ("sanshō_dayū", "山椒大夫", "森鷗外", "000129", "689_ruby_23256", "母子の離散と再会を描いた歴史物語。"),
    ("yamada_isho", "大導寺信輔の半生", "芥川龍之介", "000879", "32_ruby_615", "芥川唯一の長編。知性と感性の葛藤。"),
    ("shunkinsho", "春琴抄", "谷崎潤一郎", "001383", "56866_ruby_58168", "盲目の音楽師と弟子の歪んだ愛の物語。"),
    ("sasameyuki", "細雪", "谷崎潤一郎", "001383", "56698_ruby_59448", "大阪の名家四姉妹の華やかな日常と衰退。"),
    ("gan", "雁", "森鷗外", "000154", "42323_ruby_48543", "岡田とお玉の淡く切ない恋。"),
    # 第三批
    ("izunodori", "伊豆の踊子", "川端康成", "001095", "45867_ruby_33221", "伊豆の旅で出会った踊子との淡い恋。"),
    ("viyon_no_tsuma", "ヴィヨンの妻", "太宰治", "000035", "2253_ruby_1031", "犯罪者の妻の愛と覚悟を描く。"),
    ("fugaku_hyakkei", "富嶽百景", "太宰治", "000035", "270_ruby_1164", "富士山を題材にした太宰の随筆。"),
    ("tsugaru", "津軽", "太宰治", "000035", "2282_ruby_1996", "太宰の故郷津軽を巡る紀行文。"),
    ("hana", "鼻", "芥川龍之介", "000879", "42_ruby_154", "長い鼻を持つ僧の苦悩と人間の醜さ。"),
    ("imo_gayu", "芋粥", "芥川龍之介", "000879", "55_ruby_1843", "芋粥への執着とその幻滅。"),
    ("yabu_no_naka", "藪の中", "芥川龍之介", "000879", "179_ruby_168", "多人称で語られる真実の不可知性。"),
    ("jigokuhen", "地獄変", "芥川龍之介", "000879", "61_ruby_2706", "画家の執念と芸術の残酷さ。"),
    ("kappa", "河童", "芥川龍之介", "000879", "69_ruby_1321", "河童の国を舞台にした風刺小説。"),
    ("aru_aho", "或阿呆の一生", "芥川龍之介", "000879", "19_ruby_306", "芥川の自伝的断章集。"),
    ("michi_kusa", "道草", "夏目漱石", "000148", "783_ruby_1311", "漱石の自伝的長編小説。"),
    ("yume_juya", "夢十夜", "夏目漱石", "000148", "799_ruby_6024", "幻想的な十の夢の物語。"),
    ("kusa_makura", "草枕", "夏目漱石", "000148", "776_ruby_6020", "画家の旅路と美意識の対話。"),
    ("to_shunshu", "杜子春", "芥川龍之介", "000879", "170_ruby_348", "唐の都の若者と仙人の物語。"),
    ("nankin_no_kirisuto", "南京の基督", "芥川龍之介", "000879", "105_ruby_773", "南京を舞台にした信仰と幻想の物語。"),
    ("meian", "明暗", "夏目漱石", "000076", "46939_ruby_38044", "漱石の最後の長編。夫婦の心理を描く。"),
    ("urashima", "浦島太郎", "古典", "000329", "3390_ruby_6090", "竜宮城から帰った浦島太郎の物語。"),
    ("issun_boshi", "一寸法師", "古典", "001779", "58053_ruby_62788", "親指ほどの小さな男の子の冒険。"),
    ("momotaro", "桃太郎", "芥川龍之介", "000879", "100_ruby_1154", "鬼が島に征伐に行く桃太郎。"),
    ("yuki_onna", "雪女", "小泉八雲", "000082", "45492_ruby_24517", "雪の中から現れた美女の怪談。"),
    ("ko_no_takane", "高野聖", "泉鏡花", "000050", "43466_ruby_25777", "山寺で出会う不思議な女と僧の物語。"),
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
                
                # 保留已有的 translations
                existing_translations = []
                if os.path.exists(filename):
                    try:
                        with open(filename, 'r', encoding='utf-8') as ef:
                            old_data = json.load(ef)
                        existing_translations = old_data.get("translations", [])
                    except:
                        pass

                # 确保 translations 长度与 paragraphs 匹配
                if not isinstance(existing_translations, list):
                    existing_translations = []
                # 如果长度不匹配（文本可能有变化），保留尽可能多的翻译
                if len(existing_translations) < len(paragraphs):
                    existing_translations.extend([[] for _ in range(len(paragraphs) - len(existing_translations))])
                elif len(existing_translations) > len(paragraphs):
                    existing_translations = existing_translations[:len(paragraphs)]

                data = {
                    "id": work_id,
                    "title": title,
                    "author": author,
                    "paragraphs": paragraphs,
                    "translations": existing_translations,
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
