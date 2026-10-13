#!/usr/bin/env python3
"""Regression tests for the Muse JSONL model-ID and answer extractor."""

from __future__ import annotations

import importlib.util
import io
import json
import unittest
from pathlib import Path

SCRIPT = Path(__file__).with_name("capture-jsonl.py")
SPEC = importlib.util.spec_from_file_location("capture_jsonl", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
capture_jsonl = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(capture_jsonl)


def event(payload_type: str, payload: dict[str, object]) -> str:
    return json.dumps({"payload_type": payload_type, "payload": payload})


class CaptureJsonlTests(unittest.TestCase):
    def test_extracts_final_answer_and_unique_effective_model_ids(self) -> None:
        lines = "\n".join(
            [
                event("session.tokenUsage", {"modelId": "muse-wonder-1.0", "usage": {"secret": "omit"}}),
                event("session.tokenUsage", {"modelId": "muse-wonder-1.0"}),
                event("session.tokenUsage", {"modelId": "muse-spark-1.3"}),
                event("run.terminal.completed", {"text": "review result"}),
            ]
        )
        self.assertEqual(
            capture_jsonl.extract_events(io.StringIO(lines)),
            ("review result", ["muse-wonder-1.0", "muse-spark-1.3"]),
        )

    def test_ignores_untrusted_or_malformed_model_ids(self) -> None:
        lines = "\n".join(
            [
                event("session.tokenUsage", {"modelId": "bad model\n::error::secret"}),
                event("session.tokenUsage", {"modelId": None}),
                event("run.terminal.completed", {"text": "ok"}),
            ]
        )
        self.assertEqual(capture_jsonl.extract_events(io.StringIO(lines)), ("ok", []))

    def test_rejects_invalid_jsonl(self) -> None:
        with self.assertRaisesRegex(ValueError, "invalid JSONL"):
            capture_jsonl.extract_events(io.StringIO("not json\n"))

    def test_requires_completed_answer(self) -> None:
        with self.assertRaisesRegex(ValueError, "completed run answer"):
            capture_jsonl.extract_events(io.StringIO(event("session.tokenUsage", {"modelId": "muse-wonder-1.0"})))


if __name__ == "__main__":
    unittest.main()
