import importlib.util
from datetime import datetime
from pathlib import Path


HERE = Path(__file__).resolve().parent
SPECIFICATION = importlib.util.spec_from_file_location('complete_prestart_contract', HERE / 'contract.py')
contract = importlib.util.module_from_spec(SPECIFICATION)
SPECIFICATION.loader.exec_module(contract)


def _seal(seal, reviewed_pin):
    contract.require(isinstance(seal, dict) and contract.hex_digest(reviewed_pin)
                     and contract.digest(seal) == reviewed_pin, 'candidate_seal_pin_refused')
    expected = dict(schemaVersion=1, status='source-candidate-inactive', expiresAt=contract.DEADLINE,
                    claimantGeneration=contract.GENERATION, appSystemId=contract.APP_SYSTEM,
                    receiptSystemId=contract.RECEIPT_SYSTEM, factoryScope=contract.FACTORY_SCOPE,
                    predecessorContainerId=contract.NATIVE_ID, competitorContainerId=contract.COMPETITOR_ID,
                    predecessorSealSha256=contract.PREDECESSOR_SEAL,
                    predecessorFiles=contract.PREDECESSOR_FILES,
                    daemonArtifact=contract.DAEMON_ARTIFACT,
                    fenceManifestSha256=contract.FENCE_MANIFEST_SHA256,
                    fencedBodySha256=contract.FENCED_BODY_SHA256,
                    automaticPredecessorRestartAllowed=False, unfencedSqlRollbackAllowed=False,
                    receiptCreditProved=False, runtimeStarted=False)
    contract.require(set(seal) == set(expected) | {'files', 'receiptTokenSha256', 'parentClaimProofSha256'}
                     and all(type(seal.get(name)) is type(value) and seal[name] == value
                             for name, value in expected.items()), 'candidate_authority_refused')
    files = seal['files']
    contract.require(isinstance(files, dict) and set(files) == set(contract.PREDECESSOR_FILES)
                     and all(contract.hex_digest(pin) for pin in files.values())
                     and all(files[name] == contract.PREDECESSOR_FILES[name] for name in (
                         'config/prefunded.json', 'code/prefunded-replay-bundle.mjs'))
                     and all(files[name] != contract.PREDECESSOR_FILES[name] for name in (
                         'config/config.json', 'code/replay-daemon.mjs'))
                     and files['code/replay-daemon.mjs'] == contract.COMPLETE_DAEMON_SHA256
                     and contract.hex_digest(seal['receiptTokenSha256'])
                     and contract.hex_digest(seal['parentClaimProofSha256']), 'candidate_file_set_refused')


def _fresh(evidence, now):
    try:
        timestamp = evidence['observedAt']
        contract.require(isinstance(timestamp, str) and timestamp.endswith('Z'), 'fresh_parent_evidence_required')
        observed = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        contract.require(0 <= (now - observed).total_seconds() <= 60, 'fresh_parent_evidence_required')
    except (ValueError, TypeError, KeyError):
        raise ValueError('fresh_parent_evidence_required') from None


def _attestation(value, expected, code):
    contract.require(isinstance(value, dict) and set(value) == set(expected)
                     and all(type(value[name]) is type(item) and value[name] == item
                             for name, item in expected.items()), code)


def _financial_proof(evidence, now):
    try:
        timestamp = evidence['financialProofObservedAt']
        contract.require(isinstance(timestamp, str) and timestamp.endswith('Z'),
                         'natural_attempt_financial_proof_required')
        observed = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        earliest = datetime.fromisoformat(contract.NATURAL_FINANCIAL_PROOF_AFTER.replace('Z', '+00:00'))
        contract.require(earliest <= observed <= now, 'natural_attempt_financial_proof_required')
    except (ValueError, TypeError, KeyError):
        raise ValueError('natural_attempt_financial_proof_required') from None


def validate_prestart(seal, reviewed_seal_sha256, evidence, reviewed_evidence_sha256):
    now = contract.instant()
    _seal(seal, reviewed_seal_sha256)
    contract.require(isinstance(evidence, dict) and contract.hex_digest(reviewed_evidence_sha256)
                     and contract.digest(evidence) == reviewed_evidence_sha256,
                     'parent_evidence_pin_refused')
    expected_fields = {'observedAt', 'candidateSealSha256', 'financialProofPassed', 'financialProofSha256',
        'financialProofObservedAt',
        'stoppedClaimantIds', 'allClaimPathsAccountedFor', 'claimRpcTransactions', 'processingReceipts',
        'predecessorFilesSha256', 'receiptStateBeforeSha256', 'receiptStateAfterSha256',
        'financialStateBeforeSha256', 'financialStateAfterSha256', 'retryStateBeforeSha256',
        'retryStateAfterSha256', 'deadline', 'fence', 'jwt', 'readiness'}
    contract.require(set(evidence) == expected_fields
                     and evidence['candidateSealSha256'] == reviewed_seal_sha256,
                     'parent_evidence_scope_refused')
    _fresh(evidence, now)
    contract.require(evidence['financialProofPassed'] is True
                     and contract.hex_digest(evidence['financialProofSha256']), 'financial_proof_required')
    _financial_proof(evidence, now)
    contract.require(evidence['stoppedClaimantIds'] == sorted([contract.NATIVE_ID, contract.COMPETITOR_ID])
                     and evidence['allClaimPathsAccountedFor'] is True
                     and all(type(evidence[name]) is int and evidence[name] == 0
                             for name in ('claimRpcTransactions', 'processingReceipts')),
                     'claimant_quiescence_refused')
    contract.require(evidence['predecessorFilesSha256'] == contract.digest(contract.PREDECESSOR_FILES),
                     'retained_predecessor_files_refused')
    for category in ('receipt', 'financial', 'retry'):
        before = evidence[category + 'StateBeforeSha256']
        after = evidence[category + 'StateAfterSha256']
        contract.require(contract.hex_digest(before) and before == after, 'protected_state_changed')
    deadline = dict(epoch=contract.EXPIRY, active=True, stopTarget=contract.CONTAINER,
                    effectiveUnitsVerified=True, timerSha256=contract.TIMER_SHA256,
                    stopperSha256=contract.STOPPER_SHA256)
    _attestation(evidence['deadline'], deadline, 'unchanged_effective_deadline_required')
    _attestation(evidence['fence'], dict(committed=True, bodySha256=contract.FENCED_BODY_SHA256,
                                       metadataUnchanged=True, oldTokenRefusedBeforeMutation=True),
                 'committed_claim_fence_required')
    _attestation(evidence['jwt'], dict(tokenSha256=seal['receiptTokenSha256'], signatureVerified=True,
                                     serverRoleAudienceVerified=True, serverGenerationVerified=True),
                 'server_generation_proof_required')
    readiness = evidence['readiness']
    flags = ('checkExitedZero', 'readOnly', 'prefundedFactoryLoaded', 'paidInterestReady', 'focusedRunnerPassed')
    contract.require(isinstance(readiness, dict) and set(readiness) == set(flags) | {
        'daemonSha256', 'outerConfigSha256', 'focusedRunnerEvidenceSha256'}
        and all(readiness[name] is True for name in flags)
        and readiness['daemonSha256'] == seal['files']['code/replay-daemon.mjs']
        and readiness['outerConfigSha256'] == seal['files']['config/config.json']
        and contract.hex_digest(readiness['focusedRunnerEvidenceSha256']), 'complete_readiness_refused')
    _fresh(evidence, contract.instant())
    return dict(status='parent-prestart-evidence-accepted-not-started', candidateSealSha256=reviewed_seal_sha256,
                parentEvidenceSha256=reviewed_evidence_sha256, runtimeStarted=False, receiptCreditProved=False)
