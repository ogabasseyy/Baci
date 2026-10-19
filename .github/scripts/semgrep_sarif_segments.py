"""Line-oriented extraction for the SARIF drift audit:
quote-aware logical-line joining and run:-block segmentation.
Split from semgrep_sarif_shell (300-line limit); imports the
YAML/lexical primitives back from shell (no cycle: shell never
imports segments).
"""
import re
from semgrep_sarif_shell import map_key_value, strip_comments


def logical_lines(raw_lines):
    # Join quote-continued lines (a multi-line string's prose
    # must not parse as commands), then comment-strip, then
    # join backslash continuations. A # outside quotes ends
    # code for quote-tracking, matching strip_comments.
    chunks = []
    buf, quote = "", None
    for raw in raw_lines:
        if buf:
            buf += "\n"
        buf += raw
        i = 0
        while i < len(raw):
            ch = raw[i]
            if quote == "'":
                if ch == "'":
                    quote = None
            elif quote == '"':
                if ch == "\\":
                    i += 1
                elif ch == '"':
                    quote = None
            elif ch == "\\":
                i += 1
            elif ch == "#":
                break
            elif ch in ("'", '"'):
                quote = ch
            i += 1
        if quote is None:
            chunks.append(buf)
            buf = ""
    if buf.strip():
        chunks.append(buf)
    logical = []
    buf = ""
    for chunk in chunks:
        # A backslash-newline inside single quotes is literal
        # in bash; collapsing it can only split tokens, never
        # merge them, so analysis stays conservative.
        code = strip_comments(chunk.replace("\\\n", " ")).rstrip()
        if code.endswith("\\"):
            buf += code[:-1] + " "
        else:
            buf += code
            logical.append(buf)
            buf = ""
    if buf.strip():
        logical.append(buf)
    return logical


def run_segments(lines):
    bodies = []
    i = 0
    while i < len(lines):
        # Quoted "run": keys open blocks too: a bare-key match
        # would leave the whole step unaudited. Unnamed inline
        # steps (- run: evil) are unwrapped the same way.
        base = len(lines[i]) - len(lines[i].lstrip(" "))
        text = lines[i].strip()
        dash = re.match(r"^-\s+(.*)$", text)
        if dash:
            text = dash.group(1).strip()
        key, rest = map_key_value(text)
        ind = re.match(r"^([|>]?)\s*(.*)$", rest or "") \
            if key == "run" else None
        if ind and (ind.group(1) or ind.group(2)):
            if ind.group(1):
                j = i + 1
                while j < len(lines) \
                        and (not lines[j].strip()
                             or len(lines[j])
                             - len(lines[j].lstrip()) > base):
                    bodies.append(lines[j])
                    j += 1
                i = j
            else:
                bodies.append(ind.group(2))
                i += 1
        else:
            i += 1
    joined = []
    buf = ""
    for raw in bodies:
        stripped = raw.rstrip()
        if stripped.endswith("\\"):
            buf += stripped[:-1] + " "
        else:
            buf += stripped
            joined.append(buf)
            buf = ""
    return joined
