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
            # -d anywhere in the flag-letter run starts the
            # debugger (verified bundled -wd), which inserts
            # PERL5DB before the first line. Value-taking
            # flags and :args end the run, so module/pattern/
            # extension text containing d (-MData::Dumper,
            # -F\d+, -i.bak) stays silent; -l/-0 take octal
            # only, so d after them is still the debugger.
            # Uppercase -D needs a DEBUGGING perl (absent on
            # the runner) and stays silent.
            letters = re.split(r"[CDFIMVeimx:]",
                               cluster, maxsplit=1)[0]
            if "d" in letters \
                    and "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
                return
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
