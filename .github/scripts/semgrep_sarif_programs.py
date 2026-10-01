"""Data-program content guards: perl and jq sources executed
by helpers run with runner tokens, so their content takes the
same fail-closed treatment as shell (dangerous fixed-code
constructs drift even when human review sleeps through the
trusted-tree signal). jq inline programs (--jq included) scan
with the same rule as -f files.
"""
import re
from semgrep_sarif_scan import _paren_end


def jq_program_has_env(text):
    # environ access (token into the pipeline) plus module loading
    # (-L/import/include would source unpinned code). Field access
    # (.env) is data and stays allowed; string literals over-scan
    # (fail closed, human-reviewed).
    return re.search(
        r"\$ENV\b|(?<![.\w$])(env|getenv|import|include)"
        r"(?![\w])", text) is not None


def audit_jq_content(text, drift):
    if jq_program_has_env(text) \
            and "helper-jq-env" not in drift:
        drift.append("helper-jq-env")


def _split_args(inner):
    # Top-level comma split (quote- and depth-aware).
    args = []
    depth, quote, buf = 0, None, ""
    for ch in inner:
        if quote:
            buf += ch
            if ch == quote:
                quote = None
        elif ch in ("'", '"'):
            quote, buf = ch, buf + ch
        elif ch in "([{":
            depth, buf = depth + 1, buf + ch
        elif ch in ")]}":
            depth = max(0, depth - 1)
            buf += ch
        elif ch == "," and depth == 0:
            args.append(buf)
            buf = ""
        else:
            buf += ch
    args.append(buf)
    return args


def _stmt_end(text, i):
    # Index of the top-level ; ending the statement at i
    # (quote/depth-aware); len(text) when unterminated.
    depth, quote, j = 0, None, i
    while j < len(text):
        ch = text[j]
        if quote:
            if ch == quote:
                quote = None
            j += 1
        elif ch in ("'", '"'):
            quote, j = ch, j + 1
        elif ch in "([{":
            depth, j = depth + 1, j + 1
        elif ch in ")]}":
            depth, j = max(0, depth - 1), j + 1
        elif ch == ";" and depth == 0:
            return j
        else:
            j += 1
    return j


def _is_call_open(text, at, name):
    # True when this `open` keyword is a builtin call: not a
    # sub definition, hash key/subscript, sigil, label, or
    # package qualifier (method ->open stays in: conservative).
    before = text[:at]
    if re.search(r"(?:sub|use|no)\s+$", before):
        return False
    if before[-1:] in ("{", "$", "@", "%", ":"):
        return False
    after = text[at + len(name):]
    rest = after[re.match(r"\s*", after).end():]
    if rest.startswith(("=>", ":", "::")):
        return False
    return True


def _mode_danger(args):
    # 2nd-arg mode: piped, write/append, or unresolvable
    # (unquoted/variable). Reads ('<', '-') stay allowed:
    # ranges output is shape-constrained downstream, so reads
    # cannot exfiltrate. Under-2 args cannot name a safe mode.
    if len(args) < 2:
        return True
    mode = args[1].strip()
    if len(mode) >= 2 and mode[0] == mode[-1] \
            and mode[0] in ("'", '"'):
        body = mode[1:-1]
        return "|" in body or body[:1] in (">", "+")
    return True


_SAFE_SYSOPEN = {"O_RDONLY", "O_NONBLOCK", "O_NOCTTY", "O_NOFOLLOW",
                 "O_CLOEXEC", "O_NOATIME", "O_DIRECT", "O_SYNC",
                 "O_DSYNC", "O_RSYNC", "O_LARGEFILE", "0"}


def _sysopen_danger(args):
    # Flags arg must be read-only (+ safe adjuncts): anything
    # else (or unparseable) can write.
    if len(args) < 3:
        return True
    for piece in args[2].split("|"):
        if piece.strip() not in _SAFE_SYSOPEN:
            return True
    return False


def _open_danger(segment):
    # open()/sysopen(), paren and paren-free forms: piped and
    # write modes drift, as do unresolvable modes and 1-arg
    # opens (the scalar of that name may hold "|cmd").
    i = 0
    while True:
        m = re.search(r"\b(open|sysopen)\b", segment[i:])
        if not m:
            return False
        name, at = m.group(1), i + m.start()
        if not _is_call_open(segment, at, name):
            i = at + len(name)
            continue
        after = segment[at + len(name):]
        paren = re.match(r"\s*\(", after)
        if paren:
            start = at + len(name) + paren.end()
            j = _paren_end(segment, start)
            args = _split_args(segment[start:j])
            i = j + 1 if j < len(segment) else len(segment)
        else:
            j = _stmt_end(segment, at + len(name))
            args = _split_args(segment[at + len(name):j])
            i = at + len(name)
        if name == "sysopen":
            if _sysopen_danger(args):
                return True
        elif _mode_danger(args):
            return True


def _double_eval(text):
    # s-op with two e flags (s/.../.../ee): the replacement RESULT
    # (attacker-influenced match data) is evaluated as code. Single
    # /e is fixed author code (human-visible in the diff).
    pairs = {"{": "}", "[": "]", "(": ")", "<": ">"}
    for m in re.finditer(
            r"(?<![\w$:])s(?![\w:])\s*(\S)", text):
        dlm = m.group(1)
        if dlm.isalnum() or dlm in (" ", "\t", "\n", ";"):
            continue
        i = m.end()
        sections = []
        ok = True
        for _ in range(2):
            buf = ""
            if dlm in pairs:
                depth = 1
                while i < len(text) and depth:
                    ch = text[i]
                    if ch == "\\" and i + 1 < len(text):
                        buf += text[i:i + 2]
                        i += 2
                    elif ch == dlm:
                        depth += 1
                        buf += ch
                        i += 1
                    elif ch == pairs[dlm]:
                        depth -= 1
                        if depth:
                            buf += ch
                        i += 1
                    else:
                        buf += ch
                        i += 1
                if depth:
                    ok = False
                    break
                sections.append(buf)
                while i < len(text) and text[i] in (" ", "\t"):
                    i += 1
                if not sections or len(sections) == 1:
                    if i < len(text) and text[i] == dlm:
                        i += 1
                    else:
                        ok = False
                        break
            else:
                while i < len(text) and text[i] != dlm:
                    if text[i] == "\\" and i + 1 < len(text):
                        buf += text[i:i + 2]
                        i += 2
                    else:
                        buf += text[i]
                        i += 1
                if i >= len(text):
                    ok = False
                    break
                i += 1
                sections.append(buf)
        if not ok:
            continue
        flags = re.match(r"[a-z]*", text[i:]).group(0)
        if flags.count("e") >= 2:
            return True
    return False


def audit_perl_content(text, drift):
    # Fixed-code backstop for token-adjacent perl: BEGIN/END blocks,
    # process spawning, string eval, dynamic loading, piped/write
    # opens, regex code (?{}), double-eval substitution, and
    # trailing __DATA__/__END__ sections all drift. `use` of plain
    # modules stays allowed (@INC is system + poison-guarded -I).
    if "helper-perl-danger" in drift:
        return
    danger = re.compile(
        r"(?<!\$)\b(BEGIN|END)\s*\{"
        r"|(?<!\$)\b(system|exec|eval|readpipe)\b"
        r"|`"
        r"|(?<!\$)\bqx(?![\w])"
        r"|\(\?\??\{"
        r"|\buse\s+lib\b|\bno\s+lib\b")
    if danger.search(text):
        drift.append("helper-perl-danger")
        return
    if re.search(
            r"(?<!\$)\brequire\b(?!\s+v?[\d][\d._]*\s*"
            r"(?:[;}]|$))", text):
        drift.append("helper-perl-danger")
        return
    if re.search(r"(?<!\$)\bdo\b(?!\s*\{)\s*\S", text):
        drift.append("helper-perl-danger")
        return
    if re.search(r"^__(DATA|END)__", text, re.M):
        drift.append("helper-perl-danger")
        return
    if _open_danger(text) or _double_eval(text):
        drift.append("helper-perl-danger")
