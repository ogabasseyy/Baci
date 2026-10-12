#!/usr/bin/env python3
"""Tests for the transition prerequisite tracer (fixture dirs, no root)."""

import importlib.util
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent


def _load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


diagnostic = _load('funding-gateway-transition-diagnostic')
activator = _load('funding-gateway-transition-activator')
candidate = _load('funding-gateway-transition-candidate')


class TracerVerdictTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.uid = os.geteuid()

    def test_reports_exact_failed_check_per_fixture(self):
        good = self.root / 'good.json'
        good.write_bytes(b'{}')
        good.chmod(0o400)
        self.assertEqual(
            diagnostic.inspect_file(good, (0o400, 0o600), self.uid)['verdict'],
            'pass',
        )
        bad_mode = self.root / 'mode.json'
        bad_mode.write_bytes(b'{}')
        bad_mode.chmod(0o644)
        self.assertEqual(
            diagnostic.inspect_file(bad_mode, (0o400,), self.uid)['verdict'],
            'fail:mode',
        )
        link = self.root / 'link.json'
        link.symlink_to(good)
        facts = diagnostic.inspect_file(link, (0o400,), self.uid)
        self.assertEqual(facts['verdict'], 'fail:symlink')
        self.assertTrue(facts['target'].endswith('good.json'))
        subdir = self.root / 'dir.json'
        subdir.mkdir()
        self.assertEqual(
            diagnostic.inspect_file(subdir, (0o400,), self.uid)['verdict'],
            'fail:not-regular',
        )
        self.assertEqual(
            diagnostic.inspect_file(
                self.root / 'absent.json', (0o400,), self.uid
            )['verdict'],
            'fail:missing',
        )
        hard = self.root / 'hard.json'
        hard.write_bytes(b'{}')
        hard.chmod(0o400)
        os.link(hard, self.root / 'hard-alias.json')
        self.assertEqual(
            diagnostic.inspect_file(hard, (0o400,), self.uid)['verdict'],
            'fail:nlink',
        )

    def test_flags_group_writable_ancestor(self):
        parent = self.root / 'writable'
        parent.mkdir()
        parent.chmod(0o775)
        child = parent / 'child.json'
        child.write_bytes(b'{}')
        result = diagnostic.inspect_ancestors(child, self.uid)
        self.assertEqual(result['verdict'], 'fail:ancestor-writable')
        self.assertEqual(result['path'], str(parent))
        tight = self.root / 'tight'
        tight.mkdir(mode=0o755)
        tight.chmod(0o755)
        result = diagnostic.inspect_ancestors(tight / 'child.json', self.uid)
        # System temp ancestors above the fixture may fail; the tight dir
        # itself must never be the reported failure.
        self.assertNotEqual(result.get('path'), str(tight))

    def test_provenance_absence_check(self):
        self.assertEqual(
            diagnostic.inspect_absence(self.root / 'receipt.json')['verdict'],
            'pass',
        )
        present = self.root / 'receipt.json'
        present.write_bytes(b'{}')
        self.assertEqual(
            diagnostic.inspect_absence(present)['verdict'],
            'fail:already-exists',
        )

    def test_spec_covers_every_ceremony_input(self):
        self.assertEqual(
            diagnostic.GRAPH_DEFAULT_MODES, activator.GRAPH_DEFAULT_MODES
        )
        self.assertEqual(
            set(diagnostic.GRAPH_MODE_OVERRIDES),
            {
                Path(path).name
                for path in activator.GRAPH_MODE_OVERRIDES
            },
        )
        for name, modes in diagnostic.GRAPH_MODE_OVERRIDES.items():
            full = next(
                path for path in activator.GRAPH_MODE_OVERRIDES
                if Path(path).name == name
            )
            self.assertEqual(modes, activator.GRAPH_MODE_OVERRIDES[full])
        self.assertEqual(diagnostic.ARCHIVE_MODES, candidate.ARCHIVE_MODES)
        rows = {
            label: (path, modes, step)
            for label, path, modes, step in diagnostic.spec_table()
        }
        for graph_path in activator.GRAPH:
            name = Path(graph_path).name
            self.assertIn(f'graph:{name}', rows)
            self.assertEqual(
                rows[f'graph:{name}'][1],
                diagnostic.GRAPH_MODE_OVERRIDES.get(
                    name, diagnostic.GRAPH_DEFAULT_MODES
                ),
            )
        self.assertEqual(
            rows['graph:managed-inventory-helper.mjs'][1], (0o550,)
        )
        self.assertEqual(
            rows['live-binding'],
            (activator.BINDING_PATH, (0o440,), 'build-package/check/activate'),
        )
        self.assertEqual(
            rows['live-evidence'][1], (0o440,)
        )
        self.assertEqual(
            rows['package-binding'],
            (activator.PACKAGE_BINDING_PATH, (0o400, 0o600), 'check/activate'),
        )
        self.assertEqual(
            rows['owner-inputs'],
            (candidate.OWNER_INPUT_PATH, (0o400, 0o600), 'check/activate'),
        )
        self.assertEqual(rows['gateway-unit'][1], (0o444, 0o644))
        self.assertIn('receipt', rows)
        self.assertIn('renewal-receipt', rows)

    def test_spec_lists_renewal_archives_at_exact_0440(self):
        state = self.root / 'state'
        archive = state / 'renewals' / 'approved-renewal'
        archive.mkdir(parents=True)
        for leaf in ('binding.json', 'startup-evidence.json'):
            (archive / leaf).write_bytes(b'x')
        with patch.object(
            diagnostic.candidate, 'STATE_DIRECTORY', state
        ):
            rows = {
                label: (path, modes, step)
                for label, path, modes, step in diagnostic.spec_table()
            }
        self.assertEqual(
            rows['archive:approved-renewal/binding.json'][1], (0o440,)
        )
        self.assertEqual(
            rows['archive:approved-renewal/startup-evidence.json'][1], (0o440,)
        )


if __name__ == '__main__':
    unittest.main()
