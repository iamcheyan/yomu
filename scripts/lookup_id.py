import requests
import re
import sys
import json

def get_file_id(author_id, work_id):
    """
    Find the file ID in the aozorahack/aozorabunko_text GitHub repository.
    The file ID is usually in the format {work_id}_ruby_{number}.
    """
    # Use the GitHub API to list the directory contents
    api_url = f"https://api.github.com/repos/aozorahack/aozorabunko_text/contents/cards/{author_id}/files"
    
    try:
        response = requests.get(api_url, timeout=10)
        if response.status_code != 200:
            if response.status_code == 404:
                print(f"Error: Author directory for '{author_id}' not found on GitHub.")
            else:
                print(f"Error: GitHub API returned status {response.status_code}")
            return None
        
        files = response.json()
        
        # We look for a directory name that starts with "{work_id}_"
        # We prefer "ruby" versions over "txt" versions.
        candidates = [f.get("name", "") for f in files if f.get("type") == "dir"]
        
        ruby_matches = [c for c in candidates if c.startswith(f"{work_id}_ruby_")]
        txt_matches = [c for c in candidates if c.startswith(f"{work_id}_txt_")]
        
        if ruby_matches:
            # Usually there's only one, but if multiple, pick the last one (often the newest)
            return sorted(ruby_matches)[-1]
        elif txt_matches:
            return sorted(txt_matches)[-1]
        
        return None
        
    except Exception as e:
        print(f"Connection error: {e}")
        return None

def extract_ids(input_str):
    """
    Extract author_id and work_id from various input formats.
    - URL: https://www.aozora.gr.jp/cards/000879/card127.html
    - Path: 000879/127
    """
    # Try URL pattern
    match = re.search(r'cards/(\d+)/card(\d+)\.html', input_str)
    if match:
        return match.group(1), match.group(2)
    
    # Try simple ID pattern: 000879/127
    match = re.search(r'(\d+)/(\d+)', input_str)
    if match:
        return match.group(1), match.group(2)
        
    return None, None

def main():
    print("=== Aozora Bunko File ID Lookup ===")
    
    if len(sys.argv) < 2:
        print("\nUsage:")
        print("  python scripts/lookup_id.py <aozora_card_url>")
        print("  python scripts/lookup_id.py <author_id>/<work_id>")
        print("\nExample:")
        print("  python scripts/lookup_id.py https://www.aozora.gr.jp/cards/000879/card127.html")
        sys.exit(1)
    
    input_val = sys.argv[1]
    author_id, work_id = extract_ids(input_val)
    
    if not author_id or not work_id:
        print(f"\nError: Could not parse IDs from '{input_val}'")
        print("Format should be a URL like '.../cards/000879/card127.html' or '000879/127'")
        sys.exit(1)
        
    # Ensure IDs are padded with zeros if necessary (Aozora uses 6 digits for author usually)
    author_id = author_id.zfill(6)
    
    print(f"\nTarget Author ID: {author_id}")
    print(f"Target Work ID:   {work_id}")
    print("Checking aozorahack/aozorabunko_text repository...")
    
    file_id = get_file_id(author_id, work_id)
    
    if file_id:
        print(f"\n[SUCCESS]")
        print(f"File ID found: {file_id}")
        print("-" * 30)
        print(f"Author ID: {author_id}")
        print(f"File ID:   {file_id}")
        print("-" * 30)
        print(f"Data for sync_books.py entry:")
        print(f'("{work_id}", "Title", "Author", "{author_id}", "{file_id}", "Description")')
    else:
        print("\n[FAILED]")
        print(f"No directory matching '{work_id}_ruby_*' or '{work_id}_txt_*' found for author {author_id}.")
        print("Please verify the work ID on aozora.gr.jp.")

if __name__ == "__main__":
    main()
