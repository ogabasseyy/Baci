from datetime import datetime, timezone
import time

from protected_snapshot import prove_unchanged
from release_contract import DEADLINE, Refused, _require

DEADLINE_EPOCH = 1791302350
TIMERS = ('baci-prefunded-public-deadline.timer', 'baci-prefunded-deadline.timer',
          'baci-prefunded-replay-deadline.timer')
ROLES = ('prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence',
         'prefunded_snapshot_verifier')


def validate_prestart(evidence, seal_sha, now=None, phase='prestart'):
    now = time.time() if now is None else now
    _require(now < DEADLINE_EPOCH - 600, 'financial_activation_window_expired')
    _require(isinstance(evidence, dict) and evidence.get('sealSha256') == seal_sha,
             'financial_owner_evidence_seal_mismatch')
    try:
        observed = datetime.fromisoformat(evidence['observedAt'].replace('Z', '+00:00'))
        _require(observed.tzinfo is not None, 'financial_owner_evidence_stale')
        age = now - observed.astimezone(timezone.utc).timestamp()
    except (ValueError, KeyError, TypeError, AttributeError):
        raise ValueError('financial_owner_evidence_stale') from None
    _require(0 <= age <= 60, 'financial_owner_evidence_stale')
    _require(evidence.get('public') == {'archiveSha256':
        '882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2',
        'manifestSha256': '42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8',
        'getStatus': 200, 'enabled': False, 'maximumAmountKobo': 0,
        'postStatus': 503, 'patchStatus': 503, 'mutationsEnabled': False},
        'financial_public_default_deny_unproved')
    _require(phase in ('prestart', 'preschedule'), 'financial_owner_phase_refused')
    _require(evidence.get('financialContainersStopped') is (phase == 'prestart')
             and evidence.get('financialSchedulesStopped') is True,
             'financial_runtime_not_quiescent')
    if phase == 'preschedule':
        _require(evidence.get('freshReplayCompletedPass') is True,
                 'financial_replay_completed_pass_unproved')
    _require(evidence.get('replayConfigurationChecked') is True
             and evidence.get('jwtSignaturesVerified') is True
             and evidence.get('jwtExpiresAt') == DEADLINE
             and evidence.get('prefundedReplayPresent') is True
             and evidence.get('financialDatabaseAbsent') is True,
             'financial_replay_configuration_not_proved')
    _require(evidence.get('tlsReadiness') == {'status': 'restricted-tls-ready',
        'profiles': ['worker', 'authorizer', 'evidence'], 'readOnly': True,
        'cardPaymentsEnabled': False}
        and evidence.get('replayReadiness') == {'status': 'replay-runtime-ready', 'readOnly': True}
        and evidence.get('snapshotTlsIdentityVerified') is True,
        'financial_tls_readiness_not_proved')
    roles = evidence.get('roles', {})
    _require(set(roles) == set(ROLES) and all(row == {'expiresAt': DEADLINE,
        'passwordUnchanged': True, 'privilegesUnchanged': True, 'membershipUnchanged': True,
        'unsafe': False} for row in roles.values()), 'financial_role_fences_not_proved')
    _require(evidence.get('snapshotBinding') == {'expiresAt': DEADLINE,
        'identityUnchanged': True, 'immutableTriggerRestored': True},
        'financial_snapshot_binding_expired_or_unproved')
    timers = evidence.get('timers', {})
    _require(set(timers) == set(TIMERS) and all(row == {'active': True,
        'effectiveDeadline': DEADLINE, 'dropIns': [], 'needDaemonReload': False,
        'stopTargetsVerified': True} for row in timers.values()),
        'financial_effective_stop_timers_not_proved')
    _require(evidence.get('isolationContractsVerified') is True
             and evidence.get('separateSnapshotCredential') is True
             and evidence.get('sourceAndInstalledArtifactPinsVerified') is True,
             'financial_installation_contract_not_proved')
    _require(evidence.get('guardedRenewalCommitted') is True
             and evidence.get('rollbackRehearsalBoundToSql') is True
             and evidence.get('constraintsAndHistoryPreserved') is True,
             'financial_renewal_not_committed_or_unproved')
    prove_unchanged(evidence.get('protectedBefore'), evidence.get('protectedAfter'))
    return {'status': 'financial-prestart-gates-passed', 'mutationsEnabled': False,
            'financialStarted': False, 'newPaymentStarted': False, 'deadline': DEADLINE}


def activate_financial(adapter, seal_sha, now=time.time):
    _require(adapter.verify_seal(seal_sha) is True, 'financial_preparation_seal_unproved')
    validate_prestart(adapter.prestart_evidence(), seal_sha, now())
    started = False
    try:
        _require(now() < DEADLINE_EPOCH - 600, 'financial_activation_window_expired')
        started = True
        adapter.start_replay()
        _require(adapter.replay_completed_pass_is_fresh() is True,
                 'financial_replay_completed_pass_unproved')
        _require(now() < DEADLINE_EPOCH - 600, 'financial_activation_window_expired')
        adapter.run_independent_snapshot()
        _require(adapter.snapshot_pass_verified() is True, 'financial_snapshot_pass_unproved')
        _require(now() < DEADLINE_EPOCH - 600, 'financial_activation_window_expired')
        adapter.run_background_once()
        _require(adapter.background_pass_verified() is True, 'financial_background_pass_unproved')
        _require(adapter.protected_payment_state_unchanged() is True, 'financial_payment_state_changed')
        validate_prestart(adapter.preschedule_evidence(), seal_sha, now(), phase='preschedule')
        _require(now() < DEADLINE_EPOCH - 600, 'financial_activation_window_expired')
        adapter.schedule_workers()
        _require(adapter.schedules_and_deadlines_verified() is True,
                 'financial_schedules_or_deadlines_unproved')
        _require(now() < DEADLINE_EPOCH, 'financial_activation_window_expired')
        _require(adapter.public_mutations_disabled() is True, 'financial_public_mutations_changed')
        return {'status': 'financial-workers-ready-public-readonly', 'deadline': DEADLINE,
                'mutationsEnabled': False, 'newPaymentStarted': False}
    except BaseException as activation_error:
        if started:
            try:
                withdrawn = adapter.withdraw_financial_only()
            except BaseException as withdrawal_error:
                raise Refused('financial_withdrawal_unconfirmed') from withdrawal_error
            if withdrawn is not True:
                raise Refused('financial_withdrawal_unconfirmed') from activation_error
        raise
