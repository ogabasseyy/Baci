import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
EVIDENCE = Path('/private/tmp/baci-complete-replay-focused-evidence-20261004.json')
RUNNER = Path('/private/tmp/baci-reviewed-replay-focused-20261004.json')


class EvidenceTests(unittest.TestCase):
    def setUp(self):
        specification = importlib.util.spec_from_file_location('start_evidence_seal', HERE / 'replay_start_seal.py')
        self.subject = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(self.subject)
        self.raw, self.runner_raw = EVIDENCE.read_bytes(), RUNNER.read_bytes()
        self.evidence, self.runner = json.loads(self.raw), json.loads(self.runner_raw)

    def validate_mutation(self, evidence=None, runner=None):
        evidence = copy.deepcopy(self.evidence if evidence is None else evidence)
        runner_raw = self.subject.encoded(self.runner if runner is None else runner)
        runner_pin = hashlib.sha256(runner_raw).hexdigest()
        evidence['runnerReportSha256'] = runner_pin
        raw = self.subject.encoded(evidence)
        with patch.object(self.subject, 'RUNNER_SHA', runner_pin), patch.dict(self.subject.FOCUSED,
                sha256=hashlib.sha256(raw).hexdigest()):
            self.subject.validate_focused(raw, runner_raw)

    def test_actual_retained_evidence_and_full_report_validate_exact_pins(self):
        self.subject.validate_focused(self.raw, self.runner_raw)
        self.assertEqual(len(self.runner['testResults']), 11)
        self.assertEqual(self.runner['numTotalTestSuites'], 12)
        self.assertEqual(len(self.evidence['sourcePins']), 47)

    def test_actual_file_byte_drift_refuses(self):
        for raw, runner in ((self.raw + b' ', self.runner_raw), (self.raw, self.runner_raw + b' ')):
            with self.assertRaises(ValueError):
                self.subject.validate_focused(raw, runner)

    def test_actual_readiness_adapter_accepts_exact_retained_evidence_and_full_report(self):
        sources = {name: (HERE / name).read_bytes() for name in self.subject.SOURCE_FILES}
        with patch.dict(sys.modules):
            for name in self.subject.MODULES:
                sys.modules.pop(name, None)
            modules = self.subject.load_modules(Path('/root/sealed-fixture/owner'), sources)
            adapter = modules['replay_start_readiness']
            seal = dict(files={'code/replay-daemon.mjs': self.evidence['daemonSha256'], 'config/config.json': 'b'*64},
                daemonArtifact=dict(productionTableSha256=self.subject.PRODUCTION_SHA))
            check = dict(status='bounded-candidate-readonly-check-passed', sealSha256=self.evidence['candidateSealSha256'],
                daemonSha256=self.evidence['daemonSha256'], outerConfigSha256='b'*64)
            result = adapter.validate_readiness(lambda path, digest: self.raw if path == Path(self.subject.FOCUSED['path'])
                else self.runner_raw, self.subject.FOCUSED, seal, check)
            self.assertTrue(result['focusedRunnerPassed'])
            self.assertEqual(result['focusedRunnerEvidenceSha256'], self.subject.FOCUSED['sha256'])

    def test_failed_pending_boolean_or_wrong_report_counts_refuse(self):
        for key, value in (('success', False), ('numPassedTests', 110), ('numFailedTests', 1),
                ('numPendingTests', 1), ('numTodoTests', 1), ('numTotalTests', True),
                ('numFailedTestSuites', 1), ('numTotalTestSuites', 11)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate_mutation(runner=dict(self.runner, **{key: value}))

    def test_every_result_and_assertion_must_pass_without_failure_messages(self):
        for change in ('file-status', 'assertion-status', 'failure', 'missing-file', 'renamed-file', 'snapshot'):
            runner = copy.deepcopy(self.runner)
            if change == 'file-status':
                runner['testResults'][0]['status'] = 'failed'
            elif change == 'assertion-status':
                runner['testResults'][0]['assertionResults'][0]['status'] = 'pending'
            elif change == 'failure':
                runner['testResults'][0]['assertionResults'][0]['failureMessages'] = ['failure']
            elif change == 'missing-file':
                runner['testResults'].pop()
            elif change == 'renamed-file':
                runner['testResults'][0]['name'] = '/unreviewed/test.ts'
            else:
                runner['snapshot']['failure'] = True
            with self.subTest(change=change), self.assertRaises(ValueError):
                self.validate_mutation(runner=runner)

    def test_production_table_scope_and_exact_evidence_schema_refuse_drift(self):
        for key, value in (('sourcePins', {}), ('sourcePins', self.evidence['sourcePins'][:-1]),
                ('sourceTableSha256', '9'*64), ('exitCode', True), ('allSuitesPassed', False),
                ('totalTests', 110), ('unexpected', True)):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.validate_mutation(evidence=dict(self.evidence, **{key: value}))


if __name__ == '__main__':
    unittest.main()
