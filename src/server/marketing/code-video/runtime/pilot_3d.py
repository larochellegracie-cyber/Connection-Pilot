"""
Depth and lighting for custom scenes: lit shapes with a light side and a shaded side (cylinders, spheres, glossy blocks), soft contact shadows, a studio set
(backdrop, floor, light pool, drifting out-of-focus lights) and a vignette. TRUSTED code: every function draws through the canvas's own plumbing (_blit,
_apply_alpha), is cheap enough to call several times per frame, and takes plain numbers and colour strings.
All positions are design units (the canvas is 1080 wide). Colours are "#RRGGBB".
"""
import math

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

from pilot_scenes import rgb


def _arr(color):
    return np.array(rgb(color), dtype=np.float32)


def _mix(a, b, k):
    return a + (b - a) * k


def _layer(arr, mask):
    """An RGBA layer from an (h, w, 3) float array and an 'L' mask image."""
    img = Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
    img.putalpha(mask)
    return img


def _soft_mask(size, painter, ss=2):
    big = Image.new("L", (size[0] * ss, size[1] * ss), 0)
    painter(ImageDraw.Draw(big), ss)
    return big.resize(size, Image.LANCZOS)


def gloss_rect(c, x, y, w, h, color, radius=0, top=0.3, bottom=0.25, alpha=1.0, sheen=0.35):
    """A rounded block lit from above: lighter at the top, darker at the bottom, with a soft sheen across its upper part."""
    c._count()
    s = c._v.s
    pw, ph = int(w * s), int(h * s)
    if pw < 2 or ph < 2 or alpha <= 0:
        return
    base = _arr(color)
    k = np.linspace(0, 1, ph, dtype=np.float32)[:, None, None]
    col = _mix(_mix(base, np.array([255.0] * 3, dtype=np.float32), top), np.array([0.0] * 3, dtype=np.float32), 0)[None, None, :] * (1 - k) + _mix(base, np.zeros(3, dtype=np.float32), bottom)[None, None, :] * k
    arr = np.broadcast_to(col, (ph, pw, 3)).copy()
    if sheen > 0:
        v = np.clip(1 - np.linspace(0, 1, ph, dtype=np.float32) / 0.45, 0, 1)[:, None, None] * sheen * 255 * 0.5
        arr = arr + v
    r = int(radius * s)
    mask = _soft_mask((pw, ph), lambda d, ss: d.rounded_rectangle([0, 0, pw * ss - 1, ph * ss - 1], radius=r * ss, fill=255))
    c._blit(c._apply_alpha(_layer(arr, mask), alpha), int(x * s), int(y * s))


def cylinder(c, cx, top_y, w, h, color, tilt=0.26, light=0.3, top_color=None, alpha=1.0, gloss=0.4):
    """
    A lit cylinder seen slightly from above (a cake tier, a cup, a can, a drum): `cx` the centre, `top_y` the centre of its top ellipse, `w` its width,
    `h` the height of its side, `tilt` how open the top ellipse is (0.15 flat-on to 0.5 from above), `light` where the light is across it (0 left, 1 right),
    `gloss` how bright the highlight stripe is. The top face is drawn lighter.
    """
    c._count()
    s = c._v.s
    pw, ph_side = int(w * s), int(h * s)
    ry = max(2, int(w * tilt / 2 * s))
    if pw < 4 or ph_side < 1 or alpha <= 0:
        return
    H = ph_side + 2 * ry + 2
    base = _arr(color)
    u = np.linspace(0, 1, pw, dtype=np.float32)[None, :, None]
    lum = 0.55 + 0.5 * np.cos((u - light) * math.pi * 0.95)
    edge = 1 - 0.4 * np.abs(2 * u - 1) ** 3
    side = base[None, None, :] * np.clip(lum * edge, 0.2, 1.25)
    if gloss > 0:
        side = side + 255 * gloss * np.exp(-(((u - (light * 0.8 + 0.1)) / 0.045) ** 2)) * 0.7
    arr = np.broadcast_to(side, (H, pw, 3)).copy()
    # the side's shape: a rectangle with the lower half of the bottom ellipse
    mask = _soft_mask((pw, H), lambda d, ss: (d.rectangle([0, ry * ss, pw * ss - 1, (ry + ph_side) * ss], fill=255), d.ellipse([0, (ph_side) * ss, pw * ss - 1, (ph_side + 2 * ry) * ss], fill=255)))
    img = _layer(arr, mask)
    # the top face
    tc = _arr(top_color) if top_color else _mix(base, np.array([255.0] * 3, dtype=np.float32), 0.28)
    face = Image.new("RGBA", (pw, 2 * ry), (0, 0, 0, 0))
    yy, xx = np.mgrid[0:2 * ry, 0:pw].astype(np.float32)
    g = np.clip(1 - np.hypot((xx - pw * (0.35 + 0.3 * light)) / (pw * 0.7), (yy - ry * 0.7) / (ry * 1.5)), 0, 1)[..., None]
    farr = tc[None, None, :] * (0.85 + 0.25 * g) + 255 * 0.12 * g
    fmask = _soft_mask((pw, 2 * ry), lambda d, ss: d.ellipse([0, 0, pw * ss - 1, 2 * ry * ss - 1], fill=255))
    face = _layer(farr, fmask)
    img.alpha_composite(face, (0, 0))
    rim = ImageDraw.Draw(img)
    rim.arc([1, 1, pw - 2, 2 * ry - 2], 190, 350, fill=(255, 255, 255, 90), width=max(1, int(s * 2)))
    c._blit(c._apply_alpha(img, alpha), int((cx - w / 2) * s), int((top_y - 0) * s) - ry)


def sphere(c, cx, cy, r, color, alpha=1.0, light=(-0.35, -0.45), shine=0.6):
    """A lit ball (a cherry, a bauble, a bubble): a highlight toward `light` and a shaded edge."""
    c._count()
    s = c._v.s
    d = int(2 * r * s)
    if d < 3 or alpha <= 0:
        return
    base = _arr(color)
    yy, xx = np.mgrid[0:d, 0:d].astype(np.float32)
    nx, ny = (xx - d / 2) / (d / 2), (yy - d / 2) / (d / 2)
    nz = np.sqrt(np.clip(1 - nx ** 2 - ny ** 2, 0, 1))
    lx, ly = light
    lz = math.sqrt(max(0.05, 1 - lx * lx - ly * ly))
    diff = np.clip(nx * lx + ny * ly + nz * lz, 0, 1)[..., None]
    spec = (np.clip(nx * lx + ny * ly + nz * lz, 0, 1) ** 24)[..., None] * 255 * shine
    arr = base[None, None, :] * (0.28 + 0.85 * diff) + spec
    mask = _soft_mask((d, d), lambda dr, ss: dr.ellipse([0, 0, d * ss - 1, d * ss - 1], fill=255))
    c._blit(c._apply_alpha(_layer(arr, mask), alpha), int((cx - r) * s), int((cy - r) * s))


def soft_shadow(c, cx, cy, rx, ry, alpha=0.4, blur=0.5, color="#000000"):
    """A soft contact shadow on the ground: an ellipse centred on (cx, cy), blurred by `blur` (0 sharp .. 1 very soft)."""
    c._count()
    s = c._v.s
    pad = int(max(rx, ry) * s * (0.3 + blur))
    w, h = int(2 * rx * s) + 2 * pad, int(2 * ry * s) + 2 * pad
    if w < 4 or h < 4 or w * h > 20_000_000 or alpha <= 0:
        return
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(img).ellipse([pad, pad, w - pad, h - pad], fill=rgb(color) + (255,))
    img = img.filter(ImageFilter.GaussianBlur(max(1, pad * 0.45 * (0.4 + blur))))
    c._blit(c._apply_alpha(img, alpha), int(cx * s - w / 2), int(cy * s - h / 2))


def floor(c, y, color_a, color_b, shine=0.25, spot_x=0.5):
    """A ground plane from `y` to the bottom of the frame: `color_a` at the horizon fading to `color_b` near the camera, with a pool of light at `spot_x`."""
    c._count()
    s = c._v.s
    w, h = c._img.size
    top = int(y * s)
    if top >= h:
        return
    key = ("floor", w, h, top, color_a, color_b)
    layer = c._v._cache.get(key)
    if layer is None:
        k = np.linspace(0, 1, h - top, dtype=np.float32)[:, None, None] ** 0.8
        arr = np.broadcast_to(_arr(color_a)[None, None, :] * (1 - k) + _arr(color_b)[None, None, :] * k, (h - top, w, 3)).copy()
        layer = c._v._cache[key] = _layer(arr, Image.new("L", (w, h - top), 255))
    c._blit(layer.copy(), 0, top)
    if shine > 0:
        c.glow(c.W * spot_x - 460, y - 120, 920, "#FFFFFF", shine * 0.5)


def vignette(c, strength=0.45):
    """Darkens the corners a little so the eye stays on the middle (call last)."""
    c._count()
    w, h = c._img.size
    key = ("vignette", w, h)
    base = c._v._cache.get(key)
    if base is None:
        yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
        d = np.hypot((xx - w / 2) / (w * 0.62), (yy - h / 2) / (h * 0.62))
        a = np.clip((d - 0.55) / 0.6, 0, 1) ** 1.6
        arr = np.zeros((h, w, 4), dtype=np.uint8)
        arr[..., 3] = (a * 255).astype(np.uint8)
        base = c._v._cache[key] = Image.fromarray(arr, "RGBA")
    c._blit(c._apply_alpha(base.copy(), max(0.0, min(1.0, strength))), 0, 0)


def bokeh(c, t, count=10, color="#FFFFFF", seed=1, strength=0.25, rise=24.0, region=(0.0, 0.0, 1.0, 0.7)):
    """Soft out-of-focus lights drifting at different depths (bigger ones are nearer and move faster): depth and sparkle behind a subject."""
    c._count()
    x0, y0, x1, y1 = region
    for i in range(int(max(0, min(24, count)))):
        r1, r2, r3 = ((math.sin(seed * 12.9898 + i * 78.233) * 43758.5453) % 1.0 + 1) % 1.0, ((math.sin(seed * 4.1414 + i * 12.9898) * 24634.6345) % 1.0 + 1) % 1.0, ((math.sin(seed * 9.1 + i * 3.7) * 9631.31) % 1.0 + 1) % 1.0
        depth = 0.35 + 0.65 * r3
        size = 70 + 200 * depth
        x = c.W * (x0 + (x1 - x0) * r1) + 40 * math.sin(t * (0.3 + depth) + i)
        y = c.H * (y0 + (y1 - y0) * r2) - (t * rise * depth) % (c.H * (y1 - y0) * 0.6) + 24 * math.cos(t * 0.5 + i)
        c.glow(x - size / 2, y - size / 2, size, color, strength * (0.4 + 0.6 * depth) * (0.6 + 0.4 * math.sin(t * 0.8 + i)))


def rays(c, t, x, color="#FFFFFF", strength=0.12, spread=0.5, count=5):
    """Soft beams of light falling from the top of the frame at x (design units), swaying slowly."""
    c._count()
    w, h = c._img.size
    sw, sh = max(8, w // 4), max(8, h // 4)
    layer = Image.new("RGBA", (sw, sh), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(int(count)):
        ang = (i - (count - 1) / 2) * spread * 0.32 + 0.08 * math.sin(t * 0.4 + i)
        x0 = x / c.W * sw
        x1 = x0 + math.tan(ang) * sh * 1.2
        half = sw * 0.035 * (0.7 + 0.5 * math.sin(t * 0.6 + i * 2) ** 2)
        d.polygon([(x0 - half * 0.3, 0), (x0 + half * 0.3, 0), (x1 + half * 2.2, sh), (x1 - half * 2.2, sh)], fill=rgb(color) + (int(255 * strength),))
    layer = layer.filter(ImageFilter.GaussianBlur(max(1, sw // 28))).resize((w, h), Image.BICUBIC)
    c._blit(layer, 0, 0)


def studio(c, t, bg_a=None, bg_b=None, glow=None, floor_y=0.68, spot_x=0.5, light_rays=True, lights=9):
    """
    A whole set in one call: a graded backdrop, soft beams of light, a glow behind the subject, a floor with a pool of light, and drifting out-of-focus lights.
    Colours default to the video's palette. Draw your subject after it (on the floor at floor_y), then call c.vignette() last.
    """
    p = c.palette
    a, b = bg_a or p.bg_a, bg_b or p.bg_b
    wall = '#%02X%02X%02X' % tuple(int(x + (y - x) * 0.22) for x, y in zip(_arr(a), _arr(b)))   # the wall stays its own colour down to the floor
    c.gradient(a, wall, 90)
    if light_rays:
        rays(c, t, c.W * spot_x, glow or p.glow, 0.10)
    c.glow(c.W * spot_x - 700, c.H * floor_y - 900, 1400, glow or p.glow, 0.34)
    bokeh(c, t, lights, glow or p.glow2, seed=3, strength=0.22)
    # the floor is the set's own floor colour, a little darker toward the camera
    fa = _arr(b)
    fb = '#%02X%02X%02X' % tuple(int(v * 0.86) for v in fa)
    floor(c, c.H * floor_y, b, fb, 0.3, spot_x)
