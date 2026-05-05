import json
import os

PREVIEW_PATH = "/home/tetsuya/Development/yomu/data/metadata/aozora_local_enrichment_preview.json"
NOVELS_DIR = "/home/tetsuya/Development/yomu/data/novels"

def enrich_novels():
    if not os.path.exists(PREVIEW_PATH):
        print(f"Error: {PREVIEW_PATH} not found.")
        return

    with open(PREVIEW_PATH, 'r', encoding='utf-8') as f:
        enrichment_data = json.load(f)
    
    print(f"Starting enrichment for {len(enrichment_data)} potential entries...")
    
    count = 0
    for entry in enrichment_data:
        if entry.get('matchConfidence') != 'id':
            continue
            
        filename = entry['file']
        metadata = entry['metadata']
        path = os.path.join(NOVELS_DIR, filename)
        
        if not os.path.exists(path):
            continue
            
        try:
            with open(path, 'r', encoding='utf-8') as f:
                novel = json.load(f)
            
            # Enrich the novel data with Aozora metadata
            # We keep the original structure but add a dedicated 'aozora_info' block
            novel['aozora_info'] = metadata
            
            with open(path, 'w', encoding='utf-8') as f:
                json.dump(novel, f, ensure_ascii=False, indent=2)
            
            count += 1
            if count % 1000 == 0:
                print(f"Processed {count} files...")
        except Exception as e:
            print(f"Error processing {filename}: {e}")

    print(f"Finished! Total enriched: {count} files.")

if __name__ == "__main__":
    enrich_novels()
