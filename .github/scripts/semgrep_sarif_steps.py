"""Per-step command guards: secret/loose argv0 allowlists with git
confinement, PATH-family hijack rejection, and the no-token-
expression rule for the agent step and job environment.
"""
import re
from semgrep_sarif_redirect import (has_socket_redirect,
                                    redirect_targets)
from semgrep_sarif_scan import is_trusted_write_target
from semgrep_sarif_segments import run_segments
from semgrep_sarif_consts import (ENV_POISON, RUNTIME_TOKEN_VARS,
                                  SECRET_BINDINGS, SHELL_KEYWORDS,
                                  STRICT_ALLOW)
from semgrep_sarif_peel import peel_prefix
from semgrep_sarif_shell import (_bare_word, map_key_value,
                                 split_commands2, strip_comments,
                                 tokenize, unquote_value)

def _steps_item_indent(lines):
    # Indent of `- ` items under the first block-style steps:
    # key (quoted spellings included). None when no block
    # sequence exists: callers fall back to any-indent so step
    # enumeration cannot silently empty itself.
    for line in lines:
        m = re.match(r"^(\s*)(?:\"steps\"|'steps'|steps):"
                     r"\s*(?:#.*)?$", line)
        if m:
            return len(m.group(1)) + 2
    return None

def is_step_boundary(line, item_indent=None):
    # Named (- name:) and unnamed (- uses:/- run:/...) steps both
    # delimit spans, so an unnamed step cannot widen a span.
    # Quoted keys (- "name":) delimit too: a bare-key match would
    # merge an attacker step into the previous span. The dash
    # must sit at the steps-item indent: block-scalar content
    # (run: | bodies, heredocs) is always deeper, so a `- name:`
    # there is prose, not a step -- while a dash at exactly the
    # item indent dedents out of any scalar and YAML parses it
    # as a real (audited) step either way.
    m = re.match(r"^(\s*)-\s+(.*)$", line)
    if not m:
        return False
    if item_indent is not None \
            and len(m.group(1)) != item_indent:
        return False
    key, _ = map_key_value(m.group(2).strip())
    return key is not None

def step_start(lines, ref_index):
    indent = _steps_item_indent(lines)
    for i in range(ref_index, -1, -1):
        if is_step_boundary(lines[i], indent):
            return i
    return 0

def step_end(lines, start_index):
    indent = _steps_item_indent(lines)
    for i in range(start_index + 1, len(lines)):
        if is_step_boundary(lines[i], indent):
            return i
    return len(lines)

def _var_ref(text, name):
    # True when shell text references $NAME (plain or braced):
    # the boundary guards reject $NAMESAKE and ${NAMESAKE}.
    return re.search(r"\$" + name + r"(?![A-Za-z0-9_])",
                     text) is not None \
        or re.search(r"\$\{" + name + r"(?=[}:?#%/+\-=])",
                     text) is not None


def step_name(line):
    # Name of a - name: step (quoted spellings included); "" when
    # the line is not a named-step header.
    dash = re.match(r"^-\s+(.*)$", line.strip())
    if not dash:
        return ""
    key, val = map_key_value(dash.group(1).strip())
    return unquote_value(val) if key == "name" else ""


def audit_step_commands(ctx, drift):

    # (d) Per-step command allowlists. Secret-bearing steps
    # (derived: any secrets. reference in the span, so an aliased
    # token auto-escalates its step) plus the integrity-critical
    # installer step take STRICT_ALLOW; remaining steps take that
    # plus git/rm (the collision step's tools). Every step
    # inherits runner runtime tokens, so even secretless steps
    # cannot run exfil-capable commands. Unknown interpreters,
    # direct executables, eval/traps/aliases, and sudo in any
    # step all drift, as does any redirect into the trusted
    # tree (a resolver git cat-file piped there would rewrite
    # trusted scripts at runtime). PATH-family assignment would
    # hijack later argv0 resolution within the step, so it
    # drifts in secret steps too. Residual: rm operands
    # (runner-local DoS only; no secrets or consumed outputs in
    # rm-bearing steps).
    secret_ref = re.compile(
        r"secrets\s*\.\s*[A-Za-z_]\w*|secrets\s*\["
        r"|github\s*\.\s*token\b"
        r"|github\s*\[\s*['\"]token['\"]\s*\]"
        r"|github\s*\[(?!\s*['\"])",
        re.IGNORECASE)
    LOOSE_ALLOW = STRICT_ALLOW | {"git", "rm"}
    GIT_SAFE_FLAGS = {"--no-pager", "-v", "--version", "-h",
                      "--help"}
    GIT_DANGER_FLAGS = {"-c", "--config", "--config-env",
                        "--exec-path", "-p", "--paginate",
                        "--git-dir", "--work-tree"}
    GIT_READ_SUBCOMMANDS = {"cat-file", "help", "version"}
    # (e) Secret bindings are allowlisted over the whole file
    # (job-level env precedes the first step boundary, so a
    # per-span scan would miss it): any other NAME bound to an
    # exact ${{ secrets.KEY }} value drifts, since a fresh LEAK
    # binding plus an allowed echo would print the key in
    # fragments redaction cannot match. Comparisons (HAS_KEY)
    # are not bindings: they evaluate to booleans.
    bound = {}
    for line in ctx.workflow_lines:
        key, val = map_key_value(line.strip())
        if not key \
                or re.fullmatch(r"[A-Za-z_]\w*", key) is None:
            continue
        text = re.sub(r"\s+#.*$", "",
                      unquote_value(val or "")).strip()
        m = re.fullmatch(r"\$\{\{\s*secrets\.([A-Za-z_]\w*)"
                         r"\s*\}\}", text)
        if not m:
            continue
        bound.setdefault(key, m.group(1))
        if (key, m.group(1)) not in SECRET_BINDINGS \
                and "secret-step-unexpected-binding" not in drift:
            drift.append("secret-step-unexpected-binding")
    # Poison names tolerate shell escapes (export P\ATH= unescapes
    # its operand -- verified); the = stays literal (a\=1 is dead).
    poison_alt = "(?:" + "|".join(
        "\\\\?" + "\\\\?".join(v) for v in ENV_POISON) + ")"
    assign_prefix = (r"(?:^|[;&|])\s*(?:[A-Za-z_][A-Za-z0-9_]*"
                     r"=\S+\s+)*")
    builtin_prefix = (r"(?:(?:export|local|readonly|declare|"
                      r"typeset)\s+(?:-\S+\s+)*)?"
                      r"(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*")
    indent = _steps_item_indent(ctx.workflow_lines)
    bounds = [i for i, line in enumerate(ctx.workflow_lines)
              if is_step_boundary(line, indent)] \
        + [len(ctx.workflow_lines)]
    for k in range(len(bounds) - 1):
        span = ctx.workflow_lines[bounds[k]:bounds[k + 1]]
        name = step_name(span[0])
        strict = name == "Install Muse Code" or any(
            secret_ref.search(line) for line in span)
        allowed = STRICT_ALLOW if strict else LOOSE_ALLOW
        for line in span:
            # Alias-valued run fields (run: *payload): GitHub
            # resolves the anchor before executing, while the
            # argv0 rules below skip *-leading words as globs. Fail
            # closed on the alias itself (optional &anchor/!!tag
            # prefixes included); quoted '*x' is a literal string
            # and block-scalar bodies cannot be alias nodes, so
            # only a same-line bare alias matches.
            if re.match(r"""\s*(?:-\s+)?(?:"run"|'run'|run)\s*:"""
                         r"""\s*(?:(?:&\S+|!!\S+)\s+)*"""
                         r"""\*[A-Za-z0-9_-]+\s*(?:#.*)?$""",
                         line) \
                    and "secret-step-untrusted-command" not in drift:
                drift.append("secret-step-untrusted-command")
            # Flow-style steps (- {run: ...}) never match the
            # block-style boundary parser, so their run bodies
            # audit nowhere: fail closed. Same indent discipline
            # as is_step_boundary (a dash there dedents any
            # scalar, so it is a real step either way); with no
            # block steps key, any indent fails closed.
            dm = re.match(r"^(\s*)-\s*\{", line)
            if dm and (indent is None or len(dm.group(1)) == indent) \
                    and "secret-step-untrusted-command" not in drift:
                drift.append("secret-step-untrusted-command")
        for seg in run_segments(span):
            if has_socket_redirect(seg) \
                    and "secret-step-untrusted-command" not in drift:
                drift.append("secret-step-untrusted-command")
            for tgt in redirect_targets(seg):
                if is_trusted_write_target(tgt) \
                        and "step-trusted-write" not in drift:
                    drift.append("step-trusted-write")
            code = re.sub(r"'[^']*'", "''", seg)
            plain = strip_comments(code)
            if secret_ref.search(plain) \
                    and "secret-step-inline-secret" not in drift:
                drift.append("secret-step-inline-secret")
            if re.search(r"(?:^|[;&|]|\(|\{)\s*(?:echo|printf)"
                         r"(?![A-Za-z0-9_])", plain) \
                    and any(_var_ref(plain, n)
                            for n in list(bound)
                            + sorted(RUNTIME_TOKEN_VARS)) \
                    and "secret-step-exfil" not in drift:
                drift.append("secret-step-exfil")
            if strict and re.search(
                    assign_prefix + builtin_prefix
                    + poison_alt + r"\s*=", code) \
                    and "secret-step-path-hijack" not in drift:
                drift.append("secret-step-path-hijack")
            if re.search(
                    assign_prefix + r"(?:sudo|doas)\b", code) \
                    and "secret-step-untrusted-command" not in drift:
                drift.append("secret-step-untrusted-command")
            masked = re.sub(r"\[\[.*?\]\]", "[[ ]]", code)
            masked = re.sub(r"\(\(.*?\)\)", "(())", masked)
            # The git -C check below compares this variable's value,
            # so it survives masking (anything else would accept
            # `-C "${EVIL}"` via the masked placeholder).
            masked = re.sub(
                r"\$\{[^{}]*\}",
                lambda m: m.group(0)
                if m.group(0) == "${GITHUB_WORKSPACE}" else "${}",
                masked)
            masked = re.sub(
                r"[A-Za-z_][A-Za-z0-9_]*\(\)\s*\{?", "", masked)
            for piece, after_open, at_close in \
                    split_commands2(masked):
                if at_close and not after_open:
                    continue
                words = [_bare_word(t) for t in tokenize(piece)]
                if not words:
                    continue
                argv0, rest = peel_prefix(words)
                if not argv0 or argv0 in SHELL_KEYWORDS \
                        or argv0 in ("for", "select", "case"):
                    continue
                if re.match(r"^[\*\?\[]", argv0) \
                        or re.match(r"^\d*[<>]", argv0):
                    continue
                if argv0 not in allowed \
                        and "secret-step-untrusted-command" \
                        not in drift:
                    drift.append("secret-step-untrusted-command")
                # (f) Bare env builtins dump every variable --
                # bound secrets and the runner's injected tokens
                # included -- to the log, as does -p. Flagged
                # spellings (set -euo) pass; set -o/+o only
                # lists option states, never variables.
                if argv0 in ("set", "export", "declare",
                             "typeset", "readonly", "local") \
                        and (not rest or "-p" in rest) \
                        and not (argv0 == "set" and rest
                                and rest[0] in ("-o", "+o")) \
                        and "secret-step-env-dump" not in drift:
                    drift.append("secret-step-env-dump")
                if argv0 == "git":
                    # git reads only, from the workspace: no config
                    # injection, no pager exec, no path redirect,
                    # no fetch/write subcommands, and no
                    # filter/textconv execution via subcommand args.
                    i = 0
                    sub = None
                    bad_git = False
                    while i < len(rest):
                        tok = rest[i]
                        if tok in GIT_DANGER_FLAGS:
                            bad_git = True
                            break
                        if tok in GIT_SAFE_FLAGS:
                            i += 1
                        elif tok == "-C":
                            nxt = rest[i + 1] if i + 1 < len(rest) \
                                else ""
                            nxt = nxt.rstrip("/")
                            if nxt != "${GITHUB_WORKSPACE}" \
                                    and not nxt.startswith(
                                        "${GITHUB_WORKSPACE}/"
                                        "trusted-scripts"):
                                bad_git = True
                                break
                            i += 2
                        elif tok.startswith("-"):
                            bad_git = True
                            break
                        else:
                            sub = tok
                            i += 1
                            break
                    if not bad_git and sub is not None:
                        if sub not in GIT_READ_SUBCOMMANDS:
                            bad_git = True
                        elif any(a in ("--filters", "--textconv")
                                 for a in rest[i:]):
                            bad_git = True
                    if bad_git and "secret-step-untrusted-command" \
                            not in drift:
                        drift.append("secret-step-untrusted-command")
