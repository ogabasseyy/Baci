"""Review-runner guards: the muse invocation in run.sh (single
call, argv-scoped containment flags, token scrubbing) and the
install.sh invariants (exact version/checksums, verify-before-
install order, pinned versioned URL, no pipe-to-shell).
"""
import re
from semgrep_sarif_helpers import (CARRY_VARS, _collect_vars,
                                   _resolve)
from semgrep_sarif_install import audit_install_binding
from semgrep_sarif_pins import (MUSE_PINNED_HOST,
                                MUSE_PINNED_SHA_AARCH64,
                                MUSE_PINNED_SHA_X86,
                                MUSE_PINNED_VERSION)
from semgrep_sarif_scan import extract_subshells
from semgrep_sarif_shell import (logical_lines, peel_prefix,
                                 split_commands2,
                                 strip_comments)


def _shell_words(text):
    # Shell words: whitespace splits outside quotes, quotes group
    # (glued quotes stay one word: "a/"b is a/b, not two tokens).
    words, buf, quote = [], "", None
    i = 0
    while i < len(text):
        ch = text[i]
        if quote == "'":
            buf += ch
            if ch == "'":
                quote = None
            i += 1
        elif quote == '"' and ch == "\\" and i + 1 < len(text):
            buf += text[i:i + 2]
            i += 2
        elif quote == '"' and ch == '"':
            buf, quote, i = buf + ch, None, i + 1
        elif quote:
            buf, i = buf + ch, i + 1
        elif ch in ("'", '"'):
            quote, buf, i = ch, buf + ch, i + 1
        elif ch in (" ", "\t", "\n"):
            if buf:
                words.append(buf)
                buf = ""
            i += 1
        elif ch == "\\" and i + 1 < len(text):
            buf += text[i:i + 2]
            i += 2
        else:
            buf, i = buf + ch, i + 1
    if buf:
        words.append(buf)
    return words


def _dequote(word):
    # Remove quote characters (backslash-aware): glued forms
    # collapse to the executed spelling ("a/"b -> a/b).
    out, quote, i = "", None, 0
    while i < len(word):
        ch = word[i]
        if quote == "'":
            if ch == "'":
                quote = None
            else:
                out += ch
            i += 1
        elif ch == "\\" and quote != "'" and i + 1 < len(word):
            out += word[i + 1]
            i += 2
        elif quote == '"' and ch == '"':
            quote, i = None, i + 1
        elif not quote and ch in ("'", '"'):
            quote, i = ch, i + 1
        else:
            out, i = out + ch, i + 1
    return out


def _peel_env(words):
    # See through env -u/-i/VAR= prefixes to the real argv0 (the
    # runner scrubs tokens via env -u, so muse sits behind env).
    assign = re.compile(
        r"^([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]*\])?(\+)?=")
    i = 0
    while i < len(words):
        word = _dequote(words[i])
        m = assign.match(word)
        if m:
            # Subscript/+= assigns are pure (never prefix a
            # command, so nothing follows); plain VAR= may.
            if m.group(2) or m.group(3):
                return []
            i += 1
        elif word != "env":
            break
        else:
            i += 1
            while i < len(words):
                tok = _dequote(words[i])
                if tok == "--":
                    i += 1
                    break
                if tok in ("-u", "-C", "--unset", "--chdir",
                           "--argv0"):
                    i += 2
                elif tok in ("-i", "-0", "--null", "-v",
                             "--ignore-environment"):
                    i += 1
                elif re.fullmatch(r"-[a-zA-Z0-9]+", tok):
                    i += 2 if tok[-1] in "uC" else 1
                elif tok.startswith("--") and "=" in tok:
                    i += 1
                elif re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*=.*",
                                  tok):
                    i += 1
                else:
                    break
    return words[i:]

def audit_agent_runner(drift):

    # The data-only premise rests on the agent invocation itself:
    # every muse call in the trusted runner must carry the exact
    # execution-disabling flags (comment mentions do not count) and
    # must shed the GitHub token. Backslash continuations joined.
    runner_path = ".github/scripts/muse-review/run.sh"
    try:
        with open(runner_path) as fh:
            runner_raw = fh.read().splitlines()
    except OSError:
        runner_raw = []
    if not runner_raw:
        drift.append("agent-runner-missing")
    else:
        logical = logical_lines(runner_raw)
        # Resolve top-level literal variables first: a constructed
        # path (MUSE_BIN=...muse; "${MUSE_BIN}" exec ...) must count
        # as an invocation, not slip past the literal match.
        varmap = _collect_vars(runner_raw)
        expanded = [_resolve(line, varmap) for line in logical]
        # Command-position words (quote-glued, env-peeled): prose
        # mentions (echo "muse ...") and identifiers (muse_rc) sit
        # off command position and never count; subshell bodies
        # recurse since $(muse ...) executes too.
        roots = "|".join(
            r"\$\{%s\}|\$%s(?![A-Za-z0-9_])" % (v, v)
            for v in CARRY_VARS)

        def calls_in(text):
            found = []
            cleaned, inners = extract_subshells(text)
            for inner in inners:
                found.extend(calls_in(inner))
            for piece, _, _ in split_commands2(cleaned):
                words = _peel_env(_shell_words(piece))
                argv0, rest = peel_prefix(words)
                if not argv0:
                    continue
                cmd = _dequote(argv0)
                if cmd == "muse" or cmd.endswith("/muse"):
                    found.append((piece, rest))
            return found

        calls = []
        for line in expanded:
            calls.extend(calls_in(line))
        # Whatever still expands at command position is unresolvable
        # statically (conditional assigns, read, $()): fail closed.
        for line in expanded:
            cleaned, _ = extract_subshells(line)
            for piece, _, _ in split_commands2(cleaned):
                words = _peel_env(_shell_words(piece))
                argv0, _ = peel_prefix(words)
                if not argv0:
                    continue
                bare = re.sub(roots, "", _dequote(argv0))
                if "$" in bare or "`" in bare:
                    if "agent-indirect-unresolved" not in drift:
                        drift.append("agent-indirect-unresolved")
        if not calls:
            drift.append("agent-invocation-missing")
        elif len(calls) != 1:
            drift.append(f"agent-invocation-count={len(calls)}")
        else:
            # Scope checks to the simple command containing muse
            # (split_commands2 already bounded it: flags on a later
            # chained command cannot satisfy them). Disable flags are
            # muse's own argv; -u may precede it (env prefix) so it is
            # read from the whole scoped command.
            piece, rest = calls[0]
            argv = " ".join(_dequote(w) for w in rest)
            if not re.search(r"(?:^|\s)--disable-shell(?:\s|$)", argv):
                drift.append("agent-shell-boundary")
            elif not re.search(r"(?:^|\s)--disable-write(?:\s|$)", argv):
                drift.append("agent-write-boundary")
            elif "-u GITHUB_TOKEN" not in piece \
                    or "-u GH_TOKEN" not in piece:
                drift.append("agent-token-isolation")


def audit_installer(drift):
    # install.sh determines the executable that receives META_API_KEY:
    # pin its version and checksum shape, require verification before
    # install, forbid pipe-to-shell, and tie the artifact URL to the
    # pinned version on the pinned host.
    installer_path = ".github/scripts/muse-review/install.sh"
    try:
        with open(installer_path) as fh:
            installer_raw = fh.read().splitlines()
    except OSError:
        installer_raw = []
    if not installer_raw:
        drift.append("muse-installer-missing")
    else:
        installer = [strip_comments(line) for line in installer_raw]
        version = [line.strip()[len("MUSE_VERSION="):]
                   for line in installer
                   if re.match(r"^MUSE_VERSION=", line.strip())]
        if not version or not all(
                v.strip("\"'") == MUSE_PINNED_VERSION
                for v in version):
            drift.append("muse-installer-version")
        # Exact values, not just 64-hex shape: a re-pointed
        # download with freshly computed hashes must fail here.
        pinned_sha = {"SHA_X86_LINUX": MUSE_PINNED_SHA_X86,
                      "SHA_AARCH64_LINUX": MUSE_PINNED_SHA_AARCH64}
        for var, want in pinned_sha.items():
            vals = [line.strip()[len(var) + 1:]
                    for line in installer
                    if re.match(r"^" + var + r"=", line.strip())]
            if not vals or not all(
                    v.strip().strip("\"'") == want
                    for v in vals):
                drift.append("muse-installer-checksum")
                break
        def first_cmd(stripped_line):
            rest = stripped_line.strip()
            while True:
                m = re.match(r"[A-Za-z_][A-Za-z0-9_]*=\S+\s*",
                             rest)
                if not m:
                    break
                rest = rest[m.end():]
            m = re.match(r"\S+", rest)
            return m.group(0) if m else ""
        verify_at = [i for i, line in enumerate(installer)
                     if re.search(r"(?:^|[\s;&|()$`'\"])"
                                  r"sha256sum(?:\s|$)", line)
                     and first_cmd(line) not in ("echo", "printf")]
        cmp_at = [i for i, line in enumerate(installer)
                  if "got_sha" in line and "want_sha" in line
                  and "!=" in line
                  and first_cmd(line) not in ("echo", "printf")]
        install_at = audit_install_binding(installer, first_cmd,
                                           drift)
        if not verify_at:
            drift.append("muse-installer-no-verify")
        if not cmp_at:
            drift.append("muse-installer-no-compare")
        if install_at and verify_at and cmp_at \
                and min(install_at) < max(verify_at + cmp_at):
            drift.append("muse-installer-unverified-install")
        if any(re.search(r"\|\s*(?:sudo\s+)?(?:bash|sh)\b", line)
               for line in installer):
            drift.append("muse-installer-pipe")
        # Every URL literal in the installer must be the pinned
        # versioned download: a substring check would pass an evil
        # host alongside a retained unused lookaside string.
        # Residual: URLs assembled from variables.
        for line in installer:
            for url in re.findall(r"https?://[^\s\"'`]+", line):
                if not url.startswith(MUSE_PINNED_HOST) \
                        or "version=${MUSE_VERSION}" not in url:
                    drift.append("muse-installer-url")
                    break
            else:
                continue
            break
