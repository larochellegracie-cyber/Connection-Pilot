"""
Draws ONE contact sheet of pictures, each in a labelled cell (A, B, C...), so a model can look at several candidate pictures in a single small image. TRUSTED code (it runs
no model-written code and never writes anywhere but the output path).
Usage: python -I pilot_sheet.py out.jpg font_dir cell_width cell_height columns picture1 picture2 ...
Prints ONE JSON line: {"ok": true, "shown": [indexes], "failed": [indexes]}.
"""
import json
import os
import sys

from PIL import Image, ImageDraw, ImageFont


def main():
    out, font_dir = sys.argv[1], sys.argv[2]
    cw, ch, cols = int(sys.argv[3]), int(sys.argv[4]), max(1, int(sys.argv[5]))
    paths = sys.argv[6:][:12]
    rows = (len(paths) + cols - 1) // cols
    try:
        font = ImageFont.truetype(os.path.join(font_dir, "inter-latin-800-normal.woff"), 34)
    except Exception:
        font = ImageFont.load_default()
    sheet = Image.new("RGB", (cols * cw, rows * ch), (16, 20, 24))
    draw = ImageDraw.Draw(sheet)
    shown, failed = [], []
    for i, path in enumerate(paths):
        x, y = (i % cols) * cw, (i // cols) * ch
        try:
            im = Image.open(path)
            im.load()
            im = im.convert("RGB")
            im.thumbnail((cw - 8, ch - 8))
            sheet.paste(im, (x + (cw - im.width) // 2, y + (ch - im.height) // 2))
            shown.append(i)
        except Exception:
            draw.text((x + 20, y + ch // 2), "unreadable", fill=(200, 200, 200), font=font)
            failed.append(i)
        draw.rectangle([x, y, x + cw - 1, y + ch - 1], outline=(70, 80, 90), width=2)
        draw.ellipse([x + 8, y + 8, x + 58, y + 58], fill=(20, 60, 180))
        draw.text((x + 33, y + 33), chr(65 + i), fill=(255, 255, 255), font=font, anchor="mm")
    sheet.save(out, quality=82)
    print(json.dumps({"ok": True, "shown": shown, "failed": failed}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
