import re
import os

CSS_PATH = "/home/tetsuya/Development/yomu/css/style.css"

def deep_clean_css():
    if not os.path.exists(CSS_PATH):
        return

    with open(CSS_PATH, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    new_lines = []
    skip_keywords = [':hover', 'transition:', 'animation:', 'scroll-behavior:', '@keyframes', 'spin {']
    
    in_invalid_block = False
    brace_depth = 0
    
    for line in lines:
        stripped = line.strip()
        
        # Track braces
        brace_depth += stripped.count('{')
        brace_depth -= stripped.count('}')
        
        # Check if line should be skipped based on keywords
        if any(k in stripped for k in skip_keywords):
            # If it's a selector line with {, we might be entering an invalid block
            if '{' in stripped:
                in_invalid_block = True
            continue
            
        # If we were in an invalid block (like a hover block whose selector was skipped)
        # we skip until we find the closing brace that returns depth to 0 or same level.
        # But wait, if we skipped the selector line, depth didn't increase in our count.
        # Let's use a simpler logic.
        
    # Better logic:
    content = "".join(lines)
    
    # 1. Remove all blocks with :hover
    # Handle multi-line selectors
    content = re.sub(r'[^{}\n]*:hover[^{}]*\{[^{}]*\}', '', content, flags=re.DOTALL)
    
    # 2. Remove all @keyframes
    content = re.sub(r'@keyframes\s+\w+\s*\{[^{}]*\}', '', content, flags=re.DOTALL)
    content = re.sub(r'@-webkit-keyframes\s+\w+\s*\{[^{}]*\}', '', content, flags=re.DOTALL)
    
    # 3. Remove orphaned property lines (caused by manual deletion of selectors)
    # A property line usually looks like:  prop: value;
    # If it's NOT inside a { ... } block, it's garbage.
    
    def strip_bad_lines(text):
        output = []
        depth = 0
        for line in text.split('\n'):
            s = line.strip()
            if not s:
                output.append(line)
                continue
            
            # Check for property-like line
            is_prop = ':' in s and ';' in s
            
            if '{' in s:
                depth += s.count('{')
                output.append(line)
            elif '}' in s:
                if depth > 0:
                    depth -= s.count('}')
                    output.append(line)
                # else: orphaned brace, skip
            elif depth == 0 and is_prop:
                # Discard property outside block
                continue
            else:
                output.append(line)
        return "\n".join(output)

    content = strip_bad_lines(content)
    
    # 4. Final sweep for transition/animation
    content = re.sub(r'\s*(transition|animation|scroll-behavior)\s*:[^;!]+(!important)?\s*;', '', content, flags=re.IGNORECASE)

    # 5. Global base rules (No animation blockers, just reset)
    base = """* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    -webkit-tap-highlight-color: transparent !important;
}

:root {
    --base-font-size: 20px;
    --line-height: 2.2;
    --primary-color: #000;
    --primary-dark: #333;
    --highlight-bg: #eee;
    --highlight-border: #999;
    --vocab-bg: #f5f5f5;
    --vocab-border: #999;
}
"""
    # Remove the first block if it's the one we added
    content = re.sub(r'^\* \{.*?\}', '', content, flags=re.DOTALL)
    # Remove our global hover blockers
    content = re.sub(r'/\* Global No-Interaction Styles for E-Ink \*/.*?\}', '', content, flags=re.DOTALL)
    # Remove the broken :root or duplicated ones at start
    content = re.sub(r'^:root \{.*?\}', '', content, flags=re.DOTALL | re.MULTILINE)

    final_content = base + "\n" + content.strip()

    with open(CSS_PATH, 'w', encoding='utf-8') as f:
        f.write(final_content)
    
    print("CSS Programmatically Purified.")

if __name__ == "__main__":
    deep_clean_css()
