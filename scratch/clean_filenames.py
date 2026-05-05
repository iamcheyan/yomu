import os
import json
import re

def clean_novels():
    catalog_path = '/home/tetsuya/Development/yomu/data/aozora_catalog.json'
    novels_dir = '/home/tetsuya/Development/yomu/data/novels/'
    books_json_path = '/home/tetsuya/Development/yomu/data/books.json'

    # 1. Load catalog for mapping
    print("Loading catalog...")
    with open(catalog_path, 'r', encoding='utf-8') as f:
        catalog = json.load(f)
    
    # Create mapping: title -> fileId
    # Note: Some titles might be duplicate, but we'll try our best
    title_map = {}
    for entry in catalog:
        title = entry.get('title')
        fid = entry.get('fileId')
        if title and fid:
            title_map[title] = fid

    # 2. Load bundled books to skip them
    with open(books_json_path, 'r', encoding='utf-8') as f:
        bundled = json.load(f)
    bundled_ids = {b['id'] for b in bundled}

    # 3. Iterate through files
    print("Cleaning filenames...")
    files = [f for f in os.listdir(novels_dir) if f.endswith('.json')]
    count = 0
    skipped = 0
    not_found = 0

    for filename in files:
        base_id = filename[:-5] # remove .json
        if base_id in bundled_ids:
            skipped += 1
            continue
        
        file_path = os.path.join(novels_dir, filename)
        
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            title = data.get('title')
            # Try to find the correct fileId from catalog using title
            new_id = title_map.get(title)
            
            if new_id:
                # Update internal ID
                data['id'] = new_id
                
                # Save with new ID as filename
                new_filename = f"{new_id}.json"
                new_path = os.path.join(novels_dir, new_filename)
                
                # Write back updated content
                with open(new_path, 'w', encoding='utf-8') as f:
                    json.dump(data, f, ensure_ascii=False, indent=2)
                
                # If the name actually changed, delete the old one
                if new_filename != filename:
                    os.remove(file_path)
                
                count += 1
            else:
                # If not in catalog, we can't safely rename it
                # But we might want to at least clean symbols from the ID?
                # For now, let's just log it.
                not_found += 1
        except Exception as e:
            print(f"Error processing {filename}: {e}")

    print(f"Finished! Processed/Renamed: {count}, Skipped (Bundled): {skipped}, Catalog Mismatch: {not_found}")

if __name__ == "__main__":
    clean_novels()
