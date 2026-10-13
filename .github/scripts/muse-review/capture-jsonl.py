#!/usr/bin/env python3
"""Extract only Muse's final answer and effective model IDs from JSONL."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import TextIO

MODEL_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}\Z")


def extract_events(lines: TextIO) -> tuple[str, list[str]]:
    """Return terminal answer text and model IDs reported with usage."""
    final_text: str | None = None
    model_ids: list[str] = []

    for line_number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError as error:
            raise ValueError(f"Muse emitted invalid JSONL at line {line_number}") from error
        if not isinstance(event, dict):
            raise ValueError(f"Muse emitted a non-object event at line {line_number}")

        payload_type = event.get("payload_type")
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue

        if payload_type == "run.terminal.completed":
            text = payload.get("text")
            if isinstance(text, str):
                final_text = text
        elif payload_type == "session.tokenUsage":
            model_id = payload.get("modelId")
            if isinstance(model_id, str) and MODEL_ID.fullmatch(model_id):
                if model_id not in model_ids:
                    model_ids.append(model_id)

    if final_text is None:
        raise ValueError("Muse JSONL did not contain a completed run answer")
    return final_text, model_ids


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review-file", required=True, type=Path)
    parser.add_argument("--model-file", required=True, type=Path)
    args = parser.parse_args()

    try:
        final_text, model_ids = extract_events(sys.stdin)
        args.review_file.write_text(final_text, encoding="utf-8")
        args.model_file.write_text("".join(f"{model_id}\n" for model_id in model_ids), encoding="utf-8")
    except (OSError, ValueError) as error:
        print(f"Muse JSONL capture failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
