import unittest
from unittest.mock import Mock, patch

import replay_start_readiness as subject
from replay_rehearsal_owner import encoded


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        clock = patch.object(subject.database, '_now', return_value=subject._time('2026-10-04T12:00:00Z'))
        clock.start()
        self.addCleanup(clock.stop)
        self.sources = [dict(path='/source/production'+str(index)+'.ts', sha256='e'*64) for index in range(47)]
        table = subject.sha(encoded(self.sources))
        self.seal = dict(files={'code/replay-daemon.mjs': 'a'*64, 'config/config.json': 'b'*64},
            daemonArtifact=dict(productionTableSha256=table))
        self.full = dict(numTotalTestSuites=12, numPassedTestSuites=12, numFailedTestSuites=0,
            numPendingTestSuites=0, numTotalTests=111, numPassedTests=111, numFailedTests=0,
            numPendingTests=0, numTodoTests=0, success=True, snapshot=dict(failure=False), startTime=0,
            testResults=[dict(assertionResults=[dict(status='passed', failureMessages=[])
                for unused in range(11 if index == 0 else 10)], endTime=1, message='',
                name='/harness/src/test'+str(index)+'.test.ts', startTime=0, status='passed') for index in range(11)])
        self.full_raw = encoded(self.full)
        self.report = dict(kind='actual-focused-replay-runner', candidateSealSha256=subject.CANDIDATE_SEAL,
            daemonSha256='a'*64, sourceTableSha256=table, allSuitesPassed=True, exitCode=0,
            runnerReportSha256=subject.sha(self.full_raw), sourcePins=self.sources,
            passedSuitePaths=['src/test'+str(index)+'.test.ts' for index in range(11)],
            totalTests=111, observedAt='2026-10-04T12:00:00Z')
        self.check = dict(status='bounded-candidate-readonly-check-passed', sealSha256=subject.CANDIDATE_SEAL,
            daemonSha256='a'*64, outerConfigSha256='b'*64)

    def validate(self, report=None, check=None):
        raw = encoded(self.report if report is None else report)
        focused = dict(path='/root/reviewed/focused.json', sha256=subject.sha(raw))
        with patch.object(subject, 'FOCUSED', focused), patch.object(subject, 'REPORT_SHA256', subject.sha(self.full_raw)):
            return subject.validate_readiness(lambda path, pin: self.full_raw if path == subject.REPORT_PATH else raw,
                focused, self.seal, self.check if check is None else check)

    def test_actual_pinned_report_and_successful_check_derive_readiness(self):
        result = self.validate()
        self.assertTrue(result['focusedRunnerPassed'])
        self.assertEqual(result['focusedRunnerEvidenceSha256'], subject.sha(encoded(self.report)))

    def test_missing_evidence_never_becomes_a_fabricated_digest(self):
        reader = Mock()
        with self.assertRaisesRegex(ValueError, 'authenticated_focused'):
            subject.validate_readiness(reader, None, self.seal, self.check)
        reader.assert_not_called()

    def test_false_or_boolean_exit_and_test_counts_refuse(self):
        for name, value in (('allSuitesPassed', False), ('exitCode', True), ('exitCode', 1),
                ('totalTests', True), ('totalTests', 0), ('daemonSha256', 'f'*64), ('sourceTableSha256', 'f'*64)):
            report = dict(self.report, **{name: value})
            with self.subTest(name=name, value=value), self.assertRaises(ValueError):
                self.validate(report)

    def test_suite_loss_duplicates_and_unpinned_sources_refuse(self):
        for name, value in (('passedSuitePaths', self.report['passedSuitePaths'][:10]),
                ('passedSuitePaths', ['same']*11), ('sourcePins', {}), ('sourcePins', {'x': 'bad'}),
                ('observedAt', subject.DEADLINE), ('unexpected', True)):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.validate(dict(self.report, **{name: value}))

    def test_report_pin_mismatch_and_nonroot_path_refuse(self):
        for path, pin in (('/tmp/evidence', subject.sha(encoded(self.report))), ('/root/evidence', 'f'*64)):
            with self.assertRaises(ValueError):
                subject.validate_readiness(Mock(return_value=encoded(self.report)),
                    dict(path=path, sha256=pin), self.seal, self.check)

    def test_wrong_actual_check_or_seal_refuses(self):
        for check in ({}, dict(self.check, sealSha256='f'*64), dict(self.check, status='reported-ready')):
            with self.assertRaises(ValueError):
                self.validate(check=check)

    def test_duplicate_json_keys_refuse(self):
        raw = b'{"kind":1,"kind":2}'
        with self.assertRaises(ValueError):
            subject.validate_readiness(Mock(return_value=raw),
                dict(path='/root/evidence', sha256=subject.sha(raw)), self.seal, self.check)

    def test_full_report_failed_assertion_refuses_despite_passing_aggregate_counts(self):
        self.full['testResults'][0]['assertionResults'][0]['status'] = 'failed'
        self.full_raw = encoded(self.full)
        self.report['runnerReportSha256'] = subject.sha(self.full_raw)
        with self.assertRaises(ValueError):
            self.validate()

    def test_missing_file_and_wrong_full_report_hash_refuse(self):
        self.full['testResults'].pop()
        self.full_raw = encoded(self.full)
        self.report['runnerReportSha256'] = subject.sha(self.full_raw)
        with self.assertRaises(ValueError):
            self.validate()

    def test_production_table_digest_is_computed_from_all_47_rows(self):
        self.report['sourcePins'][0]['sha256'] = 'f'*64
        with self.assertRaises(ValueError):
            self.validate()


if __name__ == '__main__':
    unittest.main()
