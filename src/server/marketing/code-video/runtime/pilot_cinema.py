"""
Cinematic motion and light for custom scenes: a real camera (push, pull, pans, tilts, orbit with a little roll, handheld), rack focus (a band of sharpness that
moves across the picture), animated water caustics, drifting light leaks and foreground dust at several depths. TRUSTED code: every function draws through the
canvas's own plumbing, takes plain numbers and colour strings, and is cheap enough to call every frame.
"""
import math

import numpy as np
from PIL import Image, ImageFilter

from pilot_scenes import rgb

def safe_box(cx, cy, cw, ch, iw, ih):
    """A crop box of cw x ch centred near (cx, cy) that always lies inside an iw x ih picture (rounding can otherwise put an edge a hair outside, which the resize refuses)."""
    cw, ch = max(1.0, min(float(cw), float(iw))), max(1.0, min(float(ch), float(ih)))
    left = max(0.0, min(cx - cw / 2.0, iw - cw))
    top = max(0.0, min(cy - ch / 2.0, ih - ch))
    return (left, top, min(float(iw), left + cw), min(float(ih), top + ch))


MOVES = ("push", "pull", "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit", "handheld", "drift")


def _lerp(a, b, k):
    return a + (b - a) * k


def _noise(seed, t):
    """Smooth repeatable drift between -1 and 1."""
    return 0.55 * math.sin(t * 1.3 + seed * 12.9898) + 0.3 * math.sin(t * 2.9 + seed * 78.233) + 0.15 * math.sin(t * 5.1 + seed * 3.7)


def camera(c, name, u, move="push", amount=1.0, t=0.0, tint=None, tint_alpha=0.0, bright=1.0, focus_y=None, blur=16.0, band=0.2, zoom=1.0, at=None):
    """
    A moving camera over one photo, filling the whole frame. u is the scene progress 0..1, t the seconds into the scene. `move` is one of push, pull, pan_left,
    pan_right, tilt_up, tilt_down, orbit (a slow push with a little roll), handheld (a living, slightly shaky shot) or drift (a slow diagonal). `amount` 0.3..2 scales it.
    focus_y (0..1 down the frame) keeps a band of the picture sharp and softens the rest (blur, in design units): change it over time to pull focus.
    zoom (1 to 3) is the crop: 1 is the whole picture, 1.3 medium, 1.8 tight, 2.5 macro; the move happens on top of it.
    at=(x, y) (0..1 across, 0..1 down) aims the shot so that point of the picture, where its subject is, stays near the middle.
    """
    c._count()
    v, s = c._v, c._s
    a = max(0.2, min(2.0, float(amount)))
    k = max(0.0, min(1.0, float(u)))
    mz, px, py, rot = 1.1, 0.0, 0.0, 0.0
    if move == "pull":
        mz, px = _lerp(1.12 + 0.3 * a, 1.08, k), _lerp(0.25, -0.25, k) * a
    elif move == "pan_left":
        mz, px = 1.2 + 0.05 * a, _lerp(0.9, -0.9, k)
    elif move == "pan_right":
        mz, px = 1.2 + 0.05 * a, _lerp(-0.9, 0.9, k)
    elif move == "tilt_up":
        mz, py = 1.2 + 0.05 * a, _lerp(0.9, -0.9, k)
    elif move == "tilt_down":
        mz, py = 1.2 + 0.05 * a, _lerp(-0.9, 0.9, k)
    elif move == "orbit":
        mz, px, rot = _lerp(1.1, 1.1 + 0.28 * a, k), _lerp(-0.5, 0.5, k) * a, _lerp(-2.6, 2.6, k) * a
    elif move == "handheld":
        mz, px, py, rot = 1.14 + 0.1 * a * k, 0.18 * a * _noise(1, t), 0.12 * a * _noise(2, t), 0.7 * a * _noise(3, t)
    elif move == "drift":
        mz, px, py = _lerp(1.12, 1.12 + 0.18 * a, k), _lerp(-0.6, 0.6, k), _lerp(0.4, -0.4, k)
    else:  # push
        mz, px, py = _lerp(1.04, 1.04 + 0.26 * a, k), _lerp(-0.12, 0.12, k) * a, _lerp(0.08, -0.08, k) * a
    crop = max(1.0, min(3.0, float(zoom)))
    c._cam_info.append({"move": move, "zoom": crop, "at": at is not None})
    c._photo_names.append(name)
    # the crop multiplies the move's own zoom; aiming at the subject shifts the view toward it (more as the crop gets tighter, because there is more picture to move across)
    mz = mz * crop
    if at is not None:
        try:
            ax, ay = float(at[0]), float(at[1])
        except Exception:
            ax, ay = 0.5, 0.5
        reach = min(1.0, 0.45 + 0.35 * (crop - 1.0))
        px += max(-1.0, min(1.0, (ax - 0.5) * 2.0)) * reach
        py += max(-1.0, min(1.0, (ay - 0.5) * 2.0)) * reach
    pw, ph = c._img.size
    src = v.photo_source(name)
    iw, ih = src.size
    # the roll needs a larger picture to turn inside the frame: the zoom is kept above that
    roll = abs(math.sin(math.radians(rot))) * (max(pw, ph) / float(min(pw, ph))) + abs(math.cos(math.radians(rot)))
    mz = max(1.0, min(5.0, max(mz, roll)))
    scale0 = max(pw / float(iw), ph / float(ih))
    cw, ch = pw / (scale0 * mz) * roll, ph / (scale0 * mz) * roll
    cw, ch = min(cw, iw), min(ch, ih)
    cx = iw / 2.0 + max(-1.0, min(1.0, px)) * max(0.0, (iw - cw) / 2.0)
    cy = ih / 2.0 + max(-1.0, min(1.0, py)) * max(0.0, (ih - ch) / 2.0)
    big = (int(pw * roll), int(ph * roll)) if rot else (pw, ph)
    view = src.resize(big, Image.BILINEAR, box=safe_box(cx, cy, cw, ch, iw, ih))
    if rot:
        view = view.rotate(rot, Image.BICUBIC)
        left, top = (view.width - pw) // 2, (view.height - ph) // 2
        view = view.crop((left, top, left + pw, top + ph))
    if focus_y is not None:
        soft = view.resize((max(8, pw // 4), max(8, ph // 4)), Image.BILINEAR).filter(ImageFilter.GaussianBlur(max(0.5, float(blur) * s / 4.0))).resize((pw, ph), Image.BICUBIC)
        ys = np.linspace(0.0, 1.0, ph, dtype=np.float32)[:, None]
        m = np.clip((np.abs(ys - float(focus_y)) - float(band)) / 0.3, 0.0, 1.0)
        mask = Image.fromarray((np.repeat(m, pw, axis=1) * 255).astype(np.uint8), "L")
        view = Image.composite(soft, view, mask)
    if bright != 1.0:
        view = Image.eval(view, lambda p: min(255, int(p * max(0.0, min(3.0, bright)))))
    if tint and tint_alpha:
        view = Image.blend(view, Image.new("RGB", view.size, rgb(tint)), max(0.0, min(1.0, tint_alpha)))
    c._photos += 1
    gx, gy = c._offset[-1]
    c._photo_boxes.append((gx, gy, gx + c.W, gy + c.H, c._alphas[-1]))
    c._blit(c._apply_alpha(view.convert("RGBA"), 1.0), 0, 0)


def _screen_layer(c, field, color, strength):
    """Puts a 0..1 light field (low resolution) over the frame as soft light in `color`."""
    w, h = c._img.size
    r, g, b = rgb(color)
    arr = np.zeros(field.shape + (4,), dtype=np.uint8)
    arr[..., 0], arr[..., 1], arr[..., 2] = r, g, b
    arr[..., 3] = (np.clip(field * strength, 0.0, 1.0) * 255).astype(np.uint8)
    c._blit(Image.fromarray(arr, "RGBA").resize((w, h), Image.BICUBIC), 0, 0)


def caustics(c, t, strength=0.28, color="#BDEFFF", scale=1.0, speed=1.0, top=0.0):
    """Animated water light (the bright net that dances on a pool floor and walls), drawn over everything so far. `top` (0..1) is where it starts down the frame; it fades in from there."""
    c._count()
    w, h = c._img.size
    sw, sh = max(16, w // 4), max(16, h // 4)
    xs = np.linspace(0.0, 1.0, sw, dtype=np.float32)[None, :]
    ys = np.linspace(0.0, h / float(w), sh, dtype=np.float32)[:, None]
    f, tt = 22.0 * max(0.3, float(scale)), t * float(speed)
    v1 = np.sin(xs * f + tt * 0.9 + 2.2 * np.sin(ys * f * 0.8 - tt * 0.6))
    v2 = np.sin(ys * f * 1.15 - tt * 0.7 + 2.0 * np.sin(xs * f * 0.9 + tt * 0.5))
    v3 = np.sin((xs + ys) * f * 0.7 + tt * 0.4)
    ridge = np.clip(1.0 - np.abs(v1 + v2 + 0.6 * v3) / 1.2, 0.0, 1.0) ** 5
    fall = np.clip((np.linspace(0.0, 1.0, sh, dtype=np.float32)[:, None] - float(top)) / 0.25, 0.0, 1.0)
    _screen_layer(c, ridge * fall, color, float(strength) * 2.2)


def light_leak(c, t, color="#FFB35A", strength=0.4, speed=0.35, width=0.28, phase=0.0):
    """A warm film light leak: a soft tilted band of colour that drifts across the frame and breathes. Use one per scene, then the next scene a different `phase`."""
    c._count()
    w, h = c._img.size
    sw, sh = max(16, w // 6), max(16, h // 6)
    xs = np.linspace(0.0, 1.0, sw, dtype=np.float32)[None, :]
    ys = np.linspace(0.0, 1.0, sh, dtype=np.float32)[:, None]
    pos = -0.3 + ((t * float(speed) + float(phase)) % 1.6)
    d = (xs + 0.35 * ys) - pos
    band = np.exp(-(d / max(0.05, float(width))) ** 2)
    breathe = 0.75 + 0.25 * math.sin(t * 1.7 + phase * 6.0)
    _screen_layer(c, band * breathe, color, float(strength))


def dust(c, t, count=34, seed=3, strength=0.55, color="#FFFFFF", speed=1.0):
    """Specks of light drifting at different depths (near ones bigger, brighter and faster): a foreground layer that makes the picture feel deep."""
    c._count()
    w, h = c._img.size
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    from PIL import ImageDraw
    d = ImageDraw.Draw(layer)
    r, g, b = rgb(color)
    n = max(1, min(80, int(count)))
    for i in range(n):
        a1 = (math.sin((i + 1) * 12.9898 + seed * 4.1) * 43758.5453) % 1.0
        a2 = (math.sin((i + 1) * 78.233 + seed * 1.7) * 24634.6345) % 1.0
        a3 = (math.sin((i + 1) * 39.346 + seed * 9.3) * 12345.6789) % 1.0
        depth = 0.25 + 0.75 * a3
        x = (a1 * w + t * 26.0 * depth * float(speed) + 30 * math.sin(t * 0.6 + i)) % w
        y = (a2 * h - t * 46.0 * depth * float(speed)) % h
        rad = (1.2 + 4.6 * depth) * c._s
        alpha = int(255 * min(1.0, float(strength)) * (0.25 + 0.75 * depth) * (0.6 + 0.4 * math.sin(t * 1.8 + i * 2.0)))
        d.ellipse([x - rad, y - rad, x + rad, y + rad], fill=(r, g, b, max(0, alpha)))
    c._blit(layer.filter(ImageFilter.GaussianBlur(max(0.6, 1.1 * c._s))), 0, 0)
