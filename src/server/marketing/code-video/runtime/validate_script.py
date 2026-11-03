"""
Checks a model-written scene script BEFORE it is run. This is the first of several layers (the others: restricted builtins in runner.py, an
operating-system sandbox with no network and write access only to the job's folder, memory and time limits). The script may only call the
scene library and do simple arithmetic and loops. It may not import anything, define classes, open files, reach into object internals,
or contain any sentence that is not one of the business's own words from the brief.
"""
import ast

MAX_BYTES = 20000
MAX_NODES = 6000
BANNED_NODES = (ast.Import, ast.ImportFrom, ast.ClassDef, ast.While, ast.AsyncFunctionDef, ast.AsyncFor, ast.AsyncWith, ast.Await, ast.Yield, ast.YieldFrom,
                ast.Global, ast.Nonlocal, ast.Delete, ast.With, ast.Try, ast.Raise)
BANNED_NAMES = {"__builtins__", "__import__", "eval", "exec", "compile", "open", "getattr", "setattr", "delattr", "globals", "locals", "vars", "dir", "type",
                "input", "breakpoint", "exit", "quit", "help", "super", "object", "memoryview", "bytearray", "bytes", "id", "callable", "classmethod", "staticmethod",
                "property", "isinstance", "issubclass", "hasattr", "print"}
# The only attribute names a script may use. Anything else (including every name that reaches into Python's objects, files or modules) is
# refused, so a script cannot walk from the objects it is given to anything it was not given.
ALLOWED_ATTRS = {
    # the video and its scenes
    "brief", "palette", "H", "W", "safe_top", "safe_bottom", "bg_a", "bg_b", "accent", "on_accent", "glow", "glow2", "scrim", "dark", "scene", "add_scene", "photo_hero", "photo_frame", "photo_split", "statement", "card_scene", "cta",
    "text", "rect", "icon", "photo", "glow", "logo_bar", "text_block",
    # the open canvas
    "chip", "card", "field", "row", "pill", "button", "cursor", "mark", "badge", "counter", "mesh", "silhouette", "swarm", "camera", "caustics", "light_leak", "dust", "fill", "gradient", "circle", "ellipse", "line", "polygon", "arc", "shadow_rect", "logo", "text_width", "text_height", "fit_size", "push", "pop", "timeline_ad", "explainer_intro", "explainer_chaos", "explainer_form", "explainer_schedule", "explainer_chat", "explainer_swap", "explainer_cta", "product_scene", "explainer_orbit", "theme", "prop", "gloss_rect", "cylinder", "sphere", "soft_shadow", "floor", "vignette", "grade", "grain", "bokeh", "rays", "studio", "tone_a", "tone_b", "logo_at", "hook_kinetic", "feature_float", "steps_timeline", "statement_kinetic", "cta_pro", "backdrop", "fade", "timeline_height", "text_stack", "reveal_text", "ring", "timeline", "marquee",
    # the math helpers
    "sin", "cos", "pi", "floor", "ceil", "sqrt", "atan2", "radians",
    # ordinary list, dict and string methods
    "append", "extend", "insert", "index", "count", "sort", "reverse", "items", "keys", "values", "get", "copy",
    "upper", "lower", "title", "capitalize", "split", "strip", "lstrip", "rstrip", "join", "startswith", "endswith", "replace", "isdigit", "splitlines", "zfill", "center",
}
MAX_POWER = 8


def _norm(text):
    return " ".join(str(text).split()).lower()


def validate(source, allowed_text):
    """Returns a list of plain-language problems; an empty list means the script may be run."""
    problems = []
    if len(source.encode("utf-8")) > MAX_BYTES:
        return ["The script is too long."]
    try:
        tree = ast.parse(source)
    except SyntaxError as error:
        return ["Syntax error on line %s: %s" % (error.lineno, error.msg)]
    allowed = [_norm(t) for t in allowed_text if t]
    blob = " | ".join(allowed)
    nodes = list(ast.walk(tree))
    if len(nodes) > MAX_NODES:
        problems.append("The script is too complicated.")
    docstrings = set()
    for node in nodes:
        if isinstance(node, (ast.FunctionDef, ast.Module)) and node.body and isinstance(node.body[0], ast.Expr) and isinstance(getattr(node.body[0], "value", None), ast.Constant) and isinstance(node.body[0].value.value, str):
            docstrings.add(id(node.body[0].value))
    for node in nodes:
        if isinstance(node, BANNED_NODES):
            problems.append("Not allowed: %s (line %s)." % (type(node).__name__, getattr(node, "lineno", "?")))
        elif isinstance(node, ast.Name) and (node.id in BANNED_NAMES or (node.id.startswith("__") and node.id.endswith("__"))):
            problems.append("Not allowed: the name %s (line %s)." % (node.id, node.lineno))
        elif isinstance(node, ast.Attribute) and (node.attr.startswith("_") or node.attr not in ALLOWED_ATTRS):
            problems.append("Not allowed: the attribute %s (line %s). Use only the drawing methods listed in the reference." % (node.attr, node.lineno))
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Pow) and not (isinstance(node.right, ast.Constant) and isinstance(node.right.value, (int, float)) and abs(node.right.value) <= MAX_POWER):
            problems.append("Not allowed: a power with a changing or large exponent (line %s)." % node.lineno)
        elif isinstance(node, ast.BinOp) and isinstance(node.op, ast.Mult) and any(isinstance(side, (ast.List, ast.Tuple, ast.ListComp, ast.JoinedStr)) or (isinstance(side, ast.Constant) and isinstance(side.value, (str, bytes))) for side in (node.left, node.right)):
            problems.append("Not allowed: repeating a list or text with * (line %s)." % node.lineno)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str) and id(node) not in docstrings:
            text = _norm(node.value)
            # short words ("center", "p1", "fade") are option names; anything sentence-like must be the business's own words
            if len(text) > 14 and text not in blob:
                problems.append("This text is not from the business's own words: \"%s\" (line %s)." % (node.value[:60], node.lineno))
    if not any(isinstance(n, ast.FunctionDef) and n.name == "build" for n in tree.body):
        problems.append("The script must define build(video).")
    return problems[:12]
