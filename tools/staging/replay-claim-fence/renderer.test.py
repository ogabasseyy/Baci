import importlib.util
import inspect
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
SPECIFICATION = importlib.util.spec_from_file_location('claim_renderer_tests', HERE / 'renderer.py')
renderer = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(renderer)


class RendererTests(unittest.TestCase):
    def test_default_mode_is_rollback(self):
        self.assertEqual(inspect.signature(renderer.render_transaction).parameters['mode'].default,
                         'rollback')

    def test_guard_has_only_pinned_claim_and_expiry_literals(self):
        guard = renderer._guard()
        for expected in ('replay_claimant_generation', '1a420a7b-0c17-4312-84dc-d276a32f19f4',
                         'pvb_staging_worker', 'pvb-staging-receipts', '1791302350',
                         '2026-10-06T15:59:10Z', "'request.jwt.claims', true"):
            self.assertIn(expected, guard)
        self.assertNotIn('__', guard)
        for mutation in ('UPDATE ', 'INSERT ', 'DELETE ', 'GRANT ', 'REVOKE ', 'CREATE '):
            self.assertNotIn(mutation, guard)

    def test_unknown_now_generation_or_pin_overrides_refuse(self):
        for options in ({'now': 1}, {'generation': 'different'}, {'definition_sha256': '0' * 64}):
            with self.subTest(options=options):
                with self.assertRaises(TypeError):
                    renderer.render_transaction('', **options)

    def test_wrong_source_pin_cannot_render_a_transaction(self):
        for mode in ('rollback', 'commit'):
            with self.subTest(mode=mode):
                with self.assertRaisesRegex(ValueError, 'definition_pin_refused'):
                    renderer.render_transaction('unapproved source', mode=mode)


if __name__ == '__main__':
    unittest.main()
