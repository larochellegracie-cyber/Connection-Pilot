# "Explain what Somerset does for a pool owner." Motion graphics in the style of a clean product explainer: the owner's swirl of pool tasks resolves into Somerset,
# a booking card that fills itself in turns into a schedule you confirm, a cross-and-tick list, then one real photograph as the payoff.
# Dark -> light -> photograph. Nothing is a still: chips swirl, fields type, rows slide, a cursor clicks, the camera never stops on the last shot.
def build(video):
    p = video.palette
    b = video.brief["scenes"]
    INK = "#0B1F44"
    MUTED = "#64748B"
    NAVY_A = "#071033"
    NAVY_B = "#0E1B4D"

    def light_bg(c, t):
        c.gradient("#FFFFFF", "#EEF2F9", 180)
        c.glow(c.W * (0.5 + 0.42 * math.sin(t * 0.7)), 260 + 160 * math.cos(t * 0.5), 1100, "#CFDDFF", 0.6)
        c.glow(c.W * (0.5 - 0.4 * math.sin(t * 0.55 + 1.0)), c.H * 0.78 + 120 * math.sin(t * 0.4), 900, "#E4ECFF", 0.5)

    # 1. The swirl: everything a pool owner has to think about piles up around them, then Somerset takes it all in.
    def swirl(c, t, u):
        c.gradient(NAVY_A, NAVY_B, 180)
        c.glow(c.W / 2, 900, 1200, p.glow, 0.26 + 0.05 * wobble(2, t, 0.5))
        k = progress(t, 0.2, 0.8)
        resolved = progress(t, 5.2, 0.7, "ease_in_out")
        c.text(b[0]["subtext"], c.W / 2, 160 + (1 - k) * 20, 40, 400, "#A9B8E8", align="center", alpha=k * (1 - resolved), width=860)
        c.reveal_text(b[0]["headline"], c.W / 2, 226, 104, 800, "#FFFFFF", t, start=0.5, step=0.12, align="center", width=900, line_height=1.04)
        c.silhouette(c.W / 2, 1430, 260)
        pull = progress(t, 4.3, 1.5, "ease_in_out")
        c.swarm(b[0]["items"], t, c.W / 2, 930, 410, 270, 24, 30, 3, 1.0, progress(t, 0.2, 3.2, "linear"), pull, 4)
        if resolved > 0.01:
            orb = progress(t, 5.3, 0.9, "back_out")
            c.circle(c.W / 2, 930, 190 * orb, "#FFFFFF", alpha=clamp(orb * 1.3))
            c.arc(c.W / 2, 930, 214 * orb, 0, 360, p.accent, 8)
            if orb > 0.6:
                c.logo_at(c.W / 2, 930, 170)
            c.text(b[1]["headline"], c.W / 2, 1180, 76, 800, "#FFFFFF", align="center", alpha=resolved, width=860)
        c.vignette(0.3)
    video.add_scene(b[0]["seconds"], swirl, "lightleak", 0.8)

    # 2. The card: a booking form that fills itself in (a status pill says who is doing it), then becomes a schedule you confirm with one click.
    def card_scene(c, t, u):
        light_bg(c, t)
        it, jt = b[2]["items"], b[3]["items"]
        swap = progress(t, 5.6, 0.8, "ease_in_out")
        # headline: first the booking, then the schedule
        if swap < 0.05:
            c.text(b[2]["subtext"], c.W / 2, 190, 40, 400, MUTED, align="center", width=860)
            c.reveal_text(b[2]["headline"], c.W / 2, 246, 92, 800, INK, t, start=0.2, step=0.1, align="center", width=900, line_height=1.04)
        else:
            c.text(b[3]["subtext"], c.W / 2, 190, 40, 400, MUTED, align="center", alpha=swap, width=860)
            c.reveal_text(b[3]["headline"], c.W / 2, 246, 92, 800, INK, t, start=5.7, step=0.1, align="center", width=900, line_height=1.04)
        # the booking form (slides away to the left)
        c.push(-340 * swap, 0, c.W, c.H, alpha=1 - swap)
        y0 = c.card(84, 620, 912, 820, "New booking", "Draft", alpha=1.0)
        y = c.field(122, y0, 836, it[0], it[1], t, 1.2)
        y = c.field(122, y, 836, it[2], it[3], t, 2.7)
        y = c.field(122, y, 836, it[4], it[5], t, 4.2)
        c.pill(it[6], 760, 560, t, 0.9)
        c.text(it[7], c.W / 2, 1500, 50, 800, INK, align="center", alpha=progress(t, 4.8, 0.6), width=860)
        c.pop()
        # the schedule (slides in from the right) and the button that gets clicked
        if swap > 0.01:
            c.push(340 * (1 - swap), 0, c.W, c.H, alpha=swap)
            y0 = c.card(84, 620, 912, 940, jt[0], jt[1], alpha=1.0)
            for i in range(3):
                c.row(122, y0 + i * 112, 836, jt[2 + i * 2], jt[3 + i * 2], t, 6.7 + i * 0.5)
            press = progress(t, 9.9, 0.35, "linear")
            c.button(122, 620 + 940 - 150, 836, jt[8], progress(t, 8.4, 0.5), press * (1 - progress(t, 10.3, 0.3, "linear")))
            c.text(jt[9], c.W / 2, 1640, 50, 800, INK, align="center", alpha=progress(t, 10.4, 0.6), width=860)
            c.pop()
            mv = progress(t, 8.9, 1.0, "ease_in_out")
            c.cursor(lerp(800, 560, mv), lerp(1050, 1460, mv), progress(t, 8.7, 0.3), progress(t, 9.9, 0.45, "linear"), 1.4)
    video.add_scene(b[2]["seconds"], card_scene, "whip", 0.7)

    # 3. The list: an editorial headline with an italic accent and a short cross-and-tick list that checks itself off.
    def list_scene(c, t, u):
        light_bg(c, t)
        c.text(b[4]["subtext"], 84, 230, 40, 400, MUTED, width=860, alpha=progress(t, 0.1, 0.6))
        k1 = progress(t, 0.3, 0.9)
        c.text("Pool season", 84, 300 + (1 - k1) * 40, 126, 700, INK, face="serif", alpha=k1, width=900)
        k2 = progress(t, 0.7, 0.9)
        c.text("handled.", 84, 438 + (1 - k2) * 40, 126, 700, "#2F5BEA", face="serif_italic", alpha=k2, width=900)
        for i, line in enumerate(b[4]["items"]):
            kk = progress(t, 1.5 + i * 0.7, 0.7, "back_out")
            y = 820 + i * 160
            c.mark("yes" if i == 2 else "no", 84, y, 58, kk)
            c.text(line, 172 + (1 - kk) * 40, y + 4, 54, 700 if i == 2 else 400, INK, alpha=clamp(kk * 1.4), width=800)
        c.rect(84, 1560, 912, 2, "#DDE3EE", alpha=progress(t, 3.4, 0.5))
        c.text(video.brief["brand"]["name"], 84, 1600, 38, 700, INK, alpha=progress(t, 3.4, 0.6), width=700)
    video.add_scene(b[4]["seconds"], list_scene, "whip", 0.7)

    # 4. The payoff: one real photograph, full frame, the camera moving, the light moving, the line, and the brand.
    def payoff(c, t, u):
        c.camera("p1", u, "orbit", 1.0, t, tint=NAVY_A, tint_alpha=0.1)
        c.grade(contrast=1.1, saturation=1.15, warm=0.25, teal_orange=0.4)
        c.light_leak(t, "#FFB35A", 0.3, 0.35, 0.3, 0.2)
        c.caustics(t, 0.14, "#BDEFFF", 1.0, 1.0, 0.6)
        c.dust(t, 34, 6, 0.55, "#FFE9C4", 1.1)
        c.vignette(0.5)
        c.fade(c.H * 0.4, c.H * 0.6, NAVY_A, 0.0, 0.92)
        top = c.H * 0.6
        h = c.reveal_text(b[5]["headline"], 84, top, 124, 800, "#FFFFFF", t, start=0.3, step=0.12, width=900, line_height=1.02, shadow=0.5)
        k = progress(t, 1.1, 0.9, "back_out")
        c.rect(84, top + h + 40, 520, 104, p.accent, radius=52, alpha=clamp(k * 1.4))
        c.text(video.brief["brand"]["name"], 344, top + h + 40 + 30, 38, 800, p.on_accent, align="center", width=480, alpha=clamp(k * 1.4))
        c.grain(0.035, int(t * 30))
        c.logo()
    video.add_scene(b[5]["seconds"], payoff, "fade")
