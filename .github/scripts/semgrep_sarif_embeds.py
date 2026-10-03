"""Data-language guards for helpers: perl switch/program
analysis and awk program-file binding.
"""
import re
from semgrep_sarif_pins import (SCRIPT_PIN,
                                _is_home_write,
                                _safe_exec_path)
from semgrep_sarif_programs import audit_perl_content
from semgrep_sarif_zone import _write_zone


def _zone_target(target, drift):
    zone = _write_zone(target)
    if zone == "trusted" \
            and "helper-trusted-write" not in drift:
        drift.append("helper-trusted-write")
    if zone == "workspace" \
            and "helper-workspace-write" not in drift:
        drift.append("helper-workspace-write")
    if zone == "glob" \
            and "helper-unzoneable-write" not in drift:
        drift.append("helper-unzoneable-write")
    if _is_home_write(target) \
            and "helper-home-write" not in drift:
        drift.append("helper-home-write")


def _check_perl(rest, drift):
    # Flags skipped (-I lib paths and -M module paths must stay
    # out of the attacker tree); -e/-E inline programs skip pin
    # checks but take content checks (secret/net-adjacent, like
    # gh --jq); -i inplace mode still guards its file operands.
    # No -e and no pinned script operand means stdin: drift.
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
                progs = [rest[i + 1] if not attached else attached]
                j = 0
                while j < len(argv):
                    tok2 = argv[j]
                    nxt = argv[j + 1:j + 2]
                    if tok2 in ("-e", "-E") and nxt:
                        progs.append(nxt[0])
                        j += 2
                    elif tok2.startswith(("-e", "-E")) \
                            and len(tok2) > 2:
                        progs.append(tok2[2:])
                        j += 1
                    else:
                        j += 1
                for prog in progs:
                    audit_perl_content(prog, drift)
                if inplace:
                    for target in argv:
                        _zone_target(target, drift)
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


def _scan_awk_program(prog, drift):
    # Inline awk executes: system(), |& coprocesses, pipe
    # getlines/prints, and program redirects into zoned paths.
    # Strings blank first (regex alternation and "a|b" pass);
    # dynamic targets fail closed upward; getline-from-file,
    # /dev/stdout, and || pass.
    for m in re.finditer(r">{1,2}\s*\"((?:[^\"\\]|\\.)*)\"",
                         prog):
        _zone_target(m.group(1), drift)
    code = re.sub(r"\"(?:[^\"\\]|\\.)*\"", "\"\"", prog)
    if re.search(r"(?<![\w$])system\s*\(|\|&"
                 r"|(?<!\|)\|(?!\|)\s*getline\b"
                 r"|(?<!\|)\|(?!\|)\s*\"", code) \
            and "helper-untrusted-exec" not in drift:
        drift.append("helper-untrusted-exec")
    if re.search(r">{1,2}\s*[^\"\s=]", code) \
            and "helper-trusted-write" not in drift:
        drift.append("helper-trusted-write")


def _check_awk(rest, drift):
    # -f program files must be pinned; the positional program
    # and --source programs take content checks (they execute);
    # input files are data. -i inplace rewrites its file
    # operands, so those take the write-zone rule (VAR=
    # operands are assignments, data).
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
            if tok == "--source":
                if i + 1 < len(rest):
                    _scan_awk_program(rest[i + 1], drift)
                i += 2
            else:
                _scan_awk_program(tok[len("--source="):], drift)
                i += 1
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
            _scan_awk_program(tok, drift)
            i += 1
        elif inplace and not re.fullmatch(
                r"[A-Za-z_][A-Za-z0-9_]*=.*", tok):
            _zone_target(tok, drift)
            i += 1
        else:
            i += 1

