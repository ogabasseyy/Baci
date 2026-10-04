"""gh CLI confinement for the helper audit: gh runs with the
collection token, so only the api subcommand passes, api writes
are pinned to the review-posting shape, --hostname/-R cannot
redirect the token or the endpoint, and the --jq program rule
from the jq family still applies. GET/HEAD reads pass with any
endpoint (API responses never hold secret values); anything
else fails closed.
"""
import re
from semgrep_sarif_programs import jq_program_has_env

GH_API_REVIEWS = ("repos/${GITHUB_REPOSITORY}/pulls/"
                  "${PR_NUMBER}/reviews")
GH_READ_METHODS = {"GET", "HEAD"}
GH_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
GH_POST_INPUTS = ("${RUNNER_TEMP}/muse-review-payload.json",
                  "${RUNNER_TEMP}/muse-review-payload.json.summary")
# Flags consuming the next token (endpoint scan skips both).
GH_VALUE_FLAGS = {"--method", "-X", "--input", "-H", "--header",
                  "--hostname", "--jq", "-q", "-f", "-F",
                  "--field", "--raw-field", "--template", "-t",
                  "--preview", "-p", "--cache", "-R", "--repo"}


def _gh_flagzone(rest):
    # Flag-parsing region: tokens before a -- terminator (after
    # it everything is positional, so no smuggled method/input).
    if "--" in rest:
        return rest[:rest.index("--")]
    return rest


def _gh_method(rest):
    # Explicit request method (--method/-X: separate, = or
    # glued); None when unset (gh defaults GET, or POST with
    # --input -- covered by the input rule, not here). Last
    # occurrence wins, matching pflag flag parsing.
    found, zone = None, _gh_flagzone(rest)
    i = 0
    while i < len(zone):
        tok = zone[i]
        if tok in ("--method", "-X"):
            found = zone[i + 1] if i + 1 < len(zone) else ""
            i += 2
        elif tok.startswith("--method="):
            found = tok[len("--method="):]
            i += 1
        elif tok.startswith("-X="):
            found = tok[len("-X="):]
            i += 1
        elif re.fullmatch(r"-X\S+", tok):
            found = tok[2:]
            i += 1
        else:
            i += 1
    return found


def _gh_operands(rest):
    # Non-flag tokens with value-flag pairs skipped. Unknown
    # dash-tokens skip alone: a misread value then fails the
    # endpoint match toward drift on writes.
    out, i = [], 0
    zone = _gh_flagzone(rest)
    eq = tuple(v + "=" for v in GH_VALUE_FLAGS
               if v.startswith("--"))
    while i < len(zone):
        tok = zone[i]
        if tok in GH_VALUE_FLAGS:
            i += 2
        elif tok.startswith(eq):
            i += 1
        elif tok.startswith("-") and len(tok) > 1:
            i += 1
        else:
            out.append(tok)
            i += 1
    return out


def _gh_values(rest, names):
    # Values of the named flags (separate, --long=, or glued
    # short spelling); a glued short counts even though its
    # value is unread -- presence alone vetoes the field-free
    # shape and implies POST.
    vals, i = [], 0
    zone = _gh_flagzone(rest)
    shorts = {n for n in names
              if re.fullmatch(r"-[a-zA-Z]", n)}
    while i < len(zone):
        tok = zone[i]
        if tok in names and i + 1 < len(zone):
            vals.append(zone[i + 1])
            i += 2
        elif any(tok.startswith(n + "=") for n in names
                 if n.startswith("--")):
            vals.append(tok.split("=", 1)[1])
            i += 1
        elif any(tok.startswith(s) and len(tok) > 2
                 for s in shorts):
            vals.append(tok[2:])
            i += 1
        else:
            i += 1
    return vals


def audit_gh(rest, drift):
    # gh --jq programs are jq: scan the value, not the API path.
    for i, tok in enumerate(rest):
        prog = None
        if tok == "--jq" and i + 1 < len(rest):
            prog = rest[i + 1]
        elif tok.startswith("--jq="):
            prog = tok[len("--jq="):]
        if prog is not None and jq_program_has_env(prog) \
                and "helper-jq-env" not in drift:
            drift.append("helper-jq-env")
    ops = _gh_operands(rest)
    if not ops:
        return  # version/help/usage: no subcommand, no request
    if ops[0] != "api":
        # Only api is load-bearing: auth token/status exports
        # the token, pr/secret/release/... change remote state.
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
        return
    zone = _gh_flagzone(rest)
    if any(t == "--hostname" or t.startswith("--hostname=")
           for t in zone):
        # Token-bearing request to an arbitrary host.
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
        return
    if "-R" in zone or _gh_values(rest, {"--repo"}) \
            or any(t.startswith("-R") and len(t) > 2
                   for t in zone):
        # -R/--repo repoints repo resolution off the audited
        # endpoint shape.
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
        return
    method = _gh_method(rest)
    upper = method.upper() if method else None
    if upper is not None and upper not in GH_READ_METHODS \
            and upper not in GH_WRITE_METHODS:
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
        return
    inputs = _gh_values(rest, {"--input"})
    fields = _gh_values(rest, {"-f", "-F", "--field",
                               "--raw-field"})
    if upper in GH_READ_METHODS:
        # Explicit GET/HEAD: gh honors it even with parameters
        # (fields ride the query string); reads pass with any
        # endpoint.
        return
    if upper is None and not inputs and not fields:
        return  # parameterless GET
    # gh POSTs: explicit verb, --input, or inferred from field
    # parameters (per gh api --help). The review-posting shape
    # only -- reviews endpoint, POST, pinned payload inputs, no
    # fields (body=@file would post local file bytes, and any
    # inferred POST carries unpinned parameters).
    endpoint = ops[1] if len(ops) > 1 else None
    if upper in ("POST", None) and endpoint == GH_API_REVIEWS \
            and all(v in GH_POST_INPUTS for v in inputs) \
            and not fields:
        return
    if "helper-untrusted-exec" not in drift:
        drift.append("helper-untrusted-exec")
