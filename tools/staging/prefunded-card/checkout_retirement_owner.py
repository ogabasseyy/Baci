import fcntl
import json
import os
from pathlib import Path
import time

from checkout_retirement_contract import INTENT, digest, render_transaction, snapshot_sql, validate
from checkout_retirement_diagnostic import failure_diagnostic
from checkout_retirement_provider import active_configuration, verify_unconfirmed
from checkout_retirement_quiescence import quiet_background
from public_app_upgrade import OLD_MANIFEST_SHA256, recover_existing_runtime, upgrade
from runtime_owner_support import database, probe, save_exact
from treasury_owner_contract import DEADLINE, DEADLINE_EPOCH, Refused
from treasury_owner_io import private_directory, root_ancestors, write_private


AUDIT = Path('/var/lib/baci-checkout-retirement-20260929')


def stage(name):
    print(json.dumps(dict(stage=name)), flush=True)


def execute(directory):
    if os.geteuid() != 0 or time.time() >= DEADLINE_EPOCH:
        raise Refused('Root execution before the existing deadline required')
    root_ancestors(directory)
    private_directory(directory)
    root_ancestors(AUDIT)
    AUDIT.mkdir(mode=0o700, exist_ok=True)
    private_directory(AUDIT)
    descriptor = os.open(AUDIT / 'lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return execute_locked(directory)
    finally:
        os.close(descriptor)


def execute_locked(directory):
    current_stage = 'preflight'
    database_applied = False
    try:
        stage(current_stage)
        before = probe(snapshot_sql())
        retired = isinstance(before, dict) and before.get('phase') == 'retired_unconfirmed'
        if retired:
            database_applied = None
        validate(before, retired=retired)
        current_stage = 'existing-runtime-recovery'
        stage(current_stage)
        recover_existing_runtime(directory)
        current_stage = 'mounted-configuration-verification'
        stage(current_stage)
        secret, configuration_sha = active_configuration(OLD_MANIFEST_SHA256)
        if retired:
            current_stage = 'retirement-resume-verification'
            stage(current_stage)
            result = probe(f"""SELECT jsonb_build_object('retired',operation.checkout_retired,
              'recorded',EXISTS(SELECT 1 FROM prefunded_card.checkout_retirements WHERE operation_id=operation.id
                AND amount_kobo=10000 AND approval->'evidence'->>'operatorApproval'='retire-unconfirmed-test-checkout-v1'))
              FROM prefunded_card.operations operation WHERE id='{INTENT}';""")
            if result != {'retired': True, 'recorded': True}:
                raise Refused('Existing retirement proof differs')
            database_applied = True
            upgrade(directory)
            print(json.dumps(dict(status='already_retired', intentId=INTENT, newPaymentStarted=False,
                                  phoneReadyForNewPayment=False, deadline=DEADLINE)), flush=True)
            return
        current_stage = 'worker-quiescence'
        stage(current_stage)
        with quiet_background(stage):
            save_exact(AUDIT / 'before.json', before)
            evidence = verify_unconfirmed(secret, configuration_sha)
            current_stage = 'database-rehearsal'
            stage(current_stage)
            database(render_transaction(directory, before, evidence, rehearsal=True))
            current_stage = 'compatible-public-app-upgrade'
            stage(current_stage)
            upgrade(directory)
            current_stage = 'fresh-provider-verification'
            stage(current_stage)
            secret, verified_sha = active_configuration(OLD_MANIFEST_SHA256)
            if verified_sha != configuration_sha:
                raise Refused('Configuration changed during upgrade')
            evidence = verify_unconfirmed(secret, configuration_sha)
            sql = render_transaction(directory, before, evidence)
            attempt = str(time.time_ns())
            write_private(AUDIT / (attempt + '-approval.json'), json.dumps(evidence, sort_keys=True).encode())
            write_private(AUDIT / (attempt + '-apply.sql'), sql.encode())
            current_stage = 'database-apply-unconfirmed'
            stage(current_stage)
            database_applied = None
            result = json.loads(database(sql))
            if result != {'status': 'retired_unconfirmed', 'intentId': INTENT, 'releasedKobo': 10000}:
                raise Refused('Retirement acknowledgement differs')
            database_applied = True
            current_stage = 'postflight'
            stage(current_stage)
            after = probe(snapshot_sql())
            validate(after, retired=True)
            if after['protected'] != before['protected']:
                raise Refused('Protected financial state changed')
            report = dict(status='retired_unconfirmed', intentId=INTENT, releasedReservationKobo=10000,
                          preservedPrincipalKobo=10000, approvedTotalBudgetKobo=10000, collectionStatus='pending',
                          permanentlyFenced=True, newPaymentStarted=False, phoneReadyForNewPayment=False,
                          deadline=DEADLINE, sqlSha256=digest(sql.encode()))
            write_private(AUDIT / (attempt + '-result.json'), json.dumps(report, sort_keys=True).encode())
            current_stage = 'background-schedule-restore'
        print(json.dumps(report), flush=True)
    except Exception as error:
        print(json.dumps(dict(status='refused', stage=current_stage, databaseApplied=database_applied,
                              newPaymentStarted=False, phoneReadyForNewPayment=False, redacted=True,
                              **failure_diagnostic(error))), flush=True)
        raise


def main():
    try:
        execute(Path(__file__).resolve().parent)
    except Exception:
        raise SystemExit(1) from None
    print('STAGING_CHECKOUT_RETIRED', flush=True)


if __name__ == '__main__':
    main()
