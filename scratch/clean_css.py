import re
import os

CSS_PATH = "/home/tetsuya/Development/yomu/css/style.css"

def clean_css():
    if not os.path.exists(CSS_PATH):
        return

    with open(CSS_PATH, 'r', encoding='utf-8') as f:
        content = f.read()

    # 1. Remove all @keyframes
    content = re.sub(r'@keyframes\s+\w+\s*\{[^{}]*\}', '', content, flags=re.DOTALL)
    
    # 2. Remove all blocks that have :hover in the selector
    # This is tricky for nested or comma-separated selectors, but let's try
    # We find blocks by matching selectors followed by { ... }
    def remove_hover_blocks(match):
        selector = match.group(1)
        if ':hover' in selector:
            return ''
        return match.group(0)

    # Simple block matcher (doesn't handle nested {} well, but CSS usually doesn't have them except media queries)
    content = re.sub(r'([^{}\n]+)\{[^{}]*\}', remove_hover_blocks, content, flags=re.DOTALL)

    # 3. Remove transition and animation properties from remaining blocks
    content = re.sub(r'\s*(transition|animation|scroll-behavior)\s*:[^;!]+(!important)?\s*;', '', content, flags=re.IGNORECASE)

    # 4. Cleanup empty blocks
    content = re.sub(r'([^{}\n]+)\{\s*\}', '', content, flags=re.DOTALL)

    # 5. Add back the global safety rules at the top
    safety_rules = """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent !important;
    transition: none !important;
    animation: none !important;
}

/* Global No-Interaction Styles for E-Ink */
@media (hover: hover) {
    *:hover {
        background-color: inherit !important;
        color: inherit !important;
        transform: none !important;
        box-shadow: none !important;
        text-decoration: none !important;
    }
}
"""
    # Remove existing global rules if any (to avoid duplication)
    content = re.sub(r'\* \{[^}]*transition: none !important;[^}]*\}', '', content, flags=re.DOTALL)
    
    final_content = safety_rules + "\n" + content

    with open(CSS_PATH, 'w', encoding='utf-8') as f:
        f.write(final_content)
    
    print("CSS Cleaned up.")

if __name__ == "__main__":
    clean_css()
