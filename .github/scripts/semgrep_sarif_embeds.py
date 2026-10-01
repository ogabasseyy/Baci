"""Data-language guards for helpers: perl switch/program
analysis and awk program-file binding.
"""
import re
from semgrep_sarif_pins import (SCRIPT_PIN,
                                _is_home_write,
                                _safe_exec_path)
from semgrep_sarif_scan import _write_zone


def _check_perl(rest, drift):
    # Flags skipped (-I lib paths and -M module paths must stay
    # out of the attacker tree); -e/-E inline programs pass
    # (visible in the file for human review) but -i inplace
    # mode still guards its file operands. No -e and no pinned
    # script operand means a stdin program: drift.
    i, inplace = 0, False
    while i < len(rest):
        tok = rest[i]
        if tok == "--":
            i += 1
            break
        if tok in ("-h", "-v", "-V", "--help", "--version"):
            return
        if tok.startswith("-") and not tok.startswith("--") \
                and len(tok) > 1:
            cluster = tok[1:]
            racers = [(cluster.find(c), c)
                      for c in "IeEMm" if c in cluster]
            if not racers:
                if "i" in cluster:
                    inplace = True
                i += 1
                continue
            _, winner = min(racers)
            pos = cluster.find(winner)
            if winner == "I":
                if pos == len(cluster) - 1:
                    if i + 1 >= len(rest):
                        if "helper-env-poison" not in drift:
                            drift.append("helper-env-poison")
                        return
                    value, step = rest[i + 1], 2
                else:
                    value, step = cluster[pos + 1:], 1
                if not _safe_exec_path(value) \
                        and "helper-env-poison" not in drift:
                    drift.append("helper-env-poison")
                    return
                i += step
            elif winner in ("M", "m"):
                if pos == len(cluster) - 1:
                    if i + 1 >= len(rest):
                        i += 1
                        continue
                    value, step = rest[i + 1], 2
                else:
                    value, step = cluster[pos + 1:], 1
                if ("/" in value or value.startswith(".")) \
                        and not _safe_exec_path(value) \
                        and "helper-untrusted-exec" not in drift:
                    drift.append("helper-untrusted-exec")
                    return
                i += step
            else:
                if "i" in cluster:
                    inplace = True
                attached = cluster[pos + 1:]
                if not attached:
                    if i + 1 >= len(rest):
                        if "helper-untrusted-exec" \
                                not in drift:
                            drift.append("helper-untrusted-exec")
                        return
                    argv = rest[i + 2:]
                else:
                    argv = rest[i + 1:]
                if inplace:
                    for target in argv:
                        zone = _write_zone(target)
                        if zone == "trusted" \
                                and "helper-trusted-write" \
                                not in drift:
                            drift.append("helper-trusted-write")
                        if zone == "workspace" \
                                and "helper-workspace-write" \
                                not in drift:
                            drift.append("helper-workspace-write")
                        if _is_home_write(target) \
                                and "helper-home-write" \
                                not in drift:
                            drift.append("helper-home-write")
                return
        elif tok.startswith("-"):
            i += 1
        else:
            break
    if i >= len(rest):
        if "helper-untrusted-exec" not in drift:
            drift.append("helper-untrusted-exec")
        return
    if not re.match(SCRIPT_PIN, rest[i]) \
            and "helper-untrusted-exec" not in drift:
        drift.append("helper-untrusted-exec")


def _check_awk(rest, drift):
    # -f program files must be pinned; the positional program
    # and input files pass (inline code is human-visible,
    # inputs are data). --source programs are inline too. -i
    # inplace rewrites its file operands, so those take the
    # write-zone rule (VAR= operands are assignments, data).
    i, inplace, program_seen = 0, False, False
    while i < len(rest):
        tok = rest[i]
        if tok == "--":
            i += 1
            continue
        if tok in ("-f", "--file") and i + 1 < len(rest):
            if not re.match(SCRIPT_PIN, rest[i + 1]) \
                    and "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
                return
            i += 2
        elif tok.startswith("-f") and len(tok) > 2:
            if not re.match(SCRIPT_PIN, tok[2:]) \
                    and "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
                return
            i += 1
        elif tok.startswith("--file="):
            if not re.match(SCRIPT_PIN,
                             tok[len("--file="):]) \
                    and "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
                return
            i += 1
        elif tok == "--source" \
                or tok.startswith("--source="):
            i += 2 if tok == "--source" else 1
        elif tok == "-i":
            # Bare -i takes an include file: only the inplace
            # extension is known-safe (unpinned code otherwise).
            nxt = rest[i + 1] if i + 1 < len(rest) else ""
            if nxt.startswith("inplace"):
                inplace = True
                i += 2
            elif nxt == "" or nxt == "--" \
                    or nxt.startswith("-"):
                i += 1
            else:
                if "helper-untrusted-exec" not in drift:
                    drift.append("helper-untrusted-exec")
                return
        elif tok in ("--inplace",) \
                or tok.startswith("--inplace="):
            inplace = True
            i += 1
        elif tok.startswith("-i"):
            if tok[2:].startswith("inplace"):
                inplace = True
                i += 1
            else:
                if "helper-untrusted-exec" not in drift:
                    drift.append("helper-untrusted-exec")
                return
        elif tok in ("-v", "-F", "-W"):
            i += 2
        elif tok.startswith("-"):
            i += 1
        elif not program_seen:
            program_seen = True
            i += 1
        elif inplace and not re.fullmatch(
                r"[A-Za-z_][A-Za-z0-9_]*=.*", tok):
            zone = _write_zone(tok)
            if zone == "trusted" \
                    and "helper-trusted-write" not in drift:
                drift.append("helper-trusted-write")
            if zone == "workspace" \
                    and "helper-workspace-write" not in drift:
                drift.append("helper-workspace-write")
            i += 1
        else:
            i += 1

