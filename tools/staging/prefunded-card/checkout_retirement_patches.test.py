from pathlib import Path
import tempfile
import unittest

from checkout_retirement_patches import definitions, render_patches


class PatchTests(unittest.TestCase):
    def test_exact_baselines_and_acl_oid_checks_are_required_for_every_patch(self):
        directory = Path(__file__).parent
        patches = definitions(directory)
        self.assertEqual(len(patches), 11)
        rendered = render_patches(directory)
        self.assertEqual(rendered.count('retirement function baseline differs:'), 11)
        self.assertEqual(rendered.count('proacl IS NOT DISTINCT FROM before_acl'), 11)
        self.assertIn('reserve_pre_treasury_guard', rendered)
        self.assertNotIn('CREATE OR REPLACE FUNCTION prefunded_card.reserve(', rendered)
        with self.assertRaises(ValueError):
            render_patches(directory, owner='untrusted')

    def test_ambiguous_source_does_not_silently_broaden_patch(self):
        source = (Path(__file__).parent / 'storage.sql').read_text()
        with tempfile.TemporaryDirectory() as folder:
            changed = Path(folder) / 'storage.sql'
            changed.write_text(source + '\n' + source)
            with self.assertRaisesRegex(ValueError, 'source differs'):
                definitions(Path(folder))


if __name__ == '__main__':
    unittest.main()
