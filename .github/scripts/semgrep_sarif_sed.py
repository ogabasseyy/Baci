"""Sed program audit: the script (not just -i subjects) is a
code channel. s///e and the e command execute shell, w/W
write files with no -i needed, and -f loads the program from
a file (workspace/relative/unresolved paths are attacker
influence). Parses address/command structure so ; and e
letters inside s bodies, addresses, and text blocks stay
silent. Residual: --debug/-l attacker flags are noise, not
execution; old-form tar-style option order is unsupported.
"""
from semgrep_sarif_scan import _write_zone


def _sed_scripts(rest):
    # (programs, -f files): -e/--expression values (attached
    # bundles included), or operand[0] when neither -e nor -f
    # is given. -l consumes its arg, -i never does (its
    # suffix attaches), so -le/-ie bundles parse correctly.
    progs, ffiles, operands = [], [], []
    i, n = 0, len(rest)
    while i < n:
        tok = rest[i]
        if tok in ("-e", "--expression"):
            if i + 1 < n:
                progs.append(rest[i + 1])
            i += 2
        elif tok.startswith("--expression="):
            progs.append(tok.split("=", 1)[1])
            i += 1
        elif tok in ("-f", "--file"):
            if i + 1 < n:
                ffiles.append(rest[i + 1])
            i += 2
        elif tok.startswith("--file="):
            ffiles.append(tok.split("=", 1)[1])
            i += 1
        elif tok == "--":
            operands.extend(rest[i + 1:])
            break
        elif tok.startswith("-") and not tok.startswith("--") \
                and len(tok) > 2:
            j, ate = 1, False
            while j < len(tok):
                if tok[j] in ("e", "f"):
                    if tok[j + 1:]:
                        val = tok[j + 1:]
                    elif i + 1 < n:
                        val, ate = rest[i + 1], True
                    else:
                        break
                    if tok[j] == "e":
                        progs.append(val)
                    else:
                        ffiles.append(val)
                    break
                if tok[j] == "l":
                    if j + 1 >= len(tok):
                        ate = True
                    break
                if tok[j] == "i":
                    break
                j += 1
            i += 2 if ate else 1
        elif tok.startswith("-") and len(tok) > 1:
            i += 1
        else:
            operands.append(tok)
            i += 1
    if not progs and not ffiles and operands:
        progs = [operands[0]]
    return progs, ffiles


def _skip_sed_addrs(prog, i):
    # Index past up to 2 addresses, comma, and ! modifiers.
    n = len(prog)
    for _ in range(2):
        while i < n and prog[i] in " \t":
            i += 1
        if i < n and prog[i] == "/":
            j = i + 1
            while j < n and prog[j] != "/":
                j += 2 if prog[j] == "\\" and j + 1 < n \
                    else 1
            i = j + 1 if j < n else n
        elif prog[i:i + 2] in ("\\/", "\\%"):
            close = prog[i + 1]
            j = i + 2
            while j < n and prog[j] != close:
                j += 2 if prog[j] == "\\" and j + 1 < n \
                    else 1
            i = j + 1 if j < n else n
        elif i < n and (prog[i].isdigit()
                       or prog[i] in "$~+"):
            while i < n and (prog[i].isdigit()
                             or prog[i] in "~+"):
                i += 1
        else:
            break
        while i < n and prog[i] in " \t":
            i += 1
        if i < n and prog[i] == ",":
            i += 1
            continue
        break
    while i < n and prog[i] in " \t!":
        i += 1
    return i


def _sed_s(prog, k):
    # (flags, end) of the s command at k (after the letter);
    # (None, k) when unterminated (sed errors, no execution).
    if k >= len(prog) or prog[k].isalnum() \
            or prog[k] in " \t\n;":
        return None, k
    d, i, n = prog[k], k + 1, len(prog)
    for _ in range(2):
        while i < n and prog[i] != d:
            i += 2 if prog[i] == "\\" and i + 1 < n \
                else 1
        if i >= n:
            return None, k
        i += 1
    start = i
    while i < n and prog[i].isalpha():
        i += 1
    return prog[start:i], i


def _sed_cmds(prog):
    # (cmd, args) walking ;- and newline-separated commands.
    # s-commands consume fully (a ; inside bodies is data);
    # a/c/i backslash-newline text blocks (with \-continued
    # lines) are skipped as data; # runs to the newline.
    i, n = 0, len(prog)
    skip_text = False
    while i < n:
        if skip_text:
            while True:
                j = prog.find("\n", i)
                if j < 0:
                    return
                if prog[i:j].endswith("\\"):
                    i = j + 1
                    continue
                i = j + 1
                break
            skip_text = False
            continue
        while i < n and prog[i] in " \t;\n{}":
            i += 1
        if i >= n:
            return
        if prog[i] == "#":
            j = prog.find("\n", i)
            i = n if j < 0 else j + 1
            continue
        j = _skip_sed_addrs(prog, i)
        if j >= n or prog[j] in ";\n":
            i = j + 1
            continue
        cmd, k = prog[j], j + 1
        if cmd == "s":
            flags, end = _sed_s(prog, k)
            yield ("s", flags)
            i = end if end > k else k
            continue
        end = k
        while end < n and prog[end] not in ";\n":
            end += 1
        args = prog[k:end]
        yield (cmd, args)
        if cmd in ("a", "c", "i") and args.strip() == "\\":
            skip_text = True
        i = end


def audit_sed_programs(rest, drift):
    # Exec programs drift helper-untrusted-exec; returns the
    # w/W filenames for the destination rule.
    progs, ffiles = _sed_scripts(rest)
    found_e = False
    targets = []
    for prog in progs:
        for cmd, args in _sed_cmds(prog):
            if cmd == "e":
                found_e = True
            elif cmd == "s":
                if args and "e" in args:
                    found_e = True
            elif cmd in ("w", "W"):
                if args.strip():
                    targets.append(args.strip())
    if found_e and "helper-untrusted-exec" not in drift:
        drift.append("helper-untrusted-exec")
    for path in ffiles:
        zone = _write_zone(path)
        if zone == "workspace" \
                or (zone is None and not path.startswith("/")):
            if "helper-untrusted-exec" not in drift:
                drift.append("helper-untrusted-exec")
            break
    return targets
