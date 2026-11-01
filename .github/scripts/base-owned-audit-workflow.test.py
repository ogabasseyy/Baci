#!/usr/bin/env python3
"""Static trust-boundary contract for the base-owned PR audit workflow."""
from pathlib import Path
import unittest

WORKFLOW = Path(__file__).resolve().parents[1] / 'workflows/base-owned-pr-audit.yml'

class WorkflowTests(unittest.TestCase):
    def test_only_base_code_runs_with_minimal_permissions(self):
        source = WORKFLOW.read_text()
        for expected in ('pull_request_target:', 'contents: read', 'persist-credentials: false',
                         'github.event.pull_request.base.sha', 'github.event.pull_request.head.sha',
                         'base-owned-audit-snapshot.py', 'semgrep-sarif-filter.py',
                         'TRUSTED_CHANGED=', 'python3 -I',
                         'refs/pull/${PR_NUMBER}/head', 'git rev-parse FETCH_HEAD',
                         '[[ "$PR_HEAD_SHA" =~ ^[0-9a-f]{40}$ ]]',
                         '[[ "$PR_NUMBER" =~ ^[1-9][0-9]*$ ]]'):
            self.assertIn(expected, source)
        for forbidden in ('allow-unsafe-pr-checkout', 'secrets.', 'security-events: write',
                          'actions/cache', 'npm install', 'pnpm install'):
            self.assertNotIn(forbidden, source)
        self.assertNotIn('paths:', source)

if __name__ == '__main__':
    unittest.main()
