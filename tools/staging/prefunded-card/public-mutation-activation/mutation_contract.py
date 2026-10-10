from datetime import datetime, timezone
import math
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'financial-activation'))
sys.path.insert(0, str(HERE.parent.parent / 'interest-bridge/activation'))
from release_contract import DEADLINE, HEX, Refused, _require
from owner_public import GOAL
from owner_public_artifacts import ARCHIVE, MANIFEST
from protected_snapshot import prove_unchanged

EPOCH = 1791302350
FLAG = 'PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED'
AUDIT = '/root/baci-financial-owner.2ynkl9kc'
INTENT = 'd8bcf921-61b3-4647-90e2-5648e4d6967d'
FINANCIAL_SEAL = 'c78ef2d125ad8019508cfced9e19d730848184c528b7a33c68d42c782418b086'


def window(now):
    _require(type(now) in (int, float) and math.isfinite(now)
             and 0 < now < EPOCH - 600, 'public_mutation_window_refused')


def fresh(timestamp, now, maximum=60):
    try:
        observed = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
        _require(observed.tzinfo is not None, 'public_mutation_evidence_stale')
        age = now - observed.astimezone(timezone.utc).timestamp()
        _require(0 <= age <= maximum, 'public_mutation_evidence_stale')
    except (AttributeError, ValueError, TypeError):
        raise Refused('public_mutation_evidence_stale') from None


def financial_report(value):
    _require(isinstance(value, dict) and value == {
        'status': 'financial-workers-ready-public-readonly', 'deadline': DEADLINE,
        'mutationsEnabled': False, 'newPaymentStarted': False},
        'actual_financial_activation_report_required')


def validate(evidence, seal, baseline, now):
    window(now)
    _require(isinstance(evidence, dict), 'public_mutation_evidence_required')
    _require(seal == FINANCIAL_SEAL, 'public_mutation_r8_financial_seal_required')
    _require(evidence.get('sealSha256') == seal, 'public_mutation_seal_mismatch')
    fresh(evidence.get('observedAt'), now)
    financial_report(evidence.get('financialReport'))
    _require(evidence.get('public') == {
        'archiveSha256': ARCHIVE, 'manifestSha256': MANIFEST, 'getStatus': 200,
        'enabled': False, 'maximumAmountKobo': 0, 'postStatus': 503,
        'patchStatus': 503, 'mutationsEnabled': False}, 'public_mutation_default_deny_required')
    _require(evidence.get('runtime') == {
        'status': 'activated-runtime-current', 'deadline': DEADLINE,
        'replay': 'fresh-completed-pass', 'snapshot': 'fresh-completed-pass',
        'background': 'fresh-completed-pass', 'schedules': ['snapshot', 'background']},
        'public_mutation_current_runtime_required')
    _require(evidence.get('restricted') == {
        'tlsReadiness': {'status': 'restricted-tls-ready',
            'profiles': ['worker', 'authorizer', 'evidence'], 'readOnly': True,
            'cardPaymentsEnabled': False},
        'replayReadiness': {'status': 'replay-runtime-ready', 'readOnly': True},
        'replayConfigurationChecked': True, 'snapshotTlsIdentityVerified': True},
        'public_mutation_restricted_checks_required')
    _require(evidence.get('publicPrivate') == {'status': 'public-private-ready',
        'customerTlsVerified': True, 'verifierTlsVerified': True, 'httpStarted': False},
        'public_mutation_private_launch_check_required')
    _require(evidence.get('chainSha256') == evidence.get('approvedChainSha256')
             and isinstance(evidence.get('chainSha256'), str)
             and HEX.fullmatch(evidence['chainSha256']), 'public_mutation_full_chain_drift')
    prove_unchanged(baseline, evidence.get('protectedBefore'))
    prove_unchanged(baseline, evidence.get('protectedAfter'))


def enabled_capability(value):
    status, body = value
    _require(status == 200 and body == {'goalId': GOAL, 'enabled': True,
        'maximumAmountKobo': 10000, 'currency': 'NGN'}, 'public_mutation_capability_unproved')
