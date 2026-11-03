"""
Pilot's scene library for code-written videos. TRUSTED code: it is not written by the model and is not run on the model's behalf with any
extra rights. The model only writes a short `build(video)` function that calls what is defined here; see API.md.

Everything is drawn with Pillow into frames that are piped to ffmpeg. Positions are in "design units" for a 1080-wide video and scaled to
the real size, exactly like Pilot's other renderer, so the two look alike.
"""
import math
import subprocess
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

DESIGN_W = 1080
MARGIN = 84
COLUMN = DESIGN_W - 2 * MARGIN


def clamp01(v):
    return max(0.0, min(1.0, v))


def lerp(a, b, k):
    return a + (b - a) * k


EASINGS = {
    "linear": lambda t: t,
    "ease_out": lambda t: 1 - (1 - t) ** 3,
    "ease_in_out": lambda t: 4 * t ** 3 if t < 0.5 else 1 - ((-2 * t + 2) ** 3) / 2,
    "back_out": lambda t: 1 + 2.70158 * (t - 1) ** 3 + 1.70158 * (t - 1) ** 2,
    "expo_out": lambda t: 1.0 if t >= 1 else 1 - 2 ** (-10 * t),
}


def rgb(hex_colour):
    text = str(hex_colour).strip()
    if text.startswith("rgb"):  # "rgb(1,2,3)" or "rgba(1,2,3,0.5)" are accepted too
        parts = [float(v) for v in text[text.index("(") + 1:text.index(")")].split(",")[:3]]
        return (int(parts[0]), int(parts[1]), int(parts[2]))
    h = text.lstrip("#")
    if len(h) == 3:
        h = "".join(c + c for c in h)
    if len(h) != 6 or any(ch not in "0123456789abcdefABCDEF" for ch in h):
        raise ValueError("%r is not a colour. Colours are \"#RRGGBB\" strings; use the palette's colour names (bg_a, bg_b, glow, glow2, tone_a, tone_b, accent, text), not a flag such as p.dark or p.light." % (text,))
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16))


def rgba(hex_colour, alpha=1.0):
    r, g, b = rgb(hex_colour)
    return (r, g, b, int(255 * clamp01(alpha)))


# ---- animation --------------------------------------------------------------------------------------------------------------------

class Motion(object):
    """How an element arrives: a delay, a duration, a kind (fade, slide_up, grow, pop, none) and an easing."""

    def __init__(self, kind="slide_up", delay=0.0, duration=0.9, easing="expo_out"):
        self.kind = kind if kind in ("fade", "slide_up", "grow", "pop", "none") else "fade"
        self.delay = float(delay)
        self.duration = max(0.05, float(duration))
        self.easing = EASINGS.get(easing, EASINGS["expo_out"])

    def progress(self, t):
        if self.kind == "none":
            return 1.0
        return clamp01(self.easing(clamp01((t - self.delay) / self.duration)))


# ---- drawing helpers --------------------------------------------------------------------------------------------------------------

class Fonts(object):
    def __init__(self, font_dir):
        self.dir = font_dir
        self.cache = {}

    def get(self, weight, px, face="sans"):
        weight = weight if weight in (400, 700, 800) else 700
        key = (face, weight, int(px))
        if key not in self.cache:
            try:
                if face in ("serif", "serif_italic"):
                    w = 700 if weight == 800 else weight
                    self.cache[key] = ImageFont.truetype("%s/../../lora/files/lora-latin-%d-%s.woff" % (self.dir, w, "italic" if face == "serif_italic" else "normal"), int(px))
                else:
                    self.cache[key] = ImageFont.truetype("%s/inter-latin-%d-normal.woff" % (self.dir, weight), int(px))
            except Exception:
                try:
                    self.cache[key] = ImageFont.truetype("%s/inter-latin-%d-normal.woff" % (self.dir, weight), int(px))
                except Exception:
                    self.cache[key] = ImageFont.load_default()
        return self.cache[key]


def wrap(draw, text, font, max_w):
    lines = []
    for paragraph in str(text).split("\n"):
        line = ""
        for word in paragraph.split():
            attempt = (line + " " + word).strip()
            if line and draw.textlength(attempt, font=font) > max_w:
                lines.append(line)
                line = word
            else:
                line = attempt
        lines.append(line)
    return lines


def rounded(size, radius, fill=255):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, size[0] - 1, size[1] - 1], radius=radius, fill=fill)
    return mask


class Layer(object):
    """A pre-drawn picture with its own transparency, placed on a scene and animated."""

    def __init__(self, scene, image, x, y, motion, float_amount=0.0, drift=(0, 0), opacity=1.0, anchor=(0.5, 0.5)):
        self.scene = scene
        self.rgb = image.convert("RGB")
        self.alpha = image.getchannel("A") if image.mode == "RGBA" else Image.new("L", image.size, 255)
        self.x, self.y = x, y
        self.motion = motion
        self.float_amount = float_amount
        self.drift = drift
        self.opacity = opacity
        self.anchor = anchor
        self._tables = {}

    def paint(self, frame, t, seconds):
        s = self.scene.video.s
        p = self.motion.progress(t)
        if p <= 0:
            return
        k = clamp01(seconds and t / seconds)
        x = self.x + self.drift[0] * s * k
        y = self.y + self.drift[1] * s * k
        if self.float_amount:
            phase = (self.x + self.y) / (170.0 * s)
            w = (t * math.pi * 2) / 4.2 + phase
            x += math.cos(w * 0.8) * self.float_amount * 0.35 * s
            y += math.sin(w) * self.float_amount * s
        alpha = self.opacity
        img, mask = self.rgb, self.alpha
        kind = self.motion.kind
        if kind == "slide_up":
            y += (1 - p) * 56 * s
            alpha *= clamp01(p * 1.6)
        elif kind == "fade":
            alpha *= p
        elif kind == "grow":
            if p < 0.999:
                nw = max(1, int(img.width * p))
                img, mask = img.resize((nw, img.height)), mask.resize((nw, mask.height))
        elif kind == "pop":
            scale = 0.7 + 0.3 * p
            alpha *= clamp01(p * 1.6)
            if scale < 0.999:
                nw, nh = max(1, int(img.width * scale)), max(1, int(img.height * scale))
                x += (self.rgb.width - nw) * self.anchor[0]
                y += (self.rgb.height - nh) * self.anchor[1]
                img, mask = img.resize((nw, nh)), mask.resize((nw, nh))
        if alpha < 0.999:
            key = int(alpha * 100)
            table = self._tables.get(key)
            if table is None:
                table = self._tables[key] = [int(i * key / 100.0) for i in range(256)]
            mask = mask.point(table)
        frame.paste(img, (int(round(x)), int(round(y))), mask)


def icon_image(kind, px, color="#FFFFFF", disc=None):
    """A small drawn symbol (tick, arrow, star), optionally on a coloured disc."""
    px = max(8, int(px))
    img = Image.new("RGBA", (px, px), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if disc:
        d.ellipse([0, 0, px - 1, px - 1], fill=rgba(disc))
    c = rgba(color)
    wdt = max(2, int(px * 0.12))
    if kind == "tick":
        d.line([(px * 0.28, px * 0.52), (px * 0.45, px * 0.68), (px * 0.74, px * 0.34)], fill=c, width=wdt, joint="curve")
    elif kind == "arrow":
        d.line([(px * 0.22, px * 0.5), (px * 0.78, px * 0.5)], fill=c, width=wdt)
        d.line([(px * 0.55, px * 0.28), (px * 0.78, px * 0.5), (px * 0.55, px * 0.72)], fill=c, width=wdt, joint="curve")
    elif kind == "star":
        pts = []
        for i in range(10):
            a = -math.pi / 2 + i * math.pi / 5
            rad = px * (0.42 if i % 2 == 0 else 0.18)
            pts.append((px / 2 + math.cos(a) * rad, px / 2 + math.sin(a) * rad))
        d.polygon(pts, fill=c)
    return img


# "whip", "crosszoom", "lightleak" and "slice" are live transitions: the next scene is already moving while it arrives, and the two scenes overlap in time
LIVE = ("whip", "crosszoom", "lightleak", "slice")
TRANSITIONS = ("fade", "push", "zoom", "wipe", "iris") + LIVE


def _smear(img, dx, dy, steps=7):
    """Motion blur: the picture averaged over a short path (dx, dy in pixels)."""
    w, h = img.size
    acc = np.zeros((h, w, 3), dtype=np.float32)
    for i in range(steps):
        f = i / float(steps - 1) - 0.5
        acc += np.asarray(img.transform((w, h), Image.AFFINE, (1, 0, -dx * f, 0, 1, -dy * f), Image.BILINEAR), dtype=np.float32)
    return Image.fromarray((acc / steps).astype(np.uint8), "RGB")


def _scaled(img, z, steps=1, spread=0.0):
    """The picture magnified about its centre by z (a zoom blur when steps > 1: the average of several magnifications up to z + spread)."""
    w, h = img.size
    acc = np.zeros((h, w, 3), dtype=np.float32)
    for i in range(steps):
        zz = z + spread * (i / float(max(1, steps - 1)) if steps > 1 else 0.0)
        cw, ch = w / zz, h / zz
        acc += np.asarray(img.resize((w, h), Image.BILINEAR, box=((w - cw) / 2, (h - ch) / 2, (w + cw) / 2, (h + ch) / 2)), dtype=np.float32)
    return Image.fromarray((acc / steps).astype(np.uint8), "RGB")


def live_transition(kind, outgoing, incoming, k):
    """One frame of a live transition at progress k (0..1); both pictures are already the right moment of their own scenes."""
    w, h = outgoing.size
    e = EASINGS["ease_in_out"](clamp01(k))
    peak = math.sin(math.pi * e)
    if kind == "whip":                      # a fast sideways whip pan: the two shots sit side by side on one strip and the camera slides across, smeared by its own speed
        strip = Image.new("RGB", (w * 2, h))
        strip.paste(incoming, (0, 0))
        strip.paste(outgoing, (w, 0))
        x0 = int(round(w * (1 - e)))
        view = strip.crop((x0, 0, x0 + w, h))
        blur = int(w * 0.36 * peak)
        return _smear(view, blur, 0) if blur > 4 else view
    if kind == "crosszoom":                 # punch through the first scene into the second, with a soft flash at the join
        a = _scaled(outgoing, 1 + 0.9 * e, 6, 0.5 * peak)
        b = _scaled(incoming, 1.6 - 0.6 * e, 6, 0.4 * peak)
        mix = Image.blend(a, b, float(np.clip((e - 0.35) / 0.3, 0, 1)))
        return Image.blend(mix, Image.new("RGB", mix.size, (255, 244, 230)), 0.38 * peak * peak)
    if kind == "lightleak":                 # the picture burns out to warm light and the next scene develops out of it
        mix = Image.blend(outgoing, incoming, float(np.clip((e - 0.3) / 0.4, 0, 1)))
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        d = ((xs / w) + 0.4 * (ys / h)) - lerp(-0.2, 1.3, e)
        glow = np.exp(-(d / 0.3) ** 2)[..., None] * (0.35 + 0.65 * peak)
        arr = np.asarray(mix, dtype=np.float32)
        arr = arr + glow * np.array([255, 170, 90], dtype=np.float32) * 0.65 * (0.4 + 0.6 * peak)
        return Image.fromarray(np.clip(arr, 0, 255).astype(np.uint8), "RGB")
    # slice: thin horizontal strips of the next scene slide in from one side, one after another (the same direction for every strip, so it reads as a clean reveal, not tiles)
    out = outgoing.copy()  # nothing is ever filled in or dimmed: only the two scenes are on screen
    strips = 12
    for i in range(strips):
        y0, y1 = int(h * i / strips), int(h * (i + 1) / strips)
        local = EASINGS["ease_in_out"](clamp01((k * 1.33) - i * 0.03))
        dx = int(w * (1 - local))
        # the strip of the next scene slides in from one side: only the part that is on screen is pasted (nothing is ever filled in), and the rest of the row still shows the scene that is leaving
        if dx > 0 and dx < w:
            out.paste(incoming.crop((0, y0, w - dx, y1)), (dx, y0))
        elif dx < 0 and -dx < w:
            out.paste(incoming.crop((-dx, y0, w, y1)), (0, y0))
        elif dx == 0:
            out.paste(incoming.crop((0, y0, w, y1)), (0, y0))
    return out



class Scene(object):
    def __init__(self, video, seconds, background, transition="fade", transition_seconds=0.6):
        self.video = video
        self.seconds = float(seconds)
        self.background = background  # a PIL RGB image, or a PhotoView
        self.layers = []
        self.transition = transition if transition in TRANSITIONS else "fade"
        self.transition_seconds = min(float(transition_seconds), self.seconds / 2)

    # -- low-level pieces --------------------------------------------------------------------------------------------------------

    def _motion(self, anim, delay, duration, easing="expo_out"):
        return Motion(anim, delay, duration, easing)

    def text(self, text, x, y, size, weight=700, color="#FFFFFF", alpha=1.0, align="left", width=COLUMN, line_height=1.12, delay=0.0, duration=0.95, anim="slide_up", float_amount=0.0):
        v = self.video
        px = size * v.s
        font = v.fonts.get(weight, px)
        scratch = ImageDraw.Draw(Image.new("L", (4, 4)))
        lines = wrap(scratch, text, font, width * v.s)
        lh = px * line_height
        w = int(max(scratch.textlength(l, font=font) for l in lines)) + 4
        h = int(lh * len(lines)) + int(px * 0.3)
        img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        colour = rgba(color, alpha)
        for i, line in enumerate(lines):
            lw = d.textlength(line, font=font)
            ox = 0 if align == "left" else (w - lw) / 2 if align == "center" else w - lw
            d.text((ox, i * lh), line, font=font, fill=colour)
        left = x * v.s if align == "left" else x * v.s - w / 2 if align == "center" else x * v.s - w
        self.layers.append(Layer(self, img, left, y * v.s, self._motion(anim, delay, duration), float_amount))
        return len(lines) * size * line_height

    def rect(self, x, y, w, h, color, radius=0, alpha=1.0, delay=0.0, duration=0.9, anim="fade", float_amount=0.0, drift=(0, 0), gradient=None):
        v = self.video
        size = (max(1, int(w * v.s)), max(1, int(h * v.s)))
        img = Image.new("RGBA", size, rgba(color, alpha))
        if gradient:  # a vertical fade from one colour to another, each with its own transparency
            top, bottom = gradient
            col = Image.new("RGBA", (1, size[1]))
            for j in range(size[1]):
                k = j / max(1, size[1] - 1)
                col.putpixel((0, j), tuple(int(lerp(top[i], bottom[i], k)) for i in range(4)))
            img = col.resize(size)
        if radius:
            img.putalpha(ImageChops.multiply(img.getchannel("A"), rounded(size, int(radius * v.s))))
        self.layers.append(Layer(self, img, x * v.s, y * v.s, self._motion(anim, delay, duration), float_amount, (drift[0], drift[1])))

    def glow(self, x, y, diameter, color, strength=0.3, drift=(0, 0), delay=0.0):
        """A very soft round glow of colour behind the content: depth without clutter."""
        v = self.video
        d = max(8, int(diameter * v.s))
        small = 64
        img = Image.new("RGBA", (small, small))
        px = img.load()
        r0, g0, b0 = rgb(color)
        for j in range(small):
            for i in range(small):
                dist = math.hypot(i - small / 2, j - small / 2) / (small / 2)
                px[i, j] = (r0, g0, b0, int(255 * strength * max(0.0, 1 - dist) ** 1.6))
        self.layers.append(Layer(self, img.resize((d, d), Image.BICUBIC), x * v.s, y * v.s, self._motion("fade", delay, 1.4), 0.0, drift))

    def photo(self, name, x, y, w, h, radius=0, zoom=(1.02, 1.16), delay=0.0, duration=1.1, anim="fade", float_amount=0.0):
        """A photo in a frame that zooms slowly inside it."""
        v = self.video
        self.layers.append(PhotoLayer(self, v.image(name), x * v.s, y * v.s, w * v.s, h * v.s, radius * v.s, zoom, self._motion(anim, delay, duration), float_amount))

    def icon(self, kind, x, y, size, color="#FFFFFF", disc=None, delay=0.0, anim="pop", float_amount=0.0):
        v = self.video
        img = icon_image(kind, int(size * v.s), color, disc)
        self.layers.append(Layer(self, img, x * v.s, y * v.s, self._motion(anim, delay, 0.8, "back_out"), float_amount))

    def logo_bar(self):
        """The business's logo on a soft white chip, or its name in text when it has no logo. Always on top."""
        v = self.video
        s = v.s
        if v.has_image("logo"):
            logo = v.image("logo")
            h = int(64 * s)
            w = min(int(logo.width * h / logo.height), int(300 * s))
            pad = int(14 * s)
            chip = Image.new("RGBA", (w + 2 * pad, h + 2 * pad), (0, 0, 0, 0))
            ImageDraw.Draw(chip).rounded_rectangle([0, 0, chip.width - 1, chip.height - 1], radius=int(22 * s), fill=(255, 255, 255, 255))
            chip.alpha_composite(logo.convert("RGBA").resize((w, h), Image.LANCZOS), (pad, pad))
            self.layers.append(Layer(self, chip, MARGIN * s, v.safe_top * s + 40 * s, self._motion("fade", 0.15, 0.8)))
        elif v.brand.get("name"):
            self.text(v.brand["name"], MARGIN, v.safe_top + 56, 44, 800, v.palette["text"], delay=0.15, anim="fade", width=880)

    # -- composed pieces (the controlled, high-quality scene types) --------------------------------------------------------------

    def text_block(self, headline, subtext, x, y, width=COLUMN, size=None, color=None, soft=None, align="left", delay=0.5):
        """An accent line, a bold headline, a lighter supporting line, arriving one after another. Returns the block's height in design units."""
        p = self.video.palette
        size = size or headline_size(headline)
        color = color or p["text"]
        soft = soft or p["text"]
        bar_x = x if align == "left" else x + width / 2 - 48
        self.rect(bar_x, y, 96, 10, p["accent"], radius=5, delay=delay, duration=0.7, anim="grow")
        hx = x if align == "left" else x + width / 2
        height = 38 + self.text(headline, hx, y + 38, size, 800, color, align=align, width=width, line_height=1.08, delay=delay + 0.2)
        if subtext:
            height += 24 + self.text(subtext, hx, y + height + 24, 42, 400, soft, alpha=0.78 if soft == p["text"] else 1.0, align=align, width=width, line_height=1.25, delay=delay + 0.6, duration=0.9)
        return height

    def frame_at(self, t):
        v = self.video
        if isinstance(self.background, PhotoView):
            frame = self.background.view(t, self.seconds)
        else:
            frame = self.background.copy()
        for layer in self.layers:
            layer.paint(frame, t, self.seconds)
        return frame


class PhotoView(object):
    """A photo that fills the whole frame and moves: a slow zoom plus a gentle pan (Ken Burns)."""

    def __init__(self, image, w, h, zoom=(1.02, 1.2), pan=(-0.7, 0.7), pan_y=(0.35, -0.35)):
        self.src = downscale(image.convert("RGB"), int(max(w, h) * 2))
        self.w, self.h = w, h
        self.zoom, self.pan, self.pan_y = zoom, pan, pan_y

    def view(self, t, seconds):
        k = EASINGS["ease_in_out"](clamp01(seconds and t / seconds))
        z = lerp(self.zoom[0], self.zoom[1], k)
        iw, ih = self.src.size
        scale0 = max(self.w / iw, self.h / ih)
        cw, ch = self.w / (scale0 * z), self.h / (scale0 * z)
        slack_x, slack_y = max(0.0, (iw - cw) / 2), max(0.0, (ih - ch) / 2)
        cx = iw / 2 - lerp(self.pan[0], self.pan[1], k) * slack_x
        cy = ih / 2 - lerp(self.pan_y[0], self.pan_y[1], k) * slack_y
        box = (cx - cw / 2, cy - ch / 2, cx + cw / 2, cy + ch / 2)
        return self.src.resize((self.w, self.h), Image.BILINEAR, box=box)


class PhotoLayer(Layer):
    def __init__(self, scene, image, x, y, w, h, radius, zoom, motion, float_amount):
        self.view = PhotoView(image, int(w), int(h), zoom, (0, 0), (0, 0))
        base = Image.new("RGBA", (int(w), int(h)), (0, 0, 0, 255))
        if radius:
            base.putalpha(rounded((int(w), int(h)), int(radius)))
        Layer.__init__(self, scene, base, x, y, motion, float_amount)
        self.zoom = zoom

    def paint(self, frame, t, seconds):
        self.rgb = self.view.view(t, seconds)
        Layer.paint(self, frame, t, seconds)


def downscale(img, longest):
    if max(img.size) <= longest:
        return img
    k = longest / float(max(img.size))
    return img.resize((int(img.width * k), int(img.height * k)), Image.LANCZOS)


def est_text_height(headline, subtext, size):
    """How tall a headline (and supporting line) will be, in design units, so a block can be centred."""
    lines = max(1, int(math.ceil(len(headline) * size * 0.64 / COLUMN)))
    height = 38 + lines * size * 1.08
    if subtext:
        height += 24 + max(1, int(math.ceil(len(subtext) * 42 * 0.64 / COLUMN))) * 42 * 1.25
    return height


def headline_size(text, boost=0):
    n = len(text)
    return (112 if n <= 16 else 100 if n <= 26 else 88 if n <= 40 else 76) + boost


# ---- the video ---------------------------------------------------------------------------------------------------------------------

class Palette(dict):
    """The brand colours, readable as palette["accent"] or palette.accent."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)


class Video(object):
    def __init__(self, brief):
        self.brief = brief
        self.width, self.height, self.fps = int(brief["width"]), int(brief["height"]), int(brief.get("fps", 30))
        self.s = self.width / float(DESIGN_W)
        self.W = DESIGN_W
        self.H = self.height / self.s  # design height
        self.safe_top = min(250, self.H * 0.12)
        self.safe_bottom = self.H - min(380, self.H * 0.2)
        self.palette = Palette(brief["palette"])
        self.light = False
        self.glow_boost = 1.0
        self.brand = brief["brand"]
        self.fonts = Fonts(brief["font_dir"])
        self.assets = brief.get("assets", {})
        self._images = {}
        self._backgrounds = {}
        self._cache = {}
        self._sources = {}
        self.scenes = []
        # every sentence a script may put on screen: the business's own words from the brief
        texts = [brief["brand"].get("name", "")]
        for scene in brief["scenes"]:
            texts += [scene.get("headline", ""), scene.get("subtext", "")] + list(scene.get("items", []) or [])
        self.allowed_text = [t for t in texts if t]

    # assets are named by the short names in the brief ("p1", "logo"); nothing else can be opened
    def has_image(self, name):
        return name in self.assets

    def image(self, name):
        if name not in self.assets:
            raise ValueError("unknown photo: %s" % name)
        if name not in self._images:
            self._images[name] = Image.open(self.assets[name]).convert("RGBA")
        return self._images[name]

    def photo_source(self, name):
        """The photo as a reduced RGB picture, ready to crop (cached)."""
        if name not in self._sources:
            self._sources[name] = downscale(self.image(name).convert("RGB"), int(max(self.width, self.height) * 2))
        return self._sources[name]

    def background(self, angle=150):
        """The calm brand-colour gradient every designed scene sits on (a deep base easing into a darker shade)."""
        if angle in self._backgrounds:
            return self._backgrounds[angle].copy()
        p = self.palette
        a, b = np.array(rgb(p["bg_a"]), dtype=np.float32), np.array(rgb(p["bg_b"]), dtype=np.float32)
        w, h = self.width, self.height
        th = math.radians(angle)
        ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
        reach = abs(math.cos(th)) * w / 2 + abs(math.sin(th)) * h / 2
        k = np.clip(((xs - w / 2) * math.cos(th) + (ys - h / 2) * math.sin(th)) / (2 * reach) + 0.5, 0, 1)[..., None]
        img = Image.fromarray((a * (1 - k) + b * k).astype(np.uint8), "RGB")
        self._backgrounds[angle] = img
        return img.copy()

    def scene(self, seconds, background=None, transition="fade", transition_seconds=0.6):
        sc = Scene(self, seconds, background if background is not None else self.background(), transition, transition_seconds)
        self.scenes.append(sc)
        return sc

    def add_scene(self, seconds, draw, transition="fade", transition_seconds=0.6):
        """Open drawing: `draw(c, t, u)` is called for every frame with the canvas, the seconds into the scene and the progress 0..1."""
        from pilot_canvas import DrawScene
        self.scenes.append(DrawScene(self, seconds, draw, transition, transition_seconds))

    # premium scenes: complete, carefully composed scenes (see pilot_premium.py)
    def hook_kinetic(self, *args, **kwargs):
        import pilot_premium
        return pilot_premium.hook_kinetic(self, *args, **kwargs)

    def feature_float(self, *args, **kwargs):
        import pilot_premium
        return pilot_premium.feature_float(self, *args, **kwargs)

    def steps_timeline(self, *args, **kwargs):
        import pilot_premium
        return pilot_premium.steps_timeline(self, *args, **kwargs)

    def statement_kinetic(self, *args, **kwargs):
        import pilot_premium
        return pilot_premium.statement_kinetic(self, *args, **kwargs)

    def cta_pro(self, *args, **kwargs):
        import pilot_premium
        return pilot_premium.cta_pro(self, *args, **kwargs)

    def timeline_ad(self):
        """The whole video from brief['timeline']: elements on one continuous timeline (see pilot_timeline.py)."""
        import pilot_timeline
        return pilot_timeline.render(self)

    # explainer scenes: floating task bubbles, a form that fills in, a schedule that builds itself, a chat (see pilot_explainer.py)
    def explainer_intro(self, *args, **kwargs):
        import pilot_explainer
        return pilot_explainer.intro(self, *args, **kwargs)

    def explainer_chaos(self, *args, **kwargs):
        import pilot_explainer
        return pilot_explainer.chaos(self, *args, **kwargs)

    def explainer_form(self, *args, **kwargs):
        import pilot_explainer
        return pilot_explainer.form(self, *args, **kwargs)

    def explainer_schedule(self, *args, **kwargs):
        import pilot_explainer
        return pilot_explainer.schedule(self, *args, **kwargs)

    def explainer_chat(self, *args, **kwargs):
        import pilot_explainer
        return pilot_explainer.chat(self, *args, **kwargs)

    def explainer_swap(self, *args, **kwargs):
        import pilot_explainer
        return pilot_explainer.swap(self, *args, **kwargs)

    def explainer_orbit(self, *args, **kwargs):
        import pilot_explainer
        return pilot_explainer.orbit(self, *args, **kwargs)

    def product_scene(self, *args, **kwargs):
        import pilot_product
        return pilot_product.scene(self, *args, **kwargs)

    def explainer_cta(self, *args, **kwargs):
        import pilot_explainer
        return pilot_explainer.cta(self, *args, **kwargs)

    def theme(self, name="dark", glow=1.0):
        """'light' draws the explainer scenes on a clean white background with dark text; 'dark' (the default) on the brand's dark background. `glow` (0.4 to 2.2) strengthens the soft light on dark backgrounds."""
        self.light = str(name) == "light"
        self.glow_boost = max(0.4, min(2.2, float(glow)))

    def glows(self, sc, flip=False):
        p = self.palette
        H = self.H
        sc.glow(-380 if flip else 480, H * 0.02, 980, p["glow"], 0.34 if p["dark"] else 0.26, (50 if flip else -50, 44))
        sc.glow(520 if flip else -360, H * 0.54, 860, p["glow2"], 0.26 if p["dark"] else 0.2, (-44 if flip else 44, -50), delay=0.2)

    # -- scene types ---------------------------------------------------------------------------------------------------------------

    def photo_hero(self, photo, headline, subtext="", seconds=4.0, pan="right", zoom=(1.02, 1.2), transition="zoom"):
        """Full-bleed photo with a slow zoom and pan; the words sit on a soft fade of the brand colour at the bottom."""
        p = self.palette
        left = pan == "left"
        sc = self.scene(seconds, PhotoView(self.image(photo), self.width, self.height, zoom, (0.7, -0.7) if left else (-0.7, 0.7), (-0.35, 0.35) if left else (0.35, -0.35)), transition)
        scrim = rgb(p["scrim"])
        sc.rect(0, self.H * 0.3, DESIGN_W, self.H * 0.7 + 2, p["scrim"], gradient=((scrim[0], scrim[1], scrim[2], 0), (scrim[0], scrim[1], scrim[2], 240)), delay=0.1, duration=1.1)
        size = headline_size(headline, 8)
        top = max(self.H * 0.5, self.safe_bottom - 30 - est_text_height(headline, subtext, size))
        sc.text_block(headline, subtext, MARGIN, top, size=size, color="#FFFFFF", soft="#FFFFFF", delay=0.5)
        sc.logo_bar()
        return sc

    def photo_frame(self, photo, headline, subtext="", seconds=4.0, flip=False, transition="fade"):
        """The photo in a rounded frame that floats a little and zooms inside it; the words below, the block centred."""
        p = self.palette
        zone_top = self.safe_top + 150
        zone_h = self.safe_bottom - zone_top
        sc = self.scene(seconds, self.background(200 if flip else 150), transition)
        self.glows(sc, flip)
        size = headline_size(headline)
        text_h = est_text_height(headline, subtext, size)
        card_h = max(360, min(780, zone_h - text_h - 64))
        y0 = zone_top + max(0, (zone_h - (card_h + 64 + text_h)) * 0.55)
        sc.rect(MARGIN + 6, y0 + 30, COLUMN - 12, card_h, "#000000", radius=48, alpha=0.3, delay=0.15, duration=0.9, float_amount=6)
        sc.photo(photo, MARGIN, y0, COLUMN, card_h, radius=44, zoom=(1.02, 1.18), delay=0.1, anim="fade", float_amount=6)
        sc.text_block(headline, subtext, MARGIN, y0 + card_h + 64, size=size, soft=p["text"], delay=0.6)
        sc.logo_bar()
        return sc

    def photo_split(self, photo, headline, subtext="", seconds=4.0, transition="push"):
        """The photo bleeds off the top; a rounded brand-colour panel slides up over its lower edge and carries the words."""
        p = self.palette
        photo_h = self.H * 0.56
        panel_top = photo_h - 30
        sc = self.scene(seconds, self.background(170), transition)
        sc.photo(photo, 0, 0, DESIGN_W, photo_h + 70, 0, zoom=(1.03, 1.16), anim="fade", duration=0.9)
        sc.rect(0, panel_top, DESIGN_W, self.H - panel_top + 80, p["bg_a"], radius=64, delay=0.2, duration=1.05, anim="slide_up")
        size = headline_size(headline)
        text_h = est_text_height(headline, subtext, size)
        sc.text_block(headline, subtext, MARGIN, panel_top + max(72, (self.safe_bottom - panel_top - text_h) / 2), size=size, delay=0.7)
        sc.logo_bar()
        return sc

    def statement(self, headline, subtext="", seconds=3.5, flip=False, transition="fade"):
        """A single bold message on the brand gradient with soft colour glows; the block is centred."""
        sc = self.scene(seconds, self.background(200 if flip else 150), transition)
        self.glows(sc, flip)
        size = headline_size(headline)
        text_h = est_text_height(headline, subtext, size)
        top = self.safe_top + 80 + max(0, (self.safe_bottom - self.safe_top - 80 - text_h) * 0.5)
        sc.text_block(headline, subtext, MARGIN, top, size=size, delay=0.3)
        sc.logo_bar()
        return sc

    def card_scene(self, kind, headline, subtext="", items=None, seconds=4.0, highlight=18, flip=False, transition="fade"):
        """A headline and one floating card (checklist, calendar or stat) that shows the idea, centred in the safe area."""
        p = self.palette
        items = [str(i) for i in (items or [])][:4]
        zone_top = self.safe_top + 150
        zone_h = self.safe_bottom - zone_top
        sc = self.scene(seconds, self.background(200 if flip else 150), transition)
        self.glows(sc, flip)
        size = headline_size(headline) - 8
        text_h = est_text_height(headline, "" if kind == "calendar" else subtext, size)
        gap = 72
        room = max(380, zone_h - text_h - gap)
        card_h = min(room, 720 if kind == "calendar" else 520 if kind == "stat" else 660)
        y0 = zone_top + max(0, (zone_h - (text_h + gap + card_h)) * 0.5)
        sc.text_block(headline, "" if kind == "calendar" else subtext, MARGIN, y0, size=size, delay=0.15)
        cx, cw, cy = (DESIGN_W - 872) / 2, 872, y0 + text_h + gap
        sc.rect(cx + (40 if flip else -40), cy + 44, cw, card_h, "#FFFFFF", radius=36, alpha=0.14, delay=0.5, duration=1.1, anim="fade", drift=(-26 if flip else 26, 14))
        self.card_face(sc, cx, cy, cw, card_h, 0.7)
        pad = 40
        if kind == "checklist":
            sc.text("What you get", cx + pad, cy + pad, 42, 800, "#0B1F44", width=cw - 2 * pad, delay=0.9, anim="fade")
            step = min(110, (card_h - 150) / max(1, len(items)))
            for i, row in enumerate(items):
                ry = cy + 120 + step * i
                at = 1.1 + i * 0.35
                sc.icon("tick", cx + pad, ry + step / 2 - 28, 56, p["on_accent"], p["accent"], delay=at)
                sc.text(row, cx + pad + 84, ry + step / 2 - 24, 38, 700, "#0B1F44", width=cw - 2 * pad - 90, delay=at + 0.1, duration=0.7, anim="fade")
        elif kind == "calendar":
            sc.rect(cx, cy, cw, 110, p["accent"], radius=36, delay=0.8, duration=0.5, anim="fade")
            sc.text(subtext or "Pick a day", cx + pad, cy + 28, 44, 800, p["on_accent"], width=cw - 2 * pad, delay=1.0, anim="fade")
            gw = cw - 56
            cell = gw / 7.0
            for d in range(31):
                col, row = d % 7, d // 7 + 1
                label = str(d + 1)
                mark = d + 1 == highlight
                px = cx + 28 + cell * col + cell / 2 - len(label) * 8
                py = cy + 110 + 24 + row * min(cell * 0.9, (card_h - 150) / 6.0)
                if mark:
                    sc.icon("none", px - 12, py - 10, 56, "#FFFFFF", p["accent"], delay=1.6)
                sc.text(label, px, py, 28, 800 if mark else 600, p["on_accent"] if mark else "#0B1F44", width=60, delay=1.0, anim="fade", duration=0.6)
        elif kind == "stat":
            sc.text(items[0] if items else headline, cx + cw / 2, cy + card_h * 0.3, 120, 800, "#0B1F44", align="center", width=cw - 2 * pad, delay=1.0)
            if len(items) > 1:
                sc.text(items[1], cx + cw / 2, cy + card_h * 0.7, 38, 700, "#64748B", align="center", width=cw - 2 * pad, delay=1.3)
        sc.logo_bar()
        return sc

    def card_face(self, sc, x, y, w, h, delay):
        """A white card with a soft, wide shadow and a hairline edge, floating gently."""
        s = self.s
        pad = int(70 * s)
        size = (int(w * s) + 2 * pad, int(h * s) + 2 * pad)
        shadow = Image.new("L", size, 0)
        ImageDraw.Draw(shadow).rounded_rectangle([pad, pad + int(26 * s), pad + int(w * s), pad + int(h * s) + int(26 * s)], radius=int(36 * s), fill=int(255 * 0.28))
        shadow = shadow.filter(ImageFilter.GaussianBlur(int(30 * s)))
        img = Image.new("RGBA", size, (2, 10, 30, 0))
        img.putalpha(shadow)
        face = Image.new("RGBA", (int(w * s), int(h * s)), (255, 255, 255, 255))
        face.putalpha(rounded(face.size, int(36 * s)))
        img.alpha_composite(face, (pad, pad))
        ImageDraw.Draw(img).rounded_rectangle([pad, pad, pad + int(w * s) - 1, pad + int(h * s) - 1], radius=int(36 * s), outline=(11, 31, 68, 24), width=max(1, int(1.5 * s)))
        sc.layers.append(Layer(sc, img, x * s - pad, y * s - pad, Motion("slide_up", delay, 1.1, "expo_out"), float_amount=7))

    def cta(self, headline, seconds=5.0, photo=None, transition="fade"):
        """The call to action: the photo (or a star) in a ring, the headline, and a button carrying the business name."""
        p = self.palette
        name = self.brand.get("name", "")
        label = name if len(name) <= 22 else (name.replace(" and ", " & ").split(" & ")[0].strip()[:26])
        ring = 360
        size = headline_size(headline) - 4
        head_h = math.ceil(len(headline) * size * 0.64 / (COLUMN - 40)) * size * 1.08
        total = ring + 76 + head_h + 76 + 124
        zone_top = self.safe_top + 140
        zone_h = self.safe_bottom - zone_top
        y0 = zone_top + max(0, (zone_h - total) * 0.5)
        sc = self.scene(seconds, self.background(165), transition)
        self.glows(sc)
        if photo:
            sc.rect(540 - ring / 2 - 14, y0 - 14, ring + 28, ring + 28, p["accent"], radius=(ring + 28) / 2, delay=0.1, duration=0.9, anim="pop", float_amount=5)
            sc.photo(photo, 540 - ring / 2, y0, ring, ring, ring / 2, zoom=(1.02, 1.16), delay=0.15, anim="fade", float_amount=5)
        else:
            sc.icon("star", 540 - ring / 4, y0 + ring / 4, ring / 2, p["on_accent"], p["accent"], delay=0.1, float_amount=8)
        head_y = y0 + ring + 76
        sc.text(headline, 540, head_y, size, 800, p["text"], align="center", width=COLUMN - 40, line_height=1.08, delay=0.5)
        by = head_y + head_h + 76
        sc.rect(220, by, 640, 124, p["accent"], radius=62, delay=1.0, duration=0.9, anim="slide_up", float_amount=4)
        if label:
            sc.text(label, 520, by + (42 if len(label) > 14 else 34), 38 if len(label) > 14 else 48, 800, p["on_accent"], align="center", width=440, delay=1.3, anim="fade", duration=0.6)
        sc.icon("arrow", 220 + 640 - 120, by + 22, 80, p["on_accent"], None, delay=1.4, anim="fade")
        sc.logo_bar()
        return sc

    # -- rendering -----------------------------------------------------------------------------------------------------------------

    def _begins(self):
        """When each scene begins. A scene that follows a live transition begins early, while the one before is still finishing, so the two overlap."""
        begins, cur = [], 0.0
        for i, sc in enumerate(self.scenes):
            overlap = self.scenes[i - 1].transition_seconds if i and self.scenes[i - 1].transition in LIVE else 0.0
            begin = cur - overlap
            begins.append(begin)
            cur = begin + sc.seconds
        return begins

    def total_seconds(self):
        if not self.scenes:
            return 0.0
        return self._begins()[-1] + self.scenes[-1].seconds

    def frame_at(self, t):
        begins = self._begins()
        for i, sc in enumerate(self.scenes):
            start = begins[i]
            end = start + sc.seconds
            nxt = self.scenes[i + 1] if i + 1 < len(self.scenes) else None
            if sc.transition in LIVE and nxt is not None and begins[i + 1] <= t < end:
                into = (t - begins[i + 1]) / sc.transition_seconds
                return live_transition(sc.transition, sc.frame_at(max(0.0, t - start)), nxt.frame_at(max(0.0, t - begins[i + 1])), into)
            if t < end or i == len(self.scenes) - 1:
                local = max(0.0, t - start)
                frame = sc.frame_at(local)
                into = (local - (sc.seconds - sc.transition_seconds)) / sc.transition_seconds if nxt and sc.transition not in LIVE else -1
                if nxt is None or into <= 0:
                    return frame
                k = EASINGS["ease_in_out"](clamp01(into))
                incoming = nxt.frame_at(0.0)
                if sc.transition == "push":
                    out = Image.new("RGB", frame.size)
                    out.paste(frame, (-int(frame.width * 0.35 * k), 0))
                    out.paste(incoming, (int(frame.width * (1 - k)), 0))
                    return out
                if sc.transition == "zoom":
                    z = 1 + 0.1 * k
                    w, h = frame.size
                    zoomed = frame.resize((int(w * z), int(h * z)), Image.BILINEAR).crop((int(w * (z - 1) / 2), int(h * (z - 1) / 2), int(w * (z - 1) / 2) + w, int(h * (z - 1) / 2) + h))
                    small = incoming.resize((int(w * (0.92 + 0.08 * k)), int(h * (0.92 + 0.08 * k))), Image.BILINEAR)
                    layer = Image.new("RGB", (w, h))
                    layer.paste(small, ((w - small.width) // 2, (h - small.height) // 2))
                    return Image.blend(zoomed, layer, k)
                if sc.transition in ("wipe", "iris"):
                    w, h = frame.size
                    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
                    if sc.transition == "wipe":      # a soft diagonal edge sweeping from the left
                        field = (xs / w) * 0.85 + (ys / h) * 0.15
                        edge = lerp(-0.12, 1.12, k)
                        m = np.clip((edge - field) / 0.12, 0, 1)
                    else:                            # a circle opening from the middle
                        field = np.hypot(xs - w / 2, ys - h / 2) / math.hypot(w / 2, h / 2)
                        m = np.clip((lerp(-0.1, 1.1, k) - field) / 0.1, 0, 1)
                    return Image.composite(incoming, frame, Image.fromarray((m * 255).astype(np.uint8), "L"))
                return Image.blend(frame, incoming, k)
        return self.scenes[-1].frame_at(0.0)

    def render(self, out_path):
        if not self.scenes:
            raise ValueError("the video has no scenes")
        frames = int(round(self.total_seconds() * self.fps))
        cmd = [self.brief["ffmpeg"], "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "%dx%d" % (self.width, self.height), "-r", str(self.fps), "-i", "-",
               "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "veryfast", "-crf", "20", "-movflags", "+faststart", out_path]
        proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
        try:
            for i in range(frames):
                proc.stdin.write(self.frame_at(i / float(self.fps)).tobytes())
            proc.stdin.close()
            if proc.wait() != 0:
                raise RuntimeError("ffmpeg failed")
        finally:
            if proc.poll() is None:
                proc.kill()
