"""Reviewer env:-block poison scan (incl. bash function imports)."""
import re

from semgrep_sarif_consts import (ENV_POISON, is_bash_func_key)
from semgrep_sarif_shell import map_key_value


def audit_reviewer_env_block(workflow_lines, drift):
    # Shell-startup, loader, and interpreter-preload vars are
    # inherited by every run: step: a poison var in any YAML env:
    # mapping (job or step level) re-sources the audited blocks from
    # outside their pinned spans. Only contiguous env: blocks (and
    # flow mappings) are scanned, so run:-block text cannot FP.
    # The shared poison list (single source of truth) with quoted
    # keys normalized in both the opener and the block entries.
    # Bash function imports (BASH_FUNC_<name>%%, round 14) ride the
    # same walk in both branches: map_key_value's bare-key class
    # excludes %, so unquoted %% keys ALSO match a line regex (the
    # bare alternative cannot parse them at all); quoted keys are
    # normalized by map_key_value and match is_bash_func_key.
    idx = 0
    while idx < len(workflow_lines):
        line = workflow_lines[idx]
        stripped = line.strip()
        key, val = map_key_value(stripped)
        if key == "env" and val.startswith("{"):
            if (any(re.search(r"""["']?\b%s\b["']?\s*:""" % var,
                              stripped)
                     for var in ENV_POISON)
                    or re.search(r"""["']?BASH_FUNC_\S+%%"""
                                 r"""["']?\s*:""", stripped)) \
                    and "reviewer-env-poison" not in drift:
                drift.append("reviewer-env-poison")
            idx += 1
        elif key == "env" and not val:
            base = len(line) - len(line.lstrip(" "))
            idx += 1
            while idx < len(workflow_lines):
                sub = workflow_lines[idx]
                if sub.strip() == "" or sub.strip().startswith("#"):
                    idx += 1
                    continue
                if len(sub) - len(sub.lstrip(" ")) <= base:
                    break
                subkey = map_key_value(sub.strip())[0]
                if (subkey in ENV_POISON
                        or (subkey is not None
                            and is_bash_func_key(subkey))
                        or re.search(r"^\s*[\"']?BASH_FUNC_\S+%%"
                                     r"[\"']?\s*:", sub)) \
                        and "reviewer-env-poison" not in drift:
                    drift.append("reviewer-env-poison")
                idx += 1
        else:
            idx += 1
