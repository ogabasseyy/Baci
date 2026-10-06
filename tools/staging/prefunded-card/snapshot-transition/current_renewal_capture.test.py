import hashlib
from pathlib import Path
import runpy
import sys
from types import ModuleType, SimpleNamespace
import tempfile
import unittest
import urllib.request
from unittest.mock import patch

import current_renewal_capture as collector
import snapshot_collector

FIXTURE = runpy.run_path(str(Path(__file__).with_name('snapshot_collector.test.py')))


def helpers():
    return {name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
            for name in collector.HELPERS}


class CurrentCaptureTests(unittest.TestCase):
    def test_complete_large_security_census_is_bounded_without_relaxing_normal_query_limits(self):
        payload = '{"security":"' + 'x' * 20_000_000 + '"}'
        self.assertEqual(len(collector.decode_capture(payload)['security']), 20_000_000)
        with patch.object(collector, 'CAPTURE_LIMIT', 32), self.assertRaises(ValueError):
            collector.decode_capture(payload)
        for invalid in ('{"key":1,"key":2}', '{"key":NaN}'):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                collector.decode_capture(invalid)

    def test_large_collector_transport_executes_only_the_source_rendered_readonly_query(self):
        runtime = SimpleNamespace(DOCKER=['/usr/bin/docker'], PSQL='/usr/bin/psql',
            ENVIRONMENT={'PATH': '/usr/bin'})
        modules = {'runtime_owner_support': runtime}
        statement = 'BEGIN READ ONLY; SELECT jsonb_build_object(); ROLLBACK;'
        with patch.object(collector, '_sources', return_value=(modules, b'', {})), \
                patch.object(collector, '_render', return_value=statement), \
                patch.object(collector.subprocess, 'run', return_value=SimpleNamespace(
                    returncode=0, stdout='{}')) as runner:
            self.assertEqual(collector.execute('/root/r8', phase='prestart', helper_pins={}), '{}')
        arguments, = runner.call_args.args
        self.assertEqual(arguments[-4:], ['-U', 'postgres', '-d', 'postgres'])
        self.assertIn('baci-isolated-savings-db-1', arguments)
        self.assertEqual(runner.call_args.kwargs['input'], statement)
        self.assertEqual(runner.call_args.kwargs['env'], runtime.ENVIRONMENT)
        self.assertEqual(runner.call_args.kwargs['timeout'], 40)

    def test_exact_standard_library_opener_is_valid_but_off_origin_functions_are_not(self):
        self.assertTrue(collector._function_origin(urllib.request.build_opener, set()))
        namespace = {'__file__': urllib.request.__file__}
        exec(compile('def build_opener(): return None', urllib.request.__file__, 'exec'), namespace)
        self.assertFalse(collector._function_origin(namespace['build_opener'], set()))

    def fixture(self, directory):
        root, modules, unused = FIXTURE['CollectorTests']().fixture(directory)
        sources = {
            'snapshot_binding_sql': "def identity_guard(): return \"IF current_user<>'postgres' THEN RAISE EXCEPTION 'refused'; END IF;\"\n"
                'def metadata_expression(): return "jsonb_build_object()"\n',
            'treasury_owner_io': 'def root_ancestors(path): pass\ndef private_directory(path): pass\n'
                'def read_file(path, owner, mode, limit): return path.read_bytes()\n',
            'runtime_owner_support': 'def database(sql): return "actual query result"\n',
            'treasury_owner_contract': 'SYSTEM=' + repr(collector.SYSTEM) + '\n',
            'release_contract': 'DEADLINE=' + repr(collector.DEADLINE) + '\n',
            'owner_database': 'ROLES=' + repr(collector.ROLES) + '\ndef private_json(path): return {}\n'}
        database = modules['database_sql']
        target = Path(database.__file__)
        target.write_text(target.read_text() + 'def _role_fingerprint(): return "SELECT \'actual fingerprint\'"\n')
        exec(compile(target.read_text(), str(target), 'exec'), vars(database))
        modules['protected_snapshot']._protected_state_expression = database._protected_state_expression
        for name, source in sources.items():
            target = root / collector.SOURCE_MODULES[name]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(source)
            module = ModuleType(name)
            module.__file__ = str(target)
            exec(compile(source, str(target), 'exec'), vars(module))
            modules[name] = module
        modules['snapshot_binding_sql'].protected_expression = modules['protected_snapshot'].protected_expression
        modules['owner_database']._role_fingerprint = database._role_fingerprint
        modules['owner_database'].database = modules['runtime_owner_support'].database
        import json
        files = {relative: hashlib.sha256((root / relative).read_bytes()).hexdigest()
                 for relative in collector.SOURCE_MODULES.values()}
        relative = 'tooling/card-week-renewal/sealed-source.json'
        files[relative] = hashlib.sha256((root / relative).read_bytes()).hexdigest()
        raw = json.dumps({'files': files}).encode()
        (root / 'financial-preparation.json').write_bytes(raw)
        return root, modules, hashlib.sha256(raw).hexdigest()

    def test_same_readonly_statement_captures_full_material_actual_metadata_and_original_roles(self):
        with tempfile.TemporaryDirectory() as directory:
            root, modules, seal = self.fixture(directory)
            with patch.object(collector, 'SEAL', seal), patch.object(snapshot_collector, 'SEAL', seal), \
                    patch.dict(sys.modules, modules):
                statement = collector.sql(root, phase='prestart', helper_pins=helpers())
        self.assertEqual(statement.count('BEGIN TRANSACTION'), 1)
        self.assertTrue(statement.endswith('ROLLBACK;\n'))
        for required in ('REPEATABLE READ READ ONLY', "'materialCanonical',state::text", "'metadata'",
                "'executorFingerprint'", 'rolconnlimit<>-1', 'pg_roles', "'capture'", "'sourceOrigins'",
                'FROM material CROSS JOIN bindings CROSS JOIN snapshots CROSS JOIN security',
                "IF current_user<>'postgres'"):
            self.assertIn(required, statement)
        for forbidden in ('INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'COMMIT;'):
            self.assertNotIn(forbidden, statement)

    def test_changed_or_foreign_executing_shared_modules_and_helper_bytes_refuse(self):
        for changed in ('module-path', 'module-bytes', 'function-origin', 'helper-pin', 'role-alias'):
            with tempfile.TemporaryDirectory() as directory:
                root, modules, seal = self.fixture(directory)
                pins = helpers()
                if changed == 'module-path':
                    modules['snapshot_binding_sql'].__file__ = '/copied/snapshot_binding_sql.py'
                elif changed == 'module-bytes':
                    Path(modules['snapshot_binding_sql'].__file__).write_text('changed')
                elif changed == 'function-origin':
                    namespace = {'__file__': '/unsealed/source.py'}
                    exec(compile('def metadata_expression(): return "unsafe"', namespace['__file__'], 'exec'), namespace)
                    modules['snapshot_binding_sql'].metadata_expression = namespace['metadata_expression']
                elif changed == 'helper-pin':
                    pins['snapshot_collector.py'] = '0' * 64
                else:
                    modules['owner_database']._role_fingerprint = lambda: 'fabricated'
                with patch.object(collector, 'SEAL', seal), patch.object(snapshot_collector, 'SEAL', seal), \
                        patch.dict(sys.modules, modules), self.subTest(changed=changed), self.assertRaises(ValueError):
                    collector.sql(root, phase='prestart', helper_pins=pins)

    def test_unknown_phase_and_incomplete_reviewed_helper_pins_refuse(self):
        for phase, pins in (("prestart'; COMMIT;", helpers()), ('prestart', {})):
            with self.subTest(phase=phase), self.assertRaises(ValueError):
                collector.sql('/root/r8', phase=phase, helper_pins=pins)


if __name__ == '__main__':
    unittest.main()
