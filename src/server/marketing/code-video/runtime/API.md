# Pilot scene library (what the video script may use)

You write ONE Python function, `build(video)`. Nothing else: no imports, no classes, no files, no network. The names `video` and `math`
(sin, cos, pi, floor, ceil, sqrt) are already available, as are range, len, min, max, abs, round, int, float, str, list, dict, tuple,
enumerate, zip, sum, sorted. Every sentence you put on screen must be copied from the brief (a scene's headline, subtext or items, or the
business name). Never invent text, numbers, prices, offers or claims.

`video.brief["scenes"]` is the list of scenes to tell (role, seconds, headline, subtext, items, photo, visual).
`video.palette` has the brand colours: bg_a, bg_b, text, accent, on_accent, glow, glow2, scrim, dark. Read them as `video.palette["accent"]` or `video.palette.accent`. Use these, never other colours.
Photos are named in the brief ("p1", "p2"...). Only those names can be used.

## PREMIUM SCENES (use these as your main building blocks)
Complete, carefully composed scenes with kinetic type, drifting photos, soft glows and brand colours built in. Choose, order and parameterise them; they
are what make the video look professionally designed, so prefer them over hand-positioning. Each adds one scene. Every `headline`, `subtext` and item
must be copied from the brief.
- `video.hook_kinetic(photo, headline, subtext="", seconds=4.0, pan="right"|"left", anchor="bottom"|"center", transition="wipe")`
  Full-bleed drifting photo, smooth scrim, headline whose words rise in. The opening scene when a photo exists.
- `video.feature_float(photo, headline, subtext="", seconds=4.0, layout="stack"|"side", flip=False, transition="iris")`
  Blurred backdrop of the photo with a sharp rounded copy floating above it, words beneath ("stack") or beside it ("side"; `flip` swaps the sides).
- `video.steps_timeline(headline, items, seconds=5.0, photo=None, transition="zoom")`
  A headline and a timeline of up to 4-5 short items (from the brief) that draws itself; with a photo, a circular photo in a filling ring.
- `video.statement_kinetic(headline, subtext="", seconds=3.5, photo=None, flip=False, transition="fade")`
  One bold message centred on the brand field (or over a blurred photo). Use for a key message or when no photo fits.
- `video.cta_pro(headline, seconds=5.0, photo=None, transition="fade")`
  The ending: a ring that fills around a circular photo (or a star), the headline rising in, a button with the business name. Always last.
Transitions: "fade", "push", "zoom", "wipe", "iris". Do not repeat the same transition twice in a row. Alternate `pan`, `layout` and `flip`.
A good build is 4-6 premium scenes in the brief's order. Add your own scene with `video.add_scene` only when it clearly adds something the premium scenes cannot do.

## Scene types (each adds one scene and returns it)
- `video.photo_hero(photo, headline, subtext="", seconds=4.0, pan="right"|"left", zoom=(1.02, 1.2), transition="fade"|"push"|"zoom")`
  Full-bleed photo, slow zoom and pan, words on a soft fade at the bottom. Best for the hook and for the strongest photo.
- `video.photo_frame(photo, headline, subtext="", seconds=4.0, flip=False, transition=...)`  Photo in a floating rounded frame, words below.
- `video.photo_split(photo, headline, subtext="", seconds=4.0, transition=...)`  Photo bleeds off the top, a panel slides up with the words.
- `video.statement(headline, subtext="", seconds=3.5, flip=False, transition=...)`  One bold message on the brand gradient. Use when no photo fits.
- `video.card_scene(kind, headline, subtext="", items=None, seconds=4.0, highlight=18, flip=False, transition=...)`
  kind: "checklist" (items = up to 4 short lines from the brief), "calendar" (a booking calendar; subtext becomes its header), "stat".
- `video.cta(headline, seconds=5.0, photo=None, transition=...)`  The ending: ringed photo (or a star), headline, button with the business name. Always last.

## Custom touches (optional): `sc = video.scene(seconds, transition="fade")`, then
`sc.text(text, x, y, size, weight=700, color="#FFFFFF", align="left", delay=0.0, anim="slide_up"|"fade"|"grow"|"pop"|"none")`,
`sc.rect(x, y, w, h, color, radius=0, alpha=1.0, delay=0.0)`, `sc.icon("tick"|"arrow"|"star", x, y, size, color, disc=None, delay=0.0)`,
`sc.photo(name, x, y, w, h, radius=0, zoom=(1.02,1.16))`, `sc.glow(x, y, diameter, color, strength)`, `sc.logo_bar()`.
Positions are in design units: the video is 1080 wide; `video.H` is its height; keep content between `video.safe_top` + 150 and `video.safe_bottom`.
Prefer the scene types above; they are composed and spaced for you.

## Craft rules
- Open with a strong hook (a photo scene when a photo fits), 1 to 3 supporting scenes (one idea each), end with `video.cta`.
- Use photos only where the brief gives one. Alternate how photos are shown (hero, frame, split). Alternate `pan` and `flip`.
- Vary transitions: mostly "fade", some "push" or "zoom". Match each scene's `seconds` to the brief; the total must match the brief's total.
- Fewer words is better. Never put the same sentence on two scenes.

# OPEN DRAWING (design your own scenes)

`video.add_scene(seconds, draw, transition="fade"|"push"|"zoom")` adds a scene you draw yourself. `draw(c, t, u)` is called for EVERY frame:
`c` is the canvas, `t` the seconds into the scene, `u` the progress 0..1. It must draw the whole frame from scratch (start with `c.gradient(...)`
or a photo). Define `draw` as a function inside `build`, and compute every position, size and fade from `t` and `u`: that is how things move.
`c.W` is 1080, `c.H` the height (design units, y grows downward); `c.safe_top` and `c.safe_bottom` mark the area clear of the platform's buttons.
You may mix open scenes with the library scenes above (for example an open hook and middle, then `video.cta`).

## Canvas methods (all colours are "#RRGGBB" strings, `alpha` is 0..1)
- `c.gradient(color_a, color_b, angle=150)`, `c.fill(color)`
- `c.rect(x, y, w, h, color, radius=0, alpha=1, stroke=0, stroke_color=None)`, `c.circle(cx, cy, r, color, alpha=1, stroke=0)`, `c.ellipse(cx, cy, rx, ry, color)`
- `c.line(x1, y1, x2, y2, color, width=6)`, `c.polygon([(x, y), ...], color)`, `c.arc(cx, cy, r, start_deg, end_deg, color, width=10)` (progress rings)
- `c.shadow_rect(x, y, w, h, color, radius=36, blur=40, offset=24, shadow=0.3)`: a card with a soft shadow
- `c.glow(x, y, diameter, color, strength=0.3)`: a soft round glow. `c.icon("tick"|"arrow"|"star", x, y, size, color, disc=None)`
- `c.text(text, x, y, size, weight=700, color, align="left"|"center"|"right", alpha=1, width=912, line_height=1.1, spacing=0, shadow=0)` -> height used.
  `weight` is 400, 700 or 800. For `align="center"`, x is the centre; for "right", x is the right edge. `c.text_width(text, size, weight)` measures it.
  TEXT RULE: the text must be copied from the brief (a headline, subtext, item, the business name, or any part of one, such as one word at a time or
  the first N letters for a typewriter effect). Anything else raises an error and the video is thrown away. Day numbers like "18" are fine.
- `c.photo(name, x, y, w, h, shape="rect"|"round"|"circle", radius=0, zoom=1, pan_x=0, pan_y=0, alpha=1, blur=0, tint=None, tint_alpha=0, gray=0, bright=1)`:
  a photo from the brief cropped to the box. Animate `zoom` (1 to 1.3) and `pan_x`/`pan_y` (-1..1) over time for Ken Burns. Use `tint` + `tint_alpha`
  to wash a photo in the brand colour, `blur` for a soft background, `gray` for black-and-white, `bright` < 1 to darken under text.
- `c.logo()`: the business logo on its own white chip (top left by default). Inside a `c.push(...)` container it fits and centres itself in that container, so put it in a container of any size; do not draw a backing rectangle behind it (it already has its own chip).
- Groups: `c.push(x, y, w, h, alpha=1, scale=1, rotate=0)` ... drawing in local coordinates (0, 0 = the box's top-left) ... `c.pop()`.
  A group fades, scales (about its centre) and rotates (degrees) as one: use it to slide in and fade up a headline plus its supporting line.
Helpers: `progress(t, start, duration, easing="expo_out")` (0 to 1 over time), `ease(name, k)`, `lerp(a, b, k)`, `clamp(v, lo, hi)`, `wobble(seed, t, speed=1)`
(smooth drift -1..1), `rand(seed)` (0..1, repeatable), `math.sin/cos/pi/floor/ceil/sqrt/atan2/radians`, `range` (up to 5000), and loops over lists or ranges.
No `while`, no imports, no classes, no files, no sorting tricks with huge lists. Python 3.9.

## Make it look designed, not generated
- One concept for the whole video (for example: pool-blue rising bubbles and a water-line wipe; a slow diagonal colour sweep; photo cut-outs in circles
  that grow; a ring that fills as steps are listed). Use the palette (`video.palette`) everywhere; accents sparingly, one highlight colour.
- Strong hierarchy: headline 88-120, bold (800); supporting text 38-46, regular (400), lower contrast. Left margin 84. Never crowd; leave space.
- Stagger entrances (`progress(t, 0.2 + i*0.18, 0.9)`), ease everything, and keep something gently moving all the time (a slow zoom, a drifting glow, a breathing ring).
- Treat photos: tint or darken under text, a circle or rounded crop, a slow pan. A photo scene should feel different from a graphic scene.
- Keep each frame to about 120 drawing calls or fewer. A frame that takes longer than 12 seconds stops the whole video.

## Layout check (your script is rejected and sent back to you if it fails)
Pilot draws two sample frames of every scene you draw yourself and checks them. It reports: text overlapping other text, text running off the side,
text in the bottom area the platforms cover, text smaller than 30, a scene with no words, and a scene that never calls `c.logo()`. To avoid overlaps,
stack text using the height that `c.text()` returns (it is the height used): `h = c.text(headline, x, y, 100, 800, ...)` then `c.text(sub, x, y + h + 24, ...)`.
`c.text_height(text, size, weight, width)` gives the height without drawing. Call `c.logo()` in every scene you draw.

## Composed helpers (they place things for you; prefer them over hand-positioning)
- `c.reveal_text(text, x, y, size, weight, color, t, start=0.0, step=0.08, align="left", width=912, line_height=1.1, rise=44, shadow=0)` -> height. Kinetic type:
  the words rise and fade in one after another. Use for headlines. Put the next line at `y + height + 24`.
- `c.text_stack([(text, size, weight, color, alpha), ...], x, y, width=912, gap=24, align=None)` -> end y (x = c.W / 2 centres it; pass align="left" or "right" with the matching x otherwise). Several lines spaced by their real heights.
- `c.backdrop(name, u, dim=0.55, blur=22, tint=None, tint_alpha=0.25)`: a photo as a soft, darkened, slowly drifting full-frame backdrop.
- `c.grade(contrast=1, saturation=1, brightness=1, warm=0, teal_orange=0, fade=0)`: colour-grades everything drawn so far (warm > 0 warmer, < 0 cooler; `teal_orange` 0 to 1 splits teal shadows and orange highlights; `fade` lifts the blacks like film). Call after the photo, before text.
- `c.grain(strength=0.04, seed=0)`: fine film grain (use a new `seed` per frame, e.g. `int(t * 30)`).
- `c.fade(y, h, color, from_alpha=0, to_alpha=0.9)`: a smooth full-width vertical scrim (use under text on a photo; never stack thin rects).
- `c.photo(..., shadow=0.5)`: adds a soft shadow under a photo (rounded). `c.ring(cx, cy, r, u, color, width, track_color, track_alpha)`: a progress ring that is u full.
- `c.timeline(items, x, y, t, start, step, size, color, accent, width)` -> end y: a line draws down while each item pops its dot and slides in. `c.timeline_height(items, size, width)` measures it first.
- `c.marquee(text, y, size, color, t, speed=70, alpha=0.18)`: a faint drifting band of text behind other content.
- Transitions for `add_scene` and the library scenes: "fade", "push", "zoom", "wipe" (soft diagonal sweep), "iris" (circle opening). Vary them.

## Three patterns to adapt (change the layout, photos, motion and colours to suit THIS business; do not copy them literally)
```python
def build(video):
    p = video.palette
    b = video.brief["scenes"]

    # A. Hook: a drifting full-bleed photo, a smooth scrim, a headline whose words rise in
    def hook(c, t, u):
        c.photo("p1", 0, 0, c.W, c.H, zoom=lerp(1.06, 1.26, u), pan_x=lerp(-0.5, 0.5, u), pan_y=0.25, tint=p.bg_a, tint_alpha=0.22)
        c.fade(c.H * 0.36, c.H * 0.64, p.bg_a, 0.0, 0.94)
        top = c.H * 0.56
        c.rect(84, top, 8, 330 * progress(t, 0.2, 1.0), p.accent, radius=4)
        h = c.reveal_text(b[0]["headline"], 124, top, 112, 800, "#FFFFFF", t, start=0.35, step=0.09, width=860, line_height=1.06, shadow=0.4)
        k = progress(t, 1.1, 0.9)
        c.text(b[0]["subtext"], 124, top + h + 26 + (1 - k) * 30, 44, 400, "#FFFFFF", alpha=0.88 * k, width=860)
        c.logo()
    video.add_scene(b[0]["seconds"], hook, "wipe")

    # B. Feature: a blurred backdrop, a floating sharp photo with a shadow, words beneath
    def feature(c, t, u):
        c.backdrop("p2", u, dim=0.6, blur=26, tint=p.bg_a, tint_alpha=0.35)
        c.marquee(b[1]["headline"], c.H * 0.12, 150, "#FFFFFF", t, speed=60, alpha=0.05)
        k = progress(t, 0.1, 1.2)
        top = c.safe_top + 150
        c.photo("p2", 84, top + (1 - k) * 90 + 10 * wobble(2, t, 0.8), 912, 760, shape="round", radius=44, zoom=lerp(1.08, 1.2, u), alpha=k, shadow=0.5)
        y = top + 760 + 70
        c.rect(84, y, 110 * progress(t, 0.7, 0.7), 10, p.accent, radius=5)
        h = c.reveal_text(b[1]["headline"], 84, y + 36, 88, 800, "#FFFFFF", t, start=0.8, step=0.08, width=912, line_height=1.06)
        k2 = progress(t, 1.5, 0.8)
        c.text(b[1]["subtext"], 84, y + 36 + h + 22 + (1 - k2) * 24, 42, 400, "#FFFFFF", alpha=0.8 * k2, width=912)
        c.logo()
    video.add_scene(b[1]["seconds"], feature, "iris")

    # C. Steps: brand-colour field with soft glows, centred block, a timeline that draws itself, a photo in a filling ring
    def steps(c, t, u):
        c.gradient(p.bg_a, p.bg_b, 160)
        c.glow(500, -80, 1000, p.glow, 0.34 - 0.06 * wobble(1, t))
        c.glow(-300, c.H * 0.55, 860, p.accent, 0.22)
        zone = c.safe_bottom - (c.safe_top + 150)
        head_h = c.text_height(b[2]["headline"], 100, 800, 912, 1.06)
        total = 36 + head_h + 90 + c.timeline_height(b[2]["items"], 46, 912)
        top = c.safe_top + 150 + max(0.0, (zone - total) * 0.45)
        c.rect(84, top, 110 * progress(t, 0.1, 0.7), 10, p.accent, radius=5)
        h = c.reveal_text(b[2]["headline"], 84, top + 36, 100, 800, "#FFFFFF", t, start=0.2, step=0.1, width=912, line_height=1.06)
        c.timeline(b[2]["items"], 84, top + 36 + h + 90, t, start=0.9, step=0.6, size=46, color="#FFFFFF", accent=p.accent, width=912)
        c.photo("p2", 800, c.safe_top + 60, 160, 160, shape="circle", zoom=lerp(1.1, 1.3, u), alpha=progress(t, 0.4, 1.0))
        c.ring(880, c.safe_top + 140, 92, progress(t, 0.5, 2.4, "ease_in_out"), p.accent, 10, "#FFFFFF", 0.2)
        c.logo()
    video.add_scene(b[2]["seconds"], steps, "zoom")

    video.cta(b[3]["headline"], seconds=b[3]["seconds"], photo="p1")
```
Rules that make the difference: motion everywhere but calm (eased entrances, slow drifts), one idea per scene, centred or deliberately anchored blocks (never everything at the top), real photos large and treated, text always on a scrim or a clean field, generous 84-unit margins, the brand's accent used for only one or two things per scene. In your own scripts also vary the composition scene to scene: full-bleed, floating, split, centred, side-by-side.


## DEPTH AND LIGHTING (use these for a polished, three-dimensional look)
- `c.studio(t, floor_y=0.68, spot_x=0.5)`: a whole lit set in one call (graded backdrop from the video's palette, soft light beams, a glow, a floor with a pool of light, drifting out-of-focus lights). For a scene built from DRAWN things (props, shapes, lit objects): start with it, draw the hero after it, call `c.vignette()` last. Do NOT use it in a scene that fills the frame with a photograph (`c.camera` or a full-frame `c.photo`): the photograph covers it completely, so it does nothing; use `c.rays`, `c.light_leak`, `c.caustics` and `c.vignette` over the photograph instead.
- `c.cylinder(cx, top_y, w, h, color, tilt=0.26, light=0.3, top_color=None, gloss=0.4)`: a lit cylinder seen from slightly above (cake tier, cup, can, drum, pillar): `top_y` is the centre of its top ellipse, `light` is where the light is across it (0 left .. 1 right; vary it with `t` for a turning highlight).
- `c.sphere(cx, cy, r, color, shine=0.6)`: a lit ball with a highlight (a cherry, a bauble, a bubble, a pearl). `c.gloss_rect(x, y, w, h, color, radius=0, top=0.3, bottom=0.25, sheen=0.35)`: a rounded block lit from above (a glossy button, a drip, a ribbon, a card).
- `c.soft_shadow(cx, cy, rx, ry, alpha=0.4, blur=0.5)`: a blurred contact shadow under things that stand on the floor. `c.floor(y, color_a, color_b)`, `c.bokeh(t, count, color, seed)`, `c.rays(t, x, color)`, `c.vignette(strength)`.
- `video.palette.tone_a` and `tone_b` are two supporting colours chosen for the subject; `bg_a`, `bg_b`, `glow`, `glow2` the set and its lights; `accent` is the business's own brand colour (use it for accents).
- Depth recipe: backdrop and lights (far) -> floor and soft shadow -> hero (large, lit, a slow turn or bob) -> sparkles or props in front that move faster. A slow camera push (`c.push(0, 0, c.W, c.H, scale=1.0 + 0.06 * u)` around everything) adds parallax.

## PROPS (ready-made illustrations; place, animate and combine them)
`c.prop(kind, cx, cy, size, k=1.0, t=0.0, tint=None)` draws a finished illustration centred on (cx, cy), about `size` wide, built up as `k` goes 0..1 (drive `k` with
`progress(t, start, duration)` so it assembles on screen; `t` makes flames, steam and water move). Kinds: `"cake"` (a layered chocolate cake with icing drips and candles),
`"cupcake"`, `"coffee"`, `"gift"`, `"house"`, `"tree"`, `"sun"`, `"water"` (a pool surface), `"wrench"`. `tint` recolours the main part (the icing, the cup, the box, the roof, the water),
so pass a brand colour such as `video.palette.accent`. Use props for the main subject and add your own shapes around them (a plate of sparkles, a ground line, shadows, text).

## ILLUSTRATING A SUBJECT (the pattern below is the OLD flat style; prefer c.studio + c.prop + lit shapes, above) (when the request is about something the scenes and photos cannot show)
Draw it yourself from shapes, inside `draw(c, t, u)`, in the brand palette, and build it up over time. Work in a local box with `c.push(x, y, w, h, scale=..., alpha=...)` so the whole drawing can pop in and bob as one. Pattern (a layered cake; adapt the idea to ANY subject):
```
def draw(c, t, u):
    c.gradient(video.palette.bg_a, video.palette.bg_b, 160)
    c.glow(c.W / 2, c.H * 0.42, 900, video.palette.glow, 0.3)
    k = progress(t, 0.2, 1.0, "back_out")                      # the whole drawing pops in
    bob = 8 * wobble(3, t, 0.8)
    c.push(140, c.H * 0.30 + bob, 800, 700, scale=0.7 + 0.3 * k, alpha=clamp(k * 1.5))
    c.ellipse(400, 640, 330, 36, "#000000", alpha=0.25)                       # shadow on the table
    for i in range(3):                                                         # three layers drop in one after another
        a = progress(t, 0.5 + i * 0.35, 0.6, "back_out")
        c.rect(120 + i * 25, 470 - i * 150 - (1 - a) * 220, 560 - i * 50, 130, "#4A2A1A", radius=26, alpha=clamp(a * 1.6))
        c.rect(120 + i * 25, 470 - i * 150 - (1 - a) * 220, 560 - i * 50, 34, "#6B3F29", radius=17, alpha=clamp(a * 1.6))   # icing band
    for j in range(6):                                                         # icing drips on the top layer
        d = progress(t, 1.9 + j * 0.1, 0.5)
        c.rect(170 + j * 85, 320, 42, 40 + 60 * d * (0.6 + 0.4 * rand(j)), "#6B3F29", radius=21)
    c.circle(400, 280 - 14 * progress(t, 2.3, 0.5, "back_out"), 26, video.palette.accent)       # a cherry on top
    c.pop()
    for s in range(8):                                                         # sparkles
        c.circle(200 + 90 * s, 300 + 40 * wobble(s, t, 1.2), 3 + 3 * wobble(s + 9, t, 2) ** 2, "#FFFFFF", alpha=0.6)
```
Tips: shapes first, detail second (highlight bands, shadows, small bounces); stagger parts with `progress(t, start + i * gap, ...)`; reuse one `draw` for several scenes by passing `t` offsets; keep text to the brief's words with `c.reveal_text`/`c.text`. A closing scene with `video.cta_pro` or your own call to action keeps it professional.


## CINEMATIC MOTION (the main way to make a photographed video feel like film, not like slides)
A video made from photographs must MOVE like footage: the camera never stops, light and water keep moving, and one scene flows into the next. Prefer these over
rounded photo cards, floating frames and `c.photo` boxes with a shadow (those look like slides).
- `c.camera(name, u, move="push", amount=1.0, t=0.0, tint=None, tint_alpha=0.0, bright=1.0, focus_y=None, blur=16, band=0.2, zoom=1.0, at=None)`: the photo fills the WHOLE frame and the camera moves over it.
  `u` is the scene progress 0..1, `t` the seconds in. move: "push" (slow push-in), "pull" (pull back), "pan_left", "pan_right", "tilt_up", "tilt_down", "orbit" (a push with a slight roll),
  "handheld" (a living, slightly shaky shot), "drift" (slow diagonal). `amount` 0.3..2 scales the move. `focus_y` (0..1 down the frame) keeps a band sharp and softens the rest: change it with `u` to pull focus.
- `c.caustics(t, strength=0.28, color="#BDEFFF", scale=1.0, speed=1.0, top=0.0)`: animated water light over everything so far (for pools, water, anything wet). `top` is where it starts down the frame.
- `c.light_leak(t, color="#FFB35A", strength=0.4, speed=0.35, width=0.28, phase=0.0)`: a warm drifting film light leak. Give each scene a different `phase`.
- `c.dust(t, count=34, seed=3, strength=0.55, color="#FFFFFF", speed=1.0)`: specks of light at several depths (a foreground layer for depth). Give each scene a different `seed`.
- Existing finishing still applies: `c.grade(...)` after the photo (cool and desaturated for the "before", warm teal-orange for the "after"), `c.rays`, `c.vignette`, `c.grain(0.04, int(t * 30))` last.
- LIVE TRANSITIONS (third argument of `video.add_scene(seconds, draw, transition, transition_seconds)`): "whip" (a fast sideways whip pan with motion blur), "crosszoom" (punch through into the next scene with a soft flash),
  "lightleak" (burns out to warm light, the next scene develops out of it), "slice" (strips slide in). The next scene is ALREADY MOVING while it arrives and the two scenes overlap in time, so the video flows.
  Use `transition_seconds` 0.6 to 0.9 for them. Choose transitions for the strategy and the storyboard (each scene names how it hands over): a fast reel can be all hard whips, a luxury film all slow fades or light leaks; none of these is required.

One way to build a CINEMATIC picture-led film (an option for a strategy that calls for it, not the way every video is built: a fast reel, an offer, an explainer or a slideshow each have their own look, and the creative strategy and the storyboard decide):
1. Give the video ONE idea (a before and after, a journey, a reveal), and let the grade, light and camera carry it.
2. For this look each scene can be full frame: `c.camera(...)` first, then grade, light (caustics / rays / light_leak / dust), vignette, a scrim under the words if they need one, the words, grain. Leave any of it out when the look is clean, bright or graphic.
3. Vary the camera when the story varies; scene length is the storyboard's (a rapid reel is under 2 seconds a scene, a slow film 4 or more).
4. Words are short and sit IN the picture (on the scrim, big, kinetic with `c.reveal_text`), not in a box. A list can be a few lines that land one by one (a small dot and the line), not a card.
5. If a photo is used twice, use a different move, crop (`zoom`/pan through `c.camera` amount) and grade the second time.


## MOTION GRAPHICS KIT (invent the visuals instead of photographing them)
For an explainer, an offer, a price, steps, features or a list, or whenever there is no photograph that is clearly the right main visual, DO NOT lay words over photos. Invent clean graphics and app UI and keep
everything moving, the way a good product-explainer video or offer post is built. Photographs are used only where one is clearly the right payoff (a full-frame final shot with `c.camera`), never as a floating card.
All words still come from the brief (a card's labels, a field's value, a chip's text). The only words that need not: Draft, New, Done, Schedule, Today, Confirm, Booking, Plan, Saved, Sent, Details, Next (a card's own tags and buttons).
The kit's own small type is not measured by the layout check, and each piece is placed by you: stack with the y it returns.
- `c.chip(text, cx, cy, size=30, tone="plain"|"hot"|"soft"|"accent"|"dark", rot=0, alpha=1, scale=1, lead=0)`: a pill label (a task, a tag). Returns (width, height).
- `c.swarm(items, t, cx, cy, rx=380, ry=230, n=18, size=28, seed=1, speed=1, density=1, pull=0, hot=4)`: a cloud of chips (the words in `items`) milling around a point. Grow `density` 0..1 so it piles up; raise `pull` 0..1 to draw it into the centre and fade it (the mess resolving).
- `c.silhouette(cx, base_y, size, color, alpha)`: a head-and-shoulders person, for "the owner with everything on their mind".
- `c.card(x, y, w, h, title="", tag="", alpha=1, dark=False)`: an app card with a soft shadow, title left, small tag right. Returns the y where its content starts.
- `c.field(x, y, w, label, value, t, start=0, speed=18, active=False, alpha=1)`: a form field whose `value` types itself from `start` with a blinking caret. Returns the next y. `c.row(x, y, w, left, right, t, start=0, alpha=1)`: a schedule row that slides in (time left, label in a pale block with an accent bar).
- `c.pill(text, cx, cy, t, start=0, size=24, tone="soft")`: a status pill with a pulsing dot ("writing...") that pops in. `c.button(x, y, w, label, k=1, press=0)` and `c.cursor(x, y, k=1, press=0, size=1)`: a button and a pointer that travels to it and clicks (`press` 0..1 dips the button and shows a ripple).
- `c.mark("no"|"yes", x, y, size=46, k=1)`: a red cross ring or a green tick disc for a "no X, no Y, yes Z" list. `c.badge(n, x, y, size=44, k=1)`: a numbered step dot.
- `c.counter(target, x, y, t, start=0, dur=2.2, size=120, color, align="center", weight=800)`: a number rolling up from zero to `target`, a number written in the brief ("20", "1,200", "$20", "98%").
- `c.mesh(x, y, w, h, colors, t, radius=44, alpha=1)`: a soft animated gradient card (`colors` = a base then 2-3 blob colours), for a price or an offer.
- `c.text(..., face="serif"|"serif_italic")`: an editorial serif headline and an italic accent word ("The price" in serif, "is the price." in italic accent colour). Default is the clean sans.
Recipes (adapt, never copy): 
1. THE SWIRL (dark navy, glow): small kicker + big line on top, `c.silhouette` at the bottom, `c.swarm` of the business's tasks growing in `density`, then `pull` it in while an orb with `c.logo_at` and a short line ("X takes it from here") resolves it.
2. THE CARD (light, `c.gradient("#FFFFFF", "#EEF2F9", 180)`): a quiet kicker and a bold line, `c.card` with three `c.field`s typing one after another, `c.pill` saying who is doing it, a caption under the card; then the card slides out (`c.push(-340*k, 0, c.W, c.H, alpha=1-k)`) and a schedule card of `c.row`s slides in with a `c.button` that the `c.cursor` clicks.
3. THE LIST: a serif headline with an italic accent line, then 3 lines each with `c.mark` ("no", "no", "yes") popping in one after another.
4. THE OFFER: `c.mesh` card with `c.counter` of the price and a small "/month" style unit beside it, a serif line below, the list, and a quiet footer with the logo.
5. THE PAYOFF (optional): one real photograph, full frame, `c.camera` moving, light moving, one short line and the brand.
Dark scene, light scene, then a payoff: change the mood between scenes. Join with "whip", "crosszoom", "lightleak" or "slice". Keep every scene moving all the time and the words short.


## COMPOSITION (decide it for every scene, from the story)
A video is a story told in frames, not one layout with different backgrounds. For EACH scene, before drawing it, answer from the story (not from a list):
1. What is this scene's visual subject?  2. Where should the viewer's eye go first?  3. Does it need words at all? (A scene may have none: the picture can carry it.)  4. Should it be visually quiet or intense?  5. How does it differ from the previous scene?  6. What is its payoff?
Then compose for those answers. The toolkit gives you the capabilities; the choice is yours. Examples of what exists, not a rotation to cycle through:
- a full-frame image with no words and moving light; an edge-to-edge picture with one short line; a tight crop or detail shot (`c.camera` amount and `zoom`) that shows a different part of the picture;
- big type on its own over a dark vignette with no scrim; a centred title; type that sits where the picture is quiet; a split where half the frame is picture and half is colour;
- a graphic or motion-only moment (light, caustics, shapes, a counter); a quiet beat with almost nothing in it; a logo end card (`c.logo()` fits any container you give it).
Things that read as a template: the same text position, the same scrim and the same type size in several scenes in a row. Layout check: three or more consecutive scenes with the same headline position, size and scrim are sent back. Repeat a treatment only when the story needs it, and change the rest.


## THE STORYBOARD IS A CONTRACT
When the brief's scenes carry a `shot`, each one is the creative director's decision for that scene, and you EXECUTE it; you do not reinterpret it. Storyboard scene k is code scene k (exactly one `video.add_scene` per scene, in order, with the scene's seconds and transition). The finished frames are measured against each shot, and a scene that does not match is sent back to you with the requirement, what the frames actually show, the fix, and what to keep. The shot's words map to the toolkit like this:
- `text`: "none" = no `c.text` and no `c.reveal_text` in that scene; "headline" / "headline_sub" / "type_only" = words (supporting line only for headline_sub).
- `text_position`: top/middle/bottom and left/center/right = where the headline block sits (left: `align="left"`; center: `align="center"` with x = `c.W / 2`; right: `align="right"`); "fill" = type that fills the frame (size 140+, `align="center"`, width about 900).
- `text_scale`: small about 44-56, medium 64-90, large 100-130, dominant 140+.
- `camera` + `crop` + `subject_at`: `c.camera(picture, u, move, ..., zoom=crop, at=(subject_at.x, subject_at.y))` with move push_in = "push", pull_out = "pull", and the rest by name; crop wide 1.0, medium 1.3, tight 1.8, macro 2.5.
- `scrim`: none = no `c.fade`; light = `c.fade` up to about 0.4; heavy = 0.7 or more.
- `composition`: typographic = the type is the picture; graphic_motion = no photograph, shapes/light/counters; logo_card = the logo (fits any container) and the name; detail_crop = a tight or macro crop; split = half picture, half colour.
- `lighting` and `intensity` are for you to realise with `c.light_leak`, `c.caustics`, `c.rays`, `c.dust`, `c.grade`, `c.vignette` (quiet = few and faint, intense = several and strong).
