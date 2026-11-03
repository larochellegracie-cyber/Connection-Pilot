"""
Motion-graphics kit for custom scenes: the invented pieces of a clean product-explainer or an offer post, drawn rather than photographed. Task chips and a swarm of them,
cards with a header, form fields that type themselves, schedule rows, status pills, buttons with a clicking cursor, check and cross marks, number badges, a counter that
rolls up to a number, an animated gradient card, a head-and-shoulders silhouette. TRUSTED code: everything draws through the canvas's own plumbing, takes plain numbers,
strings and colour strings, and every word it draws still goes through the canvas's rule that text comes from the business's own words (a counter's target must be one of them).
All positions are design units (the canvas is 1080 wide). The words inside these pieces are the piece's own small type, so the layout check does not measure them.
"""
import math

import numpy as np
from PIL import Image

from pilot_scenes import lerp, rgb, rounded

INK = "#0B1F44"
MUTED = "#64748B"
LINE = "#E2E8F0"
FIELD = "#F3F5FA"
RED = "#D14343"
GREEN = "#1E9E5A"


def _clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def _ease(k):
    k = _clamp(k)
    return 1 - (1 - k) ** 3


def _p(t, start, dur):
    return _ease((t - start) / max(0.05, dur))


class _Quiet(object):
    """While the kit draws its own small type, the layout check does not measure it."""

    def __init__(self, c):
        self.c = c

    def __enter__(self):
        self.was = getattr(self.c, "_quiet", False)
        self.c._quiet = True

    def __exit__(self, *exc):
        self.c._quiet = self.was
        return False


def chip(c, text, cx, cy, size=30, tone="plain", rot=0.0, alpha=1.0, scale=1.0, lead=0.0):
    """A pill-shaped label (a task, a tag, a status) centred on (cx, cy). tone: plain (white), hot (red), soft (pale blue), accent (brand colour), dark. `lead` leaves room on the left for a dot. Returns (width, height)."""
    p = c.palette
    with _Quiet(c):
        tw = c.text_width(text, size, 700)
        w, h, m = tw + size * 1.5 + lead, size * 1.9, 36
        fill, ink = {"plain": ("#FFFFFF", INK), "hot": ("#FFE3E3", "#B42318"), "soft": ("#E6EDFF", "#1E3A9E"), "accent": (p["accent"], p["on_accent"]), "dark": ("#1A2550", "#E8EEFF")}.get(tone, ("#FFFFFF", INK))
        if alpha > 0.01:
            c.push(cx - w / 2 - m, cy - h / 2 - m, w + 2 * m, h + 2 * m, alpha, scale, rot)
            c.shadow_rect(m, m, w, h, fill, radius=h / 2, blur=14, offset=8, shadow=0.22 if tone != "dark" else 0.4)
            c.text(text, m + lead + (w - lead) / 2, m + (h - size * 1.1) / 2, size, 700, ink, align="center", width=w + 80)
            c.pop()
    return w, h


def card(c, x, y, w, h, title="", tag="", alpha=1.0, dark=False):
    """A clean app card with a soft shadow, a bold title on the left, a small tag on the right and a hairline under them. Returns the y where its content starts."""
    fill, ink, sub = ("#111B3D", "#FFFFFF", "#9FB0D8") if dark else ("#FFFFFF", INK, MUTED)
    with _Quiet(c):
        c.shadow_rect(x, y, w, h, fill, radius=34, blur=36, offset=18, shadow=0.16 if not dark else 0.4, alpha=alpha)
        if title:
            c.text(title, x + 38, y + 30, 38, 800, ink, alpha=alpha, width=w - 200)
        if tag:
            c.text(tag, x + w - 38, y + 40, 26, 400, sub, align="right", alpha=alpha, width=240)
        if title or tag:
            c.rect(x + 38, y + 96, w - 76, 2, "#26335F" if dark else LINE, alpha=alpha)
    return y + 128


def field(c, x, y, w, label, value, t, start=0.0, speed=18.0, active=False, alpha=1.0):
    """A form field: a small label, an input box and `value` typed into it from `start` seconds at `speed` letters a second, with a blinking caret. Returns the y for the next field."""
    p = c.palette
    typed = value[: int(max(0.0, t - start) * speed)] if t >= start else ""
    typing = t >= start and len(typed) < len(value)
    with _Quiet(c):
        c.text(label, x, y, 26, 400, MUTED, alpha=alpha, width=w)
        c.rect(x, y + 38, w, 74, FIELD, radius=18, alpha=alpha, stroke=3 if (typing or active) else 2, stroke_color=p["accent"] if (typing or active) else LINE)
        if typed:
            c.text(typed, x + 24, y + 38 + 17, 36, 400, INK, alpha=alpha, width=w - 48)
        if (typing or active) and int(t * 2.2) % 2 == 0:
            c.rect(x + 24 + (c.text_width(typed, 36, 400) if typed else 0) + 3, y + 38 + 16, 3, 42, p["accent"], alpha=alpha)
    return y + 112 + 30


def row(c, x, y, w, left, right, t, start=0.0, alpha=1.0):
    """A schedule row that slides in: a small time on the left, a pale block with a brand-colour bar and its label."""
    p = c.palette
    k = _p(t, start, 0.7)
    if k <= 0.01:
        return y + 84
    ox = (1 - k) * 70
    with _Quiet(c):
        c.text(left, x + ox, y + 16, 30, 400, MUTED, alpha=alpha * k, width=120)
        c.rect(x + 130 + ox, y, w - 130, 72, "#E4ECFF", radius=14, alpha=alpha * k)
        c.rect(x + 130 + ox, y, 7, 72, p["accent"], radius=3, alpha=alpha * k)
        c.text(right, x + 160 + ox, y + 16, 34, 700, INK, alpha=alpha * k, width=w - 190)
    return y + 84


def pill(c, text, cx, cy, t, start=0.0, size=24, tone="soft"):
    """A small status pill with a pulsing dot ('writing...'), which pops in at `start`."""
    k = _p(t, start, 0.5)
    if k <= 0.01:
        return
    p = c.palette
    w, h = chip(c, text, cx, cy, size, tone, 0.0, k, 0.9 + 0.1 * k, lead=size * 1.1)
    with _Quiet(c):
        c.circle(cx - w / 2 + size * 1.2, cy, size * (0.3 + 0.08 * math.sin(t * 6)), p["accent"], alpha=k)


def button(c, x, y, w, label, k=1.0, press=0.0):
    """A full-width brand-colour button; `press` (0..1) dips it as if clicked."""
    p = c.palette
    inset = 6 * press
    with _Quiet(c):
        c.shadow_rect(x + inset, y + inset, w - 2 * inset, 96 - 2 * inset, p["accent"], radius=48, blur=16, offset=10, shadow=0.22 * (1 - press), alpha=k)
        c.text(label, x + w / 2, y + 27, 38, 800, p["on_accent"], align="center", alpha=k, width=w - 60)


def cursor(c, x, y, k=1.0, press=0.0, size=1.0):
    """A mouse pointer at (x, y); `press` (0..1) shows a click ripple."""
    p = c.palette
    if k <= 0.01:
        return
    pts = [(0, 0), (0, 40), (10, 31), (17, 46), (25, 42), (18, 28), (31, 28)]
    c.polygon([(x + a * size * 1.12 - 1, y + b * size * 1.12 - 1) for a, b in pts], "#0B1F44", alpha=k)
    c.polygon([(x + a * size, y + b * size) for a, b in pts], "#FFFFFF", alpha=k)
    if press > 0.01:
        c.circle(x, y, 14 + 54 * press, p["accent"], alpha=0.5 * (1 - press), stroke=5)


def mark(c, kind, x, y, size=46, k=1.0):
    """A ✕ (kind "no": red ring and cross) or a ✓ (kind "yes": green disc and tick), its top-left at (x, y), popping in as k goes 0..1."""
    if k <= 0.01:
        return
    r, cx, cy = size / 2 * (0.4 + 0.6 * _ease(k)), x + size / 2, y + size / 2
    if kind == "yes":
        c.circle(cx, cy, r, GREEN, alpha=_clamp(k * 1.5))
        c.icon("tick", cx - r * 0.55, cy - r * 0.55, r * 1.1, "#FFFFFF", None, alpha=_clamp(k * 1.5))
    else:
        c.circle(cx, cy, r, RED, alpha=_clamp(k * 1.5), stroke=4)
        d = r * 0.38
        c.line(cx - d, cy - d, cx + d, cy + d, RED, 5, alpha=_clamp(k * 1.5))
        c.line(cx - d, cy + d, cx + d, cy - d, RED, 5, alpha=_clamp(k * 1.5))


def badge(c, n, x, y, size=44, k=1.0):
    """A numbered brand-colour dot (a step marker); n is the number as text."""
    p = c.palette
    if k <= 0.01:
        return
    r = size / 2 * (0.4 + 0.6 * _ease(k))
    c.circle(x + size / 2, y + size / 2, r, p["accent"], alpha=_clamp(k * 1.5))
    with _Quiet(c):
        c.text(str(n), x + size / 2, y + size * 0.2, size * 0.58, 800, p["on_accent"], align="center", alpha=_clamp(k * 1.5), width=size)


def counter(c, target, x, y, t, start=0.0, dur=2.2, size=120, color="#FFFFFF", align="center", weight=800):
    """A number that rolls up from zero to `target` (a number written in the brief, such as "20" or "1,200", with any $ % or + around it), fast at first and slowing into place."""
    c._check_text(target)
    s = str(target)
    i = 0
    while i < len(s) and not s[i].isdigit():
        i += 1
    j = len(s)
    while j > i and not s[j - 1].isdigit():
        j -= 1
    pre, body, post = s[:i], s[i:j], s[j:]
    digits = body.replace(",", "")
    k = _ease((t - start) / max(0.05, dur))
    commas, dec = "," in body, ("." in digits)
    value = float(digits or 0) * k
    shown = ("%.*f" % (len(digits.split(".")[1]) if dec else 0, value)) if dec else str(int(round(value)))
    if commas:
        head, _, tail = shown.partition(".")
        shown = "{:,}".format(int(head)) + ("." + tail if tail else "")
    prev = getattr(c, "_skip_check", False)
    c._skip_check = True
    try:
        c.text(pre + shown + post, x, y, size, weight, color, align=align, width=1000)
    finally:
        c._skip_check = prev


def mesh(c, x, y, w, h, colors, t, radius=44, alpha=1.0):
    """A soft animated gradient card (blobs of the given colours drifting over the first colour), like a modern pricing card."""
    sw, sh = max(8, int(w * c._s / 5)), max(8, int(h * c._s / 5))
    xs = np.linspace(0, 1, sw, dtype=np.float32)[None, :]
    ys = np.linspace(0, 1, sh, dtype=np.float32)[:, None]
    base = np.array(rgb(colors[0]), dtype=np.float32)
    out = np.ones((sh, sw, 3), dtype=np.float32) * base
    for i, col in enumerate(colors[1:]):
        bx = 0.5 + 0.38 * math.sin(t * 0.55 + i * 2.1 + 0.5)
        by = 0.5 + 0.34 * math.cos(t * 0.45 + i * 1.7)
        wgt = np.exp(-(((xs - bx) ** 2) + (((ys - by) * (h / float(w))) ** 2)) / 0.1)[..., None]
        out = out * (1 - wgt) + np.array(rgb(col), dtype=np.float32) * wgt
    img = Image.fromarray(np.clip(out, 0, 255).astype(np.uint8), "RGB").resize((max(1, int(w * c._s)), max(1, int(h * c._s))), Image.BICUBIC).convert("RGBA")
    img.putalpha(rounded(img.size, int(radius * c._s)))
    c._count()
    c._blit(c._apply_alpha(img, alpha), int(x * c._s), int(y * c._s))


def silhouette(c, cx, base_y, size, color="#1B2A63", alpha=1.0):
    """A head-and-shoulders silhouette (a person) standing on `base_y`, about `size` wide at the shoulders: a round head, a short neck and broad rounded shoulders."""
    c.ellipse(cx, base_y + size * 0.62, size * 0.62, size * 0.5, color, alpha=alpha)
    c.rect(cx - size * 0.62, base_y + size * 0.62, size * 1.24, size * 1.4, color, alpha=alpha)
    c.rect(cx - size * 0.13, base_y - size * 0.1, size * 0.26, size * 0.4, color, alpha=alpha)
    c.circle(cx, base_y - size * 0.34, size * 0.34, color, alpha=alpha)


def swarm(c, items, t, cx, cy, rx=380.0, ry=230.0, n=18, size=28, seed=1, speed=1.0, density=1.0, pull=0.0, hot=4):
    """A cloud of task chips (the words of `items`, repeated) milling around (cx, cy). `density` 0..1 is how many are out (let it grow for 'it keeps piling up'), `pull` 0..1 draws them into the centre and fades them (the mess resolving). Every `hot` chip is red."""
    n = max(1, min(26, int(n)))
    shown = int(n * _clamp(density) + 0.999)
    for i in range(shown):
        a = rand_(i * 3 + seed)
        b = rand_(i * 7 + seed + 11)
        ang = i * 2.399963 + t * speed * (0.12 + 0.3 * a) * (1 if i % 2 else -1)
        rad = 0.3 + 0.7 * b
        px = cx + rx * rad * math.cos(ang) + 16 * math.sin(t * 1.3 + i)
        py = cy + ry * rad * math.sin(ang) + 12 * math.cos(t * 1.1 + i * 2)
        k = _clamp(pull)
        px, py = lerp(px, cx, k * 0.9), lerp(py, cy, k * 0.9)
        born = _ease(t * 2.5 - i * 0.12 / max(0.2, speed))
        label = items[i % len(items)]
        chip(c, label, px, py, size, "hot" if hot and i % hot == hot - 1 else "plain", 9 * math.sin(t * 0.8 + i * 1.9), (1 - k) * born, (0.6 + 0.4 * born) * (1 - 0.5 * k))


def rand_(seed):
    x = math.sin(seed * 12.9898 + 78.233) * 43758.5453
    return x - math.floor(x)
