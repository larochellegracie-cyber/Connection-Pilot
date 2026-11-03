"""
Draws ONE ready-made prop (see pilot_props.KINDS) as a still picture on a transparent background, cropped to the drawing. TRUSTED code (it runs no model-written
code). Usage: python -I pilot_still.py kind out.png [tint]. Prints one JSON line: {"ok": true, "width": w, "height": h}.
Used when a picture needs a product and the business has no photo of it: the drawing is placed on the design by the caller.
"""
import json
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

SIDE = 1100


def main():
    kind, out = sys.argv[1], sys.argv[2]
    tint = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3].startswith("#") else None
    from PIL import Image
    import pilot_canvas
    import pilot_props
    if kind not in pilot_props.KINDS:
        print(json.dumps({"ok": False, "errors": ["unknown prop " + kind]}))
        return 2
    video = types.SimpleNamespace(s=1.0, H=float(SIDE), safe_top=0.0, safe_bottom=float(SIDE), palette={}, allowed_text=[], _cache={})
    frame = Image.new("RGBA", (SIDE, SIDE), (0, 0, 0, 0))
    canvas = pilot_canvas.Canvas(video, frame)
    pilot_props.prop(canvas, kind, SIDE / 2.0, SIDE * 0.46, SIDE * 0.72, 1.0, 1.0, tint)
    # the faint edge of a clipped shadow would show as a pale rectangle: drop very faint pixels and ramp the rest
    r, g, b, a = frame.split()
    a = a.point(lambda v: 0 if v < 56 else min(255, int((v - 56) * 255 / 199.0)) if v < 255 else 255)
    frame = Image.merge("RGBA", (r, g, b, a))
    box = frame.getchannel("A").point(lambda v: 255 if v > 40 else 0).getbbox()
    if not box:
        print(json.dumps({"ok": False, "errors": ["nothing was drawn"]}))
        return 3
    pad = 12
    box = (max(0, box[0] - pad), max(0, box[1] - pad), min(SIDE, box[2] + pad), min(SIDE, box[3] + pad))
    frame.crop(box).save(out)
    print(json.dumps({"ok": True, "width": box[2] - box[0], "height": box[3] - box[1]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
