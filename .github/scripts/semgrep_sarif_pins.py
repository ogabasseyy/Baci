"""Pinned trust anchors for the SARIF drift audit.

Every value here is a reviewed constant: changing one means the
audited artifact changed and a human must re-approve. The audit
fails closed on any mismatch.

Also home to the helper path predicates: they decide purely
from the pins above, so the trust anchors and their tests
stay in one reviewable place.
"""
import posixpath
import re

AUDITED_RULE_ID = (
    "yaml.github-actions.security.pull-request-target-code-checkout"
    ".pull-request-target-code-checkout"
)
AUDITED_PATH = ".github/workflows/muse-code-review.yml"
PINNED_CHECKOUT_USES = (
    "actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0"
)
MUSE_PINNED_VERSION = "1.4.1-R4503.1"
MUSE_PINNED_HOST = "https://lookaside.facebook.com/"
MUSE_PINNED_SHA_X86 = (
    "8b53c9cdbc025bc2d9068bc7016e2c1e51c3a0c608821da1"
    "7528ad23be900a12"
)
MUSE_PINNED_SHA_AARCH64 = (
    "a6d46239975adac282aa829d2a5bd1cd3119334c18ecfa7"
    "76d4377daebddb595"
)


WS_MARKER = "GITHUB_WORKSPACE"
TRUSTED_MARKER = "trusted-scripts"
SCRIPT_PIN = r"^\$\{?SCRIPT_DIR\}?/"
RUNNER_PIN = r"^\$\{?RUNNER_TEMP\}?/"
HOME_PIN = r"^\$(?:\{HOME\}|HOME)(?:/|$)"


def _ws_rooted(token):
    return WS_MARKER in token and TRUSTED_MARKER not in token


def _contained_exec_path(path, root_re):
    # True when a root-anchored operand stays beneath its root
    # after lexical normalization: normpath first (a .. that
    # eats the root fails the re-match), then re-match. The
    # remainder must hold no $/backtick/backslash (an unresolved
    # var or escape can smuggle .. past the split). An empty
    # remainder (the bare root) passes: it cannot escape.
    m = re.match(root_re, path)
    if not m:
        return False
    if any(ch in path[m.end():] for ch in ("$", "`", "\\")):
        return False
    if not path[m.end():]:
        return True
    return re.match(root_re, posixpath.normpath(path)) \
        is not None


def _safe_exec_path(path):
    # Allow iff the target cannot be attacker-planted: the
    # trusted tree, install-audited $HOME, and absolute system
    # paths (helpers never run as root, so those are unowned).
    # Relative paths resolve under the PR-head checkout;
    # temp dirs and the runner temp dir hold job data. Every
    # branch normalizes before matching, so .. spellings
    # (${SCRIPT_DIR}/../../evil, /usr/../home/evil) cannot
    # escape their root into an allowed prefix.
    if re.match(SCRIPT_PIN, path):
        return _contained_exec_path(path, SCRIPT_PIN)
    if re.match(HOME_PIN, path):
        return _contained_exec_path(path, HOME_PIN)
    if path == "~":
        return True
    if path.startswith("~/"):
        return _contained_exec_path(path, r"^~/")
    if path.startswith("~"):
        return False
    if path == "/home/runner":
        return True
    if path.startswith("/home/runner/"):
        # The PR-controlled checkout (and the runner temp dir
        # beneath it) lives under /home/runner/work: executables
        # there are attacker-planted. Normalize first so ..
        # spellings cannot dodge the exclusion.
        norm = posixpath.normpath(path)
        if norm == "/home/runner/work" \
                or norm.startswith("/home/runner/work/"):
            return False
        return _contained_exec_path(path, r"^/home/runner/")
    if path.startswith("/"):
        norm = posixpath.normpath(path)
        # No /opt: /opt/hostedtoolcache is runner-writable
        # (chmod 777 at image build), so bytes staged there
        # execute with the helper token.
        if re.match(r"^/(usr|bin|sbin|etc)/", norm) \
                or re.match(r"^/lib[^/]*/", norm) \
                or norm == "/":
            return not any(ch in path for ch in ("$", "`", "\\"))
        return False
    return False


def _is_home_write(target):
    return re.match(HOME_PIN, target) is not None \
        or target == "~" or target.startswith("~/") \
        or target == "/home/runner" \
        or target.startswith("/home/runner/")


def script_operand(rest, base=""):
    # Validate an interpreter's script operand. Returns True
    # when bound (or provably non-executing), False on drift.
    # Options parse left to right (verified on bash 3.2/5.x):
    # a query flag (--version/--help/-n) exits before later
    # tokens, but -c executes before a later --help, and a
    # flag after the script operand is just $1 -- so query
    # flags count only in the leading option prefix. source/.
    # take no options at all (their first operand is the
    # file), so query spellings never excuse them.
    query = {"--version", "--help", "-n", "--noexec"}
    redir = re.compile(r"^\d*(>>|>|<<|<<<|<|>&|<&)")
    i = 0
    while i < len(rest):
        tok = rest[i]
        m = redir.match(tok)
        if m:
            i += 1 if len(tok) > m.end() else 2
        elif tok == "--":
            i += 1
            break
        elif tok in query and base not in ("source", "."):
            return True
        elif tok == "-" or tok in ("-c", "--command",
                                   "--init-file", "--rcfile"):
            return False
        elif re.fullmatch(r"[+-][a-zA-Z]+", tok):
            if "c" in tok:
                return False
            if "s" in tok:
                return False
            if tok in ("-o", "+o") \
                    or re.fullmatch(r"[+-][a-zA-Z]*o", tok):
                i += 2
            else:
                i += 1
        elif tok.startswith("--"):
            i += 1
        else:
            break
    if i >= len(rest):
        return False
    op = rest[i]
    if re.match(r"^\$\{?SCRIPT_DIR\}?/", op):
        return _contained_exec_path(
            op, r"^\$\{?SCRIPT_DIR\}?/")
    # Concatenated so the raw text never holds an expression
    # opener, which actionlint would parse as this job's
    # expression (steps.scriptdir is undefined here).
    squashed = re.sub(r"\s+", "", op)
    anchor = "${{steps.scriptdir.outputs.dir}}"
    if squashed == anchor:
        return True
    if squashed.startswith(anchor + "/"):
        return _contained_exec_path(
            squashed, r"^\$\{\{steps\.scriptdir\.outputs\.dir\}\}/")
    return False
