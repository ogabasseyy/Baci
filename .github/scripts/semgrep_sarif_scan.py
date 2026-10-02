"""Quote/paren-aware shell scanners: subshell extraction,
brace skipping, and output-redirect targets with the trusted-
tree write predicate shared by run-block and helper audits.
"""
import posixpath
import re


def _paren_end(text, i):
    # Index of the paren closing the depth opened before i, or
    # len(text) when unterminated. Single quotes are literal,
    # double quotes nest for paren purposes, backslashes skip.
    depth, quote, j = 1, None, i
    while j < len(text) and depth:
        ch = text[j]
        if quote == "'":
            if ch == "'":
                quote = None
            j += 1
        elif ch == "\\" and j + 1 < len(text):
            j += 2
        elif ch == "'":
            quote = "'"
            j += 1
        elif ch == '"':
            quote = None if quote == '"' else '"'
            j += 1
        elif ch == "(":
            depth += 1
            j += 1
        elif ch == ")":
            depth -= 1
            j += 1
        else:
            j += 1
    return j - 1 if depth == 0 else len(text)

def skip_braced(text, i):
    # Index just past the ${...} opening at i (i points at $),
    # honoring nesting and quotes. Unterminated runs to end.
    depth, j, quote = 1, i + 2, None
    while j < len(text) and depth:
        ch = text[j]
        if quote == "'":
            if ch == "'":
                quote = None
            j += 1
        elif ch == "\\" and j + 1 < len(text):
            j += 2
        elif ch == "'":
            quote = "'"
            j += 1
        elif ch == '"':
            quote = None if quote == '"' else '"'
            j += 1
        elif ch == "{":
            depth += 1
            j += 1
        elif ch == "}":
            depth -= 1
            j += 1
        else:
            j += 1
    return j

def extract_subshells(text):
    # Split out $(...), `...`, <(...) and >(...) commands for
    # separate analysis, replacing each with inert $(). Nested
    # forms recurse; single quotes are literal but double
    # quotes scan through (substitutions execute inside them);
    # ${...} scans through (no commands of its own, but may
    # nest $()); $((...)) extracts the same way (its nested
    # $() operands still execute).
    out, inners = [], []
    i, quote = 0, None
    while i < len(text):
        ch = text[i]
        if quote == "'":
            out.append(ch)
            if ch == "'":
                quote = None
            i += 1
        elif ch == "\\" and i + 1 < len(text):
            out.append(ch)
            out.append(text[i + 1])
            i += 2
        elif ch == "'":
            quote = "'"
            out.append(ch)
            i += 1
        elif ch == '"':
            quote = None if quote == '"' else '"'
            out.append(ch)
            i += 1
        elif ch == "`":
            j = i + 1
            buf = []
            while j < len(text) and text[j] != "`":
                if text[j] == "\\" and j + 1 < len(text):
                    buf.append(text[j])
                    buf.append(text[j + 1])
                    j += 2
                else:
                    buf.append(text[j])
                    j += 1
            inner, sub = extract_subshells("".join(buf))
            inners.append(inner)
            inners.extend(sub)
            out.append("$()")
            i = j + 1
        elif ch == "$" and text[i:i + 2] == "$(":
            j = _paren_end(text, i + 2)
            inner, sub = extract_subshells(text[i + 2:j])
            inners.append(inner)
            inners.extend(sub)
            out.append("$()")
            i = j + 1 if j < len(text) else j
        elif ch in ("<", ">") and text[i:i + 2] in ("<(", ">("):
            j = _paren_end(text, i + 2)
            inner, sub = extract_subshells(text[i + 2:j])
            inners.append(inner)
            inners.extend(sub)
            out.append("$()")
            i = j + 1 if j < len(text) else j
        else:
            out.append(ch)
            i += 1
    return "".join(out), inners

def subscript_cmdsubst(text):
    # $(...) / `...` hiding in single-quoted [[ -v name[..] ]]
    # operands, which extract_subshells treats as literal. The
    # quoted form is version-dependent (bash 3.2 rejects it at
    # parse time), so audit it as executable (fail closed).
    # Only -v operands qualify (==/case/test operands never
    # evaluate); unquoted and double-quoted forms are already
    # covered by the main extraction. Returns inner commands.
    inners = []
    for m in re.finditer(r"\[\[\s+(?:!\s+)?-v\s+", text):
        j = m.end()
        while j < len(text) and text[j] in (" ", "\t"):
            j += 1
        if j >= len(text) or text[j] != "'":
            continue
        k = j + 1
        while k < len(text) and text[k] != "'":
            k += 1
        _, sub = extract_subshells(text[j + 1:k])
        inners.extend(sub)
    return inners

def arith_regions(text):
    # Bodies of $((...)) expansions. Arithmetic evaluates nested
    # expansions even inside single quotes (verified: PWNED), so a
    # $ or backtick in here is executable despite quote stripping.
    regions = []
    i, quote = 0, None
    while i < len(text):
        ch = text[i]
        if quote == "'":
            if ch == "'":
                quote = None
            i += 1
        elif ch == "\\" and i + 1 < len(text):
            i += 2
        elif ch == "'":
            quote, i = "'", i + 1
        elif ch == '"' or ch == "`":
            i += 1
        elif text[i:i + 3] == "$((":
            j = _paren_end(text, i + 2)
            regions.append(text[i + 3:j - 1]
                           if j < len(text) else text[i + 3:])
            i = j + 1 if j < len(text) else j
        else:
            i += 1
    return regions


def github_cmdfile_kind(target):
    # "env"/"path" when a redirect/copy target is a runner
    # command file ($GITHUB_ENV/$GITHUB_PATH, braced or bare;
    # :-style defaults still land in the file when the var is
    # set, which runners always do). GITHUB_ENVY and friends
    # fail the boundary.
    t = target.strip().strip("\"'")
    m = re.fullmatch(r"\$(GITHUB_(ENV|PATH))", t)
    if m:
        return m.group(2).lower()
    m = re.fullmatch(r"\$\{GITHUB_(ENV|PATH)([^}]*)\}", t)
    if m and (m.group(2) == ""
              or m.group(2)[0] in ":}-+=?#%/["):
        return m.group(1).lower()
    return None


def is_trusted_write_target(target):
    # The trusted tree is never legitimately written by audited
    # code: resolver and helpers only read it (writes go to
    # GITHUB_OUTPUT/GITHUB_PATH/RUNNER_TEMP). Either spelling of
    # the tree root in a redirect target drifts.
    return "trusted-scripts" in target or re.search(
        r"\$(\{)?SCRIPT_DIR\}?", target) is not None

MUSE_BIN_RE = (r"^(?:\$(?:\{HOME\}|HOME)/|~/)"
               r"\.local/bin/muse$")
MUSE_DIR_RE = (r"^(?:\$(?:\{HOME\}|HOME)|~)"
               r"(?:/\.local(?:/bin)?)?/?$")
WS_RE = r"^\$(?:\{GITHUB_WORKSPACE\}|GITHUB_WORKSPACE)(?:/|$)"


def _collapse_proc_root(path):
    # Resolve /proc/<pid>/root symlinks lexically (each is the
    # process root /), alternating with normpath the way the
    # kernel resolves left to right. Pids exclude leading dots
    # (/proc/../root is root's home, not an alias). Bounded;
    # non-converging spellings stay for the caller's match.
    for _ in range(8):
        path = posixpath.normpath(re.sub(
            r"^/proc/[^/.][^/]*/root(?=/|$)", "", path,
            count=1) or "/")
    return path


def has_proc_environ(text):
    # Any /proc path resolving to an environ file: direct,
    # dot-dot, or /root-aliased spellings (/proc/self/root/
    # /proc/self/environ reads our own secrets). Step secrets
    # past exact-value masking, whatever the reader.
    for m in re.finditer(
            r"(?:^|[^/\w])(/proc/\S*?/environ(?![\w]))", text):
        if re.fullmatch(r"/proc/[^/]+/environ",
                        _collapse_proc_root(m.group(1))):
            return True
    return False


def _write_zone(target):
    # Where a helper write lands: "trusted" (script tree, the
    # installed muse binary, or its ancestor dirs -- a link
    # swap there redirects the absolute-path invocation),
    # "workspace" (the agent-readable checkout: token staging),
    # or None. Collapsed (/proc/<pid>/root aliases) and
    # normalized first so .. and alias spellings cannot hide a
    # protected destination (over-approximating outward escapes
    # is fail-closed).
    t = _collapse_proc_root(target)
    if "trusted-scripts" in t or re.search(
            r"\$(\{)?SCRIPT_DIR\}?", t) is not None:
        return "trusted"
    if re.match(MUSE_BIN_RE, t) or re.match(MUSE_DIR_RE, t):
        return "trusted"
    if re.match(WS_RE, t):
        return "workspace"
    return None

