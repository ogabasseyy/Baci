"""Review-runner guards: the muse invocation in run.sh (single
call, argv-scoped containment flags, token scrubbing) and the
install.sh invariants (exact version/checksums, verify-before-
install order, pinned versioned URL, no pipe-to-shell).
"""
import re
from semgrep_sarif_pins import (MUSE_PINNED_HOST,
                                MUSE_PINNED_SHA_AARCH64,
                                MUSE_PINNED_SHA_X86,
                                MUSE_PINNED_VERSION)
from semgrep_sarif_shell import strip_comments

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
        logical = []
        buf = ""
        for raw in runner_raw:
            code = strip_comments(raw).rstrip()
            if code.endswith("\\"):
                buf += code[:-1] + " "
            else:
                buf += code
                logical.append(buf)
                buf = ""
        if buf.strip():
            logical.append(buf)
        # Command-position match: quoted-path form (the real call) or a
        # bare muse following a command boundary/keyword. Prose
        # mentions (echo "muse ...") and identifiers (muse_rc,
        # muse-review) must not count as invocations.
        invocation = re.compile(
            r"/muse(?=[\"'\s]|$)|(?:^|[;&|()!`]|"
            r"\b(?:if|while|until|time|sudo|command|builtin|exec)\s+)"
            r"\s*muse(?=\s|$)")
        calls = [line for line in logical if invocation.search(line)]
        if not calls:
            drift.append("agent-invocation-missing")
        elif len(calls) != 1:
            drift.append(f"agent-invocation-count={len(calls)}")
        else:
            line = calls[0]
            # Scope checks to the simple command containing muse:
            # flags on a later chained command (muse ...; echo
            # --disable-shell) must not satisfy them. Bounds are
            # unquoted shell operators; redirects (>, <) stay
            # inside the command. Disable flags are muse's own
            # argv; -u may precede it (env prefix) so it is read
            # from the whole scoped command.
            ops = []
            quote = None
            for pos, ch in enumerate(line):
                if quote:
                    if ch == quote:
                        quote = None
                elif ch in ("'", '"'):
                    quote = ch
                elif ch in ";|&()`":
                    ops.append(pos)
            match = invocation.search(line)
            seg_start = max([p + 1 for p in ops
                             if p <= match.start()] + [0])
            seg_end = min([p for p in ops
                           if p >= match.end()] + [len(line)])
            segment = line[seg_start:seg_end]
            argv = line[match.end():seg_end]
            if not re.search(r"(?:^|\s)--disable-shell(?:\s|$)", argv):
                drift.append("agent-shell-boundary")
            elif not re.search(r"(?:^|\s)--disable-write(?:\s|$)", argv):
                drift.append("agent-write-boundary")
            elif ("-u GITHUB_TOKEN" not in segment
                  or "-u GH_TOKEN" not in segment):
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
        install_at = [i for i, line in enumerate(installer)
                      if first_cmd(line) == "install"
                      and "tmp_bin" in line]
        if not verify_at:
            drift.append("muse-installer-no-verify")
        if not cmp_at:
            drift.append("muse-installer-no-compare")
        if not install_at:
            drift.append("muse-installer-no-install")
        elif verify_at and cmp_at \
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
