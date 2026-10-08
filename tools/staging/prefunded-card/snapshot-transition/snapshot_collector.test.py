import hashlib
import json
from pathlib import Path
import sys
import tempfile
from types import ModuleType
import unittest
from unittest.mock import patch

import snapshot_collector as collector
from transition_constants import MODULES, SYSTEM, TABLES


class CollectorTests(unittest.TestCase):
    def fixture(self, directory):
        root = Path(directory).resolve()
        modules = {}
        sources = {'source_functions': 'APP_SYSTEM=' + repr(SYSTEM) + '\nSEALED={"reviewed":1}\n',
            'database_sql': 'def _protected_state_expression():\n    return "jsonb_build_object()"\n',
            'protected_snapshot': 'TABLES=' + repr(TABLES) + '\n'
                'def protected_expression():\n'
                '    return "jsonb_build_object(\'tables\',jsonb_build_object(),\'financial\'," + _protected_state_expression() + ")"\n'
                'def snapshot_sql():\n    return b"READ ONLY"\n'}
        files = {}
        for name in ('source_functions', 'database_sql', 'protected_snapshot'):
            target = root / MODULES[name]
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(sources[name])
            module = ModuleType(name)
            module.__file__ = str(target)
            if name == 'protected_snapshot':
                module._protected_state_expression = modules['database_sql']._protected_state_expression
            exec(compile(sources[name], str(target), 'exec'), vars(module))
            modules[name] = module
            files[MODULES[name]] = hashlib.sha256(target.read_bytes()).hexdigest()
        source = root / 'tooling/card-week-renewal/sealed-source.json'
        source.write_text('{"reviewed":1}')
        files[str(source.relative_to(root))] = hashlib.sha256(source.read_bytes()).hexdigest()
        raw = json.dumps({'files': files}).encode()
        (root / 'financial-preparation.json').write_bytes(raw)
        return root, modules, hashlib.sha256(raw).hexdigest()

    def test_readonly_single_transaction_capture_uses_exact_source_pins_and_all_catalog_layers(self):
        with tempfile.TemporaryDirectory() as directory:
            root, modules, seal = self.fixture(directory)
            with patch.object(collector, 'SEAL', seal), patch.dict(sys.modules, modules):
                sql = collector.sql(root, seal)
        self.assertTrue(sql.startswith('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;'))
        self.assertTrue(sql.endswith('ROLLBACK;\n'))
        for required in ('protectedFinancialSha256', 'financialCanonical', 'canonicalRows',
                'pg_control_system()', 'pg_roles', 'pg_auth_members', 'pg_policy', 'pg_trigger',
                'pg_constraint', 'pg_attribute', 'pg_index', 'pg_type', 'pg_enum', 'pg_range',
                'pg_rewrite', 'pg_default_acl', 'pg_get_functiondef', 'prosrc', 'COLLATE "C"',
                'FROM prefunded_card.treasury_snapshots snapshot', 'FROM prefunded_card.treasury_bindings binding'):
            self.assertIn(required, sql)
        for forbidden in ('INSERT ', 'UPDATE ', 'DELETE ', 'ALTER ', 'COMMIT;', 'SELECT *'):
            self.assertNotIn(forbidden, sql)

    def test_identical_module_bytes_loaded_from_other_root_are_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            root, modules, seal = self.fixture(directory)
            original = Path(modules['database_sql'].__file__)
            other = root / 'copied.py'
            other.write_bytes(original.read_bytes())
            modules['database_sql'].__file__ = str(other)
            with patch.object(collector, 'SEAL', seal), patch.dict(sys.modules, modules), \
                    self.assertRaisesRegex(ValueError, 'executing_source_refused'):
                collector.sql(root, seal)

    def test_complete_protected_expression_collects_all_21_full_table_hashes_in_same_statement(self):
        sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'financial-activation'))
        import protected_snapshot
        with patch.object(collector, '_modules', return_value=({'protected_snapshot': protected_snapshot}, {})):
            sql = collector.sql('/unused')
        for table in TABLES:
            self.assertIn('FROM ' + table + ' protected_row', sql)
        self.assertIn('to_jsonb(protected_row)::text', sql)
        self.assertEqual(sql.count('BEGIN TRANSACTION'), 1)
        self.assertEqual(sql.count('WITH material AS MATERIALIZED'), 1)

    def test_changed_manifest_module_source_or_loaded_contract_refuses(self):
        for changed in ('manifest', 'source', 'contract'):
            with tempfile.TemporaryDirectory() as directory:
                root, modules, seal = self.fixture(directory)
                if changed == 'manifest':
                    (root / 'financial-preparation.json').write_text('{}')
                elif changed == 'source':
                    Path(modules['database_sql'].__file__).write_text('changed')
                else:
                    modules['source_functions'].SEALED = {'unreviewed': True}
                with patch.object(collector, 'SEAL', seal), patch.dict(sys.modules, modules), self.assertRaises(ValueError):
                    collector.sql(root, seal)

    def test_stale_imported_function_origin_cannot_be_blessed_by_current_module_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root, modules, seal = self.fixture(directory)
            namespace = {'__file__': '/unsealed/database_sql.py'}
            exec(compile('def _protected_state_expression(): return "unsafe"', namespace['__file__'], 'exec'), namespace)
            modules['database_sql']._protected_state_expression = namespace['_protected_state_expression']
            with patch.object(collector, 'SEAL', seal), patch.dict(sys.modules, modules), \
                    self.assertRaisesRegex(ValueError, 'function_origin_refused'):
                collector.sql(root, seal)


if __name__ == '__main__':
    unittest.main()
