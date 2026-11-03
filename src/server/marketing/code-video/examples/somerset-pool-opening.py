# A custom Pilot video: "Make a cinematic reel for Somerset about pool opening season."
# Written the way Pilot writes it: the realistic photographs are the visuals; code supplies the camera, grade, light, type, wipes and timing.
def build(video):
    p = video.palette
    b = video.brief["scenes"]
    BLUE = p.accent

    def camera(c, name, u, z0, z1, x0, x1, y0=0.0, y1=0.0, tint_alpha=0.12):
        c.photo(name, 0, 0, c.W, c.H, zoom=lerp(z0, z1, u), pan_x=lerp(x0, x1, u), pan_y=lerp(y0, y1, u), tint=p.bg_a, tint_alpha=tint_alpha)

    def finish(c, t, warm=0.12):
        c.grade(contrast=1.08, saturation=1.1, warm=warm, teal_orange=0.35, fade=0.04)
        c.vignette(0.4)
        c.grain(0.035, int(t * 30))

    # 1. Hook: the opening photograph pushes in on a slow arc; a water-line of light sweeps up; the headline rises word by word
    def hook(c, t, u):
        camera(c, "p1", u, 1.04, 1.24, -0.4, 0.4, 0.1, -0.1)
        c.rays(t, 0.72, "#FFFFFF", 0.10)
        finish(c, t)
        c.fade(c.H * 0.42, c.H * 0.58, p.bg_b, 0.0, 0.92)
        k = progress(t, 0.2, 1.1)
        c.rect(84, c.H * 0.6, 10, 300 * k, BLUE, radius=5)
        h = c.reveal_text(b[0]["headline"], 124, c.H * 0.6, 118, 800, "#FFFFFF", t, start=0.4, step=0.1, width=860, line_height=1.04, shadow=0.45)
        k2 = progress(t, 1.3, 0.9)
        c.text(b[0]["subtext"], 124, c.H * 0.6 + h + 28 + (1 - k2) * 30, 46, 400, "#FFFFFF", alpha=0.9 * k2, width=860)
        c.logo()
    video.add_scene(b[0]["seconds"], hook, "wipe")

    # 2. Feature: a blurred, drifting copy of the photo behind a sharp rounded frame that floats up; a ring fills as the line lands
    def feature(c, t, u):
        c.backdrop("p2", u, dim=0.58, blur=26, tint=p.bg_a, tint_alpha=0.35)
        c.marquee(b[1]["headline"], c.H * 0.12, 150, "#FFFFFF", t, speed=60, alpha=0.06)
        k = progress(t, 0.1, 1.2)
        top = c.safe_top + 140
        c.photo("p2", 84, top + (1 - k) * 110 + 10 * wobble(2, t, 0.8), 912, 800, shape="round", radius=48, zoom=lerp(1.06, 1.22, u), pan_x=lerp(0.3, -0.3, u), alpha=k, shadow=0.55)
        c.ring(900, top + 800 - 30, 62, progress(t, 0.6, 2.2, "ease_in_out"), BLUE, 9, "#FFFFFF", 0.25)
        y = top + 800 + 64
        c.rect(84, y, 120 * progress(t, 0.7, 0.7), 10, BLUE, radius=5)
        h = c.reveal_text(b[1]["headline"], 84, y + 34, 92, 800, "#FFFFFF", t, start=0.8, step=0.09, width=912, line_height=1.05)
        k2 = progress(t, 1.5, 0.8)
        c.text(b[1]["subtext"], 84, y + 34 + h + 20 + (1 - k2) * 24, 42, 400, "#FFFFFF", alpha=0.85 * k2, width=912)
        c.logo()
    video.add_scene(b[1]["seconds"], feature, "iris")

    # 3. Close-up: a tight, graded crop of the hands-on work with a circular reveal and a timeline that draws itself
    def steps(c, t, u):
        camera(c, "p3", u, 1.2, 1.0, 0.0, 0.0, 0.2, 0.0, tint_alpha=0.3)
        c.fade(0, c.H, p.bg_b, 0.55, 0.9)
        finish(c, t, 0.0)
        zone = c.safe_bottom - (c.safe_top + 150)
        head_h = c.text_height(b[2]["headline"], 104, 800, 912, 1.05)
        total = 36 + head_h + 80 + c.timeline_height(b[2]["items"], 48, 912)
        top = c.safe_top + 150 + max(0.0, (zone - total) * 0.4)
        c.rect(84, top, 120 * progress(t, 0.1, 0.7), 10, BLUE, radius=5)
        h = c.reveal_text(b[2]["headline"], 84, top + 36, 104, 800, "#FFFFFF", t, start=0.2, step=0.1, width=912, line_height=1.05)
        c.timeline(b[2]["items"], 84, top + 36 + h + 80, t, start=0.9, step=0.55, size=48, color="#FFFFFF", accent=BLUE, width=912)
        c.logo()
    video.add_scene(b[2]["seconds"], steps, "zoom")

    # 4. Sign-off: the hero photograph one last time, brighter, with a ring, the line and the brand
    video.cta_pro(b[3]["headline"], seconds=b[3]["seconds"], photo="p1")
