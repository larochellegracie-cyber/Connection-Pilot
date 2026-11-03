"""
Open drawing for code-written videos. TRUSTED code. The model's script gets a `Canvas` for each frame and may draw shapes, text, photos with
treatments, glows, shadows and transformed groups, and move them however it likes over time. It never gets a Pillow object, a file, or
anything it could use to reach outside the canvas: every public name here is an explicit drawing method, and the static checker only lets a
script use those names (validate_script.py).

Limits that hold while a script draws: a cap on drawing calls and groups per frame, a time limit per frame, text that must come from the
brief (checked on every text call, so computed or joined strings are caught too), and photos that can only be chosen by their brief names.
"""
import math
import re
import time

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter

from pilot_scenes import DESIGN_W, EASINGS, TRANSITIONS, clamp01, icon_image, lerp, rgb, rgba, rounded, wrap

# the small fixed set of neutral words an app card carries on its own (a tag, a button): they make no claim about the business
UI_CHROME = {"draft", "new", "done", "schedule", "today", "confirm", "booking", "plan", "saved", "sent", "details", "next"}
MAX_CALLS = 2500
MAX_GROUPS = 40
MAX_DEPTH = 3
FRAME_SECONDS = 12


def _norm(text):
    return " ".join(str(text).split()).lower()


class Canvas(object):
    def __init__(self, video, frame):
        self._v = video
        self._img = frame
        self._s = video.s
        self._calls = 0
        self._groups = 0
        self._stack = []
        self.W = DESIGN_W
        self.H = video.H
        self.safe_top = video.safe_top
        self.safe_bottom = video.safe_bottom
        self.palette = video.palette
        self._allowed = [_norm(t) for t in video.allowed_text if t]
        self._offset = [(0.0, 0.0)]       # where the current group sits, in design units (for layout checks)
        self._alphas = [1.0]
        self._boxes = []                  # every text drawn this frame: (x0, y0, x1, y1, alpha, size, text)
        self._photo_boxes = []            # every photo drawn this frame: (x0, y0, x1, y1, alpha)
        self._prop_boxes = []             # every prop drawn this frame: (x0, y0, x1, y1, alpha), the part of its box the drawing really fills
        self._logo = False
        self._photos = 0
        self._fades = []                  # every scrim drawn this frame: (y, height, final alpha), design units (for the repetition check)
        self._cam = []                    # every camera move used this frame
        self._cam_info = []               # every camera shot this frame: its move and its crop (for the storyboard check)
        self._photo_names = []            # the name of every photo drawn this frame (for the storyboard check)
        self._logo_boxes = set()          # which text boxes are only the business name standing in for a missing logo

    # ---- plumbing -----------------------------------------------------------------------------------------------------------------

    def _count(self):
        self._calls += 1
        if self._calls > MAX_CALLS:
            raise RuntimeError("too many drawing calls in one frame")

    def _blit(self, layer, x, y):
        """Puts an RGBA layer on the current surface at pixel (x, y), clipped to it, with correct transparency."""
        target = self._img
        x, y = int(round(x)), int(round(y))
        left, top = max(0, x), max(0, y)
        right, bottom = min(target.width, x + layer.width), min(target.height, y + layer.height)
        if right <= left or bottom <= top:
            return
        part = layer.crop((left - x, top - y, right - x, bottom - y))
        if target.mode == "RGB":
            target.paste(part.convert("RGB"), (left, top), part.getchannel("A"))
        else:
            region = target.crop((left, top, right, bottom))
            target.paste(Image.alpha_composite(region, part), (left, top))

    @staticmethod
    def _apply_alpha(layer, alpha):
        if alpha < 0.999:
            a = layer.getchannel("A").point([int(i * max(0.0, alpha)) for i in range(256)])
            layer.putalpha(a)
        return layer

    def _shape(self, x, y, w, h, painter, alpha=1.0, pad=0):
        """Draws a smooth (anti-aliased) shape: painter(draw, scale, ox, oy) draws into a layer covering the shape's box."""
        s = self._s
        px, py, pw, ph = int(x * s) - pad, int(y * s) - pad, max(1, int(w * s) + 2 * pad), max(1, int(h * s) + 2 * pad)
        if pw * ph > 40_000_000:
            raise RuntimeError("a shape is too large")
        ss = 2 if max(pw, ph) <= 1400 else 1
        layer = Image.new("RGBA", (pw * ss, ph * ss), (0, 0, 0, 0))
        painter(ImageDraw.Draw(layer), ss, pad * ss, pad * ss)
        if ss > 1:
            layer = layer.resize((pw, ph), Image.LANCZOS)
        self._blit(self._apply_alpha(layer, alpha), px, py)

    # ---- fills and shapes ---------------------------------------------------------------------------------------------------------

    def fill(self, color, alpha=1.0):
        self._count()
        layer = Image.new("RGBA", self._img.size, rgba(color, alpha))
        self._blit(layer, 0, 0)

    def gradient(self, color_a, color_b, angle=150, alpha=1.0):
        """A smooth two-colour gradient over the whole surface."""
        self._count()
        w, h = self._img.size
        key = ("gradient", w, h, color_a, color_b, int(angle))
        layer = self._v._cache.get(key)
        if layer is None:
            th = math.radians(angle)
            ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
            reach = abs(math.cos(th)) * w / 2 + abs(math.sin(th)) * h / 2
            k = np.clip(((xs - w / 2) * math.cos(th) + (ys - h / 2) * math.sin(th)) / (2 * reach) + 0.5, 0, 1)[..., None]
            a, b = np.array(rgb(color_a), dtype=np.float32), np.array(rgb(color_b), dtype=np.float32)
            layer = self._v._cache[key] = Image.fromarray(np.concatenate([a * (1 - k) + b * k, np.full((h, w, 1), 255, dtype=np.float32)], axis=2).astype(np.uint8), "RGBA")
        self._blit(self._apply_alpha(layer.copy(), alpha), 0, 0)

    def rect(self, x, y, w, h, color, radius=0, alpha=1.0, stroke=0, stroke_color=None):
        self._count()
        if w * self._s < 1 or h * self._s < 1 or alpha <= 0:   # nothing to draw yet (a bar that is still growing from zero)
            return
        s = self._s
        fill = rgba(color)

        def paint(d, ss, ox, oy):
            box = [ox, oy, ox + int(w * s) * ss - 1, oy + int(h * s) * ss - 1]
            r = int(radius * s * ss)
            d.rounded_rectangle(box, radius=r, fill=fill, outline=rgba(stroke_color or color) if stroke else None, width=max(1, int(stroke * s * ss)) if stroke else 0)

        self._shape(x, y, w, h, paint, alpha)

    def circle(self, cx, cy, r, color, alpha=1.0, stroke=0, stroke_color=None):
        self._count()
        if r * self._s < 1 or alpha <= 0:
            return
        s = self._s

        def paint(d, ss, ox, oy):
            d.ellipse([ox, oy, ox + int(2 * r * s) * ss - 1, oy + int(2 * r * s) * ss - 1], fill=rgba(color), outline=rgba(stroke_color or color) if stroke else None, width=max(1, int(stroke * s * ss)) if stroke else 0)

        self._shape(cx - r, cy - r, 2 * r, 2 * r, paint, alpha)

    def ellipse(self, cx, cy, rx, ry, color, alpha=1.0):
        self._count()
        if rx * self._s < 1 or ry * self._s < 1 or alpha <= 0:
            return
        s = self._s
        self._shape(cx - rx, cy - ry, 2 * rx, 2 * ry, lambda d, ss, ox, oy: d.ellipse([ox, oy, ox + int(2 * rx * s) * ss - 1, oy + int(2 * ry * s) * ss - 1], fill=rgba(color)), alpha)

    def line(self, x1, y1, x2, y2, color, width=6, alpha=1.0):
        self._count()
        if alpha <= 0 or width <= 0:
            return
        s = self._s
        x, y = min(x1, x2) - width, min(y1, y2) - width
        w, h = abs(x2 - x1) + 2 * width, abs(y2 - y1) + 2 * width

        def paint(d, ss, ox, oy):
            d.line([((x1 - x) * s * ss, (y1 - y) * s * ss), ((x2 - x) * s * ss, (y2 - y) * s * ss)], fill=rgba(color), width=max(1, int(width * s * ss)))

        self._shape(x, y, w, h, paint, alpha)

    def polygon(self, points, color, alpha=1.0):
        self._count()
        s = self._s
        pts = [(float(px), float(py)) for px, py in list(points)[:64]]
        x, y = min(p[0] for p in pts), min(p[1] for p in pts)
        w, h = max(p[0] for p in pts) - x, max(p[1] for p in pts) - y

        def paint(d, ss, ox, oy):
            d.polygon([((px - x) * s * ss, (py - y) * s * ss) for px, py in pts], fill=rgba(color))

        self._shape(x, y, w, h, paint, alpha)

    def arc(self, cx, cy, r, start, end, color, width=10, alpha=1.0):
        """An arc of a circle from `start` to `end` degrees (0 = right, clockwise): good for progress rings."""
        self._count()
        if r * self._s < 2 or alpha <= 0 or end <= start:
            return
        s = self._s

        def paint(d, ss, ox, oy):
            d.arc([ox, oy, ox + int(2 * (r + width) * s) * ss - 1, oy + int(2 * (r + width) * s) * ss - 1], start, end, fill=rgba(color), width=max(1, int(width * s * ss)))

        self._shape(cx - r - width, cy - r - width, 2 * (r + width), 2 * (r + width), paint, alpha)

    def shadow_rect(self, x, y, w, h, color, radius=36, blur=40, offset=24, shadow=0.3, alpha=1.0):
        """A rounded card with a soft shadow beneath it."""
        self._count()
        if w * self._s < 4 or h * self._s < 4 or alpha <= 0:
            return
        s = self._s
        pad = int(blur * s * 2)
        layer = Image.new("RGBA", (int(w * s) + 2 * pad, int(h * s) + 2 * pad), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        d.rounded_rectangle([pad, pad + int(offset * s), pad + int(w * s), pad + int(h * s) + int(offset * s)], radius=int(radius * s), fill=(2, 10, 30, int(255 * shadow)))
        layer = layer.filter(ImageFilter.GaussianBlur(max(1, int(blur * s * 0.75))))
        face = Image.new("RGBA", (int(w * s), int(h * s)), rgba(color))
        face.putalpha(rounded(face.size, int(radius * s)))
        layer.alpha_composite(face, (pad, pad))
        self._blit(self._apply_alpha(layer, alpha), int(x * s) - pad, int(y * s) - pad)

    def glow(self, x, y, diameter, color, strength=0.3):
        """A very soft round glow whose top-left corner box starts at (x, y)."""
        self._count()
        key = ("glow", color)
        base = self._v._cache.get(key)
        if base is None:
            small = 64
            img = Image.new("RGBA", (small, small))
            px = img.load()
            r0, g0, b0 = rgb(color)
            for j in range(small):
                for i in range(small):
                    dist = math.hypot(i - small / 2, j - small / 2) / (small / 2)
                    px[i, j] = (r0, g0, b0, int(255 * max(0.0, 1 - dist) ** 1.6))
            base = self._v._cache[key] = img
        d = max(8, int(diameter * self._s))
        if d > 3000:
            raise RuntimeError("a glow is too large")
        self._blit(self._apply_alpha(base.resize((d, d), Image.BICUBIC), strength), int(x * self._s), int(y * self._s))

    def icon(self, kind, x, y, size, color="#FFFFFF", disc=None, alpha=1.0):
        self._count()
        self._blit(self._apply_alpha(icon_image(kind, size * self._s, color, disc), alpha), int(x * self._s), int(y * self._s))

    # ---- depth and lighting (see pilot_3d.py) ----------------------------------------------------------------------------------

    def gloss_rect(self, x, y, w, h, color, radius=0, top=0.3, bottom=0.25, alpha=1.0, sheen=0.35):
        """A rounded block lit from above (lighter top, darker bottom, soft sheen)."""
        import pilot_3d
        pilot_3d.gloss_rect(self, x, y, w, h, color, radius, top, bottom, alpha, sheen)

    def cylinder(self, cx, top_y, w, h, color, tilt=0.26, light=0.3, top_color=None, alpha=1.0, gloss=0.4):
        """A lit cylinder seen slightly from above (cake tier, cup, can, drum): cx centre, top_y the centre of its top ellipse, w width, h side height."""
        import pilot_3d
        pilot_3d.cylinder(self, cx, top_y, w, h, color, tilt, light, top_color, alpha, gloss)

    def sphere(self, cx, cy, r, color, alpha=1.0, light=(-0.35, -0.45), shine=0.6):
        """A lit ball with a highlight and a shaded edge."""
        import pilot_3d
        pilot_3d.sphere(self, cx, cy, r, color, alpha, light, shine)

    def soft_shadow(self, cx, cy, rx, ry, alpha=0.4, blur=0.5, color="#000000"):
        """A soft contact shadow (blurred ellipse) on the ground."""
        import pilot_3d
        pilot_3d.soft_shadow(self, cx, cy, rx, ry, alpha, blur, color)

    def floor(self, y, color_a, color_b, shine=0.25, spot_x=0.5):
        """A ground plane from y to the bottom, with a pool of light."""
        import pilot_3d
        pilot_3d.floor(self, y, color_a, color_b, shine, spot_x)

    def grade(self, contrast=1.0, saturation=1.0, brightness=1.0, warm=0.0, teal_orange=0.0, fade=0.0):
        """Colour-grades everything drawn so far, as a colourist would: contrast, saturation and brightness (1 = unchanged), a warm (positive) or cool (negative) cast,
        a teal-and-orange split tone (teal in the shadows, orange in the highlights, 0 to 1) and a faded-blacks film look (0 to 1). Call it after the photo and before text."""
        self._count()
        import numpy as np
        from PIL import Image, ImageEnhance
        mode = self._img.mode
        base = self._img.convert("RGB")
        if abs(contrast - 1.0) > 0.001:
            base = ImageEnhance.Contrast(base).enhance(max(0.5, min(1.9, float(contrast))))
        if abs(saturation - 1.0) > 0.001:
            base = ImageEnhance.Color(base).enhance(max(0.0, min(2.0, float(saturation))))
        if abs(brightness - 1.0) > 0.001:
            base = ImageEnhance.Brightness(base).enhance(max(0.4, min(1.8, float(brightness))))
        arr = np.asarray(base).astype("float32")
        w = max(-1.0, min(1.0, float(warm)))
        if w:
            arr[..., 0] *= 1 + w * 0.10
            arr[..., 2] *= 1 - w * 0.10
        t = max(0.0, min(1.0, float(teal_orange)))
        if t:
            lum = (0.299 * arr[..., 0] + 0.587 * arr[..., 1] + 0.114 * arr[..., 2]) / 255.0
            sh = (1.0 - lum) ** 2
            hi = lum ** 2
            arr[..., 0] += (hi * 26 - sh * 20) * t
            arr[..., 1] += (sh * 8 + hi * 6) * t
            arr[..., 2] += (sh * 30 - hi * 24) * t
        f = max(0.0, min(1.0, float(fade)))
        if f:
            arr = arr * (1 - f * 0.12) + 255.0 * f * 0.06
        out = Image.fromarray(np.clip(arr, 0, 255).astype("uint8"), "RGB")
        self._img.paste(out.convert(mode) if mode != "RGB" else out)

    def grain(self, strength=0.04, seed=0):
        """A fine film grain over the frame (strength 0 to 0.2). Give a different seed each frame (for example int(t * 30)) so it moves like film."""
        self._count()
        import numpy as np
        from PIL import Image
        mode = self._img.mode
        base = self._img.convert("RGB")
        arr = np.asarray(base).astype("float32")
        h, w = arr.shape[0], arr.shape[1]
        rng = np.random.RandomState((int(seed) * 7919 + 13) % (2 ** 31 - 1))
        noise = rng.normal(0.0, max(0.0, min(0.2, float(strength))) * 255.0, ((h + 1) // 2, (w + 1) // 2, 1)).astype("float32")
        noise = np.repeat(np.repeat(noise, 2, axis=0), 2, axis=1)[:h, :w]
        out = Image.fromarray(np.clip(arr + noise, 0, 255).astype("uint8"), "RGB")
        self._img.paste(out.convert(mode) if mode != "RGB" else out)

    def camera(self, name, u, move="push", amount=1.0, t=0.0, tint=None, tint_alpha=0.0, bright=1.0, focus_y=None, blur=16.0, band=0.2, zoom=1.0, at=None):
        """A moving camera over a photo, full frame (see API.md: CINEMATIC MOTION). move: push, pull, pan_left, pan_right, tilt_up, tilt_down, orbit, handheld, drift."""
        import pilot_cinema
        self._cam.append(move)
        pilot_cinema.camera(self, name, u, move, amount, t, tint, tint_alpha, bright, focus_y, blur, band, zoom, at)

    def caustics(self, t, strength=0.28, color="#BDEFFF", scale=1.0, speed=1.0, top=0.0):
        """Animated water light over everything drawn so far."""
        import pilot_cinema
        pilot_cinema.caustics(self, t, strength, color, scale, speed, top)

    def light_leak(self, t, color="#FFB35A", strength=0.4, speed=0.35, width=0.28, phase=0.0):
        """A warm drifting film light leak."""
        import pilot_cinema
        pilot_cinema.light_leak(self, t, color, strength, speed, width, phase)

    def dust(self, t, count=34, seed=3, strength=0.55, color="#FFFFFF", speed=1.0):
        """Specks of light at several depths, drifting."""
        import pilot_cinema
        pilot_cinema.dust(self, t, count, seed, strength, color, speed)

    def chip(self, text, cx, cy, size=30, tone="plain", rot=0.0, alpha=1.0, scale=1.0, lead=0.0):
        """A pill label centred on (cx, cy) (see API.md: MOTION GRAPHICS KIT). Returns (width, height)."""
        import pilot_ui
        return pilot_ui.chip(self, text, cx, cy, size, tone, rot, alpha, scale, lead)

    def card(self, x, y, w, h, title="", tag="", alpha=1.0, dark=False):
        """An app card with a header; returns where its content starts."""
        import pilot_ui
        return pilot_ui.card(self, x, y, w, h, title, tag, alpha, dark)

    def field(self, x, y, w, label, value, t, start=0.0, speed=18.0, active=False, alpha=1.0):
        """A form field that types `value` itself; returns the next y."""
        import pilot_ui
        return pilot_ui.field(self, x, y, w, label, value, t, start, speed, active, alpha)

    def row(self, x, y, w, left, right, t, start=0.0, alpha=1.0):
        """A schedule row that slides in; returns the next y."""
        import pilot_ui
        return pilot_ui.row(self, x, y, w, left, right, t, start, alpha)

    def pill(self, text, cx, cy, t, start=0.0, size=24, tone="soft"):
        """A status pill with a pulsing dot."""
        import pilot_ui
        return pilot_ui.pill(self, text, cx, cy, t, start, size, tone)

    def button(self, x, y, w, label, k=1.0, press=0.0):
        """A brand-colour button."""
        import pilot_ui
        return pilot_ui.button(self, x, y, w, label, k, press)

    def cursor(self, x, y, k=1.0, press=0.0, size=1.0):
        """A mouse pointer with an optional click ripple."""
        import pilot_ui
        return pilot_ui.cursor(self, x, y, k, press, size)

    def mark(self, kind, x, y, size=46, k=1.0):
        """A red cross ring ("no") or a green tick disc ("yes")."""
        import pilot_ui
        return pilot_ui.mark(self, kind, x, y, size, k)

    def badge(self, n, x, y, size=44, k=1.0):
        """A numbered step dot."""
        import pilot_ui
        return pilot_ui.badge(self, n, x, y, size, k)

    def counter(self, target, x, y, t, start=0.0, dur=2.2, size=120, color="#FFFFFF", align="center", weight=800):
        """A number rolling up to `target` (a number from the brief)."""
        import pilot_ui
        return pilot_ui.counter(self, target, x, y, t, start, dur, size, color, align, weight)

    def mesh(self, x, y, w, h, colors, t, radius=44, alpha=1.0):
        """An animated gradient card."""
        import pilot_ui
        return pilot_ui.mesh(self, x, y, w, h, colors, t, radius, alpha)

    def silhouette(self, cx, base_y, size, color="#1B2A63", alpha=1.0):
        """A head-and-shoulders silhouette."""
        import pilot_ui
        return pilot_ui.silhouette(self, cx, base_y, size, color, alpha)

    def swarm(self, items, t, cx, cy, rx=380.0, ry=230.0, n=18, size=28, seed=1, speed=1.0, density=1.0, pull=0.0, hot=4):
        """A cloud of task chips milling around a point."""
        import pilot_ui
        return pilot_ui.swarm(self, items, t, cx, cy, rx, ry, n, size, seed, speed, density, pull, hot)

    def vignette(self, strength=0.45):
        """Darkens the corners a little (call last)."""
        import pilot_3d
        pilot_3d.vignette(self, strength)

    def bokeh(self, t, count=10, color="#FFFFFF", seed=1, strength=0.25, rise=24.0, region=(0.0, 0.0, 1.0, 0.7)):
        """Soft out-of-focus lights drifting at different depths."""
        import pilot_3d
        pilot_3d.bokeh(self, t, count, color, seed, strength, rise, region)

    def rays(self, t, x, color="#FFFFFF", strength=0.12, spread=0.5, count=5):
        """Soft beams of light falling from the top at x."""
        import pilot_3d
        pilot_3d.rays(self, t, x, color, strength, spread, count)

    def studio(self, t, bg_a=None, bg_b=None, glow=None, floor_y=0.68, spot_x=0.5, light_rays=True, lights=9):
        """A whole set in one call: backdrop, light beams, glow, floor with a pool of light, drifting lights. Draw the subject after it; call c.vignette() last."""
        import pilot_3d
        pilot_3d.studio(self, t, bg_a, bg_b, glow, floor_y, spot_x, light_rays, lights)

    def prop(self, kind, cx, cy, size, k=1.0, t=0.0, tint=None):
        """A ready-made illustration (see API.md: cake, cupcake, coffee, gift, house, tree, sun, water, wrench), centred on (cx, cy) and about `size` wide, built up as k goes 0..1."""
        self._count()
        import pilot_props
        pilot_props.prop(self, kind, cx, cy, size, k, t, tint)
        # for the layout check: where the drawing really is (about 70% of its square), so words laid over it are reported to the model
        if k > 0.3:
            gx, gy = self._offset[-1]
            half = max(40.0, min(1400.0, float(size))) / 2 * 0.72
            self._prop_boxes.append((gx + cx - half, gy + cy - half * 1.1, gx + cx + half, gy + cy + half * 0.85, self._alphas[-1]))

    def logo(self, x=None, y=None, height=None):
        """
        The business's logo on a soft white chip (or its name, if it has no logo). On its own it sits top left (x 84, 64 tall). Inside a group (c.push) it fits and centres itself
        in that group, whatever the group's size, so a logo placed in a small container is still a logo: give x, y or height only to place it somewhere particular.
        """
        self._count()
        self._logo = True
        v, s = self._v, self._s
        if self._stack:
            self._logo_in_group(x, y, height)
            return
        x = 84 if x is None else x
        height = 64 if height is None else height
        y = (v.safe_top + 40) if y is None else y
        if v.has_image("logo"):
            logo = v.image("logo")
            h = int(height * s)
            w = min(int(logo.width * h / logo.height), int(300 * s))
            pad = int(14 * s)
            chip = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
            ImageDraw.Draw(chip).rounded_rectangle([0, 0, chip.width - 1, chip.height - 1], radius=int(22 * s), fill=(255, 255, 255, 255))
            chip.alpha_composite(logo.convert("RGBA").resize((w, h), Image.LANCZOS), (pad, pad))
            self._blit(chip, int(x * s), int(y * s))
        elif v.brand.get("name"):
            before = len(self._boxes)
            self.text(v.brand["name"], x, y + 10, 44, 800, v.palette["text"], width=880)
            self._logo_boxes.update(range(before, len(self._boxes)))

    def _logo_in_group(self, x, y, height):
        """The logo inside the current group: fitted to the group's own size and centred unless a position is given."""
        v, s = self._v, self._s
        gw, gh = self._img.size[0] / s, self._img.size[1] / s
        pad = max(4.0, min(14.0, gh * 0.12))
        if v.has_image("logo"):
            logo = v.image("logo")
            h = min(float(height) if height else gh - 2 * pad, gh - 2 * pad)
            w = logo.width * h / logo.height
            if w + 2 * pad > gw:
                w = gw - 2 * pad
                h = logo.height * w / logo.width
            cw, ch = w + 2 * pad, h + 2 * pad
            cx = (gw - cw) / 2 if x is None else min(max(0.0, x), max(0.0, gw - cw))
            cy = (gh - ch) / 2 if y is None else min(max(0.0, y), max(0.0, gh - ch))
            iw, ih = max(1, int(w * s)), max(1, int(h * s))
            chip = Image.new("RGBA", (int(cw * s), int(ch * s)), (0, 0, 0, 0))
            ImageDraw.Draw(chip).rounded_rectangle([0, 0, chip.width - 1, chip.height - 1], radius=int(min(22, ch * 0.3) * s), fill=(255, 255, 255, 255))
            chip.alpha_composite(logo.convert("RGBA").resize((iw, ih), Image.LANCZOS), (int(pad * s), int(pad * s)))
            self._blit(chip, int(cx * s), int(cy * s))
        elif v.brand.get("name"):
            size = max(20.0, min(44.0, gh * 0.5))
            before = len(self._boxes)
            self.text(v.brand["name"], gw / 2 if x is None else x, (gh - size * 1.1) / 2 if y is None else y, size, 800, v.palette["text"], align="center" if x is None else "left", width=max(60.0, gw - 24))
            self._logo_boxes.update(range(before, len(self._boxes)))

    def logo_at(self, cx, cy, height):
        """The business logo, centred on (cx, cy), fitted inside a box `height` tall (and up to 1.6x as wide). Returns False if the business has no logo."""
        self._count()
        v, s = self._v, self._s
        if not v.has_image("logo"):
            return False
        logo = v.image("logo")
        h = max(8, int(height * s))
        w = int(logo.width * h / logo.height)
        if w > int(height * 1.6 * s):
            w = int(height * 1.6 * s)
            h = int(logo.height * w / logo.width)
        self._blit(logo.convert("RGBA").resize((w, h), Image.LANCZOS), int(cx * s - w / 2), int(cy * s - h / 2))
        return True

    # ---- text ---------------------------------------------------------------------------------------------------------------------

    def _check_text(self, text):
        if getattr(self, "_skip_check", False):
            return
        t = _norm(text)
        if not t:
            return
        if len(t) <= 3 and all(not ch.isalpha() for ch in t):  # day numbers and separators
            return
        if t and all(word in UI_CHROME for word in t.replace(".", " ").replace(",", " ").split()):  # the neutral words of an app's own furniture
            return
        if not any(t in allowed for allowed in self._allowed):
            # phrases of the brief joined by a separator ("Cover off  •  Leaves") are still only the business's own words
            parts = [_norm(part) for part in re.split(r"\s*[•·|/–—+&]\s*", str(text)) if part.strip()]
            if len(parts) > 1 and all(any(part in allowed for allowed in self._allowed) for part in parts):
                return
            raise ValueError("text is not from the business's own words: %s. Each string on screen must be copied from the brief (a headline, subtext, item or the business name, or a part of one); join them only with a separator such as \" • \" and never add words." % str(text)[:60])

    def text_height(self, text, size, weight=700, width=912, line_height=1.1):
        """How tall `text` will be when wrapped to `width`, in design units: use it to place the next line below it."""
        self._check_text(text)
        font = self._v.fonts.get(weight, size * self._s)
        return len(wrap(ImageDraw.Draw(Image.new("L", (4, 4))), str(text), font, width * self._s)[:8]) * size * line_height

    def fit_size(self, text, size, weight=800, width=912, min_size=44):
        """The largest size, no bigger than `size`, at which the longest word of `text` still fits `width` (so a long word never spills over its column)."""
        self._check_text(text)
        scratch = ImageDraw.Draw(Image.new("L", (4, 4)))
        words = str(text).split() or [""]
        while size > min_size:
            font = self._v.fonts.get(weight, size * self._s)
            if max(scratch.textlength(word, font=font) for word in words) / self._s <= width:
                break
            size -= 4
        return size

    def text_width(self, text, size, weight=700, face="sans"):
        self._check_text(text)
        font = self._v.fonts.get(weight, size * self._s, face)
        return ImageDraw.Draw(Image.new("L", (4, 4))).textlength(str(text), font=font) / self._s

    def text(self, text, x, y, size, weight=700, color="#FFFFFF", align="left", alpha=1.0, width=912, line_height=1.1, spacing=0, shadow=0.0, face="sans"):
        """Draws words from the brief (a headline, a supporting line, an item, the name, or any part of them). Returns the height used, in design units. face: "sans" (default), "serif" or "serif_italic" (an editorial headline or an italic accent word)."""
        self._count()
        self._check_text(text)
        v, s = self._v, self._s
        px = max(6, size * s)
        font = v.fonts.get(weight, px, face)
        scratch = ImageDraw.Draw(Image.new("L", (4, 4)))
        lines = wrap(scratch, str(text), font, width * s)[:8]
        lh = px * line_height
        w = int(max(scratch.textlength(line, font=font) for line in lines) + spacing * s * max(len(line) for line in lines)) + 8
        h = int(lh * len(lines)) + int(px * 0.4)
        pad = int(24 * s) if shadow else 0
        layer = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
        d = ImageDraw.Draw(layer)
        for i, line in enumerate(lines):
            lw = scratch.textlength(line, font=font) + spacing * s * len(line)
            ox = pad + (0 if align == "left" else (w - lw) / 2 if align == "center" else w - lw)
            if spacing:
                cx = ox
                for ch in line:
                    d.text((cx, pad + i * lh), ch, font=font, fill=rgba(color))
                    cx += d.textlength(ch, font=font) + spacing * s
            else:
                d.text((ox, pad + i * lh), line, font=font, fill=rgba(color))
        if shadow:
            sh = Image.new("RGBA", layer.size, (0, 0, 0, 0))
            sh.putalpha(layer.getchannel("A").filter(ImageFilter.GaussianBlur(max(1, int(14 * s)))).point([int(i * shadow) for i in range(256)]))
            layer = Image.alpha_composite(sh, layer)
        left = x * s if align == "left" else x * s - w / 2 if align == "center" else x * s - w
        self._blit(self._apply_alpha(layer, alpha), int(left) - pad, int(y * s) - pad)
        gx, gy = self._offset[-1]
        ink = max(scratch.textlength(line, font=font) for line in lines) / s
        x0 = gx + (x if align == "left" else x - ink / 2 if align == "center" else x - ink)
        if not getattr(self, "_quiet", False):
            self._boxes.append((x0, gy + y, x0 + ink, gy + y + len(lines) * size * line_height * 0.92, alpha * self._alphas[-1], size, str(text), align))
        return len(lines) * size * line_height

    # ---- photos -------------------------------------------------------------------------------------------------------------------

    def photo(self, name, x, y, w, h, shape="rect", radius=0, zoom=1.0, pan_x=0.0, pan_y=0.0, alpha=1.0, blur=0, tint=None, tint_alpha=0.0, gray=0.0, bright=1.0, shadow=0.0):
        """
        One of the business's photos (by its brief name) cropped to a box, with a treatment. zoom >= 1 magnifies; pan_x and pan_y (-1..1) move the
        view across the spare picture (Ken Burns when you change them over time). shape: "rect", "round" (rounded corners by `radius`), "circle".
        blur (design units), tint (a colour) with tint_alpha, gray (0..1 toward black-and-white) and bright (1 = unchanged) restyle it.
        """
        self._count()
        if w * self._s < 2 or h * self._s < 2 or alpha <= 0:
            return
        self._photos += 1
        self._photo_names.append(name)
        gx, gy = self._offset[-1]
        self._photo_boxes.append((gx + x, gy + y, gx + x + w, gy + y + h, alpha * self._alphas[-1]))
        v, s = self._v, self._s
        src = v.photo_source(name)
        pw, ph = max(1, int(w * s)), max(1, int(h * s))
        if pw * ph > 40_000_000:
            raise RuntimeError("a photo is too large")
        zoom = max(1.0, min(float(zoom), 4.0))
        iw, ih = src.size
        scale0 = max(pw / iw, ph / ih)
        cw, ch = pw / (scale0 * zoom), ph / (scale0 * zoom)
        slack_x, slack_y = max(0.0, (iw - cw) / 2), max(0.0, (ih - ch) / 2)
        cx = iw / 2 + max(-1.0, min(1.0, pan_x)) * slack_x
        cy = ih / 2 + max(-1.0, min(1.0, pan_y)) * slack_y
        import pilot_cinema
        view = src.resize((pw, ph), Image.BILINEAR, box=pilot_cinema.safe_box(cx, cy, cw, ch, iw, ih))
        if blur:
            view = view.filter(ImageFilter.GaussianBlur(max(0.5, blur * s)))
        if gray:
            view = Image.blend(view, view.convert("L").convert("RGB"), max(0.0, min(1.0, gray)))
        if bright != 1.0:
            view = ImageEnhance.Brightness(view).enhance(max(0.0, min(3.0, bright)))
        if tint and tint_alpha:
            view = Image.blend(view, Image.new("RGB", view.size, rgb(tint)), max(0.0, min(1.0, tint_alpha)))
        layer = view.convert("RGBA")
        if shape == "circle":
            mask = Image.new("L", (pw * 2, ph * 2), 0)
            ImageDraw.Draw(mask).ellipse([0, 0, pw * 2 - 1, ph * 2 - 1], fill=255)
            layer.putalpha(mask.resize((pw, ph), Image.LANCZOS))
        elif shape == "round" or radius:
            mask = Image.new("L", (pw * 2, ph * 2), 0)
            ImageDraw.Draw(mask).rounded_rectangle([0, 0, pw * 2 - 1, ph * 2 - 1], radius=int(radius * s * 2), fill=255)
            layer.putalpha(mask.resize((pw, ph), Image.LANCZOS))
        if shadow and shape != "circle":
            pad = int(70 * s)
            sh = Image.new("RGBA", (pw + 2 * pad, ph + 2 * pad), (0, 0, 0, 0))
            ImageDraw.Draw(sh).rounded_rectangle([pad, pad + int(28 * s), pad + pw, pad + ph + int(28 * s)], radius=int(radius * s), fill=(2, 10, 30, int(255 * min(1.0, shadow))))
            sh = sh.filter(ImageFilter.GaussianBlur(max(1, int(30 * s))))
            self._blit(self._apply_alpha(sh, alpha), int(x * s) - pad, int(y * s) - pad)
        self._blit(self._apply_alpha(layer, alpha), int(x * s), int(y * s))

    # ---- composed helpers (they place things for you, so nothing overlaps) -------------------------------------------------------

    def backdrop(self, name, u, dim=0.55, blur=22, zoom_from=1.08, zoom_to=1.22, tint=None, tint_alpha=0.25):
        """A photo as a soft, darkened full-frame backdrop that drifts slowly: depth behind a sharp photo or text. u is the scene progress 0..1."""
        self.photo(name, 0, 0, self.W, self.H, zoom=lerp(zoom_from, zoom_to, u), pan_x=lerp(-0.4, 0.4, u), blur=blur, bright=max(0.05, 1 - dim), tint=tint, tint_alpha=tint_alpha)

    def fade(self, y, h, color, from_alpha=0.0, to_alpha=0.9):
        """A smooth full-width vertical fade of `color` from `from_alpha` at y to `to_alpha` at y+h: a scrim behind text on a photo (no visible steps)."""
        self._count()
        self._fades.append((y, h, max(from_alpha, to_alpha)))
        s = self._s
        w, hh = self._img.size[0], max(1, int(h * s))
        r, g, b = rgb(color)
        ramp = np.linspace(from_alpha, to_alpha, hh, dtype=np.float32)[:, None]
        arr = np.zeros((hh, 1, 4), dtype=np.uint8)
        arr[..., 0], arr[..., 1], arr[..., 2] = r, g, b
        arr[..., 3] = (np.clip(ramp, 0, 1) * 255).astype(np.uint8)[:, :, None].reshape(hh, 1)
        self._blit(Image.fromarray(arr, "RGBA").resize((w, hh), Image.BILINEAR), 0, int(y * s))

    def timeline_height(self, items, size=42, width=760, gap=44):
        """How tall c.timeline() will be for these items, so the block can be centred."""
        items = list(items)[:5]
        return sum(self.text_height(text, size, 700, width - 70) for text in items) + gap * max(0, len(items) - 1)

    def text_stack(self, items, x, y, width=912, gap=24, align=None):
        """
        Draws several lines of text one under another, spaced by their real heights, so they cannot overlap. `items` is a list of
        (text, size, weight, color, alpha) tuples (alpha optional). Returns the y just below the last line. With no align given, x at the middle of the
        frame means centred (so x = c.W / 2 can never end up as a left-aligned block starting in the middle), anything else left.
        """
        if align is None:
            align = "center" if abs(x - self.W / 2.0) <= 2 else "left"
        for item in list(items)[:8]:
            text, size, weight, color = item[0], item[1], item[2], item[3]
            alpha = item[4] if len(item) > 4 else 1.0
            y += self.text(text, x, y, size, weight, color, align=align, alpha=alpha, width=width) + gap
        return y - gap

    def reveal_text(self, text, x, y, size, weight, color, t, start=0.0, step=0.08, align="left", width=912, line_height=1.1, rise=44, shadow=0.0):
        """
        Kinetic text: the words of `text` rise and fade in one after another (`step` seconds apart, beginning at `start`). `t` is the seconds into
        the scene. Returns the height of the whole block, so the next line can sit below it.
        """
        self._check_text(text)
        v, s = self._v, self._s
        font = v.fonts.get(weight, max(6, size * s))
        scratch = ImageDraw.Draw(Image.new("L", (4, 4)))
        lines = wrap(scratch, str(text), font, width * s)[:8]
        space = scratch.textlength(" ", font=font) / s
        lh = size * line_height
        index = 0
        for li, line in enumerate(lines):
            words = line.split()
            widths = [scratch.textlength(wd, font=font) / s for wd in words]
            total = sum(widths) + space * max(0, len(words) - 1)
            cx = x if align == "left" else x - total / 2 if align == "center" else x - total
            for wd, ww in zip(words, widths):
                p = progress(t, start + index * step, 0.75)
                if p > 0.01:
                    self.text(wd, cx, y + li * lh + (1 - p) * rise, size, weight, color, alpha=p, width=ww + 40, shadow=shadow)
                cx += ww + space
                index += 1
        return len(lines) * lh

    def ring(self, cx, cy, r, u, color, width=14, track=None, track_alpha=0.18):
        """A circular progress ring that is `u` (0..1) full, starting at the top."""
        if track:
            self.arc(cx, cy, r, 0, 359.9, track, width, track_alpha)
        if u > 0.003:
            self.arc(cx, cy, r, -90, -90 + 359.9 * min(1.0, u), color, width)

    def timeline(self, items, x, y, t, start=0.0, step=0.55, size=42, color="#FFFFFF", accent="#E1611A", width=760, gap=44, line_alpha=0.35):
        """
        A vertical timeline: a line draws down while each item pops its dot and slides in beside it. `items` are texts from the brief.
        Returns the y below the last item.
        """
        items = list(items)[:5]
        rows = []
        cy = y
        for text in items:
            h = self.text_height(text, size, 700, width - 70)
            rows.append((cy, h))
            cy += h + gap
        end = cy - gap
        if rows:
            reach = progress(t, start, step * len(rows) + 0.4, "ease_in_out")
            top = rows[0][0] + size * 0.5
            self.line(x + 14, top, x + 14, top + (rows[-1][0] + size * 0.5 - top) * reach, color, 4, line_alpha)
        for i, (text, (ry, h)) in enumerate(zip(items, rows)):
            p = progress(t, start + i * step, 0.7)
            if p > 0.01:
                self.circle(x + 14, ry + size * 0.5, 14 * min(1.0, p * 1.3), accent)
                self.text(text, x + 56 + (1 - p) * 36, ry, size, 700, color, alpha=p, width=width - 70)
        return end

    def marquee(self, text, y, size, color, t, speed=70, alpha=0.18, weight=800, gap=60):
        """A band of `text` repeated across the video, drifting sideways: a quiet motion layer behind other content."""
        w = self.text_width(text, size, weight) + gap
        offset = (t * speed) % w
        x = -offset
        count = 0
        while x < self.W and count < 12:
            self.text(text, x, y, size, weight, color, alpha=alpha, width=w + 200)
            x += w
            count += 1

    # ---- groups (move, scale, rotate, fade a set of drawings together) -------------------------------------------------------------

    def push(self, x, y, w, h, alpha=1.0, scale=1.0, rotate=0.0, origin_x=0.5, origin_y=0.5):
        """
        Starts a group: everything drawn until pop() goes onto a transparent box whose top-left is (x, y) and whose size is w by h; (0, 0) is
        then the box's top-left. pop() places the group with `alpha`, `scale` (about origin_x/origin_y, as fractions of the box) and `rotate`
        (degrees, about the box's centre). Groups can nest 3 deep.
        """
        self._count()
        self._groups += 1
        if self._groups > MAX_GROUPS or len(self._stack) >= MAX_DEPTH:
            raise RuntimeError("too many groups")
        s = self._s
        gw, gh = max(1, int(w * s)), max(1, int(h * s))
        if gw * gh > 30_000_000:
            raise RuntimeError("a group is too large")
        self._stack.append((self._img, x * s, y * s, gw, gh, alpha, scale, rotate, origin_x, origin_y))
        self._img = Image.new("RGBA", (gw, gh), (0, 0, 0, 0))
        gx, gy = self._offset[-1]
        self._offset.append((gx + x, gy + y))
        self._alphas.append(self._alphas[-1] * alpha)

    def pop(self):
        if not self._stack:
            raise RuntimeError("pop() without a matching push()")
        parent, x, y, gw, gh, alpha, scale, rotate, ox, oy = self._stack.pop()
        self._offset.pop()
        self._alphas.pop()
        group = self._img
        self._img = parent
        scale = max(0.01, min(float(scale), 6.0))
        if abs(scale - 1) > 1e-3:
            group = group.resize((max(1, int(gw * scale)), max(1, int(gh * scale))), Image.BILINEAR)
        # keep the origin point of the box fixed while scaling
        dx = (gw - group.width) * ox
        dy = (gh - group.height) * oy
        if abs(rotate) > 1e-3:
            before = group.size
            group = group.rotate(-rotate, resample=Image.BICUBIC, expand=True)
            dx -= (group.width - before[0]) / 2
            dy -= (group.height - before[1]) / 2
        self._blit(self._apply_alpha(group, alpha), x + dx, y + dy)

    def _finish(self):
        while self._stack:
            self.pop()


# ---- helpers the script may call -------------------------------------------------------------------------------------------------

def ease(name, t):
    """Easing: linear, ease_out, ease_in_out, back_out, expo_out (t from 0 to 1)."""
    return EASINGS.get(name, EASINGS["ease_out"])(clamp01(t))


def clamp(v, lo=0.0, hi=1.0):
    return max(lo, min(hi, v))


def progress(t, start, duration, easing="expo_out"):
    """0 before `start` seconds, 1 after `start + duration`, eased in between."""
    return ease(easing, (t - start) / max(0.05, duration))


def wobble(seed, t, speed=1.0):
    """A smooth, repeatable drift between -1 and 1 (for floating, swaying, breathing)."""
    return 0.6 * math.sin(t * speed * 1.7 + seed * 12.9898) + 0.4 * math.sin(t * speed * 0.9 + seed * 78.233)


def rand(seed):
    """A repeatable pseudo-random number between 0 and 1 for a whole-number seed."""
    x = math.sin(seed * 12.9898 + 78.233) * 43758.5453
    return x - math.floor(x)


class DrawScene(object):
    """A scene the script draws itself, frame by frame."""

    def __init__(self, video, seconds, draw, transition="fade", transition_seconds=0.6):
        self.video = video
        self.seconds = float(seconds)
        self.draw = draw
        self.transition = transition if transition in TRANSITIONS else "fade"
        self.transition_seconds = min(float(transition_seconds), self.seconds / 2)

    def frame_at(self, t):
        import signal
        v = self.video
        frame = Image.new("RGB", (v.width, v.height), rgb(v.palette["bg_a"]))
        canvas = Canvas(v, frame)
        try:
            signal.setitimer(signal.ITIMER_REAL, FRAME_SECONDS)  # a frame that takes too long is stopped
            self.draw(canvas, max(0.0, t), clamp01(t / self.seconds if self.seconds else 0))
            canvas._finish()
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
        return frame


SIZE_BUCKETS = (("small", 0), ("medium", 60), ("large", 96), ("dominant", 140))


def size_bucket(size):
    name = "small"
    for label, floor in SIZE_BUCKETS:
        if size >= floor:
            name = label
    return name


def text_block(canvas, video):
    """The scene's main text as one block: where it sits (alignment and row), how big its type is and how much of the width it spans. None when the scene has no words of its own."""
    W, H = video.W, video.H
    visible = [b for i, b in enumerate(canvas._boxes) if b[4] >= 0.5 and i not in canvas._logo_boxes]
    if not visible:
        return None
    big = max(b[5] for b in visible)
    main = [b for b in visible if b[5] >= 0.9 * big]
    x0, x1 = min(b[0] for b in main), max(b[2] for b in main)
    y0, y1 = min(b[1] for b in main), max(b[3] for b in main)
    # alignment from where the block sits (reveal_text draws every word as its own left-aligned piece, so the words' own alignment says nothing about the block)
    mid = (x0 + x1) / 2.0
    if abs(mid - W / 2.0) <= 0.03 * W:  # centred on the frame: its middle is the frame's middle, however wide the block is (a left-aligned block is not symmetric about the centre)
        align = "center"
    elif x1 > 0.82 * W and x0 > 0.3 * W:
        align = "right"
    elif x0 < 0.18 * W:
        align = "left"
    else:
        align = "left" if x0 < W - x1 else "right"
    cy = (y0 + y1) / 2.0
    return {"align": align, "row": 0 if cy < H / 3.0 else 1 if cy < 2 * H / 3.0 else 2, "size": int(round(big)), "width": round((x1 - x0) / float(W), 2), "x0": round(x0), "x1": round(x1)}


def scene_signature(canvas, video):
    """What a scene's composition is made of, in coarse terms: where its biggest text sits (a 3x3 cell), how big it is, the scrim and the camera moves."""
    block = text_block(canvas, video)
    cell = None
    size = 0
    if block:
        col = {"left": 0, "center": 1, "right": 2}.get(block["align"], 0)
        cell = (col, block["row"])
        size = int(round(block["size"] / 24.0))
    scrim = tuple(sorted((int(round(f[0] / video.H * 8)), int(round(f[1] / video.H * 8)), int(round(f[2] * 4))) for f in canvas._fades))
    return {"cell": cell, "size": size, "scrim": scrim, "cam": tuple(canvas._cam)}


def measure_scene(canvas, video):
    """What a settled frame of a scene really contains, in the terms a storyboard uses."""
    return {"text": text_block(canvas, video), "scrim": round(max([f[2] for f in canvas._fades] or [0.0]), 2), "cams": list(canvas._cam_info), "assets": sorted(set(canvas._photo_names))}


POSITIONS = {"top_left": (0, 0), "top_center": (1, 0), "top_right": (2, 0), "middle_left": (0, 1), "middle_center": (1, 1), "middle_right": (2, 1), "bottom_left": (0, 2), "bottom_center": (1, 2), "bottom_right": (2, 2)}
ALIGN_COL = {"left": 0, "center": 1, "right": 2}
COL_NAMES, ROW_NAMES = ("left", "centre", "right"), ("top", "middle", "bottom")
CAMERA_MOVES = {"push_in": "push", "pull_out": "pull", "pan_left": "pan_left", "pan_right": "pan_right", "tilt_up": "tilt_up", "tilt_down": "tilt_down", "orbit": "orbit", "handheld": "handheld", "drift": "drift"}
CROPS = {"wide": (0.0, 1.25), "medium": (1.15, 1.65), "tight": (1.5, 2.2), "macro": (2.1, 9.0)}
IMAGE_FREE = ("typographic", "graphic_motion", "logo_card")


def _want_text(shot, scale_ok, block):
    """What a storyboard's text decision asks for, against the measured text block: a list of (requirement, actual, fix)."""
    out = []
    kind = shot.get("text")
    if kind == "none":
        if block:
            out.append(("no words on screen", "words on screen (type size %d)" % block["size"], "remove every c.text and c.reveal_text from this scene: it is carried by the picture alone"))
        return out
    if kind in ("headline", "headline_sub", "type_only") and not block:
        out.append(("words on screen", "no words are drawn", "draw this scene's headline with c.reveal_text or c.text"))
        return out
    if not block:
        return out
    position = shot.get("text_position")
    if position == "fill":
        if block["width"] < 0.6 and block["size"] < 130:
            out.append(("type fills the frame (dominant, spanning most of the width, centred)", "type size %d spanning %d%% of the width, %s" % (block["size"], round(block["width"] * 100), COL_NAMES[ALIGN_COL.get(block["align"], 0)]), "set the headline at size 140 or more with align=\"center\" and a width near 900 so it dominates the frame"))
    elif position in POSITIONS:
        col, row = POSITIONS[position]
        got_col = ALIGN_COL.get(block["align"], 0)
        if got_col != col or abs(block["row"] - row) >= 2:
            out.append(("text %s %s" % (ROW_NAMES[row], COL_NAMES[col]), "text %s %s (the text block spans x %d to %d of 1080)" % (ROW_NAMES[block["row"]], COL_NAMES[got_col], block["x0"], block["x1"]), "move the headline to the %s %s (set align and x%s)" % (ROW_NAMES[row], COL_NAMES[col], ' to c.W / 2 for centred' if col == 1 else '')))
    scale = shot.get("text_scale")
    if scale and not scale_ok(scale, block):
        out.append(("%s type" % scale, "type size %d spanning %d%% of the width" % (block["size"], round(block["width"] * 100)), "set the headline size to %s" % {"small": "about 44 to 56", "medium": "about 64 to 90", "large": "about 100 to 130", "dominant": "140 or more"}[scale]))
    return out


def _scale_ok(scale, block):
    size = block["size"]
    return {"dominant": size >= 110 or block["width"] >= 0.75, "large": size >= 80, "small": size <= 100, "medium": 48 <= size <= 130}.get(scale, True)


def fidelity_problems(video, measures):
    """
    The storyboard is a contract: this compares what each scene's frames really contain with what its shot asked for, and reports every obvious mismatch in the form the repair acts on
    (the scene, the requirement, the actual result, the fix, and what to keep). It looks at the measurable decisions only: text (present or not, position, size), camera move and crop,
    scrim, which picture, length and transition. Intensity, lighting and mood are left to the design review.
    """
    scenes = video.brief.get("scenes", [])
    planned = [(i, sc) for i, sc in enumerate(scenes) if sc.get("shot")]
    if not planned:
        return []
    problems = []
    if len(video.scenes) != len(scenes):
        problems.append("STORYBOARD MISMATCH: the storyboard has %d scenes and the code adds %d. REQUIRED FIX: write exactly one video.add_scene per storyboard scene, in the storyboard's order (storyboard scene k is code scene k); do not merge, drop or add scenes." % (len(scenes), len(video.scenes)))
    wanted_assets = {sc.get("photo") for _, sc in planned if sc.get("photo")}
    used_assets = set()
    for number, m in measures.items():
        used_assets.update(m["assets"])
    if len(wanted_assets) >= 2 and len(used_assets & wanted_assets) < len(wanted_assets):
        missing = sorted(wanted_assets - used_assets)
        problems.append("STORYBOARD MISMATCH: the storyboard uses %d different pictures (%s) but the code never shows %s. REQUIRED FIX: show each scene's own picture, as assigned in the storyboard (scene.photo)." % (len(wanted_assets), ", ".join(sorted(wanted_assets)), ", ".join(missing)))
    for index, scene in planned:
        number = index + 1
        shot = scene["shot"]
        code = video.scenes[index] if index < len(video.scenes) else None
        if code is None:
            continue
        found = []
        if abs(code.seconds - float(scene.get("seconds", code.seconds))) > 0.6:
            found.append(("lasts %.1f seconds" % float(scene["seconds"]), "lasts %.1f seconds" % code.seconds, "use %.1f as the scene's seconds in video.add_scene" % float(scene["seconds"])))
        want_transition = scene.get("transition")
        if want_transition and index < len(scenes) - 1 and code.transition != want_transition:
            found.append(("hands over by %s" % want_transition, "hands over by %s" % code.transition, "pass \"%s\" as the transition of this scene's video.add_scene" % want_transition))
        m = measures.get(number)
        if m is not None:
            found.extend(_want_text(shot, _scale_ok, m["text"]))
            has_image = shot.get("composition") not in IMAGE_FREE
            camera = shot.get("camera")
            if has_image and camera and camera != "static":
                moves = [c["move"] for c in m["cams"]]
                if not moves:
                    found.append(("camera %s over the picture" % camera.replace("_", " "), "no c.camera: the picture does not move", "show the picture with c.camera(\"%s\", u, \"%s\", ...)" % (scene.get("photo") or "p1", CAMERA_MOVES.get(camera, "push"))))
                elif CAMERA_MOVES.get(camera) not in moves:
                    found.append(("camera %s" % camera.replace("_", " "), "camera %s" % ", ".join(moves), "use the move \"%s\" in this scene's c.camera call" % CAMERA_MOVES.get(camera, "push")))
            crop = shot.get("crop")
            if has_image and crop in CROPS and m["cams"]:
                lo, hi = CROPS[crop]
                z = m["cams"][0]["zoom"]
                if not (lo <= z <= hi):
                    found.append(("%s crop" % crop, "crop zoom %.2f" % z, "pass zoom=%s to c.camera (wide 1.0, medium 1.3, tight 1.8, macro 2.5)" % {"wide": "1.0", "medium": "1.3", "tight": "1.8", "macro": "2.5"}[crop]))
            if has_image and shot.get("subject_at") and crop in ("tight", "macro") and m["cams"] and not any(c.get("at") for c in m["cams"]):
                found.append(("a %s crop aimed at the subject (it sits at x %.2f, y %.2f)" % (crop, shot["subject_at"]["x"], shot["subject_at"]["y"]), "the crop is not aimed at anything", "pass at=(%.2f, %.2f) to c.camera so the crop lands on the subject" % (shot["subject_at"]["x"], shot["subject_at"]["y"])))
            scrim = shot.get("scrim")
            if scrim == "none" and m["scrim"] >= 0.2:
                found.append(("no scrim", "a scrim up to %d%% opaque" % round(m["scrim"] * 100), "remove the c.fade scrim; light the picture instead"))
            elif scrim == "heavy" and m["scrim"] < 0.55:
                found.append(("a heavy scrim", "a scrim of %d%%" % round(m["scrim"] * 100), "darken the area under the words with c.fade up to 0.7 or more"))
            elif scrim == "light" and not (0.1 <= m["scrim"] <= 0.65):
                found.append(("a light scrim", "a scrim of %d%%" % round(m["scrim"] * 100), "use a c.fade of about 0.3 to 0.5"))
            photo = scene.get("photo")
            if has_image and photo and m["assets"] and photo not in m["assets"]:
                found.append(("the picture %s" % photo, "the picture %s" % ", ".join(m["assets"]), "show %s in this scene (its subject: %s)" % (photo, shot.get("subject", "see the storyboard"))))
        if found:
            problems.append("STORYBOARD MISMATCH, scene %d (%s):\nSTORYBOARD REQUIREMENT: %s\nACTUAL RESULT: %s\nREQUIRED FIX: %s\nPRESERVE: the scene's duration and transition and everything in it that already matches the storyboard; do not touch the other scenes." % (number, (scene.get("headline") or shot.get("purpose") or "")[:40], "; ".join(f[0] for f in found), "; ".join(f[1] for f in found), "; ".join(f[2] for f in found)))
    return problems


def _draw_at(video, scene, u):
    import signal
    canvas = Canvas(video, Image.new("RGB", (video.width, video.height), rgb(video.palette["bg_a"])))
    try:
        signal.setitimer(signal.ITIMER_REAL, FRAME_SECONDS)
        scene.draw(canvas, u * scene.seconds, u)
        canvas._finish()
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
    return canvas


def measure_video(video):
    """What every scene the script draws really contains at the end of the scene (see measure_scene), plus its length and how it hands over: the numbers the storyboard check reads."""
    out = []
    begins = video._begins()
    for number, scene in enumerate(video.scenes, 1):
        entry = {"scene": number, "begin": round(begins[number - 1], 2), "seconds": round(scene.seconds, 2), "transition": scene.transition, "transition_seconds": round(scene.transition_seconds, 2)}
        if isinstance(scene, DrawScene):
            entry.update(measure_scene(_draw_at(video, scene, 0.92), video))
        out.append(entry)
    return out


def repetition_problems(signatures):
    """Three or more consecutive scenes whose headline sits in the same place at the same size under the same scrim are a template with different backgrounds: say so, and where."""
    names_x, names_y = ("left", "centre", "right"), ("top", "middle", "bottom")
    problems = []
    run = []

    def close(run):
        if len(run) >= 3:
            first = run[0][1]
            cams = sorted(set(m for _, sig in run for m in sig["cam"]))
            problems.append("Scenes %s have the same composition: the headline sits %s %s at the same size under the same scrim%s. Decide for each scene what the eye should go to and whether it needs words at all: a full-frame image with no words, a centred title, big type with no scrim, a different crop or a quiet moment would carry at least one of them better." % (
                ", ".join(str(n) for n, _ in run), names_y[first["cell"][1]], names_x[first["cell"][0]], (" and the camera only varies between %s" % ", ".join(cams)) if cams else ""))

    for number, sig in signatures:
        key = (sig["cell"], sig["size"], sig["scrim"])
        if sig["cell"] is not None and run and (run[-1][1]["cell"], run[-1][1]["size"], run[-1][1]["scrim"]) == key:
            run.append((number, sig))
        else:
            close(run)
            run = [(number, sig)] if sig["cell"] is not None else []
    close(run)
    return problems


def lint_video(video):
    """
    Draws two sample frames of every scene the script draws itself and reports layout problems in plain words, so the model can fix them:
    text overlapping text, text off the edge or in the platform's button area, text that is too small, a scene with no words, no photo
    where one was given, or no logo. Library scenes are composed by Pilot and are not checked.
    """
    problems = []
    signatures = []
    measures = {}
    W, H = video.W, video.H
    asked = float(video.brief.get("total_seconds") or 0)
    if asked and abs(video.total_seconds() - asked) > max(0.8, 0.06 * asked):
        problems.append("The video runs %.1f seconds but %.0f were asked for (a scene that follows a whip, crosszoom, lightleak or slice starts 0.6 s early, so those overlaps are not played twice). Give every scene the seconds the storyboard gives it (b[i][\"seconds\"]) and do not add or drop time." % (video.total_seconds(), asked))
    photos_given = [name for name in video.assets if name != "logo"]
    start = 0.0
    for number, scene in enumerate(video.scenes, 1):
        if isinstance(scene, DrawScene):
            seen_logo = False
            seen_text = False
            for u in (0.5, 0.92):
                t = u * scene.seconds
                canvas = Canvas(video, Image.new("RGB", (video.width, video.height), rgb(video.palette["bg_a"])))
                import signal
                try:
                    signal.setitimer(signal.ITIMER_REAL, FRAME_SECONDS)
                    scene.draw(canvas, t, u)
                    canvas._finish()
                finally:
                    signal.setitimer(signal.ITIMER_REAL, 0)
                seen_logo = seen_logo or canvas._logo
                visible = [b for b in canvas._boxes if b[4] >= 0.5]
                seen_text = seen_text or bool(visible)
                for i, a in enumerate(visible):
                    if a[5] < 30:
                        problems.append("Scene %d: text \"%s\" is too small (%d). On a phone screen use at least 34 (supporting lines read best at 44 or more)." % (number, a[6][:30], a[5]))
                    if video.brief.get("strategy"):  # the storyboard's own lines are set as the storyboard says: a supporting line is never small print, a headline is set big
                        listed = video.brief.get("scenes") or []
                        planned = listed[number - 1] if number - 1 < len(listed) else {}
                        shown = a[6].strip().lower()
                        if shown and shown == str(planned.get("subtext", "")).strip().lower() and a[5] < 42:
                            problems.append("Scene %d: the supporting line \"%s\" is set at %d, which is small print on a phone. Set it at 44 or more." % (number, a[6][:30], a[5]))
                        elif shown and shown == str(planned.get("headline", "")).strip().lower() and a[5] < 64 and a[5] >= max(b[5] for b in visible) and (planned.get("shot") or {}).get("text_scale") != "small":
                            problems.append("Scene %d: the headline \"%s\" is set at %d. Set headlines at 72 or more (the storyboard's text size says how much bigger)." % (number, a[6][:30], a[5]))
                    if a[0] < -2 or a[2] > W + 2:
                        problems.append("Scene %d: text \"%s\" runs off the side of the video. Reduce its size or width." % (number, a[6][:30]))
                    if H > W and a[3] > H - 150 and u > 0.8:
                        problems.append("Scene %d: text \"%s\" ends at y=%d, inside the bottom area the platforms cover with their own buttons. The BOTTOM EDGE of every line must be above y=%d: start the block higher (the block's height is its lines added up, so a large headline that wraps to two lines needs its top about %d higher) or make the type smaller." % (number, a[6][:30], a[3], H - 150, int(a[3] - (H - 150)) + 20))
                    for b in visible[i + 1:]:
                        ix = max(0.0, min(a[2], b[2]) - max(a[0], b[0]))
                        iy = max(0.0, min(a[3], b[3]) - max(a[1], b[1]))
                        small = min((a[2] - a[0]) * (a[3] - a[1]), (b[2] - b[0]) * (b[3] - b[1]))
                        if small > 0 and ix * iy > 0.12 * small:
                            ia, ib = canvas._boxes.index(a), canvas._boxes.index(b)
                            if ia in canvas._logo_boxes or ib in canvas._logo_boxes:
                                other = b if ia in canvas._logo_boxes else a
                                problems.append("Scene %d: the business name that c.logo() writes at the top left (no logo file was given) overlaps \"%s\". Move the other text clear of it (keep it below y=%d), or place the name yourself where nothing else is with c.logo(x, y), or remove c.logo() from a scene where the strategy does not put the brand." % (number, other[6][:30], int(max(a[3], b[3]) + 20)))
                            else:
                                problems.append("Scene %d: the text \"%s\" overlaps \"%s\". Place the second line below the first using the height c.text() returns (or c.text_height)." % (number, a[6][:30], b[6][:30]))
                for a in visible:
                    area = max(1.0, (a[2] - a[0]) * (a[3] - a[1]))
                    for p in canvas._photo_boxes:
                        if p[4] < 0.5:
                            continue
                        inside = max(0.0, min(a[2], p[2]) - max(a[0], p[0])) * max(0.0, min(a[3], p[3]) - max(a[1], p[1])) / area
                        if number != len(video.scenes) and 0.015 < inside < 0.8 and (p[2] - p[0]) * (p[3] - p[1]) < 0.7 * W * H:
                            problems.append("Scene %d: the text \"%s\" is partly over a photo. Put text clearly beside or below a photo, or fully on top of a large darkened one." % (number, a[6][:30]))
                for a in visible:
                    area = max(1.0, (a[2] - a[0]) * (a[3] - a[1]))
                    for p in canvas._prop_boxes:
                        if p[4] < 0.5:
                            continue
                        inside = max(0.0, min(a[2], p[2]) - max(a[0], p[0])) * max(0.0, min(a[3], p[3]) - max(a[1], p[1])) / area
                        if inside > 0.45:
                            problems.append("Scene %d: the text \"%s\" is drawn over your illustration. Put words above or below the drawing, clear of it." % (number, a[6][:30]))
                if u > 0.9:
                    for p in canvas._photo_boxes:
                        if p[4] < 0.5:
                            continue
                        full = max(1.0, (p[2] - p[0]) * (p[3] - p[1]))
                        shown = max(0.0, min(p[2], W) - max(p[0], 0)) * max(0.0, min(p[3], H) - max(p[1], 0))
                        if shown / full < 0.9 and full < 3 * W * H and shown < 0.9 * W * H:
                            problems.append("Scene %d: a photo is cut off by the edge of the video. Keep photos inside x 0-%d (or make one fill the whole frame)." % (number, W))
                    # a small piece of a picture pasted over a full-frame camera shot is a thumbnail, not a character: things move by cutting between pictures or by the camera
                    if canvas._cam and any((b[2] - b[0]) * (b[3] - b[1]) < 0.15 * W * H and b[4] >= 0.5 for b in canvas._photo_boxes):
                        problems.append("Scene %d pastes a small copy or crop of a picture over a full-frame picture (an inset thumbnail). Remove it: show the picture once, full frame with c.camera; a moving object is shown by cutting to the next picture, and only light, particles and type are drawn over it." % number)
                    scene_photos = len(canvas._photo_boxes)
            # the first scene must open on a picture only when nothing else decided otherwise: with a storyboard, scene 1 has a picture when the storyboard gave it one
            first = (video.brief.get("scenes") or [{}])[0]
            opens_on_picture = bool(first.get("photo")) if (video.brief.get("strategy") or first.get("shot")) else True
            if number == 1 and photos_given and opens_on_picture and video.brief.get("look") != "motion" and not any(b[4] >= 0.5 for b in canvas._photo_boxes):
                problems.append("Scene 1 shows no photo, but the business gave you photos (%s). Open with a photo: it is the strongest hook." % ", ".join(photos_given))
            if video.brief.get("require_motion"):
                signatures.append((number, scene_signature(canvas, video)))
                measures[number] = measure_scene(canvas, video)
            # a scene must move: two frames a third of a second apart that are almost identical mean a still
            try:
                planned = ((video.brief.get("scenes") or [])[number - 1:number] or [{}])[0].get("shot") or {}
                held = planned.get("camera") == "static" and scene.seconds <= 2.5  # a short hold the storyboard asked for (an end card) is a decision, not a missing move
                if not video.brief.get("require_motion") or scene.seconds < 1.6 or held:  # a beat of a second or so (a logo card, a flash) is not expected to show motion between two sample frames
                    raise LookupError
                import signal
                import numpy as np
                shots = []
                for tt in (scene.seconds * 0.4, scene.seconds * 0.4 + 0.35):
                    cv = Canvas(video, Image.new("RGB", (video.width, video.height), rgb(video.palette["bg_a"])))
                    signal.setitimer(signal.ITIMER_REAL, FRAME_SECONDS)
                    try:
                        scene.draw(cv, tt, min(1.0, tt / scene.seconds))
                        cv._finish()
                    finally:
                        signal.setitimer(signal.ITIMER_REAL, 0)
                    shots.append(np.asarray(cv._img.convert("RGB").resize((video.width // 6, video.height // 6), Image.BILINEAR), dtype=np.float32))
                closing = number == len(video.scenes)  # a calm end card with a pulsing button and a settling logo needs only a little movement
                if float(np.abs(shots[0] - shots[1]).mean()) < (0.04 if closing else 0.2 if video.brief.get("look") == "motion" else 0.6):
                    problems.append("Scene %d is almost a still picture: nothing in it moves. Use c.camera with a move, moving light (c.caustics, c.light_leak, c.dust) or kinetic text." % number)
            except LookupError:
                pass
            except TimeoutError:
                raise
            except Exception:
                pass
            planned_text = (video.brief.get("scenes", [{}] * number)[number - 1].get("shot") or {}).get("text") if number - 1 < len(video.brief.get("scenes", [])) else None
            if not seen_text and planned_text != "none":
                problems.append("Scene %d has no words on screen." % number)
            # where the logo is required: the strategy's brand decision (the last scene, or every scene); without a strategy, a motion-graphics video carries it on its last scene only
            rule = video.brief.get("logo_rule") or ("last" if video.brief.get("look") == "motion" else "every")
            wanted_here = rule == "every" or (rule == "last" and number == len(video.scenes)) or (rule == "ends" and number in (1, len(video.scenes)))
            if not seen_logo and wanted_here:
                problems.append("Scene %d never calls c.logo(). The strategy puts the business logo here." % number)
            if seen_logo and not wanted_here and video.brief.get("logo_rule"):  # forbidden only where the strategy decided where the brand goes
                problems.append("Scene %d calls c.logo(), but the strategy shows the business name or logo only %s. Remove c.logo() from this scene." % (number, "on the last scene" if rule == "last" else "on the first and last scenes"))
        start += scene.seconds
    problems = (fidelity_problems(video, measures) if video.brief.get("require_motion") else []) + problems
    problems.extend(repetition_problems(signatures))
    return list(dict.fromkeys(problems))[:8]
