import importlib.util
from pathlib import Path
import unittest

from notification_contract import (
    CHECK, DEADLINE, OLD_EPOCH, PINS, ROUTINES, SERVICE, TARGET_EPOCH, UNIT_ROOT,
    Refused, candidate_units, ensure_window, validate_database, validate_effective, validate_routines,
)
from notification_database import expected_routines, expected_state


DIRECTORY = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('original_worker_contract', DIRECTORY.parents[1] / 'savings-engagement' / 'worker_contract.py')
LEGACY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LEGACY)


class NotificationContractTests(unittest.TestCase):
    def originals(self):
        result = {UNIT_ROOT + name: content for name, content in LEGACY.unit_files().items()}
        result.update({path: path.encode() for path in PINS if not path.startswith(UNIT_ROOT)})
        return result

    def test_observed_unit_pins_match_existing_immutable_contract(self):
        import hashlib
        for name, content in LEGACY.unit_files().items():
            self.assertEqual(hashlib.sha256(content).hexdigest(), PINS[UNIT_ROOT + name])

    def test_candidate_changes_expiry_and_retains_only_the_check_oneshot(self):
        from unittest.mock import patch
        originals = self.originals()
        with patch('notification_contract.digest', side_effect=lambda content: next(PINS[path] for path, value in originals.items() if value == content)):
            candidates = candidate_units(originals)
        self.assertEqual(set(candidates), {UNIT_ROOT + name for name in (SERVICE, CHECK, DEADLINE)})
        for name in (SERVICE, CHECK):
            restored = candidates[UNIT_ROOT + name].replace(str(TARGET_EPOCH).encode(), str(OLD_EPOCH).encode())
            if name == CHECK:
                self.assertEqual(restored.count(b'RemainAfterExit=yes\n'), 1)
                self.assertIn(b'RemainAfterExit=yes\n', restored.split(b'[Service]\n', 1)[1])
                restored = restored.replace(b'RemainAfterExit=yes\n', b'')
            else:
                self.assertNotIn(b'RemainAfterExit=', restored)
            self.assertEqual(restored, originals[UNIT_ROOT + name])
        self.assertEqual(candidates[UNIT_ROOT + DEADLINE].replace(b'2026-10-06', b'2026-09-29'), originals[UNIT_ROOT + DEADLINE])

    def test_wrong_predecessor_pin_refuses_before_candidates_exist(self):
        with self.assertRaisesRegex(Refused, 'predecessor-pin'):
            candidate_units(self.originals())

    def test_unsafe_role_missing_role_or_wrong_principal_refuses(self):
        for flag in ('inherit', 'superuser', 'bypassRls', 'createDb', 'createRole', 'replication'):
            value = expected_state('2026-09-29T15:59:10Z')
            value['role'][flag] = True
            value['routines'] = expected_routines()
            with self.subTest(flag=flag), self.assertRaisesRegex(Refused, 'unsafe-role'):
                validate_database(value)
        for key, wrong in (('role', {'exists': False}), ('principalKobo', 9999), ('otherEvents', 1)):
            value = expected_state('2026-09-29T15:59:10Z')
            value[key] = wrong
            value['routines'] = expected_routines()
            with self.subTest(key=key), self.assertRaises(Refused):
                validate_database(value)

    def test_exact_routine_body_and_acl_required(self):
        validate_routines(expected_routines())
        for key, wrong in (('bodyMd5', '0' * 32), ('acl', '{postgres=X/postgres,public=X/postgres}')):
            rows = expected_routines()
            rows[0][key] = wrong
            with self.subTest(key=key), self.assertRaisesRegex(Refused, 'routine-source-baseline'):
                validate_routines(rows)
        self.assertEqual(len(ROUTINES), 12)

    def test_dropins_or_reload_pending_refuse(self):
        baseline = dict(FragmentPath=UNIT_ROOT + SERVICE, LoadState='loaded', DropInPaths='', NeedDaemonReload='no', Transient='no', ActiveState='inactive', SubState='dead')
        validate_effective(SERVICE, baseline, True)
        for key, wrong in (('DropInPaths', '/etc/override.conf'), ('NeedDaemonReload', 'yes'), ('ActiveState', 'active')):
            with self.subTest(key=key), self.assertRaises(Refused):
                validate_effective(SERVICE, dict(baseline, **{key: wrong}), True)

    def test_expired_target_and_insufficient_safety_margin_refuse(self):
        ensure_window(OLD_EPOCH + 1)
        for instant in (OLD_EPOCH - 1, TARGET_EPOCH, TARGET_EPOCH - 180):
            with self.subTest(instant=instant), self.assertRaisesRegex(Refused, 'renewal-window'):
                ensure_window(instant)


if __name__ == '__main__':
    unittest.main()
