import zipfile
import io
import requests

CATALOG_URL = "https://www.aozora.gr.jp/index_pages/list_person_all_extended_utf8.zip"

def peek():
    r = requests.get(CATALOG_URL, timeout=30)
    with zipfile.ZipFile(io.BytesIO(r.content)) as z:
        csv_filename = z.namelist()[0]
        with z.open(csv_filename) as f:
            line = f.readline().decode('utf-8')
            print(line)

if __name__ == "__main__":
    peek()
