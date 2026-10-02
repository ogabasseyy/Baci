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
        return _contained_exec_path(path, r"^/home/runner/")
    if path.startswith("/"):
        norm = posixpath.normpath(path)
        if re.match(r"^/(usr|bin|sbin|opt|etc)/", norm) \
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

