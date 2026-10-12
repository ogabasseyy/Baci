import copy
from pathlib import Path
import unittest
from unittest.mock import patch

import importlib.util


HERE = Path(__file__).resolve().parent


def load(name, filename):
    specification = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


RESUME = load('resume_history_fixture', HERE / 'public_resume.test.py')
PROJECTION = load('resume_projection_fixture', HERE.parent / 'existing-payment-projection' / 'projection_fence.test.py')


class Tests(unittest.TestCase):
    def setUp(self):
        self.host = RESUME.Host()
        before, after, report = PROJECTION.reminder_states()
        self.audit = dict(before=dict(protectedSnapshot=before),
            precommit=dict(report=report, protectedSnapshot=copy.deepcopy(after)))
        self.host.snapshot = after
        self.host.snapshot['readOnly'] = True
        self.host.report = copy.deepcopy(report)
        self.host.report.update(proofKind='financial_completion')
        del self.host.report['financialCommitted']
        self.host.report['appIdentity']['readOnly'] = True
        native = self.host.report['nativeEvidence']
        native.update(proofKind='native_transfer')
        del native['financialCommitted']
        native['appIdentity']['readOnly'] = True
        self.path = '/root/reviewed-public/precommit-audit.json'
        self.install_audit()
        pins = patch.multiple(RESUME.MODULE,
            MANIFEST_PIN=RESUME.digest(self.host.files[self.host.manifest_path]),
            UNIT_PIN=RESUME.digest(self.host.files[RESUME.UNIT]))
        pins.start()
        self.addCleanup(pins.stop)

    def install_audit(self):
        raw = RESUME.encoded(self.audit)
        self.host.files[self.path] = raw
        self.host.authority['notificationHistoryAudit'] = dict(path=self.path, sha256=RESUME.digest(raw))

    def test_authenticated_precommit_reminder_plus_contribution_resumes_public_only(self):
        result = self.host.resume()
        self.assertEqual(result['status'], 'public-service-resumed')
        self.assertEqual(self.host.start_count, 1)
        self.assertEqual(self.host.operations, [(['/usr/bin/systemctl', 'start', RESUME.MODULE.SERVICE], 30)])

    def test_unpinned_history_and_modified_audit_refuse_without_start(self):
        for missing in (True, False):
            with self.subTest(missing=missing):
                if missing:
                    authority = self.host.authority.pop('notificationHistoryAudit')
                else:
                    self.host.files[self.path] = b'foreign'
                self.assertEqual(self.host.resume()['status'], 'public-resume-refused')
                self.assertEqual(self.host.start_count, 0)
                if missing:
                    self.host.authority['notificationHistoryAudit'] = authority

    def test_missing_or_changed_preserved_reminder_refuses(self):
        relation = 'savings_notifications.events'
        for changed in (False, True):
            with self.subTest(changed=changed):
                original = copy.deepcopy(self.host.snapshot)
                witness = self.host.snapshot['allowedTargetWitnesses'][relation]
                index = next(index for index, row in enumerate(witness['targetRows']) if row['type'] == 'missed_contribution')
                if changed:
                    witness['targetRows'][index]['read_at'] = '2026-10-03T18:00:00Z'
                else:
                    witness['targetRows'].pop(index)
                    witness['targetRowColumnHashes'].pop(index)
                    witness['targetCount'] -= 1
                    self.host.snapshot['tableRows'][relation]['count'] -= 1
                self.assertEqual(self.host.resume()['status'], 'public-resume-refused')
                self.assertEqual(self.host.start_count, 0)
                self.host.snapshot = original

    def test_read_only_precommit_claim_or_treasury_drift_in_audit_refuses(self):
        for read_only in (True, False):
            with self.subTest(read_only=read_only):
                original = copy.deepcopy(self.audit)
                if read_only:
                    self.audit['precommit']['protectedSnapshot']['readOnly'] = True
                else:
                    self.audit['precommit']['report']['treasury']['consumedKobo'] = 0
                self.install_audit()
                self.assertEqual(self.host.resume()['status'], 'public-resume-refused')
                self.assertEqual(self.host.start_count, 0)
                self.audit = original

    def test_audit_wrong_metadata_refuses_before_start(self):
        self.host.metadata_change = self.path
        self.assertEqual(self.host.resume()['status'], 'public-resume-refused')
        self.assertEqual(self.host.start_count, 0)

    def test_audit_drift_after_start_stops_only_public_and_never_retries(self):
        original = self.host.run

        def changed(arguments, *, timeout):
            original(arguments, timeout=timeout)
            if arguments == ['/usr/bin/systemctl', 'start', RESUME.MODULE.SERVICE]:
                self.host.files[self.path] = b'foreign-audit'

        self.host.run = changed
        path = str(Path(__file__).resolve())
        self.host.files[path] = Path(path).read_bytes()
        self.host.authority['sources'][path] = RESUME.digest(self.host.files[path])
        result = self.host.resume()
        self.assertEqual(result['status'], 'public-resume-refused')
        self.assertTrue(result['ownedContainerStopped'])
        self.assertEqual((self.host.start_count, self.host.stop_count), (1, 1))


if __name__ == '__main__':
    unittest.main()
