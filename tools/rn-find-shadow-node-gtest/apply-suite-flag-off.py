#!/usr/bin/env python3
"""Force FindShadowNodeByTagTest to exercise the production (flag-off) path.

Kept out of patches/react-native@*.patch so the package patch stays ≤300 lines.
Idempotent: safe to re-run on an already-mutated suite file.
"""

from __future__ import annotations

import pathlib
import re
import sys

MARKER = (
    "// Exercise the production default: the ownership fix must not rely on opt-in."
)


def main() -> int:
    if len(sys.argv) != 2:
        print(f"usage: {sys.argv[0]} <FindShadowNodeByTagTest.cpp>", file=sys.stderr)
        return 2
    path = pathlib.Path(sys.argv[1])
    text = path.read_text(encoding="utf-8")
    if MARKER in text and re.search(
        r"bool fixFindShadowNodeByTagRaceCondition\(\) override \{\s*"
        + re.escape(MARKER)
        + r"\s*return false;",
        text,
        flags=re.MULTILINE,
    ):
        print(f"ok: already flag-off in {path}")
        return 0

    pattern = re.compile(
        r"(bool fixFindShadowNodeByTagRaceCondition\(\) override \{\n)"
        r"(?:[^\n]*\n)*?"
        r"(\s*)return true;\n"
        r"(\s*\})",
        flags=re.MULTILINE,
    )
    replacement = rf"\1\2{MARKER}\n\2return false;\n\3"
    new_text, count = pattern.subn(replacement, text, count=1)
    if count != 1:
        print(
            f"error: could not rewrite fixFindShadowNodeByTagRaceCondition in {path}",
            file=sys.stderr,
        )
        return 1
    path.write_text(new_text, encoding="utf-8")
    print(f"ok: forced flag-off suite in {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
