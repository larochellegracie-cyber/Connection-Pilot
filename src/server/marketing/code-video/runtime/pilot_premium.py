"""
Premium scenes for code-written videos. TRUSTED code, written and checked by hand: each one is a complete, carefully composed scene (spacing,
hierarchy, motion and brand colours are built in), so a script that chooses and orders them, with the business's own words and photos, comes out at a
consistently high standard. They are made of the same canvas calls a script can use, so a script can add its own scenes beside them.

Every function takes the words and photo names from the brief; any text still has to be the business's own (the canvas enforces it).
"""
import math

from pilot_scenes import COLUMN, DESIGN_W, lerp

MARGIN = 84


def _zone(c):
    return c.safe_top + 150, c.safe_bottom


def hook_kinetic(video, photo, headline, subtext="", seconds=4.0, pan="right", anchor="bottom", transition="wipe"):
    """
    A full-bleed photo that drifts and zooms under a smooth scrim, with a headline whose words rise in one by one and a quieter supporting line.
    anchor: "bottom" (text in the lower third) or "center".
    """
    p = video.palette
    left = pan == "left"

    def draw(c, t, u):
        c.photo(photo, 0, 0, c.W, c.H, zoom=lerp(1.06, 1.26, u), pan_x=lerp(0.5, -0.5, u) if left else lerp(-0.5, 0.5, u), pan_y=0.25, tint=p.bg_a, tint_alpha=0.22, bright=0.92)
        c.fade(c.H * 0.34, c.H * 0.66, p.bg_a, 0.0, 0.94)
        size = c.fit_size(headline, 112 if len(headline) <= 28 else 96, 800, 860)
        head_h = c.text_height(headline, size, 800, 860, 1.06)
        block = head_h + (26 + c.text_height(subtext, 44, 400, 860)) if subtext else head_h
        top = c.safe_bottom - 40 - block if anchor == "bottom" else (c.H - block) / 2
        c.rect(84, top, 8, max(0.0, (block + 10) * progress(t, 0.2, 1.0)), p.accent, radius=4)
        h = c.reveal_text(headline, 124, top, size, 800, "#FFFFFF", t, start=0.35, step=0.09, width=860, line_height=1.06, shadow=0.4)
        if subtext:
            k = progress(t, 1.1, 0.9)
            c.text(subtext, 124, top + h + 26 + (1 - k) * 30, 44, 400, "#FFFFFF", alpha=0.88 * k, width=860)
        c.logo()

    video.add_scene(seconds, draw, transition)


def feature_float(video, photo, headline, subtext="", seconds=4.0, layout="stack", flip=False, transition="iris"):
    """
    A blurred, darkened backdrop of the photo with a sharp rounded copy floating above it (soft shadow, slow zoom) and the words beneath or beside it.
    layout: "stack" (photo on top, words below) or "side" (a tall photo on one side, words on the other; `flip` swaps sides).
    """
    p = video.palette

    def draw(c, t, u):
        c.backdrop(photo, u, dim=0.6, blur=26, tint=p.bg_a, tint_alpha=0.35)
        c.marquee(headline, c.H * 0.12, 150, "#FFFFFF", t, speed=60, alpha=0.05)
        k = progress(t, 0.1, 1.2)
        bob = 10 * wobble(2, t, 0.8)
        zone_top, zone_bottom = _zone(c)
        if layout == "side":
            pw = 440
            px = MARGIN if not flip else DESIGN_W - MARGIN - pw
            tx = (MARGIN + pw + 56) if not flip else MARGIN
            tw = DESIGN_W - 2 * MARGIN - pw - 56
            ph = min(1000, zone_bottom - zone_top)
            c.photo(photo, px, zone_top + (1 - k) * 90 + bob, pw, ph, shape="round", radius=44, zoom=lerp(1.08, 1.2, u), pan_x=lerp(-0.2, 0.2, u), alpha=k, shadow=0.5)
            size = c.fit_size(headline, 76 if len(headline) > 22 else 88, 800, tw)
            head_h = c.text_height(headline, size, 800, tw, 1.06)
            sub_h = (22 + c.text_height(subtext, 40, 400, tw)) if subtext else 0
            y = zone_top + max(0.0, (ph - (46 + head_h + sub_h)) / 2)
            c.rect(tx, y, 110 * progress(t, 0.7, 0.7), 10, p.accent, radius=5)
            h = c.reveal_text(headline, tx, y + 36, size, 800, "#FFFFFF", t, start=0.8, step=0.08, width=tw, line_height=1.06)
            if subtext:
                k2 = progress(t, 1.5, 0.8)
                c.text(subtext, tx, y + 36 + h + 22 + (1 - k2) * 24, 40, 400, "#FFFFFF", alpha=0.8 * k2, width=tw)
        else:
            size = c.fit_size(headline, 88 if len(headline) <= 30 else 76, 800, 912)
            head_h = c.text_height(headline, size, 800, 912, 1.06)
            sub_h = (22 + c.text_height(subtext, 42, 400, 912)) if subtext else 0
            text_h = 36 + head_h + sub_h
            ph = max(420, min(780, zone_bottom - zone_top - text_h - 70))
            top = zone_top + max(0.0, (zone_bottom - zone_top - (ph + 70 + text_h)) * 0.4)
            c.photo(photo, 84, top + (1 - k) * 90 + bob, 912, ph, shape="round", radius=44, zoom=lerp(1.08, 1.2, u), pan_x=lerp(-0.2, 0.2, u), alpha=k, shadow=0.5)
            y = top + ph + 70
            c.rect(84, y, 110 * progress(t, 0.7, 0.7), 10, p.accent, radius=5)
            h = c.reveal_text(headline, 84, y + 36, size, 800, "#FFFFFF", t, start=0.8, step=0.08, width=912, line_height=1.06)
            if subtext:
                k2 = progress(t, 1.5, 0.8)
                c.text(subtext, 84, y + 36 + h + 22 + (1 - k2) * 24, 42, 400, "#FFFFFF", alpha=0.8 * k2, width=912)
        c.logo()

    video.add_scene(seconds, draw, transition)


def steps_timeline(video, headline, items, seconds=5.0, photo=None, transition="zoom"):
    """
    The brand-colour field with soft glows, a headline whose words rise in, and a timeline of the items that draws itself (a line, then each
    dot and line of text in turn). With a photo, a circular photo sits top right inside a ring that fills. The whole block is centred.
    """
    p = video.palette
    items = [str(i) for i in list(items)[:5]]

    def draw(c, t, u):
        c.gradient(p.bg_a, p.bg_b, 160)
        c.glow(500, -80, 1000, p.glow, 0.34 - 0.06 * wobble(1, t))
        c.glow(-300, c.H * 0.55, 860, p.accent, 0.22)
        zone_top, zone_bottom = _zone(c)
        size = c.fit_size(headline, 100 if len(headline) <= 20 else 84, 800, 760 if photo else 912)
        head_h = c.text_height(headline, size, 800, 760 if photo else 912, 1.06)
        total = 36 + head_h + 90 + c.timeline_height(items, 46, 912)
        top = zone_top + max(0.0, (zone_bottom - zone_top - total) * 0.45)
        c.rect(84, top, 110 * progress(t, 0.1, 0.7), 10, p.accent, radius=5)
        h = c.reveal_text(headline, 84, top + 36, size, 800, "#FFFFFF", t, start=0.2, step=0.1, width=760 if photo else 912, line_height=1.06)
        c.timeline(items, 84, top + 36 + h + 90, t, start=0.9, step=0.6, size=46, color="#FFFFFF", accent=p.accent, width=912)
        if photo:
            c.photo(photo, 800, top - 10, 160, 160, shape="circle", zoom=lerp(1.1, 1.3, u), alpha=progress(t, 0.4, 1.0))
            c.ring(880, top + 70, 92, progress(t, 0.5, 2.4, "ease_in_out"), p.accent, 10, "#FFFFFF", 0.2)
        c.logo()

    video.add_scene(seconds, draw, transition)


def statement_kinetic(video, headline, subtext="", seconds=3.5, photo=None, flip=False, transition="fade"):
    """One bold message, words rising in, centred on a brand-colour field with drifting glows (or over a blurred photo backdrop), with a quiet drifting text band."""
    p = video.palette

    def draw(c, t, u):
        if photo:
            c.backdrop(photo, u, dim=0.62, blur=24, tint=p.bg_a, tint_alpha=0.4)
        else:
            c.gradient(p.bg_a, p.bg_b, 200 if flip else 150)
            c.glow(-380 if flip else 480, c.H * 0.02, 980, p.glow, 0.34 - 0.05 * wobble(3, t))
            c.glow(520 if flip else -360, c.H * 0.54, 860, p.accent, 0.22)
        c.marquee(headline, c.H * 0.86, 130, "#FFFFFF", t, speed=50, alpha=0.05)
        size = c.fit_size(headline, 112 if len(headline) <= 20 else 96 if len(headline) <= 34 else 80, 800, 912)
        head_h = c.text_height(headline, size, 800, 912, 1.06)
        block = 36 + head_h + ((26 + c.text_height(subtext, 44, 400, 912)) if subtext else 0)
        zone_top, zone_bottom = _zone(c)
        top = zone_top + max(0.0, (zone_bottom - zone_top - block) * 0.45)
        c.rect(84, top, 110 * progress(t, 0.1, 0.7), 10, p.accent, radius=5)
        h = c.reveal_text(headline, 84, top + 36, size, 800, "#FFFFFF", t, start=0.2, step=0.1, width=912, line_height=1.06)
        if subtext:
            k = progress(t, 1.0, 0.9)
            c.text(subtext, 84, top + 36 + h + 26 + (1 - k) * 26, 44, 400, "#FFFFFF", alpha=0.85 * k, width=912)
        c.logo()

    video.add_scene(seconds, draw, transition)


def cta_pro(video, headline, seconds=5.0, photo=None, transition="fade"):
    """
    The call to action: a ring that fills around a circular photo (or a star), the headline rising in, and a button with the business name that
    slides up. Glows drift behind. Always the last scene.
    """
    p = video.palette
    name = video.brand.get("name", "")
    label = name if len(name) <= 22 else name.replace(" and ", " & ").split(" & ")[0].strip()[:26]

    def draw(c, t, u):
        c.gradient(p.bg_a, p.bg_b, 165)
        c.glow(480, c.H * 0.02, 980, p.glow, 0.34 - 0.05 * wobble(4, t))
        c.glow(-360, c.H * 0.54, 860, p.accent, 0.22)
        zone_top, zone_bottom = _zone(c)
        size = c.fit_size(headline, 104 if len(headline) <= 22 else 88, 800, 880)
        head_h = c.text_height(headline, size, 800, 880, 1.06)
        ring_r = 190
        total = 2 * ring_r + 90 + head_h + 80 + 124
        top = zone_top + max(0.0, (zone_bottom - zone_top - total) * 0.45)
        cx, cy = 540, top + ring_r
        k = progress(t, 0.1, 1.0, "back_out")
        if photo:
            c.photo(photo, cx - (ring_r - 22) * k, cy - (ring_r - 22) * k, 2 * (ring_r - 22) * k, 2 * (ring_r - 22) * k, shape="circle", zoom=lerp(1.05, 1.22, u))
        else:
            c.circle(cx, cy, (ring_r - 22) * k, p.accent)
            c.icon("star", cx - 70, cy - 70, 140, p.on_accent)
        c.ring(cx, cy, ring_r, progress(t, 0.2, 1.8, "ease_in_out"), p.accent, 14, "#FFFFFF", 0.18)
        h = c.reveal_text(headline, 540, top + 2 * ring_r + 90, size, 800, "#FFFFFF", t, start=0.6, step=0.09, align="center", width=880, line_height=1.06)
        by = top + 2 * ring_r + 90 + h + 80
        kb = progress(t, 1.3, 0.9)
        if label:
            c.rect(220, by + (1 - kb) * 50, 640, 124, p.accent, radius=62, alpha=kb)
            c.text(label, 500, by + 34 + (1 - kb) * 50, 46 if len(label) <= 16 else 38, 800, p.on_accent, align="center", alpha=kb, width=440)
            c.icon("arrow", 220 + 640 - 118, by + 22 + (1 - kb) * 50, 80, p.on_accent, alpha=kb)
        c.logo()

    video.add_scene(seconds, draw, transition)


def progress(t, start, duration, easing="expo_out"):
    from pilot_canvas import progress as _progress
    return _progress(t, start, duration, easing)


def wobble(seed, t, speed=1.0):
    from pilot_canvas import wobble as _wobble
    return _wobble(seed, t, speed)
