from PIL import Image, ImageDraw, ImageFont
import os

def generate_icon(size, filename):
    # Create a white image
    img = Image.new('RGBA', (size, size), (255, 255, 255, 255))
    draw = ImageDraw.Draw(img)
    
    # Try to find a Japanese font
    font_paths = [
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/truetype/noto/NotoSansCJK-Bold.ttc",
        "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc",
        "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf"
    ]
    
    font = None
    for p in font_paths:
        if os.path.exists(p):
            try:
                font = ImageFont.truetype(p, int(size * 0.7))
                break
            except:
                continue
    
    # Draw character "よ"
    text = "よ"
    if font:
        # Use getbbox for newer PIL versions
        try:
            bbox = draw.textbbox((0, 0), text, font=font)
            w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
        except AttributeError:
            w, h = draw.textsize(text, font=font)
            
        draw.text(((size - w) / 2, (size - h) / 2 - size * 0.05), text, fill=(0, 0, 0, 255), font=font)
    else:
        # Fallback if no font found
        draw.text((size // 4, size // 4), text, fill=(0, 0, 0, 255))

    # Draw border
    border_width = max(1, size // 64)
    draw.rectangle([border_width, border_width, size - border_width, size - border_width], 
                   outline=(0, 0, 0, 255), width=border_width)

    img.save(filename)
    print(f"Generated {filename}")

# Generate for different densities
base_dir = "android/app/src/main/res"
densities = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192
}

for folder, size in densities.items():
    path = os.path.join(base_dir, folder)
    os.makedirs(path, exist_ok=True)
    generate_icon(size, os.path.join(path, "ic_launcher.png"))
    generate_icon(size, os.path.join(path, "ic_launcher_round.png"))

# Also generate for web
os.makedirs("assets", exist_ok=True)
generate_icon(512, "assets/app_icon.png")
