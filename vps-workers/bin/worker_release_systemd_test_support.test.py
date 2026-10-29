"""Safe categorical diagnostics for the disposable extractor integration."""
from __future__ import annotations

import unittest

from worker_release_systemd_test_support import _exec_code_category, _exec_status_category


class SystemdTestSupportTests(unittest.TestCase):
    def test_exec_code_uses_wait_status_categories(self):
        self.assertEqual(_exec_code_category("1"), "exited")
        self.assertEqual(_exec_code_category("2"), "killed")
        self.assertEqual(_exec_code_category("3"), "dumped")
        self.assertEqual(_exec_code_category("credential-value"), "other")

    def test_exec_status_maps_systemd_setup_failures_without_echoing_codes(self):
        self.assertEqual(_exec_status_category("0"), "zero")
        self.assertEqual(_exec_status_category("1"), "application-or-other-failure")
        self.assertEqual(_exec_status_category("203"), "exec-setup-failure")
        self.assertEqual(_exec_status_category("225"), "network-namespace-failure")
        self.assertEqual(_exec_status_category("226"), "filesystem-namespace-failure")
        self.assertEqual(_exec_status_category("9999"), "application-or-other-failure")
        self.assertEqual(_exec_status_category("secret"), "unavailable")


if __name__ == "__main__":
    unittest.main()
