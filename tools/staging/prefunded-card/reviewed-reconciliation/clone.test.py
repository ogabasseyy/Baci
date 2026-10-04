import unittest

from clone import ALLOWED, EARLY_RETURN, HEADER, reviewed_clone
from test_support import SOURCE, fixture_pin


class CloneTests(unittest.TestCase):
    def test_only_two_phase_checks_header_and_approval_guard_change(self):
        with fixture_pin()[1]:
            changed = reviewed_clone(SOURCE)
        restored = changed.replace('CREATE OR REPLACE FUNCTION pg_temp.reviewed_promote_collection(', HEADER)
        restored = restored.replace('\nBEGIN\n  PERFORM pg_temp.reviewed_approval_guard(p_scope,p_selection,p_collection);\n', '\nBEGIN\n')
        restored = restored.replace("intent.phase NOT IN ('initializing','ready','pending','reconciliation_required')", ALLOWED)
        restored = restored.replace('  IF ' + ALLOWED, EARLY_RETURN + '  IF ' + ALLOWED)
        self.assertEqual(restored, SOURCE)

    def test_wrong_source_and_duplicate_anchors_refuse(self):
        with self.assertRaisesRegex(ValueError, 'original_source_pin'):
            reviewed_clone(SOURCE)
        duplicate = SOURCE + EARLY_RETURN
        with fixture_pin(duplicate)[1], self.assertRaisesRegex(ValueError, 'clone_exact_anchors'):
            reviewed_clone(duplicate)


if __name__ == '__main__':
    unittest.main()
