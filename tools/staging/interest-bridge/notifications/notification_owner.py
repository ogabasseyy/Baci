import argparse
import json
import os
from pathlib import Path

from notification_contract import CHECK, DEADLINE, OLD, SERVICE, TARGET, TIMER, UNIT_ROOT, Refused, ensure_window, validate_database
from notification_database import change_expiry, inspect_database
from notification_io import operation_lock, read_file, replace_file, run, verify_bundle, write_new
from notification_runtime import (
    SYSTEMCTL, preflight, quiescent, readonly_check, schedule, state,
    verify_deadline, verify_installed,
)


def database_sources(directory):
    return tuple(read_file(directory / name, 0o600).decode('utf-8') for name in
                 ('notification-renewal.sql', 'notification-state-query.sql', 'notification-role-guard.sql'))


def database_snapshot(command, sources, expiry):
    value = inspect_database(command, sources[1], sources[2])
    validate_database(value, expiry)
    return value


def rehearsal(command, sources):
    before = database_snapshot(command, sources, OLD)
    change_expiry(command, *sources)
    if database_snapshot(command, sources, OLD) != before:
        raise Refused('rehearsal-state-changed')
    return before


def backup_candidates(directory, originals, candidates):
    for name in ('original', 'candidate'):
        (directory / name).mkdir(mode=0o700)
    for path, content in originals.items():
        if path.startswith(UNIT_ROOT):
            basename = Path(path).name
            write_new(directory / 'original' / basename, content)
            write_new(directory / 'candidate' / basename, candidates.get(path, content))


def restore(command, sources, originals, candidates, credential, commit_attempted, install_attempted):
    failures = []
    for arguments in ([SYSTEMCTL, 'disable', '--now', TIMER], [SYSTEMCTL, 'stop', SERVICE, CHECK],
                      [SYSTEMCTL, 'disable', '--now', DEADLINE]):
        try:
            command(arguments)
        except Exception:
            failures.append('stop-or-disable-unconfirmed')
    try:
        for name in (TIMER, SERVICE, CHECK, DEADLINE):
            value = state(command, name)
            if value.get('ActiveState') != 'inactive' or value.get('SubState') != 'dead':
                raise Refused('recovery-not-quiescent')
    except Exception:
        failures.append('quiescence-unconfirmed')
    if failures:
        return failures
    if commit_attempted:
        try:
            value = inspect_database(command, sources[1], sources[2])
            expiry = value.get('role', {}).get('validUntil')
            validate_database(value, expiry)
            if expiry == TARGET:
                change_expiry(command, *sources, commit=True, restore=True)
            elif expiry != OLD:
                raise Refused('recovery-role-deadline')
            database_snapshot(command, sources, OLD)
        except Exception:
            failures.append('role-restore-unconfirmed')
    if install_attempted:
        try:
            for path, content in candidates.items():
                current = read_file(path, 0o444)
                if current == content:
                    replace_file(path, content, originals[path])
                elif current != originals[path]:
                    raise Refused('recovery-unit-drift')
            command([SYSTEMCTL, 'daemon-reload'])
            for path, content in originals.items():
                if read_file(path, 0o444) != content:
                    raise Refused('recovery-file-drift')
            if read_file('/etc/baci/piggyvest-staging/notifications/database-url', 0o600) != credential:
                raise Refused('recovery-credential-drift')
            quiescent(command)
        except Exception:
            failures.append('unit-restore-unconfirmed')
    return failures


def activate(directory, command=run):
    stage = 'preflight'
    committed = False
    install_attempted = False
    scheduling_attempted = False
    originals = candidates = credential = sources = None
    try:
        ensure_window()
        if any((directory / name).exists() for name in ('activation-attempt', 'activation-result.json', 'original', 'candidate')):
            raise Refused('retained-attempt-collision')
        sources = database_sources(directory)
        originals, candidates, credential = preflight(command)
        stage = 'rollback-rehearsal'
        before = rehearsal(command, sources)
        stage = 'backup-and-syntax-validation'
        backup_candidates(directory, originals, candidates)
        command(['/usr/bin/systemd-analyze', 'verify', *[str(directory / 'candidate' / Path(path).name)
                for path in originals if path.startswith(UNIT_ROOT)]])
        preflight(command)
        if database_snapshot(command, sources, OLD) != before:
            raise Refused('precommit-database-drift')
        ensure_window()
        write_new(directory / 'activation-attempt', b'expiry-only-commit-and-notification-schedule\n')
        stage = 'database-commit-unconfirmed'
        committed = None
        change_expiry(command, *sources, commit=True)
        committed = True
        renewed = database_snapshot(command, sources, TARGET)
        expected = json.loads(json.dumps(before))
        expected['role']['validUntil'] = TARGET
        if renewed != expected:
            raise Refused('independent-expiry-only-verification')
        stage = 'unit-installation'
        ensure_window()
        command([SYSTEMCTL, 'stop', DEADLINE])
        install_attempted = True
        for path, content in candidates.items():
            ensure_window()
            replace_file(path, originals[path], content)
        command([SYSTEMCTL, 'daemon-reload'])
        verify_installed(command, originals, candidates, credential)
        stage = 'readonly-tls-check'
        readonly_check(command)
        if database_snapshot(command, sources, TARGET) != renewed:
            raise Refused('readonly-check-mutated-database')
        verify_installed(command, originals, candidates, credential)
        stage = 'deadline-then-scheduling'
        scheduling_attempted = True
        schedule(command)
        ensure_window()
        database_snapshot(command, sources, TARGET)
        verify_installed(command, originals, candidates, credential)
        verify_deadline(command)
        report = dict(status='notifications-scheduled', databaseCommitted=True, expiry=TARGET,
                      rollbackRehearsalPassed=True, readOnlyTlsCheckPassed=True, deadlineVerified=True,
                      principalKobo=10000, passwordChanged=False, privilegesChanged=False,
                      notificationDeliveryMayHaveOccurred=True, phoneReceiptVerified=False)
    except Exception as error:
        failures = []
        if committed is not False:
            failures = restore(command, sources, originals, candidates, credential,
                               commit_attempted=True, install_attempted=install_attempted)
        report = dict(status='refused', stage=stage, databaseCommitted=committed,
                      error=str(error) if isinstance(error, Refused) else 'redacted-failure',
                      notificationDeliveryMayHaveOccurred=scheduling_attempted,
                      recoveryVerified=committed is False or not failures, recoveryFailures=failures)
    try:
        write_new(directory / 'activation-result.json', (json.dumps(report) + '\n').encode())
    except Exception:
        prior_report = report
        failures = []
        if committed is not False:
            failures = restore(command, sources, originals, candidates, credential,
                               commit_attempted=True, install_attempted=install_attempted)
        report = dict(status='refused', stage='audit-result-write', databaseCommitted=committed,
                      error='audit-result-unconfirmed', notificationDeliveryMayHaveOccurred=scheduling_attempted,
                      recoveryVerified=committed is False or not failures, recoveryFailures=failures,
                      priorReport=prior_report)
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description='Renew only the existing staging notification login and schedule.')
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--inspect', action='store_true')
    modes.add_argument('--rehearse', action='store_true')
    modes.add_argument('--activate', action='store_true')
    parser.add_argument('--bundle-sha256', required=True)
    arguments = parser.parse_args(argv)
    descriptor = None
    try:
        if os.geteuid() != 0:
            raise Refused('root-owner-required')
        directory = Path(__file__).absolute().parent
        verify_bundle(directory, arguments.bundle_sha256)
        if arguments.inspect:
            sources = database_sources(directory)
            value = inspect_database(run, sources[1], sources[2])
            validate_database(value, OLD)
            print(json.dumps(dict(status='readonly-baseline-verified', database=value)))
            return 0
        descriptor = operation_lock()
        if arguments.rehearse:
            preflight(run)
            rehearsal(run, database_sources(directory))
            report = dict(status='rehearsal-rolled-back', databaseCommitted=False, servicesStarted=False)
            write_new(directory / 'rehearsal-result.json', (json.dumps(report) + '\n').encode())
        else:
            report = activate(directory)
        print(json.dumps(report))
        return 0 if report['status'] != 'refused' else 1
    except Exception as error:
        print(json.dumps(dict(status='refused', error=str(error) if isinstance(error, Refused) else 'redacted-failure')))
        return 1
    finally:
        if descriptor is not None:
            os.close(descriptor)


if __name__ == '__main__':
    raise SystemExit(main())
