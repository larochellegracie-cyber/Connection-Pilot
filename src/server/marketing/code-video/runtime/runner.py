"""
Runs a model-written scene script. TRUSTED code. Usage: python runner.py brief.json script.py
It validates the script, runs build(video) with a tiny set of builtins and nothing else in scope, and renders the video to brief["out"].
It prints ONE JSON line to stdout: {"ok": true} or {"ok": false, "errors": [...]}.
"""
import json
import math
import os
import sys
import types

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

def safe_range(*args):
    """range() that cannot be used to build huge sequences."""
    r = range(*[int(a) for a in args])
    if len(r) > 5000:
        raise ValueError("range is too large (at most 5000)")
    return r


SAFE_BUILTINS = {name: __builtins__[name] if isinstance(__builtins__, dict) else getattr(__builtins__, name) for name in
                 ("range", "len", "min", "max", "abs", "round", "int", "float", "str", "bool", "list", "dict", "tuple", "enumerate", "zip", "sum", "sorted", "reversed")}
SAFE_BUILTINS["range"] = safe_range


def allowed_text(brief):
    items = [brief["brand"].get("name", "")]
    for scene in brief["scenes"]:
        items += [scene.get("headline", ""), scene.get("subtext", "")] + list(scene.get("items", []) or [])
    return items


def limit_resources():
    """Belt and braces on top of the operating-system sandbox: bounded CPU time and output file size (memory limits are applied where the OS honours them)."""
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_CPU, (600, 600))
        resource.setrlimit(resource.RLIMIT_FSIZE, (400 * 1024 * 1024, 400 * 1024 * 1024))
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        try:
            resource.setrlimit(resource.RLIMIT_AS, (6 * 1024 ** 3, 6 * 1024 ** 3))
        except Exception:
            pass
    except Exception:
        pass


def start_watchdogs(budget=280):
    """Stops the program if it uses too much memory or runs far too long, whatever the script does. (Frames that take too long are stopped separately.)"""
    import resource
    import signal
    import threading
    import time

    def on_alarm(signum, frame):
        raise TimeoutError("a frame took too long to draw")

    signal.signal(signal.SIGALRM, on_alarm)
    sys.setrecursionlimit(300)
    started = time.time()

    def watch():
        while True:
            time.sleep(0.5)
            rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss  # bytes on macOS, kilobytes on Linux
            rss_bytes = rss if sys.platform == "darwin" else rss * 1024
            usage = resource.getrusage(resource.RUSAGE_SELF)
            # the limit counts the time the program really spends working (a machine that is slow or paused for a while is not a reason to stop it), with a generous cap on the clock
            if rss_bytes > 3.5 * 1024 ** 3 or usage.ru_utime + usage.ru_stime > budget or time.time() - started > budget * 4:
                os._exit(4)

    threading.Thread(target=watch, daemon=True).start()


def api_hint(error):
    """When a script calls a drawing method wrongly (an argument that does not exist, a method that does not exist), say what the method really takes, so the fix is not a guess."""
    import difflib
    import inspect
    import re
    message = str(error)
    try:
        import pilot_canvas
        import pilot_scenes
        owners = (("c", pilot_canvas.Canvas), ("video", pilot_scenes.Video))
        found = re.match(r"(\w+)\(\) (?:got an unexpected keyword argument '(\w+)'|missing|takes)", message)
        if isinstance(error, TypeError) and found:
            for prefix, owner in owners:
                if hasattr(owner, found.group(1)):
                    signature = str(inspect.signature(getattr(owner, found.group(1)))).replace("(self, ", "(").replace("(self)", "()")
                    extra = " It has no argument called %s." % found.group(2) if found.group(2) else ""
                    return " Check the toolkit reference: %s.%s%s.%s" % (prefix, found.group(1), signature, extra)
        missing = re.search(r"has no attribute '(\w+)'", message)
        if isinstance(error, AttributeError) and missing:
            names = [n for _, owner in owners for n in dir(owner) if not n.startswith("_")]
            close = difflib.get_close_matches(missing.group(1), names, 3)
            if close:
                return " Did you mean %s?" % ", ".join(close)
    except Exception:
        pass
    return ""


def main():
    brief = json.load(open(sys.argv[1]))
    if len(sys.argv) > 3 and sys.argv[3] in ("--lint", "--measure"):
        # the layout check measures design units, not pixels, so it runs on a small copy of the frame (much faster, the same answer)
        w, h = int(brief["width"]), int(brief["height"])
        brief = dict(brief, width=360, height=max(2, int(round(h * 360.0 / w / 2.0)) * 2))
    source = open(sys.argv[2]).read()
    from validate_script import validate
    problems = validate(source, allowed_text(brief))
    if problems:
        print(json.dumps({"ok": False, "errors": problems}))
        return 2
    if len(sys.argv) > 3 and sys.argv[3] == "--check":  # validation only: nothing is run or drawn
        print(json.dumps({"ok": True, "checked": True}))
        return 0
    limit_resources()
    start_watchdogs(max(120, min(600, float(brief.get("budget_seconds", 280)))))
    import pilot_scenes
    video = pilot_scenes.Video(brief)
    import pilot_canvas
    scope = {"__builtins__": SAFE_BUILTINS, "__name__": "scene_script", "video": video,
             "math": types.SimpleNamespace(sin=math.sin, cos=math.cos, pi=math.pi, floor=math.floor, ceil=math.ceil, sqrt=math.sqrt, atan2=math.atan2, radians=math.radians),
             "ease": pilot_canvas.ease, "clamp": pilot_canvas.clamp, "progress": pilot_canvas.progress, "wobble": pilot_canvas.wobble, "rand": pilot_canvas.rand, "lerp": pilot_scenes.lerp}
    try:
        exec(compile(source, "scene_script.py", "exec"), scope)
        scope["build"](video)
        if len(sys.argv) > 3 and sys.argv[3] == "--preview":  # small still frames at chosen times, for a design review; no video is made
            written = []
            for i, t in enumerate(brief.get("preview_times", [])[:12]):
                path = os.path.join(brief["preview_dir"], "frame_%02d.jpg" % i)
                video.frame_at(float(t)).convert("RGB").save(path, quality=90)
                written.append(path)
            print(json.dumps({"ok": True, "frames": len(written)}))
            return 0
        if len(sys.argv) > 3 and sys.argv[3] == "--measure":  # what every scene really contains (for the storyboard check and its report); nothing is rendered
            print(json.dumps({"ok": True, "measured": pilot_canvas.measure_video(video)}))
            return 0
        if len(sys.argv) > 3 and sys.argv[3] == "--lint":  # layout check on sample frames; nothing is rendered
            found = pilot_canvas.lint_video(video)
            print(json.dumps({"ok": not found, "errors": found}))
            return 0 if not found else 5
        video.render(brief["out"])
    except Exception as error:  # the model's script had a bug
        where = ""
        try:  # the line of the model's own script where it went wrong, so the repair can go straight to it
            import traceback
            for frame in reversed(traceback.extract_tb(error.__traceback__)):
                if frame.filename == "scene_script.py" and frame.lineno:
                    where = " (your script, line %d: %s)" % (frame.lineno, source.splitlines()[frame.lineno - 1].strip()[:140])
                    break
        except Exception:
            pass
        print(json.dumps({"ok": False, "errors": ["%s: %s%s%s" % (type(error).__name__, str(error)[:300], where, api_hint(error))]}))
        return 3
    print(json.dumps({"ok": True, "seconds": video.total_seconds(), "scenes": len(video.scenes)}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
