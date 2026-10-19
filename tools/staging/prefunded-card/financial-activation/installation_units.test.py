import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import installation_units as units
from release_contract import digest


class InstallationUnitsTests(unittest.TestCase):
    def reviewed_units(self):
        expected = {units.PREFIX + suffix: value.encode() for suffix, value in units.units().items()
                    if suffix != 'deadline.timer'}
        expected['baci-prefunded-replay-deadline.service'] = units.REPLAY_STOPPER
        expected['baci-prefunded-public-deadline.service'] = units.public_units()[
            'baci-prefunded-public-deadline.service'].encode()
        expected.update({name: b'OnCalendar=2026-10-06 15:59:10 UTC\n' for name in units.TIMERS})
        expected['baci-prefunded-public.service'] = b'ExecCondition=/usr/bin/test 1791302350\n'
        return expected

    def candidate_fixture(self):
        originals = {name: content for name, content in self.reviewed_units().items()
                     if name in (*units.TIMERS, 'baci-prefunded-public.service')}
        for name in units.TIMERS:
            if not name.startswith('baci-prefunded-public'):
                originals[name] = originals[name].replace(b'2026-10-06', b'2026-09-29')
        candidates = {name: content if name.startswith('baci-prefunded-public') else
                      content.replace(b'2026-09-29', b'2026-10-06')
                      for name, content in originals.items()}
        rows = [{'name': name, 'candidatePath': name, 'sourceSha256': digest(originals[name]),
                 'candidateSha256': digest(content)} for name, content in candidates.items()]
        metadata = json.dumps({'artifacts': {'unitArtifacts': rows}}).encode()
        return originals, candidates, metadata

    def test_unchanged_units_require_exact_root_ownership_and_0644_for_every_reviewed_unit(self):
        expected = self.reviewed_units()
        for changed in expected:
            for field, value in (('uid', 65532), ('gid', 65532), ('mode', 0o600)):
                def fingerprint(path):
                    metadata = {'uid': 0, 'gid': 0, 'mode': 0o644}
                    if path.name == changed:
                        metadata[field] = value
                    return metadata, expected[path.name]

                with self.subTest(unit=changed, field=field), \
                        patch.object(units, 'fingerprint', side_effect=fingerprint), \
                        patch.object(units, 'properties', side_effect=lambda name, fields: {
                            'FragmentPath': str(units.SYSTEMD / name),
                            'DropInPaths': '', 'NeedDaemonReload': 'no'}):
                    with self.assertRaisesRegex(ValueError, 'installation_unit_metadata_refused'):
                        units.validate_unchanged_units()

    def test_verified_plan_checks_metadata_including_exact_preserved_public_noops(self):
        originals, candidates, metadata = self.candidate_fixture()
        candidate = Path('/root/candidate')

        def pin_read(path, sha):
            content = metadata if path.name == 'candidate.json' else candidates[path.name]
            self.assertEqual(sha, digest(content))
            return content

        for changed in (None, *originals):
            def fingerprint(path):
                return {'sha256': digest(originals[path.name]),
                        'uid': 65532 if path.name == changed else 0,
                        'gid': 0, 'mode': 0o644}, originals[path.name]

            with self.subTest(unit=changed), patch.object(units, 'pin_read', side_effect=pin_read), \
                    patch.object(units, 'fingerprint', side_effect=fingerprint):
                if changed is None:
                    plan = units.verified_plan(candidate, digest(metadata))
                    self.assertEqual(set(plan), set(units.TIMERS) - {'baci-prefunded-public-deadline.timer'})
                else:
                    with self.assertRaisesRegex(ValueError, 'installation_unit_metadata_refused'):
                        units.verified_plan(candidate, digest(metadata))

    def test_deadline_installation_retains_effective_and_pinned_plan_rechecks(self):
        events = []
        with patch.object(units, 'validate_unchanged_units', side_effect=lambda: events.append('units')), \
                patch.object(units, 'verified_plan', side_effect=lambda *args: events.append('plan') or {}), \
                patch.object(units, 'command', side_effect=lambda *args: events.append('command')), \
                patch.object(units, 'verify_deadlines', return_value={'checked': True}):
            result = units.install_deadlines(Path('/candidate'), Path('/audit'), 'a' * 64)
            units.verified_plan.assert_called_once_with(Path('/candidate'), 'a' * 64)
            self.assertEqual(events, ['units', 'plan', 'command', 'command', 'units', 'command'])
            self.assertEqual(result, {'checked': True})

    def test_deadline_requires_effective_schedule_not_just_file_literal(self):
        value = {'ActiveState': 'active', 'NextElapseUSecRealtime': '',
                 'TimersCalendar': 'OnCalendar=2026-10-06 15:59:10 UTC'}
        with patch.object(units, 'validate_unchanged_units'), \
                patch.object(units, 'properties', return_value=value):
            with self.assertRaisesRegex(ValueError, 'effective_deadline_unproved'):
                units.verify_deadlines()

    def test_effective_october_deadlines_are_accepted_for_all_three_stoppers(self):
        value = {'ActiveState': 'active', 'NextElapseUSecRealtime': 'Tue 2026-10-06 15:59:10 UTC',
                 'TimersCalendar': 'OnCalendar=2026-10-06 15:59:10 UTC'}
        with patch.object(units, 'validate_unchanged_units'), \
                patch.object(units, 'properties', return_value=value):
            result = units.verify_deadlines()
        self.assertEqual(set(result), set(units.TIMERS))
        self.assertTrue(all(row['stopTargetsVerified'] for row in result.values()))

    def test_dropins_or_pending_reload_refuse_before_deadline_writes(self):
        with patch.object(units, 'fingerprint', side_effect=lambda path: (
             {'uid': 0, 'gid': 0, 'mode': 0o644}, self.reviewed_units()[path.name])), \
                patch.object(units, 'properties', return_value={'FragmentPath':'/wrong',
                    'DropInPaths':'/tmp/untrusted.conf','NeedDaemonReload':'yes'}):
            with self.assertRaisesRegex(ValueError, 'effective_unit_drift'):
                units.validate_unchanged_units()


if __name__ == '__main__':
    unittest.main()
