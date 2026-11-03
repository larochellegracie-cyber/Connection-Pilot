"""
Product scenes: one hero object (a ready-made prop or the business's own photo) on a lit studio set, with a large headline and a smaller line, a camera move,
and a build-up over the scene. TRUSTED code. Everything about the look comes from the numbers it is given (they come from a reference video's design
blueprint: where the hero sits and how big, the camera, where the headline sits and how big, when the words appear), the video's palette and the
business's own words. The scene library's scenes are not used, so the result has no templates in it.
"""
import math

from pilot_canvas import clamp, ease, progress, rand, wobble

PLACE = {"center": (0.5, 0.56), "low_center": (0.5, 0.62), "high_center": (0.5, 0.46), "left": (0.34, 0.6), "right": (0.68, 0.6)}
WIDTH = {"small": 560, "medium": 760, "large": 960}
HEAD_Y = {"top": 0.1, "upper third": 0.17, "middle": 0.45, "lower third": 0.64, "bottom": 0.78}
HEAD_SIZE = {"s": 64, "m": 84, "l": 104, "xl": 124}


HERO_ABOVE = 0.60   # a prop reaches this far (as a share of its width) above its centre (the candles) ...
HERO_BELOW = 0.44   # ... and this far below it (the plate)
PUSH_MARGIN = 0.07  # the camera push scales the hero up by up to 8 percent


def fit_hero(H, text_bottom, fy, w, closing=False, photo=False):
    """
    Where the hero goes and how big, so it is never behind the words: below the bottom of the text block (with a gap and room for the camera push) and above the
    bottom limit (the sign-off card in the last scene). Returns (centre_y, width). The preferred place is fy (a fraction of the height); the hero moves down or shrinks to fit.
    """
    above, below = (0.55, 0.55) if photo else (HERO_ABOVE, HERO_BELOW)
    floor_limit = H * (0.835 if closing else 0.93)
    gap = 36
    width = float(w)
    need = lambda s: s * (above + below + PUSH_MARGIN)
    available = floor_limit - (text_bottom + gap)
    if need(width) > available:
        width = max(300.0, available / (above + below + PUSH_MARGIN))
    min_cy = text_bottom + gap + width * (above + PUSH_MARGIN)
    max_cy = floor_limit - width * below
    cy = max(min_cy, min(H * fy, max_cy)) if min_cy <= max_cy else min_cy
    return cy, width


def scene(video, headline, subtext, hero, seconds, placement="low_center", size="large", camera="static", head_pos="upper third", head_size="l", align="left",
          text_at=0.3, horizon=None, k0=0.0, k1=1.0, transition="fade", tint=None, closing=False, sign_line=""):
    """
    One product scene. `hero` is "prop:<kind>" (cake, cupcake, coffee, gift, house, tree, sun, water, wrench) or a photo name from the brief.
    k0 and k1 say how built the hero is at the start and end of the scene (0 nothing, 1 finished): the hero builds up across the video's scenes.
    """
    p = video.palette

    def draw(c, t, u):
        fx, fy = PLACE.get(placement, PLACE["low_center"])
        w = WIDTH.get(size, 900)
        # the words come first: where they sit and how tall they are decides where the hero can be
        hs = HEAD_SIZE.get(head_size, 100)
        hs = c.fit_size(headline, hs, 800, 880, 56) if headline else hs
        top = max(c.H * HEAD_Y.get(head_pos, 0.17), c.safe_top + 150)   # always below the logo chip
        text_h = (c.text_height(headline, hs, 800, 880, 1.04) if headline else 0) + (70 if (headline and subtext) else (60 if subtext else 0))
        text_bottom = top + text_h
        is_prop = str(hero).startswith("prop:")
        cy, w = fit_hero(c.H, text_bottom, fy, w, closing, photo=not is_prop)
        # the floor: where the reference's floor began if it showed one, else just under the hero
        floor_y = max(0.55, min(0.8, float(horizon))) if horizon is not None else min(0.78, (cy + w * 0.3) / c.H)
        c.studio(t, floor_y=floor_y, spot_x=fx, lights=8)
        # the camera: a slow push in or out around everything, a drift, or the hero rising into place from a little lower
        scale, dx, rise = 1.0, 0.0, 0.0
        if camera == "push_in":
            scale = 1.0 + 0.07 * u
        elif camera == "pull_out":
            scale = 1.07 - 0.07 * u
        elif camera == "pan":
            dx = -26 + 52 * u
            scale = 1.03
        elif camera == "rise":
            rise = (1 - ease("expo_out", clamp(t / 1.2, 0, 1))) * 90
        elif camera == "orbit":
            dx = 18 * math.sin(t * 0.9)
        k = k0 + (k1 - k0) * progress(t, 0.0, seconds * 0.85, "ease_in_out") if not closing else 1.0
        c.push(dx, 0, c.W, c.H, scale=scale, origin_x=fx, origin_y=cy / c.H)
        hx, hy = c.W * fx, cy + rise
        if is_prop:
            c.prop(str(hero)[5:], hx, hy, w, k, t, tint)
        elif hero:
            ph = w * 1.05
            c.soft_shadow(hx, hy + ph * 0.5, w * 0.5, 34, 0.45, 0.7)
            c.photo(hero, hx - w / 2, hy - ph / 2, w, ph, shape="round", radius=44, zoom=1.04 + 0.05 * u, alpha=clamp(t / 0.6))
        c.pop()
        # words: one block, a large headline then a smaller line, easing in at the time the reference showed them
        ink = p.text
        ax = 84 if align == "left" else (c.W - 84 if align == "right" else c.W / 2)
        al = "left" if align == "left" else ("right" if align == "right" else "center")
        start = max(0.0, min(seconds * 0.6, text_at * seconds))
        if headline:
            h = c.reveal_text(headline, ax, top, hs, 800, ink, t, start=start, step=0.07, align=al, width=880, line_height=1.04)
            if subtext:
                k2 = progress(t, start + 0.5, 0.7)
                c.text(subtext, ax, top + h + 18 + (1 - k2) * 16, 42, 400, ink, align=al, alpha=0.8 * k2, width=880)
        if closing:
            # the sign-off: the business's name on a clean card, beneath the hero
            kk = progress(t, 0.5, 0.8, "back_out")
            nm = c._v.brand.get("name", "")
            if nm:
                cw = min(900, max(c.text_width(nm, 56, 800), c.text_width(sign_line, 34, 400) if sign_line else 0) + 120)
                c.push(c.W / 2 - cw / 2, c.H * 0.855, cw, 150, alpha=clamp(kk * 1.4), scale=0.9 + 0.1 * kk)
                c.shadow_rect(0, 0, cw, 150, "#FFFFFF", radius=44, blur=30, offset=14, shadow=0.25)
                c.text(nm, cw / 2, 26, 56, 800, "#1B1B22", align="center", width=cw - 40)
                if sign_line:
                    c.text(sign_line, cw / 2, 94, 34, 400, "#55555F", align="center", width=cw - 40)
                c.pop()
        c.logo()
        c.vignette(0.4)

    video.add_scene(seconds, draw, transition)
