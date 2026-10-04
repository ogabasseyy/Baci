"""Quote/paren-aware shell scanners: subshell extraction,
brace skipping, and output-redirect targets with the trusted-
tree write predicate shared by run-block and helper audits.
"""
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


def arith_command_regions(text):
    # Bodies of ((...)) compound commands ($((...)) excluded:
    # arith_regions covers those). Bare names here recurse
    # exactly like $((...)), so the opaque-name rule applies;
    # quoted spans are literal text, never commands, and are
    # skipped. Residual: [[ ]]/case globs with (( over-match.
    regions = []
    i, quote, n = 0, None, len(text)
    while i < n:
        ch = text[i]
        if quote:
            if ch == quote:
                quote = None
            i += 1
        elif ch in ("'", '"'):
            quote, i = ch, i + 1
        elif ch == "\\" and i + 1 < n:
            i += 2
        elif text[i:i + 2] == "((" \
                and (i == 0 or text[i - 1] != "$"):
            j = _paren_end(text, i + 1)
            regions.append(text[i + 2:j - 1]
                           if j < len(text) else text[i + 2:])
            i = j + 1 if j < len(text) else j
        else:
            i += 1
    return regions


def blank_arith_commands(text):
    # Blank ((...)) compound commands (same opener scan as
    # arith_command_regions, spans instead of bodies): their
    # *?[] are operators, and dispatch would otherwise read
    # the paren-split fragments as glob argv0s. Newlines
    # survive (no line fusion); the arithmetic rules read
    # the raw line, so nothing is lost. Mid-word (( over-
    # matches like its sibling (dead code either way).
    spans, i, quote, n = [], 0, None, len(text)
    while i < n:
        ch = text[i]
        if quote:
            if ch == quote:
                quote = None
            i += 1
        elif ch in ("'", '"'):
            quote, i = ch, i + 1
        elif ch == "\\" and i + 1 < n:
            i += 2
        elif text[i:i + 2] == "((" \
                and (i == 0 or text[i - 1] != "$"):
            j = _paren_end(text, i + 1)
            end = j + 1 if j < n else j
            spans.append((i, end))
            i = end
        else:
            i += 1
    if not spans:
        return text
    out = list(text)
    for start, end in spans:
        for k in range(start, end):
            if out[k] != "\n":
                out[k] = " "
    return "".join(out)


def _strip_case_patterns(nosub):
    # Drop case pattern prefixes clause by clause (;;-separated,
    # quote-aware): the first ) at paren depth 0 ends the
    # pattern; subshell closes sit deeper and never cut. Body
    # commands after the ) are kept for analysis. Shared by
    # the helper and run-block dispatchers so both read the
    # same command stream.
    clauses, buf, quote = [], "", None
    i = 0
    while i < len(nosub):
        ch = nosub[i]
        if quote:
            buf += ch
            if ch == quote:
                quote = None
            i += 1
        elif ch in ("'", '"'):
            quote, buf, i = ch, buf + ch, i + 1
        elif ch == ";" and nosub[i:i + 2] == ";;":
            j = i + 2
            if j < len(nosub) and nosub[j] in (";", "&"):
                j += 1
            clauses.append(buf)
            buf, i = "", j
        else:
            buf, i = buf + ch, i + 1
    clauses.append(buf)
    kept = []
    for clause in clauses:
        depth, quote, cut = 0, None, None
        i = 0
        while i < len(clause):
            ch = clause[i]
            if quote:
                if ch == quote:
                    quote = None
            elif ch in ("'", '"'):
                quote = ch
            elif ch == "(":
                depth += 1
            elif ch == ")":
                if depth == 0:
                    cut = i + 1
                    break
                depth -= 1
            i += 1
        kept.append(clause[cut:] if cut is not None else clause)
    return "; ".join(kept)


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
    # the tree root in a redirect target drifts, as does the
    # runner-writable hosted tool cache (mirrors _write_zone).
    return "trusted-scripts" in target or re.search(
        r"\$(\{)?SCRIPT_DIR\}?", target) is not None \
        or re.match(r"^/opt/hostedtoolcache(?:/|$)",
                    target) is not None
