"""Write-destination zoning: trusted tree, workspace staging,
unzoneable globs, /proc alias collapse, and environ reads.
"""
import posixpath
import re


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


_GLOB_RE = re.compile(r"[*?\[]|[@+!]\(")


def _write_zone(target):
    # Where a helper write lands: "trusted" (script tree, the
    # installed muse binary, or its ancestor dirs -- a link
    # swap there redirects the absolute-path invocation),
    # "workspace" (the agent-readable checkout: token staging),
    # "glob" (a metacharacter destination matching neither
    # zone: bash expands trusted-* onto the trusted checkout,
    # so unzoneable globs fail closed), or None. Collapsed
    # (/proc/<pid>/root aliases) and normalized first so ..
    # and alias spellings cannot hide a protected destination
    # (over-approximating outward escapes is fail-closed).
    # Quoted globs ('b[*]') are literal to bash but read as
    # globbed here (operands arrive dequoted): over-approx.
    t = _collapse_proc_root(target)
    if "trusted-scripts" in t or re.search(
            r"\$(\{)?SCRIPT_DIR\}?", t) is not None:
        return "trusted"
    if re.match(MUSE_BIN_RE, t) or re.match(MUSE_DIR_RE, t):
        return "trusted"
    if re.match(WS_RE, t):
        return "workspace"
    if _GLOB_RE.search(t):
        return "glob"
    return None
