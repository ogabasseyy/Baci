import importlib.util
import hashlib
import os
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


BASE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location(
    'funding_service_render', BASE / 'funding-service-render.py'
)
render = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(render)


class FundingServiceRenderTests(unittest.TestCase):
    def test_unit_is_loopback_staging_only_and_preserves_fixed_week_lease(self):
        unit = render.render_unit()
        timer = render.render_deadline_timer()
        self.assertIn('BACI_WORKER_PROFILE=hosted-savings-funding', unit)
        self.assertIn('PORT=4795 HOSTNAME=127.0.0.1', unit)
        self.assertIn(f'WorkingDirectory={render.ARTIFACT_ROOT}/apps/web', unit)
        self.assertIn(f'BindReadOnlyPaths={render.ARTIFACT_ROOT}', unit)
        self.assertIn(f'EnvironmentFile={render.CONFIG_PATH}', unit)
        self.assertIn(
            f'LoadCredential={render.DB_CA_CREDENTIAL}:{render.DB_CA_PATH}',
            unit,
        )
        self.assertIn(
            'ExecStart=/bin/sh -c \'export '
            f'{render.DB_CA_CREDENTIAL}="$(cat '
            f'$CREDENTIALS_DIRECTORY/{render.DB_CA_CREDENTIAL})"; '
            'unset CREDENTIALS_DIRECTORY; '
            'exec /usr/bin/env NODE_ENV=production '
            'BACI_WORKER_PROFILE=hosted-savings-funding PORT=4795 '
            'HOSTNAME=127.0.0.1 /usr/bin/node server.js\'',
            unit,
        )
        self.assertNotIn('ImportCredential=', unit)
        self.assertNotIn('-----BEGIN CERTIFICATE-----', unit)
        self.assertLess(unit.index('EnvironmentFile='), unit.index('ExecStart='))
        self.assertLess(unit.index('LoadCredential='), unit.index('ExecStart='))
        self.assertNotIn('\nEnvironment=NODE_ENV=', unit)
        self.assertIn(
            f'BACI_SAVINGS_LEASE_EXPIRES_AT" = "{render.LEASE_DEADLINE_EPOCH}', unit
        )
        self.assertIn('RuntimeMaxSec=7d', unit)
        self.assertNotIn('0.0.0.0', unit)
        self.assertNotIn('Restart=always', unit)
        self.assertIn('OnCalendar=2026-09-29 15:59:10 UTC', timer)


    def test_regression_unsets_credentials_directory_before_exec(self):
        unit = render.render_unit()
        start = next(
            line
            for line in unit.splitlines()
            if line.startswith('ExecStart=/bin/sh -c')
        )
        export_at = start.index('$CREDENTIALS_DIRECTORY/')
        unset_at = start.index('unset CREDENTIALS_DIRECTORY;')
        exec_at = start.index('exec /usr/bin/env')
        self.assertLess(export_at, unset_at)
        self.assertLess(unset_at, exec_at)


    def test_prior_unit_pin_matches_template_without_credentials_unset(self):
        old = render.render_unit().replace(
            'unset CREDENTIALS_DIRECTORY; ', '', 1
        )
        self.assertNotEqual(old, render.render_unit())
        self.assertEqual(
            hashlib.sha256(old.encode('utf-8')).hexdigest(),
            render.PRIOR_UNIT_SHA256,
        )


if __name__ == '__main__':
    unittest.main()
