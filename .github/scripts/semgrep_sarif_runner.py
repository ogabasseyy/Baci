"""Review-runner guards: quote-glued shell-word helpers shared
with the agent audit, and the install.sh invariants (exact
version/checksums, verify-before-install order, pinned
versioned URL, no pipe-to-shell).
"""
import re
from semgrep_sarif_alias import (_nameref_edges, _rebind_names,
                                 audit_tmp_aliases)
from semgrep_sarif_install import (audit_compare_shape,
                                   audit_install_binding)
from semgrep_sarif_pins import (MUSE_PINNED_HOST,
                                MUSE_PINNED_SHA_AARCH64,
                                MUSE_PINNED_SHA_X86,
                                MUSE_PINNED_VERSION)
from semgrep_sarif_scan import arith_command_regions
from semgrep_sarif_shell import split_commands2, strip_comments
from semgrep_sarif_words import (_dequote, _peel_env,
                                 _shell_words)


_OPERANDS = ("got_sha", "want_sha")
_OPERAND_ASSIGN_RE = re.compile(
    r"(?:\+\+|--)\s*\b(?:got_sha|want_sha)\b"
    r"|\b(?:got_sha|want_sha)\b\s*"
    r"(?:\+\+|--|[-+*/%&|^]?=(?![=]))")
# Post/pre ++/-- and assign-ops (==/!=/<=/>= excluded: the
# = needs a non-= neighbor, so comparisons never match).
_MAPFILE_VALUED = set("dnOsuCc")


def _operand_hit(name):
    base = re.sub(r"\[.*\]$", "", name)
    return base in _OPERANDS


_REDIR_OP = re.compile(r"^\d*(>>|>&|>|<<<|<<|<>|<&|<)")


def _redir_stripped(toks):
    # Drop redirect ops (glued targets ride the op word;
    # bare ops consume the next word) so operand scans see
    # only real operands.
    out, i = [], 0
    while i < len(toks):
        m = _REDIR_OP.match(toks[i])
        if not m:
            out.append(toks[i])
            i += 1
        elif len(toks[i]) > m.end():
            i += 1
        else:
            i += 2
    return out


def _mapfile_target(piece):
    # Array name of a mapfile/readarray call (last operand
    # past flags), or None. Unknown flags consume a value
    # (fail closed: a miscounted target drifts below).
    toks = _redir_stripped([_dequote(w)
                            for w in _shell_words(piece)])
    i = 0
    while i < len(toks) and re.fullmatch(
            r"[A-Za-z_]\w*=\S*", toks[i]):
        i += 1
    i += 1  # argv0
    ops = []
    while i < len(toks):
        w = toks[i]
        if w == "--":
            ops.extend(toks[i + 1:])
            break
        if len(w) > 1 and w[0] == "-" and w[1] != "-":
            k = 1
            while k < len(w):
                if w[k] in _MAPFILE_VALUED:
                    if k + 1 == len(w):
                        i += 1
                    break
                k += 1
            i += 1
        else:
            ops.append(w)
            i += 1
    return ops[-1] if ops else None

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
        install_at = audit_install_binding(installer, first_cmd,
                                           drift)
        if not verify_at:
            drift.append("muse-installer-no-verify")
        cmp_at = audit_compare_shape(installer, drift)
        if install_at and verify_at and cmp_at \
                and min(install_at) < max(verify_at + cmp_at):
            drift.append("muse-installer-unverified-install")
        if install_at and verify_at \
                and "muse-installer-toctou" not in drift:
            # Post-verify immutability: the hash freezes tmp_bin
            # (the compare reads the stale got_sha, so the hash
            # line — not the compare — is the freeze point; a
            # later re-hash re-freezes). Keyed on the alias
            # closure (replacement="${tmp_bin}" writes through
            # the alias), not the bare name. Any write shape
            # past the freeze — or a rebind to an unverified
            # value — drifts. Reads drift too: fail closed.
            frozen = max(verify_at)
            aliases = audit_tmp_aliases(installer)
            key = r"(?:%s)\b" % "|".join(sorted(aliases))

            def ref(text):
                return re.search(key, text)
            hit = False
            for i in range(frozen + 1, len(installer)):
                line = installer[i]
                if not ref(line):
                    continue
                if i in install_at:
                    continue  # blessed install reads it
                for piece, _, _ in split_commands2(line):
                    if not ref(piece):
                        continue
                    m = re.match(
                        r"(?:export|declare|local|readonly|"
                        r"typeset)?\s*([A-Za-z_]\w*)=(.*)$",
                        piece.strip())
                    if m and m.group(1) in aliases \
                            and not any(re.search(
                                r"\$\{?" + n + r"\b", m.group(2))
                                for n in aliases):
                        hit = True  # post-verify rebind
                    fc = first_cmd(piece)
                    if re.search(r">\s*\S*" + key, piece):
                        hit = True
                    elif fc in ("cp", "mv", "ln", "install",
                                "tee", "patch", "ed", "truncate",
                                "shred"):
                        hit = True
                    elif fc == "curl" and re.search(
                            r"-o\s*\"?\$?\{?" + key, piece):
                        hit = True
                    elif fc == "dd" and re.search(
                            r"\bof=\S*" + key, piece):
                        hit = True
                    elif fc in ("sed", "perl", "awk") \
                            and "-i" in piece:
                        hit = True
                    if hit:
                        break
                if hit:
                    break
            if hit:
                drift.append("muse-installer-toctou")
        if install_at and verify_at \
                and "muse-installer-operand-rebind" not in drift:
            # Comparison-operand freeze: got_sha is bound by
            # the hash line and want_sha before it, so every
            # post-hash rebind of either (plain/declare
            # assign, read, printf -v, for/select, nameref
            # edge, let, (( )), mapfile/getopts target)
            # drifts: want_sha="${got_sha}" makes the pinned
            # compare tautological. Both names are pinned by
            # _is_compare_if, so the pair is exact.
            frozen = max(verify_at)
            hit = False
            for i in range(frozen + 1, len(installer)):
                line = installer[i]
                if any(_OPERAND_ASSIGN_RE.search(body)
                       for body in arith_command_regions(
                               line)):
                    # Line level: the piece splitter breaks
                    # (( )) on its parens before regions form.
                    hit = True
                    break
                for piece, _, _ in split_commands2(line):
                    text = piece.strip()
                    m = re.match(
                        r"(?:export|declare|local|readonly|"
                        r"typeset)?\s*([A-Za-z_]\w*)=(.*)$",
                        text)
                    if m and m.group(1) in _OPERANDS:
                        hit = True
                    if any(n in _OPERANDS
                           for n in _rebind_names(piece)):
                        hit = True
                    if any(t in _OPERANDS
                           for _, t in _nameref_edges(text)):
                        hit = True
                    fc = first_cmd(piece)
                    if fc == "let" and _OPERAND_ASSIGN_RE.search(
                            text):
                        hit = True
                    if fc in ("mapfile", "readarray") \
                            and _operand_hit(
                                _mapfile_target(piece) or ""):
                        hit = True
                    if fc == "getopts":
                        toks = _redir_stripped(
                            [_dequote(w)
                             for w in _shell_words(piece)])
                        k = 0
                        while k < len(toks) and re.fullmatch(
                                r"[A-Za-z_]\w*=\S*",
                                toks[k]):
                            k += 1
                        # toks[k] is argv0, toks[k+1] the
                        # optstring, toks[k+2] the name.
                        if len(toks) > k + 2 and _operand_hit(
                                toks[k + 2]):
                            hit = True
                    if hit:
                        break
                if hit:
                    break
            if hit:
                drift.append("muse-installer-operand-rebind")
        if any(re.search(r"\|\s*(?:sudo\s+)?(?:bash|sh)\b", line)
               for line in installer):
            drift.append("muse-installer-pipe")
        # File-descriptor aliases bypass the name-keyed freeze:
        # exec 3<>$tmp_bin pre-verify plus >/proc/self/fd/3 (or
        # >&3, {fd} names, >&$var dups) post-verify rewrites the
        # artifact with no tmp_bin reference. The installer uses
        # no nonstandard fds, so any explicit fd past 2, any
        # {name}/$var fd spelling, and any /proc/self/fd or
        # /dev/fd path drift (standard 0/1/2 redirections pass).
        fd_num = re.compile(r"(?:^|[^\w\d='\"])(\d+)\s*[<>]"
                                r"|[<>]&\s*-?(\d+)")
        fd_sym = re.compile(r"\{\w+\}\s*[<>]|[<>]&\s*[\${]")
        if any("/proc/self/fd" in line or "/dev/fd" in line
               or fd_sym.search(line)
               or any(g and int(g) > 2
                      for m in fd_num.finditer(line)
                      for g in m.groups())
               for line in installer) \
                and "muse-installer-toctou" not in drift:
            drift.append("muse-installer-toctou")
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
