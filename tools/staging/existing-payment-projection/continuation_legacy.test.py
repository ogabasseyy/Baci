import hashlib
import importlib.util
from pathlib import Path
import sys
from types import ModuleType
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import continuation_legacy as SUBJECT

SPEC = importlib.util.spec_from_file_location('actual_evidence_fixture', HERE/'continuation_evidence.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)


class ContinuationLegacyTests(unittest.TestCase):
    def test_actual_legacy_map_explicitly_contains_authenticated_readiness_and_guard_dependencies(self):
        inputs, original, namespace, read = FIXTURE.fixtures()
        required = {'financial_readiness_owner', 'application_reports', 'financial_delta',
            'cutover_context', 'provider_preflight', 'receipt_provenance', 'financial_quiescence',
            'worker_source_authority', 'projection_preflight', 'financial_reconcile_pass',
            'completion_snapshot', 'financial_completion', 'cutover_runtime'}
        with namespace.scope() as modules:
            self.assertLessEqual(required, set(modules))
            for name in required:
                self.assertIs(modules[name], sys.modules[name])
                self.assertEqual(modules[name].__file__, str(SUBJECT.ROOT/(name+'.py')))
            self.assertTrue(callable(modules['financial_readiness_owner']._locked))

    def test_authenticated_capture_and_exact_set_refuse_changed_release_bytes(self):
        inputs, original, namespace, read = FIXTURE.fixtures()
        with patch.object(SUBJECT, 'protected_bytes', side_effect=read):
            self.assertEqual(SUBJECT.capture(namespace.diagnostic), namespace.captured)
        namespace.diagnostic.authenticate_root = lambda: {}
        with patch.object(SUBJECT, 'protected_bytes', side_effect=read), self.assertRaises(ValueError):
            SUBJECT.capture(namespace.diagnostic)

    def test_shared_completion_module_uses_explicit_dual_source_pins_and_restores_outer(self):
        inputs, original, namespace, read = FIXTURE.fixtures()
        outer = ModuleType('completion_snapshot')
        outer.__file__ = str(HERE/'completion_snapshot.py')
        with patch.dict(sys.modules, {'completion_snapshot': outer}):
            instance = SUBJECT.Legacy(namespace.diagnostic, namespace.captured)
            outer_sources = {name+'.py': (HERE.parent/'replay-complete-cutover-owner'/(name+'.py')).read_bytes()
                for name in SUBJECT.SHARED}
            SUBJECT.verify_mapping(instance.captured, outer_sources)
            paths, finders = list(sys.path), list(sys.meta_path)
            for selected in ('normal', 'exception', 'normal-again'):
                try:
                    with instance.scope() as modules:
                        legacy = sys.modules['completion_snapshot']
                        self.assertIsNot(legacy, outer)
                        self.assertEqual(legacy.__file__, str(SUBJECT.ROOT/'completion_snapshot.py'))
                        if selected == 'exception':
                            raise RuntimeError('fixture refusal')
                except RuntimeError:
                    self.assertEqual(selected, 'exception')
                self.assertIs(sys.modules['completion_snapshot'], outer)
                self.assertEqual((sys.path, sys.meta_path), (paths, finders))
            outer_sources['completion_snapshot.py'] += b' '
            with self.assertRaises(ValueError):
                SUBJECT.verify_mapping(instance.captured, outer_sources)

    def test_unknown_ambient_legacy_module_refuses(self):
        inputs, original, namespace, read = FIXTURE.fixtures()
        foreign = ModuleType('cutover_context')
        with patch.dict(sys.modules, {'cutover_context': foreign}), self.assertRaises(ValueError):
            SUBJECT.Legacy(namespace.diagnostic, namespace.captured)

    def test_tampered_external_namespace_cannot_be_overwritten_silently(self):
        inputs, original, namespace, read = FIXTURE.fixtures()
        namespace.modules['owner_runtime'] = ModuleType('owner_runtime')
        with patch.dict(sys.modules, {'owner_runtime': ModuleType('owner_runtime')}), self.assertRaises(ValueError):
            with namespace.scope():
                self.fail('foreign external import admitted')

    def test_scope_rechecks_original_closure_before_import_use(self):
        inputs, original, namespace, read = FIXTURE.fixtures()
        original['completion_snapshot.py'] += b' '
        paths, finders = list(sys.path), list(sys.meta_path)
        with self.assertRaises(ValueError):
            with namespace.scope():
                self.fail('tampered source admitted')
        self.assertEqual((sys.path, sys.meta_path), (paths, finders))
        self.assertFalse(namespace.active)


if __name__ == '__main__':
    unittest.main()
