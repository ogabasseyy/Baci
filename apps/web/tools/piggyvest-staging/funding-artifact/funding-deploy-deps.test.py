#!/usr/bin/env python3
"""Guard the funding build's pinned database driver.

The reconciled savings/funding handler imports 'pg' via
postgres-executor.ts. A missing declaration breaks the VPS standalone build
late (after snapshot + transfer). This test pins the declaration in
apps/web/package.json and its exact resolved closure in pnpm-lock.yaml so a
removal fails locally in milliseconds instead of on the VPS.
"""

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[5]
WEB_PACKAGE = ROOT / 'apps' / 'web' / 'package.json'
LOCKFILE = ROOT / 'pnpm-lock.yaml'
EXECUTOR = (
    ROOT / 'apps' / 'web' / 'src' / 'lib' / 'piggyvest' / 'postgres-executor.ts'
)

PG_VERSION = '8.23.0'
TYPES_PG_VERSION = '8.23.1'

# Exact resolved closure, spliced from the proven 1822 reference lock.
SNAPSHOT_KEYS = (
    'pg@8.23.0',
    "'@types/pg@8.23.1'",
    'pg-cloudflare@1.4.0',
    'pg-connection-string@2.14.0',
    'pg-int8@1.0.1',
    'pg-pool@3.14.0(pg@8.23.0)',
    'pg-protocol@1.16.0',
    'pg-types@2.2.0',
    'pgpass@1.0.5',
    'postgres-array@2.0.0',
    'postgres-bytea@1.0.1',
    'postgres-date@1.0.7',
    'postgres-interval@1.2.0',
)


class FundingDeployDepsTest(unittest.TestCase):
    def test_executor_import_and_declaration_stay_coupled(self):
        self.assertIn(
            "from 'pg'",
            EXECUTOR.read_text(encoding='utf-8'),
            'postgres-executor no longer imports pg; drop the dep and this guard together',
        )
        package = json.loads(WEB_PACKAGE.read_text(encoding='utf-8'))
        self.assertEqual(package['dependencies'].get('pg'), PG_VERSION)
        self.assertEqual(
            package['devDependencies'].get('@types/pg'), TYPES_PG_VERSION
        )

    def test_lockfile_resolves_exact_pg_closure(self):
        lock = LOCKFILE.read_text(encoding='utf-8')
        snapshots = lock.split('\nsnapshots:\n', 1)[1]
        for key in SNAPSHOT_KEYS:
            self.assertIn(
                f'\n  {key}:', snapshots, f'lockfile snapshot lacks {key}'
            )
        self.assertIn('specifier: 8.23.0', lock)
        self.assertIn('specifier: 8.23.1', lock)


if __name__ == '__main__':
    unittest.main()
