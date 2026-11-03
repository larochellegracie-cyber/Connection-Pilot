"""
Props: small, well-drawn illustrations (a cake, a cupcake, a coffee cup, a gift, a house, a tree, the sun, water, a wrench) that a custom scene can place and animate.
TRUSTED code. Each prop is drawn centred on (cx, cy) and about `size` wide, built up as `k` goes from 0 to 1, with `t` (seconds) for gentle movement.
The model composes scenes from these and from the canvas shapes; the props make the usual subjects recognisable.
"""
import math

KINDS = ("cake", "cupcake", "coffee", "gift", "house", "tree", "sun", "water", "wrench")


def _p(k, a, b):
    """0..1 progress of k between a and b."""
    return max(0.0, min(1.0, (k - a) / float(b - a)))


def _pop(v):
    """A little overshoot, for things that drop or pop into place."""
    v = max(0.0, min(1.0, v))
    return 1 + 2.2 * (v - 1) ** 3 + 1.2 * (v - 1) ** 2 if v < 1 else 1.0


def _mixc(a, b, k):
    ra, rb = int(a[1:3], 16), int(b[1:3], 16)
    ga, gb = int(a[3:5], 16), int(b[3:5], 16)
    ba, bb = int(a[5:7], 16), int(b[5:7], 16)
    return "#%02X%02X%02X" % (int(ra + (rb - ra) * k), int(ga + (gb - ga) * k), int(ba + (bb - ba) * k))


def cake(c, cx, cy, s, k, t, tint):
    """A three-tier chocolate cake with a glossy glaze, piped beads, drips, sprinkles that turn, cherries and candles, lit and standing on a plate with a soft shadow."""
    sponge, glaze, cream = "#5A3320", "#2A130A", tint or "#F3E3C3"
    light = 0.3 + 0.08 * math.sin(t * 0.7)
    tilt = 0.27
    widths = (s * 0.94, s * 0.7, s * 0.48)
    hs = (s * 0.22, s * 0.2, s * 0.18)
    plate_w, plate_h = s * 1.16, s * 0.035
    base_y = cy + s * 0.36                          # where the plate meets the table
    appear = _p(k, 0, 0.18)
    c.soft_shadow(cx, base_y + s * 0.03, plate_w * 0.52, s * 0.07, 0.5 * appear, 0.7)
    c.cylinder(cx, base_y - plate_h, plate_w, plate_h, "#EEF1F6", tilt=tilt, light=light, alpha=min(1.0, appear * 2), gloss=0.25)
    y = base_y - plate_h
    tops = []
    for i in range(3):
        d = _p(k, 0.08 + i * 0.16, 0.3 + i * 0.16)
        drop = (1 - _pop(d)) * -s * 0.2
        top_y = y - hs[i]
        if d > 0:
            c.cylinder(cx, top_y + drop, widths[i], hs[i], sponge, tilt=tilt, light=light, top_color=cream if i < 2 else glaze, alpha=min(1.0, d * 2.5), gloss=0.28)
        tops.append((top_y, widths[i]))
        y = top_y
    # piped beads round the front rim of the lower two tiers
    bead = _p(k, 0.56, 0.74)
    for ti in (0, 1):
        top_y, w = tops[ti]
        n = 14
        for q in range(n):
            th = math.pi * (q + 0.5) / n
            bx, by = cx + math.cos(th) * w * 0.5 * 0.97, top_y + math.sin(th) * w * tilt / 2 * 0.97
            if q / float(n) <= bead:
                c.sphere(bx, by, s * 0.02, cream, alpha=min(1.0, bead * 3), shine=0.5)
    # the glaze on the top tier: a glossy face, drips down its side, a highlight
    top_y, w = tops[2]
    ry = w * tilt / 2
    drip = _p(k, 0.66, 0.86)
    for q in range(9):
        u = (q + 0.5) / 9
        dx = (u - 0.5) * w * 0.94
        rim = top_y + ry * math.sqrt(max(0.0, 1 - (dx / (w * 0.5)) ** 2))
        length = s * (0.04 + 0.11 * ((q * 37) % 10) / 10.0) * drip
        if length > 2:
            c.gloss_rect(cx + dx - s * 0.018, rim - s * 0.01, s * 0.036, length, glaze, radius=s * 0.018, top=0.35, bottom=0.1, alpha=min(1.0, drip * 3), sheen=0.5)
            c.sphere(cx + dx, rim + length - s * 0.002, s * 0.021, glaze, alpha=min(1.0, drip * 3), shine=0.8)
    c.ellipse(cx - w * 0.16, top_y - ry * 0.15, w * 0.13 * min(1.0, drip * 2), ry * 0.18, "#FFFFFF", alpha=0.22 * min(1.0, drip * 2))
    # sprinkles turning with the cake
    spr = _p(k, 0.78, 0.92)
    for q in range(16):
        th = q * 2.399 + t * 0.55
        rr = 0.18 + 0.27 * ((q * 53) % 10) / 10.0
        px, py = cx + math.cos(th) * w * rr, top_y + math.sin(th) * ry * rr * 1.7 - 2
        c.line(px - s * 0.012, py, px + s * 0.012, py - s * 0.004, ["#FF5C8A", "#FFD166", "#7BDFF2", "#C7F9CC"][q % 4], max(3, s * 0.011), min(1.0, spr * 2))
    # cherries and candles
    ch = _p(k, 0.8, 0.95)
    for off in (-0.22, 0.2):
        c.line(cx + off * w, top_y - ry * 0.2, cx + off * w + s * 0.025, top_y - ry * 0.2 - s * 0.075 * ch, "#3E8E41", max(3, s * 0.008), ch)
        c.sphere(cx + off * w, top_y - ry * 0.2 - s * 0.012 - (1 - _pop(ch)) * s * 0.3, s * 0.04, "#C1121F", alpha=min(1.0, ch * 3), shine=0.9)
    for j, off in enumerate((-0.07, 0.0, 0.07)):
        cd = _p(k, 0.86 + j * 0.03, 0.97)
        if cd <= 0:
            continue
        x = cx + off * w * 2.2
        yb = top_y + ry * 0.05 * (j % 2)
        c.cylinder(x, yb - s * 0.14 * cd, s * 0.034, s * 0.14 * cd, ["#F4D35E", "#7BDFF2", "#F7A8B8"][j], tilt=0.5, light=0.3, gloss=0.3)
        flick = 1 + 0.22 * math.sin(t * 9 + j * 2)
        fy = yb - s * 0.14 * cd - s * 0.02
        c.glow(x - s * 0.12, fy - s * 0.12, s * 0.24, "#FFB703", 0.5 * cd)
        c.polygon([(x, fy - s * 0.085 * flick), (x + s * 0.022, fy), (x - s * 0.022, fy)], "#FFD166", alpha=cd)
        c.polygon([(x, fy - s * 0.045 * flick), (x + s * 0.011, fy), (x - s * 0.011, fy)], "#FFFFFF", alpha=0.85 * cd)


def cupcake(c, cx, cy, s, k, t, tint):
    """A cupcake with a pleated paper case, a lit swirl of frosting, sprinkles and a cherry."""
    frosting = tint or "#F2A7C3"
    cup = _p(k, 0, 0.3); sw = _p(k, 0.25, 0.7); cher = _p(k, 0.7, 1.0)
    base_y = cy + s * 0.42
    c.soft_shadow(cx, base_y + s * 0.02, s * 0.46, s * 0.06, 0.45 * cup, 0.7)
    top_w, bot_w, h = s * 0.74, s * 0.52, s * 0.4
    top_y = base_y - h
    if cup > 0:
        c.polygon([(cx - top_w / 2, top_y), (cx + top_w / 2, top_y), (cx + bot_w / 2, base_y), (cx - bot_w / 2, base_y)], "#B9783F", alpha=min(1.0, cup * 2))
        for q in range(9):
            u = (q + 0.5) / 9
            c.line(cx - top_w / 2 + u * top_w, top_y, cx - bot_w / 2 + u * bot_w, base_y, "#8F5A2C" if q % 2 else "#D39A62", max(3, s * 0.018), min(1.0, cup * 2))
        c.rect(cx - top_w / 2, top_y - s * 0.012, top_w, s * 0.03, "#D8A06B", radius=s * 0.012, alpha=min(1.0, cup * 2))
    for i, (w, hh) in enumerate(((0.82, 0.14), (0.62, 0.13), (0.42, 0.12), (0.22, 0.1))):
        d = _p(sw * 1.0, i * 0.2, 0.55 + i * 0.1)
        if d > 0:
            c.cylinder(cx + math.sin(t * 1.3 + i) * s * 0.004, top_y - s * (0.02 + 0.115 * i) - (1 - _pop(d)) * s * 0.2, s * w, s * hh, frosting, tilt=0.5, light=0.3, gloss=0.5, alpha=min(1.0, d * 3))
    for q in range(10):
        th = q * 2.399 + t * 0.6
        c.line(cx + math.cos(th) * s * 0.26 * (0.4 + 0.6 * ((q * 31) % 10) / 10.0), top_y - s * 0.16 + math.sin(th) * s * 0.05, cx + math.cos(th) * s * 0.26 * (0.4 + 0.6 * ((q * 31) % 10) / 10.0) + s * 0.025, top_y - s * 0.16 + math.sin(th) * s * 0.05 - s * 0.006, ["#FFD166", "#FFFFFF", "#7BDFF2"][q % 3], max(3, s * 0.011), min(1.0, sw * 2))
    c.sphere(cx, top_y - s * 0.43 - (1 - _pop(cher)) * s * 0.3, s * 0.055, "#C1121F", alpha=min(1.0, cher * 3), shine=0.9)


def coffee(c, cx, cy, s, k, t, tint):
    """A coffee cup on a saucer, lit from the side, with steam curling up."""
    a = _p(k, 0, 0.4)
    base_y = cy + s * 0.36
    c.soft_shadow(cx, base_y + s * 0.03, s * 0.55, s * 0.07, 0.45 * a, 0.7)
    c.cylinder(cx, base_y - s * 0.04, s * 1.1, s * 0.04, "#EEF1F6", tilt=0.28, light=0.3, gloss=0.25, alpha=min(1.0, a * 2))
    h = s * 0.5 * _pop(_p(k, 0.05, 0.45))
    if h > 4:
        c.arc(cx + s * 0.34, base_y - s * 0.25, s * 0.14, -80, 80, tint or "#FFFFFF", max(5, s * 0.055), min(1.0, a * 2))
        c.cylinder(cx, base_y - s * 0.04 - h, s * 0.62, h, tint or "#FFFFFF", tilt=0.3, light=0.3, top_color="#4A2A18", gloss=0.5)
    for j in range(3):
        sk = _p(k, 0.5 + j * 0.1, 1.0)
        for q in range(7):
            yy = base_y - s * 0.62 - q * s * 0.07
            c.glow(cx + (j - 1) * s * 0.13 + s * 0.05 * math.sin(t * 2 + j + q * 0.7) - s * 0.05, yy - s * 0.05, s * (0.08 + 0.01 * q), "#FFFFFF", 0.16 * sk * (1 - q * 0.1))


def gift(c, cx, cy, s, k, t, tint):
    box = tint or "#E1611A"
    a = _p(k, 0, 0.45); lid = _p(k, 0.4, 0.8); bow = _p(k, 0.75, 1.0)
    c.ellipse(cx, cy + s * 0.4, s * 0.45, s * 0.05, "#000000", alpha=0.2 * a)
    c.rect(cx - s * 0.38, cy - s * 0.1 + (1 - a) * -s * 0.4, s * 0.76, s * 0.5, box, radius=s * 0.04, alpha=min(1.0, a * 2))
    c.rect(cx - s * 0.08, cy - s * 0.1 + (1 - a) * -s * 0.4, s * 0.16, s * 0.5, "#FFFFFF", alpha=0.85 * min(1.0, a * 2))
    c.rect(cx - s * 0.42, cy - s * 0.26 - (1 - _pop(lid)) * s * 0.5, s * 0.84, s * 0.18, box, radius=s * 0.04, alpha=min(1.0, lid * 2))
    c.rect(cx - s * 0.08, cy - s * 0.26 - (1 - _pop(lid)) * s * 0.5, s * 0.16, s * 0.18, "#FFFFFF", alpha=0.85 * min(1.0, lid * 2))
    for sgn in (-1, 1):
        c.circle(cx + sgn * s * 0.14, cy - s * 0.36 - (1 - _pop(bow)) * s * 0.3, s * 0.12 * bow, "#FFFFFF", alpha=0.9 * bow)


def house(c, cx, cy, s, k, t, tint):
    a = _p(k, 0, 0.4); roof = _p(k, 0.35, 0.75); door = _p(k, 0.7, 1.0)
    c.rect(cx - s * 0.36, cy - s * 0.05, s * 0.72, s * 0.45 * a, "#F1E6D3", radius=s * 0.02)
    c.polygon([(cx - s * 0.46, cy - s * 0.02), (cx, cy - s * 0.4 * roof - s * 0.02), (cx + s * 0.46, cy - s * 0.02)], tint or "#C2452D", alpha=min(1.0, roof * 2))
    c.rect(cx - s * 0.07, cy + s * 0.18, s * 0.14, s * 0.22 * door, "#7A4B2A", radius=s * 0.02)
    c.rect(cx - s * 0.27, cy + s * 0.06, s * 0.14, s * 0.14 * door, "#9CD3F5", radius=s * 0.01)
    c.rect(cx + s * 0.13, cy + s * 0.06, s * 0.14, s * 0.14 * door, "#9CD3F5", radius=s * 0.01)


def tree(c, cx, cy, s, k, t, tint):
    a = _p(k, 0, 0.4); sway = 0.02 * math.sin(t * 1.6)
    c.rect(cx - s * 0.05, cy, s * 0.1, s * 0.4 * a, "#7A4B2A", radius=s * 0.02)
    for j, (dx, dy, r) in enumerate(((0, -0.22, 0.3), (-0.2, -0.05, 0.22), (0.2, -0.05, 0.22))):
        g = _p(k, 0.35 + j * 0.15, 0.7 + j * 0.15)
        c.circle(cx + (dx + sway) * s, cy + dy * s, r * s * g, tint or "#3E9B5A", alpha=min(1.0, g * 2))


def sun(c, cx, cy, s, k, t, tint):
    a = _p(k, 0, 0.5)
    c.glow(cx, cy, s * 1.6, tint or "#FFC145", 0.45 * a)
    c.circle(cx, cy, s * 0.26 * _pop(a), tint or "#FFC145")
    for j in range(12):
        ang = math.radians(j * 30 + t * 12)
        r1, r2 = s * 0.36, s * (0.46 + 0.04 * math.sin(t * 3 + j))
        r = _p(k, 0.4, 1.0)
        c.line(cx + math.cos(ang) * r1, cy + math.sin(ang) * r1, cx + math.cos(ang) * (r1 + (r2 - r1) * r), cy + math.sin(ang) * (r1 + (r2 - r1) * r), tint or "#FFC145", max(4, s * 0.03), r)


def water(c, cx, cy, s, k, t, tint):
    a = _p(k, 0, 0.5)
    c.rect(cx - s * 0.5, cy - s * 0.25, s, s * 0.5 * a, tint or "#2AA9E0", radius=s * 0.08)
    for row in range(3):
        for i in range(9):
            x = cx - s * 0.46 + i * s * 0.115
            y = cy - s * 0.12 + row * s * 0.12 + s * 0.02 * math.sin(t * 2 + i * 0.7 + row)
            c.arc(x + s * 0.05, y, s * 0.05, 200, 340, "#FFFFFF", max(3, s * 0.015), 0.5 * a)
    for j in range(4):
        d = _p(k, 0.5 + j * 0.1, 1.0)
        c.circle(cx - s * 0.3 + j * s * 0.2, cy - s * 0.3 - d * s * 0.2 - 10 * math.sin(t * 2 + j), s * 0.03, "#FFFFFF", alpha=0.7 * (1 - d * 0.5))


def wrench(c, cx, cy, s, k, t, tint):
    a = _p(k, 0, 0.6); rot = (1 - _pop(a)) * -40
    col = tint or "#9AA5B1"
    c.push(cx - s / 2, cy - s / 2, s, s, alpha=min(1.0, a * 2), rotate=rot)
    c.line(s * 0.2, s * 0.8, s * 0.65, s * 0.35, col, s * 0.12)
    c.circle(s * 0.7, s * 0.3, s * 0.19, col)
    c.polygon([(s * 0.7, s * 0.3), (s * 0.95, s * 0.05), (s * 0.97, s * 0.22)], "#0A1226")
    c.circle(s * 0.16, s * 0.84, s * 0.09, col)
    c.pop()


DRAW = {"cake": cake, "cupcake": cupcake, "coffee": coffee, "gift": gift, "house": house, "tree": tree, "sun": sun, "water": water, "wrench": wrench}


def prop(c, kind, cx, cy, size, k=1.0, t=0.0, tint=None):
    """Draws one prop (see KINDS) centred on (cx, cy), about `size` wide, built up as k goes 0..1."""
    fn = DRAW.get(str(kind))
    if fn is None:
        raise ValueError("unknown prop: %s (use one of %s)" % (kind, ", ".join(KINDS)))
    fn(c, float(cx), float(cy), max(40.0, min(1400.0, float(size))), max(0.0, min(1.0, float(k))), float(t), tint)
