from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_egress_systemd_integration import _safe_diagnostic


class SystemdIntegrationDiagnosticTests(unittest.TestCase):
    def test_diagnostic_is_printable_sanitized_and_bounded(self):
        value = _safe_diagnostic("stage\nfailed\x1b[31m", "reason: bad\x00path", limit=24)
        self.assertLessEqual(len(value), 24)
        self.assertNotIn("\x1b", value)
        self.assertNotIn("\x00", value)
        self.assertTrue(value.endswith("reason: bad?path"))

    def test_empty_diagnostic_is_explicit(self):
        self.assertEqual(_safe_diagnostic("", ""), "no diagnostic output")


if __name__ == "__main__":
    unittest.main()
