# "Make a cinematic reel for Somerset about pool opening season." Concept: winter to summer in one continuous camera move.
# A cold, desaturated covered pool (the leaves, the cover) -> whip pan -> the warm sunset opening -> punch-through -> sparkling clean water -> light burn -> sign-off.
# Every scene is full frame: the photograph is the picture, the camera never stops, and code adds light, grade, water and type.
def build(video):
    p = video.palette
    b = video.brief["scenes"]
    BLUE = p.accent
    H = video.H

    def type_block(c, t, s, y, big, small_text="", start=0.4, color="#FFFFFF", x=84, width=900):
        h = c.reveal_text(s, x, y, big, 800, color, t, start=start, step=0.09, width=width, line_height=1.04, shadow=0.5)
        if small_text:
            k = progress(t, start + 0.8, 0.9)
            c.text(small_text, x, y + h + 24 + (1 - k) * 26, 44, 400, "#FFFFFF", alpha=0.92 * k, width=width, shadow=0.35)
        return h

    # 1. Winter: the covered pool, cold and drained of colour. The camera pulls back while focus racks from the leaves up to the fence.
    def winter(c, t, u):
        c.camera("p1", u, "pull", 1.0, t, tint="#0B2A44", tint_alpha=0.22, focus_y=lerp(0.78, 0.3, u), blur=18, band=0.16)
        c.grade(contrast=1.1, saturation=0.62, warm=-0.3, teal_orange=0.2, fade=0.08)
        c.dust(t, 30, 2, 0.5, "#DDEBFF", 0.8)
        c.vignette(0.55)
        c.fade(c.H * 0.5, c.H * 0.5, "#05131F", 0.0, 0.88)
        k = progress(t, 0.2, 1.0)
        c.rect(84, c.H * 0.66, 10, 250 * k, "#9FC8E8", radius=5)
        type_block(c, t, b[0]["headline"], c.H * 0.66, 104, b[0]["subtext"], 0.3, x=124, width=860)
        c.grain(0.045, int(t * 30))
        c.logo()
    video.add_scene(b[0]["seconds"], winter, "whip", 0.7)

    # 2. The turn: warm sunset, the camera orbits in with a slight roll, a light leak burns across and water light moves on the pool.
    def opening(c, t, u):
        c.camera("p2", u, "orbit", 1.2, t, tint=p.bg_a, tint_alpha=0.08)
        c.grade(contrast=1.1, saturation=1.2, warm=0.28, teal_orange=0.45, fade=0.03)
        c.caustics(t, 0.16, "#BDEFFF", 1.0, 1.0, 0.55)
        c.rays(t, 0.82 * c.W, "#FFD9A0", 0.12)
        c.light_leak(t, "#FFB35A", 0.32, 0.4, 0.3, 0.2)
        c.dust(t, 36, 5, 0.6, "#FFE9C4", 1.2)
        c.vignette(0.45)
        c.fade(c.H * 0.46, c.H * 0.54, p.bg_b, 0.0, 0.9)
        k = progress(t, 0.15, 1.1)
        c.rect(84, c.H * 0.64, 10, 330 * k, BLUE, radius=5)
        type_block(c, t, b[1]["headline"], c.H * 0.64, 118, b[1]["subtext"], 0.45, x=124, width=860)
        c.grain(0.04, int(t * 30))
        c.logo()
    video.add_scene(b[1]["seconds"], opening, "crosszoom", 0.7)

    # 3. The clean water: a handheld, living shot of the sparkling pool; focus sweeps down the frame as three short lines land one by one.
    def clean(c, t, u):
        c.camera("p3", u, "handheld", 1.0, t, tint=p.bg_a, tint_alpha=0.06, focus_y=lerp(0.3, 0.75, u), blur=14, band=0.2)
        c.grade(contrast=1.08, saturation=1.18, warm=0.05, teal_orange=0.25)
        c.caustics(t, 0.2, "#E6FBFF", 1.0, 1.1, 0.45)
        c.light_leak(t, "#7FE3FF", 0.22, 0.3, 0.35, 0.7)
        c.dust(t, 30, 8, 0.5, "#FFFFFF", 1.0)
        c.vignette(0.45)
        c.fade(c.H * 0.34, c.H * 0.66, "#04202F", 0.0, 0.9)
        top = c.H * 0.47
        h = c.reveal_text(b[2]["headline"], 84, top, 110, 800, "#FFFFFF", t, start=0.25, step=0.1, width=900, line_height=1.04, shadow=0.5)
        y = top + h + 36
        for i, line in enumerate(b[2]["items"]):
            k = progress(t, 0.9 + i * 0.5, 0.7)
            c.rect(84, y + 22 + i * 82, 16 * k, 16 * k, BLUE, radius=8)
            c.text(line, 124 + (1 - k) * 40, y + i * 82, 50, 700, "#FFFFFF", alpha=k, width=860, shadow=0.45)
        c.grain(0.04, int(t * 30))
        c.logo()
    video.add_scene(b[2]["seconds"], clean, "lightleak", 0.8)

    # 4. Sign-off: back to the golden hour. A slow push with the light still moving; the line, then a button with the business name.
    def signoff(c, t, u):
        c.camera("p2", u, "push", 0.8, t, tint=p.bg_a, tint_alpha=0.18)
        c.grade(contrast=1.08, saturation=1.1, warm=0.2, teal_orange=0.3)
        c.light_leak(t, "#FFB35A", 0.3, 0.3, 0.3, 0.9)
        c.dust(t, 34, 11, 0.55, "#FFE9C4", 1.0)
        c.vignette(0.5)
        c.fade(c.H * 0.3, c.H * 0.7, p.bg_b, 0.0, 0.92)
        top = c.H * 0.52
        h = c.reveal_text(b[3]["headline"], c.W / 2, top, 112, 800, "#FFFFFF", t, start=0.3, step=0.1, align="center", width=860, line_height=1.04, shadow=0.5)
        k = progress(t, 1.2, 0.9, "back_out")
        by = top + h + 54
        c.rect(220, by + (1 - k) * 40, 640, 124, BLUE, radius=62, alpha=clamp(k * 1.4))
        c.text(video.brief["brand"]["name"], 500, by + 42 + (1 - k) * 40, 40, 800, p.on_accent, align="center", width=600, alpha=clamp(k * 1.4))
        c.icon("arrow", 220 + 640 - 120, by + 22 + (1 - k) * 40, 80, p.on_accent, None)
        c.grain(0.04, int(t * 30))
        c.logo()
    video.add_scene(b[3]["seconds"], signoff, "fade")
