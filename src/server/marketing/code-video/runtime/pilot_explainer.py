"""
Explainer scenes. TRUSTED code: the look of a clean, modern product-explainer video: floating task bubbles, UI mockups that fill in (a booking
form, a schedule that builds itself, a chat), and a friendly character (Pilot, or the business's own logo in an orb). Everything is drawn from
the storyboard's own words with the business's brand colours; the scenes are composed by hand so the result is consistent.

Each function adds one scene to `video` and takes the scene's length in seconds (which the narration sets).
"""
import math

from pilot_canvas import clamp, ease, progress, rand, wobble
from pilot_scenes import lerp

MARGIN = 84
INK = "#0B1F44"
MUTED = "#64748B"
LINE = "#D8DFEA"


def _light(c):
    return bool(getattr(c._v, "light", False))


def _fg(c):
    """The colour for words that sit directly on the background: white on the dark look, ink on the light one."""
    return INK if _light(c) else "#FFFFFF"


def _background(c, p, t, flip=False):
    if _light(c):
        c.gradient("#FFFFFF", "#EEF2F9", 180)
        c.glow(c.W * 0.9, c.H * 0.08, 900, p.accent, 0.07)
        c.glow(-200, c.H * 0.6, 900, p.glow, 0.06)
        return
    g = max(0.4, min(2.2, float(getattr(c._v, "glow_boost", 1.0))))
    c.gradient(p.bg_a, p.bg_b, 200 if flip else 160)
    c.glow(-380 if flip else 480, c.H * 0.02, 980, p.glow, min(0.8, (0.34 - 0.05 * wobble(3, t)) * g))
    c.glow(520 if flip else -360, c.H * 0.54, 860, p.accent, min(0.7, 0.2 * g))
    if g > 1.2:
        c.glow(c.W / 2, c.H * 0.3, 1100, p.glow2, min(0.5, 0.16 * g))


def _zone(c):
    return c.safe_top + 150, c.safe_bottom


# ---- the character --------------------------------------------------------------------------------------------------------------------

def draw_pilot(c, cx, cy, r, t, p, talk=False):
    """
    Pilot, a friendly assistant: a rounded orb in the brand colour with a glossy highlight, a dark face plate with eyes that look around and blink,
    a small smile (it moves while `talk` is true) and an antenna with a glowing tip. It bobs gently.
    """
    bob = 8 * wobble(5, t, 0.9)
    cy = cy + bob
    c.ellipse(cx, cy + r * 1.18 - bob * 0.3, r * 0.78, r * 0.12, "#000000", alpha=0.22)                  # soft ground shadow
    c.line(cx, cy - r * 0.92, cx + 8 * wobble(7, t, 0.7), cy - r * 1.28, "#FFFFFF", 6, 0.9)              # antenna
    c.circle(cx + 8 * wobble(7, t, 0.7), cy - r * 1.34, r * 0.1 * (1 + 0.15 * wobble(9, t, 2.0)), p.accent)
    c.glow(cx - r * 0.5, cy - r * 1.9, r * 1.0, p.accent, 0.35 + 0.1 * wobble(2, t))
    c.circle(cx - r * 1.02, cy + r * 0.05, r * 0.2, p.accent)                                              # ears
    c.circle(cx + r * 1.02, cy + r * 0.05, r * 0.2, p.accent)
    c.circle(cx, cy, r, p.accent)                                                                          # body
    c.circle(cx - r * 0.18, cy - r * 0.22, r * 0.86, "#FFFFFF", alpha=0.12)                                # gloss
    c.rect(cx - r * 0.74, cy - r * 0.5, r * 1.48, r * 1.0, "#0A1226", radius=r * 0.42)                     # face plate
    blink = 0.12 if (t % 3.6) > 3.48 else 1.0
    look = 0.14 * r * wobble(11, t, 0.8)
    for side in (-1, 1):
        ex = cx + side * r * 0.3 + look
        c.ellipse(ex, cy - r * 0.08, r * 0.13, r * 0.17 * blink, "#FFFFFF")
        c.circle(ex + look * 0.4, cy - r * 0.06, r * 0.05, p.glow, alpha=0.9 if blink > 0.5 else 0.0)
    open_ = (0.5 + 0.5 * math.sin(t * 11)) if talk else 0.15
    c.arc(cx, cy + r * 0.12, r * 0.22, 20, 160, "#FFFFFF", max(3, r * 0.045 + open_ * 3))


def draw_logo_orb(c, cx, cy, r, t, p):
    """The business's own logo (or its first letter) in a white orb with a soft ring: the brand as the 'character'."""
    bob = 6 * wobble(5, t, 0.8)
    cy = cy + bob
    c.circle(cx, cy, r * 1.12, p.accent, alpha=0.35)
    c.circle(cx, cy, r, "#FFFFFF")
    if not c.logo_at(cx, cy, r * 1.0):
        c.text(c._v.brand.get("name", "")[:1], cx, cy - r * 0.42, int(r * 0.9), 800, p.accent, align="center", width=r * 2)


def _character(c, kind, cx, cy, r, t, p, talk=False):
    if kind == "pilot":
        draw_pilot(c, cx, cy, r, t, p, talk)
    elif kind == "logo":
        draw_logo_orb(c, cx, cy, r, t, p)


# ---- floating bubbles -----------------------------------------------------------------------------------------------------------------

DOT_COLOURS = None


def _chip(c, p, text, x, y, k, t, seed, scale_extra=1.0):
    """One floating task bubble: a white pill with a coloured dot and the label. k (0..1) is how far it has arrived."""
    w = c.text_width(text, 32, 700) + 96
    h = 76
    pad = 44
    dots = [p.accent, p.glow, p.glow2, "#2FB36F", "#F2B33D"]
    dot = dots[int(rand(seed) * len(dots)) % len(dots)]
    sway_x, sway_y = 10 * wobble(seed, t, 0.9), 14 * wobble(seed + 3, t, 0.8)
    scale = (0.5 + 0.5 * ease("back_out", k)) * scale_extra
    c.push(x + sway_x - pad, y + sway_y - pad, w + 2 * pad, h + 2 * pad, alpha=clamp(k * 1.6) , scale=scale, rotate=2.5 * wobble(seed + 5, t, 0.6))
    c.shadow_rect(pad, pad, w, h, "#FFFFFF", radius=38, blur=22, offset=10, shadow=0.28)
    c.circle(pad + 38, pad + 38, 12, dot)
    c.text(text, pad + 64, pad + 19, 32, 700, INK, width=w)
    c.pop()
    return w


def _layout_chips(c, labels, top, bottom):
    """Greedy rows of chips spread over the area, each row shifted a little so they look scattered rather than gridded."""
    rows = []
    row, used = [], 0
    for text in labels:
        w = c.text_width(text, 32, 700) + 96
        if row and used + w + 22 > c.W - 2 * 60:
            rows.append(row)
            row, used = [], 0
        row.append((text, w))
        used += w + 22
    if row:
        rows.append(row)
    gap = (bottom - top) / max(1, len(rows))
    placed = []
    for ri, items in enumerate(rows):
        total = sum(w for _, w in items) + 22 * (len(items) - 1)
        x = (c.W - total) / 2 + (-50 if ri % 2 else 50) * (0.4 + rand(ri + 7))
        x = max(40, min(x, c.W - total - 40))
        for text, w in items:
            placed.append((text, x, top + ri * gap + (rand(len(placed) + 3) - 0.5) * gap * 0.35, len(placed)))
            x += w + 22
    return placed


def chaos(video, labels, headline, subtext="", seconds=6.0, transition="fade", head_y=0.7, align="left", head_size=96):
    """'A million things': task bubbles pop in one after another and float around, piling up, then are swept away as the headline arrives."""
    p = video.palette
    labels = [str(l) for l in list(labels)[:16]]

    def draw(c, t, u):
        _background(c, p, t)
        zone_top, zone_bottom = _zone(c)
        placed = _layout_chips(c, labels, zone_top - 20, c.H * 0.64)
        sweep = progress(t, seconds * 0.7, seconds * 0.22, "ease_in_out")
        for text, x, y, i in placed:
            k = progress(t, 0.3 + i * (min(0.38, (seconds * 0.55) / max(1, len(placed)))), 0.7, "back_out")
            if k <= 0.01 or sweep >= 0.99:
                continue
            c.push(0, 0, c.W, c.H, alpha=1 - sweep)   # the bubbles lift away and fade as the answer arrives
            _chip(c, p, text, x, y - 160 * sweep, k, t, i + 11, scale_extra=1 - 0.2 * sweep)
            c.pop()
        size = c.fit_size(headline, float(head_size), 800, 912)
        base = c.H * float(head_y)
        hx, hal = (c.W / 2, "center") if align == "center" else (84, "left")
        h = c.reveal_text(headline, hx, base, size, 800, _fg(c), t, start=seconds * 0.55, step=0.08, align=hal, width=912, line_height=1.06, shadow=0.3)
        if subtext:
            k2 = progress(t, seconds * 0.55 + 0.9, 0.8)
            c.text(subtext, hx, base + h + 22 + (1 - k2) * 20, 42, 400, _fg(c), align=hal, alpha=0.85 * k2, width=912)
        c.logo()

    video.add_scene(seconds, draw, transition)


# ---- intro ------------------------------------------------------------------------------------------------------------------------------

def intro(video, headline, subtext="", labels=(), character="pilot", seconds=5.0, transition="fade", head_y=0.56, char_y=0.36, char_r=150, align="center", head_size=104):
    """The opening: the character in the middle of faint floating bubbles, a rising headline beneath."""
    p = video.palette
    labels = [str(l) for l in list(labels)[:8]]

    def draw(c, t, u):
        _background(c, p, t)
        zone_top, zone_bottom = _zone(c)
        for i, text in enumerate(labels):
            col = i % 2
            y = zone_top + 40 + (i // 2) * 210 + 30 * wobble(i, t, 0.6)
            x = 60 + col * 560 + 40 * rand(i + 1)
            c.push(0, 0, c.W, c.H, alpha=0.5 * progress(t, 0.2 + i * 0.12, 0.8))
            _chip(c, p, text, x, y, progress(t, 0.2 + i * 0.12, 0.8, "back_out"), t, i + 31, 0.85)
            c.pop()
        cy = c.H * float(char_y)
        k = progress(t, 0.1, 1.0, "back_out")
        c.push(0, 0, c.W, c.H, alpha=clamp(k * 1.4), scale=0.6 + 0.4 * k, origin_x=0.5, origin_y=0.36)
        _character(c, character, c.W / 2, cy, float(char_r), t, p, talk=True)
        c.pop()
        size = c.fit_size(headline, float(head_size), 800, 912)
        top = c.H * float(head_y)
        ix, ial = (MARGIN, "left") if align == "left" else (c.W / 2, "center")
        c.rect(ix if ial == "left" else ix - 55 * progress(t, 0.7, 0.7), top, 110 * progress(t, 0.7, 0.7), 10, p.accent, radius=5)
        h = c.reveal_text(headline, ix, top + 36, size, 800, _fg(c), t, start=0.8, step=0.09, align=ial, width=912, line_height=1.06)
        if subtext:
            k2 = progress(t, 1.6, 0.8)
            c.text(subtext, ix, top + 36 + h + 24 + (1 - k2) * 20, 44, 400, _fg(c), align=ial, alpha=0.85 * k2, width=900)
        c.logo()

    video.add_scene(seconds, draw, transition)


# ---- the booking form that fills in ----------------------------------------------------------------------------------------------------

def form(video, title, fields, button="Submit", success="Done", seconds=7.0, character="pilot", transition="wipe"):
    """
    A form card whose fields fill in one after another (typed letter by letter with a cursor), then the button is pressed and a tick confirms it.
    `fields` is a list of (label, value) pairs. The character watches from the corner.
    """
    p = video.palette
    fields = [(str(a), str(b)) for a, b in list(fields)[:4]]

    def draw(c, t, u):
        _background(c, p, t, flip=True)
        zone_top, zone_bottom = _zone(c)
        card_h = 150 + len(fields) * 150 + 150
        top = zone_top + max(0.0, (zone_bottom - zone_top - card_h) * 0.35) - 40
        k = progress(t, 0.1, 1.0)
        float_y = 8 * wobble(2, t, 0.8)
        y0 = top + (1 - k) * 80 + float_y
        c.shadow_rect(MARGIN, y0, 912, card_h, "#FFFFFF", radius=40, blur=50, offset=26, shadow=0.3, alpha=k)
        c.text(title, MARGIN + 44, y0 + 44, 46, 800, INK, width=824, alpha=k)
        typed_all = 0.9 + len(fields) * 1.0
        for i, (label, value) in enumerate(fields):
            fy = y0 + 150 + i * 150
            start = 0.9 + i * 1.0
            c.text(label, MARGIN + 44, fy, 26, 700, MUTED, width=820, alpha=progress(t, 0.5 + i * 0.15, 0.5))
            active = start <= t < start + max(0.4, len(value) / 15.0) + 0.3
            c.rect(MARGIN + 44, fy + 40, 824, 84, "#F6F8FC", radius=20, stroke=3 if active else 2, stroke_color=p.accent if active else LINE)
            n = int(clamp((t - start) * 15.0, 0, len(value))) if value else 0
            shown = value[:n]
            if shown:
                c.text(shown, MARGIN + 72, fy + 58, 38, 600, INK, width=780)
                cur_x = MARGIN + 72 + c.text_width(shown, 38, 600)
            else:
                cur_x = MARGIN + 72
            if active and int(t * 2.6) % 2 == 0:
                c.rect(cur_x + 4, fy + 56, 4, 48, p.accent, radius=2)
        by = y0 + 150 + len(fields) * 150 + 10
        press = progress(t, typed_all + 0.2, 0.25, "ease_out") * (1 - progress(t, typed_all + 0.45, 0.25))
        c.push(MARGIN + 44, by, 824, 100, alpha=progress(t, typed_all - 0.4, 0.5), scale=1 - 0.04 * press)
        c.rect(0, 0, 824, 100, p.accent, radius=50)
        c.text(button, 412, 26, 44, 800, p.on_accent, align="center", width=700)
        c.pop()
        done = progress(t, typed_all + 0.7, 0.6, "back_out")
        if done > 0.01:
            c.push(MARGIN, y0, 912, card_h, alpha=clamp(done * 1.4))
            c.rect(0, 0, 912, card_h, "#FFFFFF", radius=40, alpha=0.93)
            c.circle(456, card_h / 2 - 50, 96 * done, p.accent)
            c.icon("tick", 456 - 60, card_h / 2 - 50 - 60, 120, p.on_accent) if done > 0.7 else None
            c.text(success, 456, card_h / 2 + 90, 60, 800, INK, align="center", width=800, alpha=clamp((done - 0.4) * 2))
            c.pop()
        _character(c, character, c.W - 190, c.safe_bottom - 130, 78, t, p)
        c.logo()

    video.add_scene(seconds, draw, transition)


# ---- the schedule that builds itself -------------------------------------------------------------------------------------------------

DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]


def schedule(video, title, entries, days=("Mon", "Tue", "Wed", "Thu", "Fri"), seconds=7.0, character="pilot", transition="iris"):
    """
    A week view that fills itself: the day columns appear, then each job block drops into its slot with a little bounce. `entries` is a list of
    (day, slot, label) where slot is 0..4 (morning to evening) and label is the job's name.
    """
    p = video.palette
    days = [d for d in days if d in DAYS][:6] or ["Mon", "Tue", "Wed", "Thu", "Fri"]
    entries = [(str(d), int(max(0, min(4, s))), str(l)) for d, s, l in list(entries)[:9] if str(d) in days]
    colours = [p.accent, p.glow, p.glow2, "#2FB36F"]

    def draw(c, t, u):
        _background(c, p, t)
        zone_top, zone_bottom = _zone(c)
        col_w = 806 / len(days)
        slot_h = 118
        card_h = 190 + slot_h * 5 + 40
        top = zone_top + max(0.0, (zone_bottom - zone_top - card_h) * 0.35) - 30
        k = progress(t, 0.1, 1.0)
        y0 = top + (1 - k) * 80 + 8 * wobble(2, t, 0.8)
        c.shadow_rect(MARGIN, y0, 912, card_h, "#FFFFFF", radius=40, blur=50, offset=26, shadow=0.3, alpha=k)
        c.text(title, MARGIN + 44, y0 + 38, 44, 800, INK, width=824, alpha=k)
        gx, gy = MARGIN + 53, y0 + 130
        for di, d in enumerate(days):
            a = progress(t, 0.5 + di * 0.1, 0.5)
            c.text(d, gx + di * col_w + col_w / 2, gy, 28, 700, MUTED, align="center", width=col_w, alpha=a)
            if di:
                c.line(gx + di * col_w, gy + 44, gx + di * col_w, gy + 44 + slot_h * 5, LINE, 2, a)
        for si in range(6):
            c.line(gx, gy + 44 + si * slot_h, gx + col_w * len(days), gy + 44 + si * slot_h, LINE, 2, progress(t, 0.6, 0.6))
        for ei, (d, slot, label) in enumerate(entries):
            start = 1.4 + ei * 0.62
            a = progress(t, start, 0.55, "back_out")
            if a <= 0.01:
                continue
            di = days.index(d)
            bx = gx + di * col_w + 8
            by = gy + 44 + slot * slot_h + 8
            drop = (1 - a) * -140
            c.push(bx, by + drop, col_w - 16, slot_h - 16, alpha=clamp(a * 1.5))
            c.rect(0, 0, col_w - 16, slot_h - 16, colours[ei % len(colours)], radius=18)
            c.text(label, 14, 14, c.fit_size(label, 28, 800, col_w - 44, 16), 800, "#FFFFFF", width=col_w - 44, line_height=1.05)
            c.pop()
        _character(c, character, c.W - 190, c.safe_bottom - 100, 78, t, p, talk=t < 1.4 + len(entries) * 0.62)
        c.logo()

    video.add_scene(seconds, draw, transition)


# ---- the conversation --------------------------------------------------------------------------------------------------------------------

def chat(video, messages, title="", seconds=8.0, character="pilot", transition="push"):
    """A chat card: the customer's message appears, the assistant 'types', then replies. `messages` is a list of (who, text), who = 'customer' or 'business'."""
    p = video.palette
    messages = [(str(w), str(m)) for w, m in list(messages)[:5]]

    def draw(c, t, u):
        _background(c, p, t, flip=True)
        zone_top, zone_bottom = _zone(c)
        sizes = []
        for who, text in messages:
            w = min(660, c.text_width(text, 34, 600) + 64)
            sizes.append(c.text_height(text, 34, 600, w - 64, 1.2) + 46 + 28)
        card_h = min(zone_bottom - zone_top - 40, max(560, 190 + sum(sizes) + 40))
        top = zone_top + max(0.0, (zone_bottom - zone_top - card_h) * 0.3)
        k = progress(t, 0.1, 1.0)
        y0 = top + (1 - k) * 80
        c.shadow_rect(MARGIN, y0, 912, card_h, "#FFFFFF", radius=40, blur=50, offset=26, shadow=0.3, alpha=k)
        _character(c, character, MARGIN + 80, y0 + 84, 44, t, p) if character == "pilot" else None
        if title:
            c.text(title, MARGIN + 150 if character == "pilot" else MARGIN + 44, y0 + 50, 40, 800, INK, width=700, alpha=k)
        c.line(MARGIN, y0 + 150, MARGIN + 912, y0 + 150, LINE, 2, k)
        y = y0 + 190
        for i, (who, text) in enumerate(messages):
            start = 0.9 + i * 1.7
            mine = who == "business"
            w = min(660, c.text_width(text, 34, 600) + 64)
            h = c.text_height(text, 34, 600, w - 64, 1.2) + 46
            x = MARGIN + 912 - 40 - w if mine else MARGIN + 40
            if mine and start - 0.8 < t < start:                      # the assistant is typing
                for d in range(3):
                    c.circle(x + w - 90 + d * 34, y + 30 + 8 * math.sin(t * 9 + d), 9, p.accent, alpha=0.8)
            a = progress(t, start, 0.5, "back_out")
            if a > 0.01:
                c.push(x, y + (1 - a) * 30, w, h, alpha=clamp(a * 1.5))
                c.rect(0, 0, w, h, p.accent if mine else "#EEF2F8", radius=28)
                c.text(text, 32, 23, 34, 600, p.on_accent if mine else INK, width=w - 64, line_height=1.2)
                c.pop()
            y += h + 28
        c.logo()

    video.add_scene(seconds, draw, transition)


# ---- the headline whose key word swaps, over a card that builds itself --------------------------------------------------------------------

def _card_bars(c, p, x, y, w, h, local, seed, title, items):
    c.text(title, x + 40, y + 36, 40, 800, INK, width=w - 80)
    n = 9
    gap = 14
    bw = (w - 80 - gap * (n - 1)) / n
    base = y + h - 70
    top = y + 130
    for i in range(n):
        k = progress(local, 0.25 + i * 0.07, 0.6, "back_out")
        bh = (0.25 + 0.75 * rand(seed * 13 + i * 7)) * (base - top) * k
        c.rect(x + 40 + i * (bw + gap), base - bh, bw, max(2, bh), p.accent if i % 3 == 0 else p.glow, radius=10)
    c.line(x + 40, base + 8, x + w - 40, base + 8, LINE, 3, 1.0)


def _card_list(c, p, x, y, w, h, local, seed, title, items):
    c.text(title, x + 40, y + 36, 40, 800, INK, width=w - 80)
    rows = (items or [title])[:4]
    rh = (h - 150) / max(1, len(rows))
    for i, label in enumerate(rows):
        k = progress(local, 0.25 + i * 0.22, 0.5, "back_out")
        ry = y + 130 + i * rh
        c.push(x + 28, ry, w - 56, rh - 12, alpha=clamp(k * 1.4))
        c.rect(0, 0, w - 56, rh - 12, "#F6F8FC", radius=22)
        c.circle(44, (rh - 12) / 2, 14, [p.accent, p.glow, "#2FB36F", "#F2B33D"][i % 4])
        c.text(label, 80, (rh - 12) / 2 - 20, 36, 700, INK, width=w - 200)
        c.rect(w - 56 - 150, (rh - 12) / 2 - 22, 118, 44, p.accent, radius=22, alpha=0.16 + 0.0)
        c.pop()


def _card_line(c, p, x, y, w, h, local, seed, title, items):
    c.text(title, x + 40, y + 36, 40, 800, INK, width=w - 80)
    n = 12
    pts = []
    left, right, top, base = x + 40, x + w - 40, y + 150, y + h - 60
    for i in range(n + 1):
        trend = i / n
        pts.append((left + (right - left) * i / n, base - (base - top) * clamp(0.18 + 0.62 * trend + 0.18 * (rand(seed * 5 + i) - 0.5))))
    k = progress(local, 0.25, 1.5, "ease_out") * n
    for i in range(n):
        seg = clamp(k - i)
        if seg <= 0:
            break
        ax, ay = pts[i]
        bx, by = pts[i + 1]
        c.line(ax, ay, ax + (bx - ax) * seg, ay + (by - ay) * seg, p.accent, 9, 1.0)
    c.line(left, base + 8, right, base + 8, LINE, 3, 1.0)


_CARDS = {"bars": _card_bars, "list": _card_list, "line": _card_line}


def swap(video, lead, words, tail="", card="bars", items=(), brand_line="", cta="", seconds=6.0, transition="fade"):
    """
    A headline with a changing key word ("Run your [ads] / [payments] / [spend]") over a clean UI card that rebuilds for each word, then a closing
    line ("all in one place"), a brand line and a call-to-action. Light or dark (see video.theme). `words` are the words that swap (2 to 5).
    """
    p = video.palette
    words = [str(w) for w in list(words)[:5]] or [str(lead)]
    items = [str(i) for i in list(items)[:4]]
    kind = card if card in _CARDS else "bars"

    def draw(c, t, u):
        _background(c, p, t)
        fg = _fg(c)
        zone_top, zone_bottom = _zone(c)
        seg = (seconds * 0.8) / len(words)
        wi = min(len(words) - 1, int(t / seg)) if t < seg * len(words) else len(words) - 1
        local = t - wi * seg
        # the headline: the lead stays, the key word slides up into place and the last one stays
        size = c.fit_size(lead, 96, 800, 912)
        lead_w = c.text_width(lead, size, 800)
        y0 = zone_top + 20
        k_head = progress(t, 0.1, 0.7)
        c.text(lead, MARGIN, y0 + (1 - k_head) * 30, size, 800, fg, width=912, alpha=k_head)
        word = words[wi]
        wsize = c.fit_size(word, size, 800, 912)
        same_line = lead_w + 24 + c.text_width(word, wsize, 800) <= 912
        wx, wy = (MARGIN + lead_w + 24, y0) if same_line else (MARGIN, y0 + size * 1.12)
        enter = progress(local, 0.0, 0.5, "expo_out")
        leave = 0.0 if wi == len(words) - 1 else progress(local, seg - 0.28, 0.25, "ease_in")
        c.text(word, wx, wy + (1 - enter) * 60 - leave * 30, wsize, 800, p.accent, width=912, alpha=clamp(enter * (1 - leave)))
        head_h = size * (1.12 if same_line else 2.24)
        # the card
        cy = y0 + head_h + 60
        ch = min(700, zone_bottom - cy - 360)
        k = progress(t, 0.25, 0.9)
        float_y = 8 * wobble(2, t, 0.8)
        c.shadow_rect(MARGIN, cy + (1 - k) * 70 + float_y, 912, ch, "#FFFFFF", radius=40, blur=50, offset=24, shadow=0.22, alpha=k)
        c.push(MARGIN, cy + (1 - k) * 70 + float_y, 912, ch, alpha=k)
        _CARDS[kind](c, p, 0, 0, 912, ch, max(0.0, local), wi + 1, word, items)
        c.pop()
        ty = cy + ch + 56
        if tail:
            kt = progress(t, seconds * 0.5, 0.7)
            tsize = c.fit_size(tail, 92, 800, 912)
            c.text(tail, MARGIN, ty + (1 - kt) * 30, tsize, 800, fg, width=912, alpha=kt)
            ty += c.text_height(tail, tsize, 800, 912, 1.1) + 30
        if brand_line:
            kb = progress(t, seconds * 0.55, 0.7)
            c.text(brand_line, MARGIN, ty, 36, 700, MUTED, width=912, alpha=kb)
        if cta:
            kc = progress(t, seconds * 0.62, 0.6, "back_out")
            c.push(c.W / 2 - 250, zone_bottom - 40, 500, 100, alpha=clamp(kc * 1.4), scale=0.85 + 0.15 * kc)
            c.rect(0, 0, 500, 100, p.accent, radius=50)
            c.text(cta, 250, 26, 44, 800, p.on_accent, align="center", width=440)
            c.pop()
        c.logo()

    video.add_scene(seconds, draw, transition)


def cta(video, headline, photo=None, seconds=4.0, transition="fade"):
    """The closing scene in the video's own theme (light or dark): the picture in a ring, the call to action, and the business name on a button."""
    p = video.palette

    def draw(c, t, u):
        _background(c, p, t)
        fg = _fg(c)
        k = progress(t, 0.1, 0.9, "back_out")
        cy = c.H * 0.34
        if photo:
            c.push(c.W / 2 - 230, cy - 230, 460, 460, alpha=clamp(k * 1.4), scale=0.7 + 0.3 * k)
            c.circle(230, 230, 230, p.accent)
            c.photo(photo, 12, 12, 436, 436, shape="circle", zoom=1.08 + 0.05 * u)
            c.pop()
        size = c.fit_size(headline, 100, 800, 880)
        top = cy + 290
        h = c.reveal_text(headline, c.W / 2, top, size, 800, fg, t, start=0.6, step=0.08, align="center", width=880, line_height=1.06)
        kb = progress(t, 1.3, 0.6, "back_out")
        name = c._v.brand.get("name", "")
        label = name if name else headline
        size = 44
        while size > 34 and c.text_width(label, size, 800) > 760:
            size -= 2
        w = min(880, c.text_width(label, size, 800) + 120)
        c.push(c.W / 2 - w / 2, top + h + 40, w, 100, alpha=clamp(kb * 1.4), scale=0.85 + 0.15 * kb)
        c.rect(0, 0, w, 100, p.accent, radius=50)
        c.text(label, w / 2, 50 - size * 0.55, size, 800, p.on_accent, align="center", width=w - 20)
        c.pop()
        c.logo()

    video.add_scene(seconds, draw, transition)


# ---- elements arranged in a circle around the character, turning slowly, with depth and glow ----------------------------------------------

_GLYPHS = [("droplet", ("water", "pool", "test", "chemical", "balanc", "acid", "chlor", "leak")), ("snow", ("clos", "winter", "cover", "season", "cold")), ("sun", ("open", "summer", "spring", "heat")),
           ("sparkle", ("clean", "vacuum", "wash", "scrub", "brush", "polish", "deck", "patio", "power")), ("wrench", ("repair", "equipment", "pump", "filter", "install", "fix", "maint", "heater")),
           ("calendar", ("book", "schedul", "weekly", "visit", "appoint", "plan", "remind")), ("shield", ("safe", "fence", "protect", "insur", "licen", "quote", "invoice")), ("wave", ("swim", "spa", "liner", "fill"))]
_ORDER = ["droplet", "sparkle", "wrench", "calendar", "snow", "sun", "shield", "wave"]


def _glyph_for(label, i):
    low = str(label).lower()
    for kind, words in _GLYPHS:
        if any(w in low for w in words):
            return kind
    return _ORDER[i % len(_ORDER)]


def _glyph(c, kind, x, y, r, color, alpha=1.0):
    """A simple symbol drawn from shapes, centred on (x, y), about 2r across: the 'icon' look of floating elements, drawn in the business's own colours."""
    w = max(4, r * 0.16)
    if kind == "droplet":
        c.polygon([(x, y - r * 1.05), (x + r * 0.62, y + r * 0.1), (x - r * 0.62, y + r * 0.1)], color, alpha)
        c.circle(x, y + r * 0.22, r * 0.62, color, alpha)
    elif kind == "snow":
        for a in (0, 60, 120):
            ax = math.cos(math.radians(a)) * r
            ay = math.sin(math.radians(a)) * r
            c.line(x - ax, y - ay, x + ax, y + ay, color, w, alpha)
        c.circle(x, y, r * 0.2, color, alpha)
    elif kind == "sun":
        c.circle(x, y, r * 0.5, color, alpha)
        for a in range(0, 360, 45):
            ca, sa = math.cos(math.radians(a)), math.sin(math.radians(a))
            c.line(x + ca * r * 0.72, y + sa * r * 0.72, x + ca * r * 1.0, y + sa * r * 1.0, color, w, alpha)
    elif kind == "sparkle":
        c.polygon([(x, y - r), (x + r * 0.26, y - r * 0.26), (x + r, y), (x + r * 0.26, y + r * 0.26), (x, y + r), (x - r * 0.26, y + r * 0.26), (x - r, y), (x - r * 0.26, y - r * 0.26)], color, alpha)
    elif kind == "wrench":
        c.line(x - r * 0.7, y + r * 0.7, x + r * 0.35, y - r * 0.35, color, w * 1.6, alpha)
        c.circle(x + r * 0.5, y - r * 0.5, r * 0.42, color, alpha)
        c.circle(x + r * 0.62, y - r * 0.62, r * 0.16, "#0A1226", alpha)
    elif kind == "calendar":
        c.rect(x - r * 0.9, y - r * 0.75, r * 1.8, r * 1.6, color, radius=r * 0.2, alpha=alpha)
        c.rect(x - r * 0.9, y - r * 0.75, r * 1.8, r * 0.42, "#FFFFFF", radius=r * 0.2, alpha=alpha * 0.55)
        for gx in (-0.45, 0.05, 0.55):
            c.circle(x + r * gx, y + r * 0.25, r * 0.13, "#0A1226", alpha=alpha * 0.8)
    elif kind == "shield":
        c.polygon([(x - r * 0.8, y - r * 0.75), (x + r * 0.8, y - r * 0.75), (x + r * 0.8, y + r * 0.1), (x, y + r), (x - r * 0.8, y + r * 0.1)], color, alpha)
        c.line(x - r * 0.35, y, x - r * 0.05, y + r * 0.3, "#0A1226", w, alpha)
        c.line(x - r * 0.05, y + r * 0.3, x + r * 0.4, y - r * 0.25, "#0A1226", w, alpha)
    else:
        for k in (-0.45, 0.0, 0.45):
            c.arc(x, y + r * k, r * 0.55, 200, 340, color, w, alpha)


def orbit(video, headline, subtext="", labels=(), character="logo", seconds=7.0, transition="fade", cx=0.5, cy=0.31, rx=372, ry=205, speed=0.32, char_r=118, head_y=0.585, align="center", head_size=100, stagger=0.16, shape="disc"):
    """
    The character in the middle with the business's services as glass discs arranged on a tilted circle that turns slowly: the discs at the back are
    smaller and dimmer, the ones at the front larger and brighter (a 3D feel), over a soft glow with tiny lights drifting round. The headline rises beneath.
    """
    p = video.palette
    labels = [str(l) for l in list(labels)[:10]] or [str(headline)]
    n = len(labels)

    def draw(c, t, u):
        _background(c, p, t)
        fg = _fg(c)
        ox, oy = c.W * float(cx), c.H * float(cy)
        rx_, ry_ = float(rx), float(ry)
        k0 = progress(t, 0.1, 1.0, "back_out")
        c.glow(ox, oy, 760, p.accent, 0.3 + 0.08 * wobble(4, t, 0.8))
        # the path the discs follow
        for ring, a in ((1.0, 0.22), (1.32, 0.1)):
            steps = 40 if ring == 1.0 else 28
            prev = None
            for s in range(steps + 1):
                ang = 2 * math.pi * s / steps
                pt = (ox + rx_ * ring * math.cos(ang) * k0, oy + ry_ * ring * math.sin(ang) * k0)
                if prev:
                    c.line(prev[0], prev[1], pt[0], pt[1], p.glow, 3, a * k0)
                prev = pt
        # tiny lights drifting round
        for i in range(14):
            sp = 0.18 + 0.5 * rand(i + 40)
            ang = t * sp + 2 * math.pi * rand(i + 70)
            rr = 0.55 + 0.9 * rand(i + 90)
            z = (math.sin(ang) + 1) / 2
            c.circle(ox + rx_ * rr * math.cos(ang), oy + ry_ * rr * math.sin(ang), 3 + 4 * z, "#FFFFFF", alpha=(0.15 + 0.5 * z) * k0 * (0.5 + 0.5 * wobble(i, t, 1.5)))
        # the discs, back to front
        turn = t * float(speed)
        items = []
        for i, text in enumerate(labels):
            ang = turn + 2 * math.pi * i / n
            items.append((math.sin(ang), i, text, ang))
        items.sort()
        for z, i, text, ang in items:
            born = progress(t, 0.35 + i * float(stagger), 0.8, "back_out")
            if born <= 0.01:
                continue
            depth = (z + 1) / 2
            d = 210 * (0.62 + 0.5 * depth) * (0.4 + 0.6 * born)
            x = ox + rx_ * math.cos(ang) * born
            y = oy + ry_ * math.sin(ang) * born - 12 * wobble(i + 5, t, 0.9)
            alpha = clamp(born * 1.4) * (0.5 + 0.5 * depth)
            c.push(x - d / 2 - 30, y - d / 2 - 30, d + 60, d + 60, alpha=alpha)
            if depth > 0.5:
                c.glow(d / 2 + 30, d / 2 + 30, d * 1.3, p.accent if i % 2 else p.glow, 0.28 * depth)
            c.circle(d / 2 + 30, d / 2 + 30, d / 2, "#FFFFFF", alpha=0.14)
            c.circle(d / 2 + 30, d / 2 + 30, d / 2, "#FFFFFF", alpha=0.0, stroke=3, stroke_color=p.accent if i % 2 else p.glow)
            c.circle(d / 2 + 30 - d * 0.16, d / 2 + 30 - d * 0.2, d * 0.24, "#FFFFFF", alpha=0.12)
            if shape == "icon":
                _glyph(c, _glyph_for(text, i), d / 2 + 30, d / 2 + 30 - d * 0.08, d * 0.24, "#FFFFFF" if not _light(c) else p.accent, 0.95)
                size = c.fit_size(text, 26, 700, d * 0.8, 18)
                c.text(text, d / 2 + 30, d / 2 + 30 + d * 0.24, size, 700, "#FFFFFF" if not _light(c) else INK, align="center", width=d * 0.8, alpha=0.9)
            else:
                size = c.fit_size(text, 34, 800, d * 0.78, 22)
                h = c.text_height(text, size, 800, d * 0.78, 1.05)
                c.text(text, d / 2 + 30, d / 2 + 30 - h / 2, size, 800, "#FFFFFF" if not _light(c) else INK, align="center", width=d * 0.78, line_height=1.05)
            c.pop()
        # the character in the middle, in front of the back discs
        k = progress(t, 0.05, 1.0, "back_out")
        c.push(ox - 200, oy - 200, 400, 400, alpha=clamp(k * 1.4), scale=0.6 + 0.4 * k)
        _character(c, character, 200, 200, float(char_r), t, p, talk=True)
        c.pop()
        size = c.fit_size(headline, float(head_size), 800, 912)
        top = c.H * float(head_y)
        ax = MARGIN if align == "left" else c.W / 2
        al = "left" if align == "left" else "center"
        c.rect((ax if al == "left" else ax - 55 * progress(t, 0.9, 0.7)), top, 110 * progress(t, 0.9, 0.7), 10, p.accent, radius=5)
        h = c.reveal_text(headline, ax, top + 36, size, 800, fg, t, start=1.0, step=0.09, align=al, width=912, line_height=1.06)
        if subtext:
            k2 = progress(t, 1.9, 0.8)
            c.text(subtext, ax, top + 36 + h + 24 + (1 - k2) * 20, 44, 400, fg, align=al, alpha=0.85 * k2, width=900)
        c.logo()

    video.add_scene(seconds, draw, transition)
