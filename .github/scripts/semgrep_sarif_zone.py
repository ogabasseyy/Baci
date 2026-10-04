"""Write-destination zoning: trusted tree, workspace staging,
unzoneable globs, /proc alias collapse, and environ reads.
"""
import posixpath
import re
from semgrep_sarif_shell import _bare_word, tokenize


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
    # dot-dot, /root-aliased, or per-thread task/<tid>
    # spellings (the same process bytes either way). Step
    # secrets past exact-value masking, whatever the reader. Words
    # dequote first (quote removal joins /proc/self/en""viron
    # into the environ path); space-joined so separate words
    # cannot fuse into a phantom match.
    text = " ".join(_bare_word(w) for w in tokenize(text))
    for m in re.finditer(
            r"(?:^|[^/\w])(/proc/\S*?/environ(?![\w]))", text):
        collapsed = re.sub(r"^(/proc/[^/]+)/task/[^/.][^/]*",
                           r"\1",
                           _collapse_proc_root(m.group(1)))
        if re.fullmatch(r"/proc/[^/]+/environ", collapsed):
            return True
    return False


_GLOB_RE = re.compile(r"[*?\[]|[@+!]\(")


def _write_zone(target):
    # Where a helper write lands: "trusted" (script tree, the
    # installed muse binary, its ancestor dirs -- a link
    # swap there redirects the absolute-path invocation -- or
    # hosted tool-cache paths, runner-writable and executable),
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
    if re.match(r"^/opt/hostedtoolcache(?:/|$)", t):
        return "trusted"
    if re.match(WS_RE, t):
        return "workspace"
    if _GLOB_RE.search(t):
        return "glob"
    return None


def audit_cd(argv0, rest, drift):
    # cd/pushd/popd break the zoning CWD assumption (helpers
    # start in the workspace): later relative destinations
    # would land wherever the cd points while zoning assumes
    # the start dir. Rejected conservatively: only provable
    # temp dirs pass. Bare cd (HOME), -, ~, unknown expansions,
    # and popd/pushd rotations (unresolvable stack) all drift.
    # No legit helper changes directory (verified). Step run
    # blocks need no mirror: cd is outside their allowlist.
    if argv0 == "popd":
        if "helper-sensitive-cwd" not in drift:
            drift.append("helper-sensitive-cwd")
        return
    i = 0
    while i < len(rest) \
            and re.fullmatch(r"-[PLen]+", rest[i]):
        i += 1
    if i < len(rest) and rest[i] == "--":
        i += 1
    dest = rest[i] if i < len(rest) else ""
    if argv0 == "pushd" and re.fullmatch(r"[+-]\d+", dest):
        dest = ""
    if re.match(r"^\$(?:\{RUNNER_TEMP\}|RUNNER_TEMP)"
                r"(?:/|$)", dest):
        return
    if dest == "" or dest == "-" or dest.startswith("~") \
            or any(ch in dest for ch in ("$", "`", "\\")):
        hit = True
    else:
        norm = posixpath.normpath(dest)
        hit = not (norm == "/tmp"
                   or norm.startswith("/tmp/")
                   or norm == "/var/tmp"
                   or norm.startswith("/var/tmp/"))
    if hit and "helper-sensitive-cwd" not in drift:
        drift.append("helper-sensitive-cwd")
