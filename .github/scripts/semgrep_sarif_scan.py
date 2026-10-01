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


def redirect_targets(text):
    # Output-redirect targets outside quotes: >, >>, >|, &>,
    # &>>, <>, >&file. Inputs (<), heredocs (<<), fd dups
    # (>&2, >&-) yield nothing; >( ) itself yields nothing but
    # the command inside is still scanned for nested writes.
    # Unterminated quotes read to end of
    # line; such input is a loud bash syntax error anyway.
    # ${...} expansions are skipped (a default value may hold a
    # comparison >, as in ${X:-a>b}); $(...) is still scanned
    # because redirections inside command substitution are real.
    # Residual: a redirect nested in $(...) inside a skipped
    # ${...} default is missed -- adversarial obfuscation, out of
    # the accident-scope model (fork PRs skip the audit anyway).
    targets = []
    quote, i = None, 0
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == quote:
                quote = None
            i += 1
        elif ch in ("'", '"'):
            quote, i = ch, i + 1
        elif ch == "$" and text[i:i + 2] == "${":
            i = skip_braced(text, i)
        elif ch == "&" and text[i:i + 3] == "&>>":
            i = _redirect_target(text, i + 3, targets)
        elif ch == "&" and text[i:i + 2] == "&>":
            i = _redirect_target(text, i + 2, targets)
        elif ch == "<" and text[i:i + 2] == "<>":
            i = _redirect_target(text, i + 2, targets)
        elif ch == ">":
            if text[i + 1:i + 2] == "&":
                i = _dup_target(text, i + 2, targets)
            elif text[i + 1:i + 2] in (">", "|"):
                i = _redirect_target(text, i + 2, targets)
            else:
                i = _redirect_target(text, i + 1, targets)
        else:
            i += 1
    return targets

def _redirect_target(text, i, targets):
    while i < len(text) and text[i] in (" ", "\t"):
        i += 1
    if i < len(text) and text[i] in ("'", '"'):
        quote, j = text[i], i + 1
        while j < len(text) and text[j] != quote:
            j += 1
        targets.append(text[i + 1:j])
        return j + 1
    j = i
    while j < len(text) and text[j] not in (" ", "\t", ";",
                                            "|", "&", "<", ">",
                                            "(", ")"):
        j += 1
    if j > i:
        targets.append(text[i:j])
    return j

def _dup_target(text, i, targets):
    # >&word duplicates onto a file only when word is neither an
    # fd nor -; >&2/>&-/>&2- stay silent.
    j = i
    while j < len(text) and text[j] not in (" ", "\t", ";",
                                            "|", "&", "<", ">",
                                            "(", ")"):
        j += 1
    word = text[i:j]
    if word and word != "-" and not re.fullmatch(r"\d+-?", word):
        targets.append(word)
    return j

def is_trusted_write_target(target):
    # The trusted tree is never legitimately written by audited
    # code: resolver and helpers only read it (writes go to
    # GITHUB_OUTPUT/GITHUB_PATH/RUNNER_TEMP). Either spelling of
    # the tree root in a redirect target drifts.
    return "trusted-scripts" in target or re.search(
        r"\$(\{)?SCRIPT_DIR\}?", target) is not None

