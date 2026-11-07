"""Pinned future private base-fetch sequence; activated in a later change."""

import hashlib
import re
from pathlib import Path

PRIVATE_ENV = "        env:\n          GH_TOKEN: ${{ github.token }}\n"
PRIVATE_RUN = """            base_sha=$(jq -r .pull_request.base.sha "$GITHUB_EVENT_PATH")
            printf '%s' "$base_sha" | LC_ALL=C grep -Eq '^[0-9a-f]{40}$'
            [ "$GITHUB_SERVER_URL" = "https://github.com" ]
            [ "$(jq -r .repository.full_name "$GITHUB_EVENT_PATH")" = "$GITHUB_REPOSITORY" ]
            umask 077
            ask_dir=$(mktemp -d)
            trap 'rm -rf "$ask_dir"' EXIT
            askpass="$ask_dir/askpass"
            # shellcheck disable=SC2016 # The helper expands the token only when Git runs it.
            printf '%s\\n' '#!/bin/sh' 'case "$1" in *Username*) printf "%s\\n" x-access-token ;; *) printf "%s\\n" "$GH_TOKEN" ;; esac' > "$askpass"
            chmod 700 "$askpass"
            GIT_ASKPASS="$askpass" GIT_TERMINAL_PROMPT=0 git -c credential.helper= fetch --no-tags --depth 1 "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}.git" "$base_sha"
            unset GH_TOKEN
            rm -rf "$ask_dir"
            trap - EXIT
"""
PRIVATE_RUN_LINES = [line.strip() for line in PRIVATE_RUN.splitlines() if not line.strip().startswith("#")]


def private_env_is_exact(body, expected, block, line):
    """Accept only the token entry scoped to the pinned authenticated step."""
    return (
        body == expected and line == "        env:"
        and block.count("        env:") == 1
        and "          GH_TOKEN: ${{ github.token }}" in block
        and "        shell: bash" in block
        and block.index("          GH_TOKEN: ${{ github.token }}") == block.index(line) + 1
        and block.index("        shell: bash") == block.index(line) + 2
    )

EXPECTED_RUN = [
    'if [ -n "${{ github.event.pull_request.head.sha }}" ]; then',
    "rm -rf /tmp/cg-check && mkdir -p /tmp/cg-check",
    'base_ref=$(jq -r .pull_request.base.ref "$GITHUB_EVENT_PATH")',
    'git fetch --no-tags --depth 1 origin "$base_ref"',
    "git archive FETCH_HEAD .github/scripts/capability_gate_contract_check.py .github/scripts/capability_gate_contract_ci_checks.py .github/scripts/capability_gate_contract_workflow_checks.py | tar -x -C /tmp/cg-check",
    "CHECKER=/tmp/cg-check/.github/scripts/capability_gate_contract_check.py",
    "else",
    "CHECKER=.github/scripts/capability_gate_contract_check.py",
    "fi",
    'python3 "$CHECKER" "$PINNED_CHECKER_SHA256"',
]


def sha256_of(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def declared_checker_pin(workflow_text):
    """The PR-head workflow's declared checker hash (comments never count; duplicates fail)."""
    stripped = [line.strip() for line in workflow_text.splitlines()]
    pins = [m.group(1) for s in stripped if s and not s.startswith("#") and (m := re.match(r"PINNED_CHECKER_SHA256:\s*([0-9a-f]{64})\s*$", s))]
    if len(pins) > 1:
        raise ValueError("checker pin duplicated")
    return pins[0] if pins else None



EXPECTED_RUN_WITH_COMPANION = [
    line.replace(
        "capability_gate_contract_workflow_checks.py | tar",
        "capability_gate_contract_workflow_checks.py vps-workers/baci-editorial-context/capability_gate_contract_private_fetch.py | tar",
    )
    for line in EXPECTED_RUN
]
EXPECTED_RUN_PRIVATE = EXPECTED_RUN_WITH_COMPANION[:2] + PRIVATE_RUN_LINES + EXPECTED_RUN_WITH_COMPANION[4:]
