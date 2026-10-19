import copy
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
NOW = datetime(2026, 10, 3, 8, tzinfo=timezone.utc)


class PrestartTests(unittest.TestCase):
    def setUp(self):
        specification = importlib.util.spec_from_file_location('complete_prestart_tests', HERE / 'prestart.py')
        self.module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(self.module)
        self.contract = self.module.contract
        self.seal = dict(schemaVersion=1, status='source-candidate-inactive', expiresAt=self.contract.DEADLINE,
                         claimantGeneration=self.contract.GENERATION, appSystemId=self.contract.APP_SYSTEM,
                         receiptSystemId=self.contract.RECEIPT_SYSTEM, factoryScope=self.contract.FACTORY_SCOPE,
                         predecessorContainerId=self.contract.NATIVE_ID,
                         competitorContainerId=self.contract.COMPETITOR_ID,
                         predecessorSealSha256=self.contract.PREDECESSOR_SEAL,
                         predecessorFiles=dict(self.contract.PREDECESSOR_FILES),
                         daemonArtifact=dict(self.contract.DAEMON_ARTIFACT),
                         files={**self.contract.PREDECESSOR_FILES,
                                'code/replay-daemon.mjs': self.contract.COMPLETE_DAEMON_SHA256,
                                'config/config.json': '2' * 64},
                         receiptTokenSha256='3' * 64, parentClaimProofSha256='4' * 64,
                         fenceManifestSha256=self.contract.FENCE_MANIFEST_SHA256,
                         fencedBodySha256=self.contract.FENCED_BODY_SHA256,
                         automaticPredecessorRestartAllowed=False, unfencedSqlRollbackAllowed=False,
                         receiptCreditProved=False, runtimeStarted=False)
        self.seal_sha = self.contract.digest(self.seal)
        self.evidence = dict(observedAt=NOW.isoformat().replace('+00:00', 'Z'),
                             candidateSealSha256=self.seal_sha,
                             financialProofPassed=True, financialProofSha256='5' * 64,
                             financialProofObservedAt=NOW.isoformat().replace('+00:00', 'Z'),
                             stoppedClaimantIds=sorted([self.contract.NATIVE_ID, self.contract.COMPETITOR_ID]),
                             allClaimPathsAccountedFor=True, claimRpcTransactions=0, processingReceipts=0,
                             predecessorFilesSha256=self.contract.digest(self.contract.PREDECESSOR_FILES),
                             receiptStateBeforeSha256='6' * 64, receiptStateAfterSha256='6' * 64,
                             financialStateBeforeSha256='7' * 64, financialStateAfterSha256='7' * 64,
                             retryStateBeforeSha256='8' * 64, retryStateAfterSha256='8' * 64,
                             deadline=dict(epoch=self.contract.EXPIRY, active=True,
                                           stopTarget=self.contract.CONTAINER, effectiveUnitsVerified=True,
                                           timerSha256=self.contract.TIMER_SHA256,
                                           stopperSha256=self.contract.STOPPER_SHA256),
                             fence=dict(committed=True, bodySha256=self.contract.FENCED_BODY_SHA256,
                                        metadataUnchanged=True, oldTokenRefusedBeforeMutation=True),
                             jwt=dict(tokenSha256=self.seal['receiptTokenSha256'], signatureVerified=True,
                                      serverRoleAudienceVerified=True, serverGenerationVerified=True),
                             readiness=dict(daemonSha256=self.seal['files']['code/replay-daemon.mjs'],
                                            outerConfigSha256=self.seal['files']['config/config.json'],
                                            checkExitedZero=True, readOnly=True, prefundedFactoryLoaded=True,
                                            paidInterestReady=True, focusedRunnerPassed=True,
                                            focusedRunnerEvidenceSha256='9' * 64))

    def validate(self, evidence=None, seal=None):
        evidence = self.evidence if evidence is None else evidence
        seal = self.seal if seal is None else seal
        with patch.object(self.contract, 'datetime') as clock:
            clock.now.return_value = NOW
            return self.module.validate_prestart(seal, self.contract.digest(seal), evidence,
                                                  self.contract.digest(evidence))

    def test_complete_fresh_parent_evidence_is_accepted_without_starting(self):
        result = self.validate()
        self.assertEqual(result['status'], 'parent-prestart-evidence-accepted-not-started')
        self.assertFalse(result['runtimeStarted'])
        self.assertFalse(result['receiptCreditProved'])

    def test_half_capability_or_failed_real_runner_refuses(self):
        for field in ('prefundedFactoryLoaded', 'paidInterestReady', 'focusedRunnerPassed', 'readOnly'):
            with self.subTest(field=field):
                evidence = copy.deepcopy(self.evidence)
                evidence['readiness'][field] = False
                with self.assertRaisesRegex(ValueError, 'complete_readiness_refused'):
                    self.validate(evidence)

    def test_wrong_daemon_or_config_readiness_pin_refuses(self):
        for field in ('daemonSha256', 'outerConfigSha256'):
            with self.subTest(field=field):
                evidence = copy.deepcopy(self.evidence)
                evidence['readiness'][field] = '0' * 64
                with self.assertRaises(ValueError):
                    self.validate(evidence)

    def test_running_unknown_or_duplicate_claimant_and_inflight_lease_refuse(self):
        for field, value in (('stoppedClaimantIds', [self.contract.NATIVE_ID]),
                             ('stoppedClaimantIds', [self.contract.NATIVE_ID] * 2),
                             ('allClaimPathsAccountedFor', False), ('claimRpcTransactions', 1),
                             ('processingReceipts', 1), ('processingReceipts', False)):
            with self.subTest(field=field, value=value):
                evidence = copy.deepcopy(self.evidence)
                evidence[field] = value
                with self.assertRaisesRegex(ValueError, 'claimant_quiescence_refused'):
                    self.validate(evidence)

    def test_changed_retry_receipt_or_financial_state_refuses(self):
        for field in ('retryStateAfterSha256', 'receiptStateAfterSha256', 'financialStateAfterSha256'):
            with self.subTest(field=field):
                evidence = copy.deepcopy(self.evidence)
                evidence[field] = '0' * 64
                with self.assertRaisesRegex(ValueError, 'protected_state_changed'):
                    self.validate(evidence)

    def test_uncommitted_fence_changed_metadata_or_old_token_not_refused_blocks(self):
        for field in ('committed', 'metadataUnchanged', 'oldTokenRefusedBeforeMutation'):
            with self.subTest(field=field):
                evidence = copy.deepcopy(self.evidence)
                evidence['fence'][field] = False
                with self.assertRaisesRegex(ValueError, 'committed_claim_fence_required'):
                    self.validate(evidence)

    def test_missing_actual_server_authentication_evidence_refuses(self):
        for field in ('signatureVerified', 'serverRoleAudienceVerified', 'serverGenerationVerified'):
            with self.subTest(field=field):
                evidence = copy.deepcopy(self.evidence)
                evidence['jwt'][field] = False
                with self.assertRaisesRegex(ValueError, 'server_generation_proof_required'):
                    self.validate(evidence)

    def test_expired_or_future_evidence_refuses(self):
        for offset in (-61, 1):
            with self.subTest(offset=offset):
                evidence = copy.deepcopy(self.evidence)
                evidence['observedAt'] = (NOW + timedelta(seconds=offset)).isoformat().replace('+00:00', 'Z')
                with self.assertRaisesRegex(ValueError, 'fresh_parent_evidence_required'):
                    self.validate(evidence)

    def test_unfenced_rollback_or_predecessor_restart_seal_refuses(self):
        for field in ('automaticPredecessorRestartAllowed', 'unfencedSqlRollbackAllowed'):
            with self.subTest(field=field):
                seal = copy.deepcopy(self.seal)
                seal[field] = True
                with self.assertRaisesRegex(ValueError, 'candidate_authority_refused'):
                    self.validate(seal=seal)

    def test_changed_deadline_or_missing_financial_proof_refuses(self):
        evidence = copy.deepcopy(self.evidence)
        evidence['deadline']['epoch'] += 1
        with self.assertRaises(ValueError):
            self.validate(evidence)
        evidence = copy.deepcopy(self.evidence)
        evidence['financialProofPassed'] = False
        with self.assertRaises(ValueError):
            self.validate(evidence)

    def test_deadline_crossing_during_validation_refuses(self):
        with patch.object(self.contract, 'datetime') as clock:
            clock.now.side_effect = [NOW, datetime.fromtimestamp(self.contract.EXPIRY, timezone.utc)]
            with self.assertRaisesRegex(ValueError, 'fixed_deadline_expired'):
                self.module.validate_prestart(self.seal, self.seal_sha, self.evidence,
                                              self.contract.digest(self.evidence))

    def test_integer_one_cannot_replace_authentication_or_fence_boolean_evidence(self):
        for section, field in (('deadline', 'active'), ('deadline', 'effectiveUnitsVerified'),
                               ('fence', 'committed'), ('fence', 'metadataUnchanged'),
                               ('jwt', 'signatureVerified'), ('jwt', 'serverGenerationVerified')):
            with self.subTest(section=section, field=field):
                evidence = copy.deepcopy(self.evidence)
                evidence[section][field] = 1
                with self.assertRaises(ValueError):
                    self.validate(evidence)

    def test_changed_daemon_artifact_or_dependency_closure_seal_refuses(self):
        for name in self.contract.DAEMON_ARTIFACT:
            with self.subTest(name=name):
                seal = copy.deepcopy(self.seal)
                seal['daemonArtifact'][name] = '0' * 64
                with self.assertRaisesRegex(ValueError, 'candidate_authority_refused'):
                    self.validate(seal=seal)

    def test_financial_proof_before_actual_074526_utc_retry_or_in_future_refuses(self):
        for observed in ('2026-10-03T06:45:26Z', '2026-10-03T07:45:26.302324Z',
                         '2026-10-03T08:00:01Z', 'invalid'):
            with self.subTest(observed=observed):
                evidence = copy.deepcopy(self.evidence)
                evidence['financialProofObservedAt'] = observed
                with self.assertRaisesRegex(ValueError, 'natural_attempt_financial_proof_required'):
                    self.validate(evidence)

    def test_prestart_cannot_be_accepted_an_hour_before_actual_natural_retry(self):
        before = datetime(2026, 10, 3, 6, 45, 26, tzinfo=timezone.utc)
        evidence = copy.deepcopy(self.evidence)
        evidence['observedAt'] = before.isoformat().replace('+00:00', 'Z')
        with patch.object(self.contract, 'datetime') as clock:
            clock.now.return_value = before
            with self.assertRaises(ValueError):
                self.module.validate_prestart(self.seal, self.seal_sha, evidence,
                                              self.contract.digest(evidence))


if __name__ == '__main__':
    unittest.main()
