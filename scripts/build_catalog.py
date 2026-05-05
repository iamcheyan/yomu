import requests
import zipfile
import io
import csv
import json
import os

# 青空文庫の全作品リスト (UTF-8版)
CATALOG_URL = "https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip"

def fetch_and_process():
    print(f"正在从 {CATALOG_URL} 下载全量目录...")
    
    try:
        r = requests.get(CATALOG_URL, timeout=30)
        r.raise_for_status()
        
        print("下载完成，正在解析...")
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            # 获取压缩包中的第一个文件（通常是 .csv）
            csv_filename = z.namelist()[0]
            with z.open(csv_filename) as f:
                # 使用 utf-8 解码
                decoded_content = f.read().decode('utf-8')
                reader = csv.DictReader(io.StringIO(decoded_content))
                
                # Aozora CSV headers usually include '作品名', '作品ID', '人物ID', '姓', '名'
                # But let's be more flexible
                catalog = []
                for row in reader:
                    # 获取列名（以防万一）
                    # 关键字段提取
                    title = row.get('作品名', '')
                    
                    # 姓名通常分为 '姓' 和 '名'
                    last_name = row.get('姓', '')
                    first_name = row.get('名', '')
                    author = f"{last_name}{first_name}"
                    
                    author_id = row.get('人物ID', '').zfill(6)
                    work_id = row.get('作品ID', '')
                    text_url = row.get('テキストファイルURL', '')
                    
                    # 角色过滤：只保留“著者”（Role flag: 著者）
                    # 在 CSV 中，'役割フラグ' 通常是 '著者'
                    role = row.get('役割フラグ', '著者')
                    if role != '著者':
                        continue

                    # 从文本URL中提取 file_id
                    file_id = ""
                    if text_url:
                        file_id_match = re.search(r'files/([^/.]+)\.', text_url)
                        if file_id_match:
                            file_id = file_id_match.group(1)
                    
                    if file_id:
                        catalog.append({
                            "title": title,
                            "author": author,
                            "authorId": author_id,
                            "workId": work_id,
                            "fileId": file_id
                        })
                
                print(f"解析完成，共找到 {len(catalog)} 部作品。")
                
                # 保存为 JSON
                os.makedirs("data", exist_ok=True)
                with open("data/aozora_catalog.json", "w", encoding="utf-8") as out:
                    json.dump(catalog, out, ensure_ascii=False, indent=2)
                
                print("目录已成功保存至 data/aozora_catalog.json")

    except Exception as e:
        print(f"发生错误: {e}")

if __name__ == "__main__":
    import re
    fetch_and_process()
