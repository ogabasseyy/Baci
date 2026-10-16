"""Contracts for the optional synthetic PostgreSQL scanner diagnostic."""
import importlib.util
import json
import pathlib
import tempfile
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    'diagnostic', ROOT / '.github/scripts/semgrep-sarif-pg-diagnostic.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class DiagnosticTest(unittest.TestCase):
    def test_matrix_preserves_baseline_and_changes_one_timeout_at_a_time(self):
        cases = MODULE.fixture_cases()
        base = cases['local_baseline']
        self.assertIn("user: 'goal_policy_other'", base)
        self.assertNotIn('password:', base.split('new Client(')[1])
        for field in ['connectionTimeoutMillis', 'statement_timeout', 'query_timeout']:
            self.assertNotIn(field + ':', cases['without_' + field])
            self.assertEqual(base.replace(MODULE.TIMEOUTS[field], ''),
                             cases['without_' + field])
        self.assertIn('password: process.env.PG_DIAGNOSTIC_PASSWORD', cases['environment_password'])
        self.assertIn("password: 'synthetic-diagnostic-only'", cases['literal_password'])

    def test_scanner_arguments_and_secret_output_boundary(self):
        with tempfile.TemporaryDirectory() as directory:
            output = pathlib.Path(directory) / 'summary.json'
            def scan(arguments, **kwargs):
                self.assertEqual(arguments[:6], ['semgrep', 'scan', '--strict', '--pro-intrafile',
                                                '--config', 'auto'])
                self.assertNotIn('--metrics', arguments)
                self.assertNotIn('env', kwargs)  # existing CI token stays in inherited environment
                raw_path = pathlib.Path(arguments[arguments.index('--json-output') + 1])
                fixture = pathlib.Path(arguments[-1])
                raw_path.write_text(json.dumps({'results': [{
                    'check_id': 'javascript.pg.node-pg-hardcoded-secret.node-pg-hardcoded-secret',
                    'path': str(fixture), 'extra': {'severity': 'WARNING', 'message': 'DO_NOT_RETAIN'},
                }], 'errors': [], 'paths': {'scanned': arguments[arguments.index('--json-output') + 2:]}}))
                return type('Result', (), {'returncode': 0})()
            with patch.object(MODULE.subprocess, 'run', side_effect=scan):
                self.assertEqual(MODULE.run(output, pathlib.Path(directory)), 0)
            saved = output.read_text()
            self.assertNotIn('DO_NOT_RETAIN', saved)
            self.assertNotIn('password:', saved)
            self.assertNotIn('synthetic-diagnostic-only', saved)
            self.assertEqual(json.loads(saved)['missing_cases'], [])

    def test_incomplete_or_failed_analysis_is_not_diagnostic_success(self):
        for status in [{'errors': [{'type': 'PartialParsing', 'message': 'DO_NOT_RETAIN'}]},
                       {'paths': {'scanned': []}}]:
            with self.subTest(status=status), tempfile.TemporaryDirectory() as directory:
                output = pathlib.Path(directory) / 'summary.json'
                def scan(arguments, **kwargs):
                    raw_path = pathlib.Path(arguments[arguments.index('--json-output') + 1])
                    raw_path.write_text(json.dumps(status))
                    return type('Result', (), {'returncode': 0})()
                with patch.object(MODULE.subprocess, 'run', side_effect=scan):
                    self.assertEqual(MODULE.run(output, pathlib.Path(directory)), 1)
                self.assertNotIn('DO_NOT_RETAIN', output.read_text())
                self.assertFalse(json.loads(output.read_text())['rule_observed'])

    def test_arbitrary_scanner_metadata_never_enters_summary(self):
        sentinel = 'PRIVATE_METADATA_SENTINEL'
        for field in ['error.type', 'check_id', 'severity']:
            for payload in [sentinel, {'nested': sentinel}]:
                with self.subTest(field=field, payload=payload), tempfile.TemporaryDirectory() as directory:
                    output = pathlib.Path(directory) / 'summary.json'
                    def scan(arguments, **kwargs):
                        raw_path = pathlib.Path(arguments[arguments.index('--json-output') + 1])
                        finding = {'check_id': MODULE.RULE, 'path': arguments[-1], 'extra': {'severity': 'WARNING'}}
                        errors = []
                        if field == 'error.type':
                            errors = [{'type': payload}]
                        elif field == 'check_id':
                            finding['check_id'] = payload
                        else:
                            finding['extra']['severity'] = payload
                        raw_path.write_text(json.dumps({'results': [finding], 'errors': errors,
                            'paths': {'scanned': arguments[arguments.index('--json-output') + 2:]}}))
                        return type('Result', (), {'returncode': 0})()
                    with patch.object(MODULE.subprocess, 'run', side_effect=scan):
                        self.assertEqual(MODULE.run(output, pathlib.Path(directory)), 1)
                    self.assertNotIn(sentinel, output.read_text())
                    self.assertNotIn('nested', output.read_text())

    def test_scanner_failures_keep_exit_status_and_fixed_failure_kind(self):
        for outcome, report, expected_exit, kind in [
            (2, None, 2, 'missing_report'),
            (7, '{', 7, 'invalid_report'),
            (0, '[]', 0, 'invalid_metadata'),
            (OSError('PRIVATE_FAILURE'), None, None, 'launch_error'),
            (MODULE.subprocess.TimeoutExpired('PRIVATE_FAILURE', 300), None, None, 'timeout'),
        ]:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as directory:
                output = pathlib.Path(directory) / 'summary.json'
                def scan(arguments, **kwargs):
                    if isinstance(outcome, Exception):
                        raise outcome
                    if report is not None:
                        pathlib.Path(arguments[arguments.index('--json-output') + 1]).write_text(report)
                    return type('Result', (), {'returncode': outcome})()
                with patch.object(MODULE.subprocess, 'run', side_effect=scan):
                    self.assertEqual(MODULE.run(output, pathlib.Path(directory)), 1)
                saved = output.read_text()
                self.assertNotIn('PRIVATE_FAILURE', saved)
                summary = json.loads(saved)
                self.assertEqual(summary['scanner_exit_code'], expected_exit)
                self.assertEqual(summary['failure_kind'], kind)

    def test_workflow_requires_explicit_manual_input_and_preserves_full_scan(self):
        workflow = (ROOT / '.github/workflows/security.yml').read_text()
        self.assertIn("if: github.event_name == 'workflow_dispatch' && inputs.pg_diagnostics == true", workflow)
        self.assertIn('default: false', workflow)
        diagnostic = workflow.split('name: Diagnose PostgreSQL rule with synthetic fixtures', 1)[1].split('name: Upload synthetic PostgreSQL diagnostic', 1)[0]
        self.assertIn('SEMGREP_APP_TOKEN: ${{ secrets.SEMGREP_APP_TOKEN }}', diagnostic)
        self.assertIn('continue-on-error: true', diagnostic)
        self.assertNotIn('dump-config', diagnostic)
        self.assertNotIn('semgrep_full', diagnostic)
        self.assertNotIn('semgrep.sarif', diagnostic)
        self.assertIn('semgrep ci --no-suppress-errors --timeout 15 --sarif --output=semgrep.sarif --json-output=semgrep.raw.json', workflow)
        self.assertIn('semgrep scan --error --strict --pro-intrafile --config auto', workflow)
        self.assertLess(workflow.index('name: Upload synthetic PostgreSQL diagnostic'),
                        workflow.index('name: Run full Semgrep on scheduled and manual scans'))


if __name__ == '__main__':
    unittest.main()
