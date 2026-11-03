"""
The shared TIMELINE layer. TRUSTED code. A video is a list of ELEMENTS on one continuous timeline (not a list of scenes that hard-cut): each element has a start
and an end, enters and leaves with a named animation, and can be tweened (x, y, scale, alpha, rotate, colour) at any time, so type can scale and change colour,
chips can drift from chaos into order, a card can slide up while a connector draws itself to the next node. The spec is plain data (checked by timeline.ts), the
drawing is done here with the canvas's own plumbing, and every word on screen is one of the business's own (the canvas enforces it).

Positions are fractions of the frame (x 0..1 across, y 0..1 down) and name an element's CENTRE; sizes are design units (the frame is 1080 wide).
"""
import math

from pilot_canvas import clamp, ease, progress, rand, wobble
from pilot_scenes import lerp

INK = "#0B1F44"
MUTED = "#64748B"
LINE = "#D8DFEA"
GREEN = "#2FB36F"


def _hex(value):
    h = str(value).lstrip("#")
    if len(h) == 3:
        h = "".join(ch + ch for ch in h)
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def _mix(a, b, k):
    ra, rb = _hex(a), _hex(b)
    return "#%02X%02X%02X" % tuple(int(round(ra[i] + (rb[i] - ra[i]) * k)) for i in range(3))


class _Look(object):
    def __init__(self, video):
        self.p = video.palette
        self.light = bool(getattr(video, "light", False))

    def colour(self, value, fallback="white"):
        v = value or fallback
        p = self.p
        table = {"ink": INK, "white": "#FFFFFF", "muted": MUTED, "accent": p.accent, "glow": p.glow, "glow2": p.glow2, "green": GREEN, "amber": "#F2B33D", "red": "#E5484D",
                 "text": INK if self.light else "#FFFFFF", "bg": p.bg_a, "line": LINE}
        if v in table:
            return table[v]
        v = str(v)
        if v.startswith("#"):
            h = v[1:]
            if len(h) in (3, 4):
                h = "".join(ch + ch for ch in h[:3])
            h = h[:6]
            if len(h) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in h):
                return "#" + h
        return table["white"]


# ---- state of one element at time t -----------------------------------------------------------------------------------------------------

IN_PRESETS = ("pop", "rise", "fade", "slide_left", "slide_right", "zoom", "type", "draw", "none")


def _tweened(e, prop, base, t):
    value = base
    for tw in sorted([w for w in e.get("tweens", []) if w.get("prop") == prop], key=lambda w: float(w.get("at", 0))):
        at = float(tw.get("at", 0))
        if t < at:
            break
        k = clamp((t - at) / max(0.05, float(tw.get("dur", 0.6))))
        start = tw.get("from", value)
        target = tw.get("to", value)
        if prop == "color":
            value = _mix(start, target, ease(tw.get("ease", "ease_in_out"), k))
        else:
            value = lerp(float(start), float(target), ease(tw.get("ease", "ease_in_out"), k))
    return value


def _state(e, t, W, H):
    at = float(e.get("at", 0))
    until = float(e["until"]) if e.get("until") is not None else 1e9
    s = {"visible": at <= t <= until + float(e.get("out_dur", 0.4)), "k": 1.0, "x": float(e.get("x", 0.5)) * W, "y": float(e.get("y", 0.5)) * H, "scale": float(e.get("scale", 1.0)), "alpha": 1.0, "rotate": float(e.get("rotate", 0.0))}
    if not s["visible"]:
        return s
    kin = progress(t, at, float(e.get("in_dur", 0.55)), "back_out" if e.get("in") in ("pop", "zoom") else "expo_out")
    preset = e.get("in", "fade")
    s["k"] = clamp(kin) if preset in ("type", "draw") else 1.0
    if preset == "pop":
        s["scale"] *= 0.55 + 0.45 * kin
        s["alpha"] *= clamp(kin * 1.8)
    elif preset == "rise":
        s["y"] += (1 - kin) * 70
        s["alpha"] *= clamp(kin * 1.6)
    elif preset == "fade":
        s["alpha"] *= clamp(kin * 1.4)
    elif preset == "slide_left":
        s["x"] += (1 - kin) * W * 0.35
        s["alpha"] *= clamp(kin * 1.6)
    elif preset == "slide_right":
        s["x"] -= (1 - kin) * W * 0.35
        s["alpha"] *= clamp(kin * 1.6)
    elif preset == "zoom":
        s["scale"] *= 1.5 - 0.5 * kin
        s["alpha"] *= clamp(kin * 1.6)
    if until < 1e8:
        ko = progress(t, until, float(e.get("out_dur", 0.4)), "ease_in_out")
        out = e.get("out", "fade")
        if out == "drop":
            s["y"] += ko * 90
        elif out == "shrink":
            s["scale"] *= 1 - 0.4 * ko
        s["alpha"] *= 1 - (ko if out != "none" else 0)
    s["x"] = _tweened(e, "x", s["x"] / W, t) * W if any(w.get("prop") == "x" for w in e.get("tweens", [])) else s["x"]
    s["y"] = _tweened(e, "y", s["y"] / H, t) * H if any(w.get("prop") == "y" for w in e.get("tweens", [])) else s["y"]
    s["scale"] = _tweened(e, "scale", s["scale"], t)
    s["alpha"] = clamp(_tweened(e, "alpha", s["alpha"], t)) if any(w.get("prop") == "alpha" for w in e.get("tweens", [])) else s["alpha"]
    s["rotate"] = _tweened(e, "rotate", s["rotate"], t)
    s["float"] = e.get("float", 0)
    if s["float"]:
        s["x"] += 10 * wobble(hash(e.get("id", "x")) % 97, t, 0.8) * float(s["float"])
        s["y"] += 14 * wobble(hash(e.get("id", "x")) % 89 + 3, t, 0.7) * float(s["float"])
    return s


# ---- icons (drawn with shapes, so they take any colour) ---------------------------------------------------------------------------------

def draw_icon(c, name, cx, cy, size, color, alpha=1.0):
    s = size / 100.0
    r = lambda x, y, w, h, col=color, rad=0, a=alpha: c.rect(cx + x * s, cy + y * s, w * s, h * s, col, radius=rad * s, alpha=a)
    if name == "calendar":
        r(-40, -36, 80, 74, color, 12)
        r(-40, -36, 80, 22, _mix(color, "#000000", 0.25), 12)
        for i in range(3):
            for j in range(2):
                c.circle(cx + (-22 + i * 22) * s, cy + (4 + j * 20) * s, 5 * s, "#FFFFFF", alpha=alpha * 0.9)
    elif name == "chat":
        r(-42, -34, 84, 56, color, 22)
        c.polygon([(cx - 14 * s, cy + 20 * s), (cx - 30 * s, cy + 42 * s), (cx + 6 * s, cy + 20 * s)], color)
        for i in range(3):
            c.circle(cx + (-18 + i * 18) * s, cy - 6 * s, 5 * s, "#FFFFFF", alpha=alpha * 0.9)
    elif name == "bolt":
        c.polygon([(cx + 8 * s, cy - 46 * s), (cx - 30 * s, cy + 6 * s), (cx - 4 * s, cy + 6 * s), (cx - 12 * s, cy + 46 * s), (cx + 30 * s, cy - 8 * s), (cx + 4 * s, cy - 8 * s)], color)
    elif name == "users":
        c.circle(cx - 16 * s, cy - 14 * s, 15 * s, color, alpha=alpha)
        c.circle(cx + 20 * s, cy - 8 * s, 12 * s, _mix(color, "#FFFFFF", 0.3), alpha=alpha)
        c.ellipse(cx - 16 * s, cy + 30 * s, 30 * s, 20 * s, color)
        c.ellipse(cx + 22 * s, cy + 30 * s, 22 * s, 15 * s, _mix(color, "#FFFFFF", 0.3))
    elif name == "chart":
        for i, hgt in enumerate((26, 48, 70)):
            r(-38 + i * 28, 40 - hgt, 20, hgt, color, 5)
    elif name == "clock":
        c.circle(cx, cy, 42 * s, color, alpha=alpha)
        c.line(cx, cy, cx, cy - 26 * s, "#FFFFFF", max(3, 6 * s))
        c.line(cx, cy, cx + 20 * s, cy + 8 * s, "#FFFFFF", max(3, 6 * s))
    elif name == "mail":
        r(-44, -30, 88, 60, color, 10)
        c.line(cx - 40 * s, cy - 24 * s, cx, cy + 6 * s, "#FFFFFF", max(3, 5 * s))
        c.line(cx + 40 * s, cy - 24 * s, cx, cy + 6 * s, "#FFFFFF", max(3, 5 * s))
    elif name == "phone":
        r(-24, -44, 48, 88, color, 12)
        r(-17, -34, 34, 62, "#FFFFFF", 6, alpha * 0.9)
        c.circle(cx, cy + 36 * s, 4 * s, "#FFFFFF", alpha=alpha)
    elif name == "bell":
        c.ellipse(cx, cy - 4 * s, 30 * s, 32 * s, color)
        r(-36, 8, 72, 14, color, 7)
        c.circle(cx, cy + 34 * s, 8 * s, color, alpha=alpha)
    elif name == "tick":
        c.circle(cx, cy, 44 * s, color, alpha=alpha)
        c.line(cx - 20 * s, cy + 2 * s, cx - 4 * s, cy + 18 * s, "#FFFFFF", max(4, 9 * s))
        c.line(cx - 4 * s, cy + 18 * s, cx + 24 * s, cy - 16 * s, "#FFFFFF", max(4, 9 * s))
    elif name == "star":
        pts = []
        for i in range(10):
            ang = -math.pi / 2 + i * math.pi / 5
            rad = (44 if i % 2 == 0 else 19) * s
            pts.append((cx + math.cos(ang) * rad, cy + math.sin(ang) * rad))
        c.polygon(pts, color)
    elif name == "arrow":
        c.line(cx - 34 * s, cy, cx + 30 * s, cy, color, max(4, 10 * s))
        c.line(cx + 30 * s, cy, cx + 8 * s, cy - 22 * s, color, max(4, 10 * s))
        c.line(cx + 30 * s, cy, cx + 8 * s, cy + 22 * s, color, max(4, 10 * s))
    elif name == "globe":
        c.circle(cx, cy, 42 * s, color, alpha=alpha)
        c.arc(cx, cy, 42 * s, 0, 360, "#FFFFFF", max(2, 4 * s))
        c.ellipse(cx, cy, 18 * s, 42 * s, "#FFFFFF", )
    elif name == "leaf":
        pts = [(cx + math.cos(a) * 44 * s * (0.55 + 0.45 * abs(math.cos(a))), cy + math.sin(a) * 22 * s) for a in [j * math.pi / 8 for j in range(16)]]
        c.polygon(pts, color)
        c.line(cx - 40 * s, cy + 14 * s, cx + 36 * s, cy - 10 * s, "#FFFFFF", max(3, 4 * s))
    elif name == "droplet":
        c.circle(cx, cy + 10 * s, 30 * s, color, alpha=alpha)
        c.polygon([(cx, cy - 44 * s), (cx - 26 * s, cy - 2 * s), (cx + 26 * s, cy - 2 * s)], color)
    elif name == "shield":
        c.polygon([(cx - 36 * s, cy - 34 * s), (cx + 36 * s, cy - 34 * s), (cx + 36 * s, cy + 6 * s), (cx, cy + 46 * s), (cx - 36 * s, cy + 6 * s)], color)
        c.line(cx - 14 * s, cy - 2 * s, cx - 2 * s, cy + 12 * s, "#FFFFFF", max(3, 7 * s))
        c.line(cx - 2 * s, cy + 12 * s, cx + 18 * s, cy - 14 * s, "#FFFFFF", max(3, 7 * s))
    elif name == "wrench":
        c.line(cx - 30 * s, cy + 30 * s, cx + 18 * s, cy - 18 * s, color, max(6, 14 * s))
        c.circle(cx + 24 * s, cy - 24 * s, 20 * s, color, alpha=alpha)
        c.circle(cx + 30 * s, cy - 30 * s, 9 * s, "#0B1B3F")
    elif name == "home":
        c.polygon([(cx - 44 * s, cy - 4 * s), (cx, cy - 42 * s), (cx + 44 * s, cy - 4 * s)], color)
        r(-32, -4, 64, 44, color, 4)
        r(-9, 12, 18, 28, "#FFFFFF", 3, alpha * 0.9)
    elif name == "sun":
        c.circle(cx, cy, 20 * s, color, alpha=alpha)
        for i in range(8):
            a = i * math.pi / 4
            c.line(cx + math.cos(a) * 30 * s, cy + math.sin(a) * 30 * s, cx + math.cos(a) * 44 * s, cy + math.sin(a) * 44 * s, color, max(3, 6 * s))
    elif name == "snowflake":
        for i in range(3):
            a = i * math.pi / 3
            c.line(cx - math.cos(a) * 44 * s, cy - math.sin(a) * 44 * s, cx + math.cos(a) * 44 * s, cy + math.sin(a) * 44 * s, color, max(3, 6 * s))
    elif name == "sparkle":
        c.polygon([(cx, cy - 46 * s), (cx + 11 * s, cy - 11 * s), (cx + 46 * s, cy), (cx + 11 * s, cy + 11 * s), (cx, cy + 46 * s), (cx - 11 * s, cy + 11 * s), (cx - 46 * s, cy), (cx - 11 * s, cy - 11 * s)], color)




# ---- an illustration: a swimming pool seen from above (water level, a cover that slides on and off, leaves that are swept away) ----------------------------

def draw_pool(c, w, h, t, fill, cover, leaves, clear, look):
    """
    A top-down swimming pool on its poolside paving. The paving runs the full width of the frame (it has no outline, so nothing reads as a screen or a device), the pool has a
    tile edge, steps in one corner, a ladder, and light playing on the water. `fill` 0..1 is the water level; `leaves` floating leaves are PUSHED along by a sweeping brush as
    `clear` goes 0..1 and leave over the far edge; `cover` 0..1 is how far the cover has slid across, and when it is fully across, anchor straps snap down to lock it.
    """
    p = look.p
    water = look.colour("glow")
    deck = _mix(p.bg_a, "#FFFFFF", 0.09)
    c.rect(0, 0, w, h, deck)                                                           # paving, edge to edge
    for i in range(1, 8):
        c.rect(0, i * h / 8.0, w, 3, _mix(deck, "#FFFFFF", 0.06))
    for i in range(1, 12):
        c.rect(i * w / 12.0, 0, 3, h, _mix(deck, "#FFFFFF", 0.05))
    for k in range(18):                                                                # the paving fades out into the background at top and bottom
        a = 1.0 - k / 18.0
        c.rect(0, k * 5, w, 5, p.bg_a, alpha=a * 0.95)
        c.rect(0, h - (k + 1) * 5, w, 5, p.bg_a, alpha=a * 0.95)
    ix, iy, iw, ih = 80, 96, w - 160, h - 192
    c.rect(ix - 12, iy - 12, iw + 24, ih + 24, _mix(water, "#FFFFFF", 0.62), radius=64)  # tile edge, soft corners
    c.rect(ix, iy, iw, ih, _mix(water, "#000000", 0.62), radius=52)                      # the empty basin
    level = max(0.0, min(1.0, fill))
    if level > 0.01:
        c.push(ix, iy, iw, ih)
        c.rect(0, ih * (1 - level), iw, ih * level + 2, water, radius=52 if level > 0.95 else 0)
        c.rect(0, ih * (1 - level), iw, 10, _mix(water, "#FFFFFF", 0.5))
        for r in range(5):                                                             # curved light playing on the water
            pts = []
            for s in range(0, 11):
                x = iw * (0.04 + 0.92 * s / 10.0)
                y = ih * (0.14 + 0.17 * r) + 16 * math.sin(s * 0.9 + t * 1.5 + r * 1.3)
                pts.append((x, y))
            for q in range(len(pts) - 1):
                if pts[q][1] > ih * (1 - level) + 12:
                    c.line(pts[q][0], pts[q][1], pts[q + 1][0], pts[q + 1][1], _mix(water, "#FFFFFF", 0.55), 5)
        for sx in range(3):                                                            # steps in the corner
            c.rect(iw - 150 + sx * 0, ih - 150 + sx * 44, 150, 38, _mix(water, "#FFFFFF", 0.35 - 0.08 * sx), radius=10)
        c.pop()
    c.arc(ix + iw - 10, iy - 6, 40, 180, 360, "#C9D6DF", 9)                            # a ladder over the edge
    c.arc(ix + iw - 56, iy - 6, 40, 180, 360, "#C9D6DF", 9)
    bar = -70 + clear * (iw + 160)                                                     # the sweeping brush
    for i in range(int(leaves)):
        px0 = iw * (0.10 + 0.70 * rand(i * 3 + 1))
        px = px0 if bar < px0 - 12 else bar + 34 + (i % 4) * 14                         # a leaf the brush has reached is pushed along in front of it
        py = ih * (0.14 + 0.72 * rand(i * 3 + 2)) + 9 * math.sin(t * 1.2 + i) + (4 * math.sin(t * 9 + i) if bar >= px0 - 12 and px < iw else 0)
        if px > iw + 20:
            continue
        ang = rand(i * 3 + 3) * math.tau
        pts = [(ix + px + math.cos(ang) * 26 * math.cos(a) - math.sin(ang) * 12 * math.sin(a), iy + py + math.sin(ang) * 26 * math.cos(a) + math.cos(ang) * 12 * math.sin(a)) for a in [j * math.pi / 3 for j in range(6)]]
        c.polygon(pts, ["#C77A2B", "#E0A21A", "#9B5E2E", "#D1492E"][i % 4])
    if 0.0 < clear < 1.0:
        c.push(ix, iy, iw, ih)
        c.rect(bar - 14, ih * 0.04, 28, ih * 0.92, "#EAF4FF", radius=14)               # the brush bar and its bristles
        for j in range(12):
            c.rect(bar + 8, ih * 0.06 + j * ih * 0.074, 22, 8, "#B9D6F2", radius=4)
        c.pop()
    cv = max(0.0, min(1.0, cover))
    if cv > 0.005:                                                                      # the cover slides across, with stripes and a hem
        cw = iw * cv
        c.push(ix - 12, iy - 12, iw + 24, ih + 24)
        c.rect(0, 0, cw + 12, ih + 24, "#0F2740", radius=56 if cv > 0.98 else 0)
        for i in range(1, 8):
            c.rect(0, i * (ih + 24) / 8.0, cw + 12, 4, "#1D4468")
        c.rect(max(0, cw - 4), 0, 16, ih + 24, "#081726")
        c.pop()
    if cv > 0.97:                                                                       # locked: anchor straps snap down around the edge
        lock = clamp((cv - 0.97) / 0.03)
        for gx in (0.16, 0.5, 0.84):
            for gy, sgn in ((iy - 12, -1), (iy + ih + 12, 1)):
                x = ix + iw * gx
                c.line(x, gy, x, gy + sgn * 40 * lock, look.colour("accent"), 10)
                c.circle(x, gy + sgn * 46 * lock, 13 * lock + 1, look.colour("accent"))


# ---- the element types ------------------------------------------------------------------------------------------------------------------

def _num(v):
    v = float(v)
    return int(v) if v.is_integer() else v


def _size(e, key, default):
    return float(e.get(key, default))


def _centre(index, ident, t, W, H, depth=0):
    e = index.get(ident)
    if not e or depth > 3:
        return None
    s = _state(e, t, W, H)
    return s["x"], s["y"], s


def _draw_text(c, e, s, look, t, local=False):
    size = _size(e, "size", 72)
    weight = int(e.get("weight", 800))
    width = _size(e, "width", c.W - 168)
    if any(w.get("prop") == "color" for w in e.get("tweens", [])):  # colour names ("accent", "text") become real colours before they are mixed
        tw = [dict(w, to=look.colour(w.get("to")), **({"from": look.colour(w["from"])} if w.get("from") else {})) if w.get("prop") == "color" else w for w in e.get("tweens", [])]
        colour = _tweened(dict(e, tweens=tw), "color", look.colour(e.get("color", "text")), t)
    else:
        colour = look.colour(e.get("color", "text"))
    align = e.get("align", "center")
    text = str(e.get("text", ""))
    if e.get("case") == "upper":
        text = text.upper()
    if e.get("in") == "type":
        text = text[:int(len(text) * s["k"] + 0.5)]
    h = c.text_height(text or "A", size, weight, width, float(e.get("line_height", 1.08)))
    if e.get("stagger") == "word":
        c.reveal_text(text, 0 if align == "left" else (width if align == "right" else width / 2.0), 0, size, weight, colour, t, start=float(e.get("at", 0)), step=float(e.get("step", 0.1)), align=align, width=width, line_height=float(e.get("line_height", 1.08)), rise=44, shadow=float(e.get("shadow", 0)))
        return width, h
    if e.get("highlight") and "\n" not in text:
        words = text.split(" ")
        gap = c.text_width(" ", size, weight)
        total = sum(c.text_width(w, size, weight) for w in words) + gap * (len(words) - 1)
        cx = (width - total) / 2.0 if align == "center" else 0
        marks = set(str(w).lower() for w in (e.get("highlight") or []))
        for w in words:
            wcol = look.colour(e.get("highlight_color", "accent")) if w.lower().strip(".,!?") in marks else colour
            c.text(w, cx, 0, size, weight, wcol, width=c.text_width(w, size, weight) + 4, shadow=float(e.get("shadow", 0)))
            cx += c.text_width(w, size, weight) + gap
        return width, h
    c.text(text, 0 if align == "left" else (width if align == "right" else width / 2.0), 0, size, weight, colour, align=align, width=width, line_height=float(e.get("line_height", 1.08)), shadow=float(e.get("shadow", 0)))
    return width, h


def _bounds(c, e):
    k = e.get("type")
    if k == "text":
        size = _size(e, "size", 72)
        width = _size(e, "width", c.W - 168)
        return width, c.text_height(str(e.get("text", "A")) or "A", size, int(e.get("weight", 800)), width, float(e.get("line_height", 1.08)))
    if k == "card":
        return _size(e, "w", 800), _size(e, "h", 520)
    if k == "phone":
        return _size(e, "w", 520), _size(e, "h", 1040)
    if k == "chip":
        size = _size(e, "size", 44)
        return c.text_width(str(e.get("text", "")), size, 700) + 120, 104
    if k == "button":
        return _size(e, "w", 700), 120
    if k == "icon":
        return _size(e, "size", 120), _size(e, "size", 120)
    if k == "character":
        r = _size(e, "r", 150)
        return r * 6.0, r * 6.0
    if k == "node":
        r = _size(e, "r", 80)
        return r * 3.2, r * 2 + 90
    if k == "counter":
        return _size(e, "width", 700), _size(e, "size", 140) * 1.2
    if k == "ring":
        r = _size(e, "r", 110)
        return r * 2.4, r * 2.4
    if k == "pool":
        return _size(e, "w", 800), _size(e, "h", 520)
    if k == "shape":
        return _size(e, "w", 300), _size(e, "h", 300)
    if k == "logo":
        return _size(e, "size", 200) * 1.8, _size(e, "size", 200)
    if k == "glow":
        return 10, 10
    return 10, 10


def _draw_body(c, e, s, look, t, index, W, H, w, h):
    """Draws the element inside its group (local coordinates, the box is w x h)."""
    p = look.p
    k = e.get("type")
    if k == "text":
        _draw_text(c, e, s, look, t)
    elif k == "card":
        dark = bool(e.get("dark", not look.light))
        title, tag = str(e.get("title", "")), str(e.get("tag", ""))
        if tag and c.text_width(title, 38, 800) + c.text_width(tag, 26, 400) > w - 130:
            tag = ""                                                               # the title and the tag must not collide
        fill, ink_c, sub_c, hair = ("#111B3D", "#FFFFFF", "#9FB0D8", "#26335F") if dark else ("#FFFFFF", INK, MUTED, LINE)
        c.rect(0, 0, w, h, fill, radius=34, stroke=2, stroke_color=hair)
        if title:
            c.text(title, 38, 30, 38, 800, ink_c, width=w - 76)
        if tag:
            c.text(tag, w - 38, 40, 26, 400, sub_c, align="right", width=240)
        if title or tag:
            c.rect(38, 96, w - 76, 2, hair)
        y0 = 128 if (title or tag) else 30
        rows = e.get("rows") or []
        step = float(e.get("row_step", 0.45))
        ink = "#FFFFFF" if dark else INK
        sub = "#9FB0D8" if dark else MUTED
        for i, row in enumerate(rows[:6]):
            ka = progress(t, float(e.get("at", 0)) + 0.5 + i * step, 0.45)
            if ka <= 0.01:
                continue
            ry = y0 + i * 100 + (1 - ka) * 24
            value = str(row.get("value", ""))
            room = w - 38 - 90 - (c.text_width(value, 28, 600) + 24 if value else 0)
            label, size = str(row.get("label", "")), 38
            while size > 36 and c.text_width(label, size, 700) > room:
                size -= 2
            while len(label) > 3 and c.text_width(label, size, 700) > room:
                label = label[:-1]                                                  # a label never runs under its value
            c.text(label, 38, ry, size, 700, ink, alpha=ka, width=room + 10)
            if value:
                c.text(value, w - 38 - 52, ry + 4, 28, 600, sub, align="right", alpha=ka, width=240)
            if row.get("status") == "done":
                draw_icon(c, "tick", w - 64, ry + 22, 46, GREEN, ka)
            elif row.get("status") == "pending":
                c.circle(w - 64, ry + 22, 12, "#F2B33D", alpha=ka)
    elif k == "phone":
        c.rect(0, 0, w, h, "#0A1226", radius=70, stroke=3, stroke_color="#2A3A66")
        inner_light = bool(e.get("screen_light", look.light))
        c.rect(14, 14, w - 28, h - 28, "#FFFFFF" if inner_light else "#111B3D", radius=58)
        c.rect(w / 2 - 70, 26, 140, 30, "#0A1226", radius=15)
        sx, sy, sw, sh = 14, 70, w - 28, h - 100
        for child in (e.get("children") or [])[:12]:
            cs = _state(dict(child, x=child.get("x", 0.5), y=child.get("y", 0.5)), t, sw, sh)
            if not cs["visible"] or cs["alpha"] <= 0.01:
                continue
            _draw_element_at(c, child, cs, look, t, index, sw, sh, sx + cs["x"], sy + cs["y"], local_dark=not inner_light)
    elif k == "chip":
        size = _size(e, "size", 44)
        tone = e.get("tone", "plain")
        c.chip(str(e.get("text", "")), w / 2.0, h / 2.0, size, tone)
    elif k == "button":
        label = str(e.get("text", ""))
        size = 58
        while size > 40 and c.text_width(label, size, 800) > w - 80:
            size -= 2
        c.rect(0, 0, w, h, p.accent, radius=h / 2.0)
        if e.get("pulse"):
            c.circle(w / 2.0, h / 2.0, w * 0.5 * (1 + 0.04 * math.sin(t * 5)), p.accent, alpha=0.0)
        c.text(label, w / 2.0, (h - size * 1.1) / 2.0, size, 800, p.on_accent, align="center", width=w - 40)
    elif k == "icon":
        col = look.colour(e.get("color", "accent"))
        disc = e.get("disc")
        if disc:
            c.circle(w / 2.0, h / 2.0, w * 0.62, look.colour(disc), alpha=0.95)
        draw_icon(c, str(e.get("name", "star")), w / 2.0, h / 2.0, w * (0.62 if disc else 1.0), col)
    elif k == "character":
        import pilot_explainer as ex
        r = _size(e, "r", 150)
        cx, cy = w / 2.0, h / 2.0
        if e.get("radar"):
            for i in range(3):
                ph = (t * 0.55 + i / 3.0) % 1.0
                c.circle(cx, cy, r * (1.15 + ph * 1.5), p.accent, alpha=0.5 * (1 - ph), stroke=4)
        ex._character(c, e.get("kind", "pilot"), cx, cy, r, t, p, bool(e.get("talk")))
    elif k == "node":
        r = _size(e, "r", 80)
        col = look.colour(e.get("color", "accent"))
        c.circle(w / 2.0, r + 4, r + 10, col, alpha=0.18)
        c.circle(w / 2.0, r + 4, r, col)
        draw_icon(c, str(e.get("icon", "star")), w / 2.0, r + 4, r * 1.0, "#FFFFFF")
        if e.get("label"):
            c.text(str(e["label"]), w / 2.0, r * 2 + 28, int(e.get("size", 34)), 700, look.colour(e.get("label_color", "text")), align="center", width=w)
    elif k == "counter":
        c.counter(_num(e.get("value", 0)), w / 2.0, 0, t, float(e.get("at", 0)) + 0.1, float(e.get("count_dur", 1.8)), int(e.get("size", 140)), look.colour(e.get("color", "text")), "center", 800)
    elif k == "ring":
        r = _size(e, "r", 110)
        c.ring(w / 2.0, h / 2.0, r, clamp(float(e.get("value", 1.0)) * progress(t, float(e.get("at", 0)) + 0.1, 1.4)), look.colour(e.get("color", "accent")), 16, "#FFFFFF", 0.18)
    elif k == "pool":
        draw_pool(c, w, h, t, _tweened(e, "fill", float(e.get("fill", 1.0)), t), _tweened(e, "cover", float(e.get("cover", 0.0)), t), int(e.get("leaves", 0)), _tweened(e, "clear", float(e.get("clear", 0.0)), t), look)
    elif k == "shape":
        col = look.colour(e.get("color", "accent"))
        if e.get("shape") == "circle":
            c.circle(w / 2.0, h / 2.0, min(w, h) / 2.0, col)
        else:
            c.rect(0, 0, w, h, col, radius=_size(e, "radius", 24))
    elif k == "logo":
        c.logo_at(w / 2.0, h / 2.0, _size(e, "size", 200)) or c.text(c._v.brand.get("name", ""), w / 2.0, h / 2.0 - 40, 80, 800, look.colour("text"), align="center", width=w)
    elif k == "glow":
        pass


def _draw_element_at(c, e, s, look, t, index, W, H, gx, gy, local_dark=False):
    w, h = _bounds(c, e)
    if e.get("type") == "glow":
        c.glow(gx, gy, _size(e, "size", 900), look.colour(e.get("color", "accent")), float(e.get("strength", 0.3)) * s["alpha"])
        return
    pad = 80 if e.get("type") == "text" else 0     # words rise in from below and have descenders: the group is taller than the text so nothing is clipped
    c.push(gx - w / 2.0, gy - h / 2.0, w, h + pad, alpha=clamp(s["alpha"]), scale=s["scale"], rotate=s["rotate"])
    _draw_body(c, e, s, look, t, index, W, H, w, h)
    c.pop()


def _draw_connector(c, e, look, t, index, W, H):
    a = _centre(index, e.get("from"), t, W, H)
    b = _centre(index, e.get("to"), t, W, H)
    if not a or not b:
        return
    k = progress(t, float(e.get("at", 0)), float(e.get("in_dur", 0.8)), "ease_in_out")
    if k <= 0.01:
        return
    until = float(e["until"]) if e.get("until") is not None else None
    alpha = 1.0 if until is None else 1 - progress(t, until, 0.4, "ease_in_out")
    col = look.colour(e.get("color", "accent"))
    x1, y1, x2, y2 = a[0], a[1], b[0], b[1]
    dx, dy = x2 - x1, y2 - y1
    dist = math.hypot(dx, dy) or 1.0
    ra = _size(index[e["from"]], "r", 80) if index[e["from"]].get("type") in ("node", "character") else 30
    rb = _size(index[e["to"]], "r", 80) if index[e["to"]].get("type") in ("node", "character") else 30
    sx, sy = x1 + dx / dist * ra, y1 + dy / dist * ra
    ex_, ey_ = x1 + dx * k - dx / dist * rb * k, y1 + dy * k - dy / dist * rb * k
    width = int(e.get("width", 7))
    if e.get("style") == "dashed":
        n = max(4, int(dist / 36))
        for i in range(n):
            f0, f1 = i / float(n), (i + 0.55) / float(n)
            if f1 <= k:
                c.line(sx + (x2 - sx) * f0, sy + (y2 - sy) * f0, sx + (x2 - sx) * f1, sy + (y2 - sy) * f1, col, width)
    else:
        c.line(sx, sy, ex_, ey_, col, width)
    if e.get("pulse") and k >= 0.99:
        ph = (t * 0.9) % 1.0
        c.circle(sx + (x2 - sx) * ph, sy + (y2 - sy) * ph, 11, "#FFFFFF", alpha=alpha)
        c.glow(sx + (x2 - sx) * ph, sy + (y2 - sy) * ph, 90, col, 0.5 * alpha)


def _background(c, spec, look, t):
    p = look.p
    bg = spec.get("background") or {}
    a, b = p.bg_a, p.bg_b
    if look.light:
        a, b = "#FFFFFF", "#EEF2F9"
    for shift in sorted(bg.get("shifts", []), key=lambda w: float(w.get("at", 0))):
        k = progress(t, float(shift.get("at", 0)), float(shift.get("dur", 1.0)), "ease_in_out")
        if "a" in shift:
            a = _mix(a, look.colour(shift["a"]), k)
        if "b" in shift:
            b = _mix(b, look.colour(shift["b"]), k)
    c.gradient(a, b, float(bg.get("angle", 165)))
    if look.light:
        c.glow(c.W * 0.9, c.H * 0.08, 900, p.accent, 0.07)
    else:
        c.glow(c.W * 0.1, c.H * 0.05, 1000, p.glow, 0.32 - 0.05 * wobble(3, t))
        c.glow(c.W * 0.95, c.H * 0.6, 900, p.accent, 0.18)


def render(video):
    spec = video.brief["timeline"]
    total = float(spec["seconds"])
    elements = [e for e in spec.get("elements", [])][:70]
    index = {e["id"]: e for e in elements if e.get("id")}
    look = _Look(video)

    def draw(c, t, u):
        _background(c, spec, look, t)
        W, H = c.W, c.H
        cam = spec.get("camera") or []
        zoom, cx_, cy_ = 1.0, 0.0, 0.0
        for move in sorted(cam, key=lambda w: float(w.get("at", 0))):
            k = progress(t, float(move.get("at", 0)), float(move.get("dur", 1.0)), "ease_in_out")
            zoom = lerp(zoom, float(move.get("zoom", 1.0)), k)
            cx_ = lerp(cx_, float(move.get("x", 0.0)) * W, k)
            cy_ = lerp(cy_, float(move.get("y", 0.0)) * H, k)
        if abs(zoom - 1.0) > 0.001 or cx_ or cy_:
            c.push(-cx_, -cy_, W, H, scale=zoom)
        for e in elements:
            kind = e.get("type")
            if kind == "connector":
                _draw_connector(c, e, look, t, index, W, H)
                continue
            s = _state(e, t, W, H)
            if not s["visible"] or s["alpha"] <= 0.01:
                continue
            _draw_element_at(c, e, s, look, t, index, W, H, s["x"], s["y"])
        if abs(zoom - 1.0) > 0.001 or cx_ or cy_:
            c.pop()

    video.add_scene(total, draw, "fade")
