import os
import glob

def cleanup():
    target_dir = "data/novels/"
    if not os.path.exists(target_dir):
        print(f"Directory {target_dir} does not exist.")
        return

    files = glob.glob(os.path.join(target_dir, "*.json"))
    print(f"Found {len(files)} files in {target_dir}")

    for f in files:
        basename = os.path.basename(f)
        # Check if the filename (without .json) is a number
        # Old files like 'rashomon.json' are not numeric
        name_only = os.path.splitext(basename)[0]
        
        # We delete all non-numeric files because they are likely from the old, 
        # less robust sync logic.
        if not name_only.isdigit():
            print(f"Deleting old/incomplete file: {basename}")
            os.remove(f)
        else:
            # For numeric files, we could check their size or content,
            # but usually they are from the new system.
            # However, since the user wants a "fresh start", we might want to 
            # delete them too if we want to be 100% sure.
            # For now, let's just keep numeric ones.
            pass

    print("Cleanup complete.")

if __name__ == "__main__":
    cleanup()
