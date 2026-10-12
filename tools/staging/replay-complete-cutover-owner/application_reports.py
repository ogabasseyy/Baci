"""Assemble trusted collector outputs with explicit read-only/precommit contexts.

Original receipt cryptography, provider GET verification and pinned SQL collection
remain independent parent responsibilities. Synthetic test reports are not live
evidence. This module performs no provider action, database write or activation.
"""

from datetime import datetime, timezone
import json
from pathlib import Path
import re

from cutover_runtime import require
from financial_completion import (validate_completed, validate_native_evidence,
                                  validate_precommit, validate_native_precommit)
from financial_delta import BASELINE, _snapshot


BASELINE_PATH = Path('/root/baci-financial-owner.2ynkl9kc/claim-boundary-r3-9ase5n50/snapshot.sql')
IDENTITY = dict(systemIdentifier='7685292944002592802', sessionUser='postgres',
                currentUser='postgres', database='postgres', localUnix=True, readOnly=True)


def _checked_application(value, precommit=False):
    require(type(value) is dict and set(value) == {'schemaVersion', 'reportKind', 'observedAt',
        'appIdentity', 'nativeApplication', 'completedApplication'}, 'application_report_refused')
    require(type(value['schemaVersion']) is int and value['schemaVersion'] == 1
        and value['reportKind'] == 'application_financial_subreport', 'application_report_refused')
    identity = value['appIdentity']
    require(type(identity) is dict and set(identity) == set(IDENTITY)
        and all(type(identity[name]) is type(expected) and identity[name] == expected
                for name, expected in dict(IDENTITY, readOnly=not precommit).items()), 'application_identity_refused')
    _fresh(value['observedAt'])
    return value


def checked_application(value):
    return _checked_application(value)


def _instant(value):
    require(type(value) is str and re.fullmatch(
        r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', value), 'application_time_refused')
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def _fresh(value, latest=None):
    latest = latest or datetime.now(timezone.utc)
    require(0 <= (latest - _instant(value)).total_seconds() <= 60, 'application_time_refused')


def capture_application(context, sql_path, sql_pin, snapshot_path, snapshot_pin):
    query = context.owner.read(Path(sql_path), sql_pin).decode()
    source = context.owner.read(Path(snapshot_path), snapshot_pin).decode()
    original = context.owner.read(BASELINE_PATH, BASELINE).decode().rstrip().removesuffix(';')
    require(original in source, 'protected_snapshot_baseline_refused')
    report = checked_application(json.loads(context.finance['database'](query)))
    protected = json.loads(context.finance['database'](source))
    _snapshot(protected)
    require(protected.get('readOnly') is True, 'financial_snapshot_readonly_required')
    _fresh(report['observedAt'])
    context.deadline()
    return dict(application=report, protectedSnapshot=protected)


def _assemble_native(application, original, provider, precommit=False):
    application = _checked_application(application, precommit)
    require(type(original) is dict and set(original) == {'receiptStorage', 'provenance'},
            'original_receipt_report_refused')
    expected = {'status', 'observedAt', 'publicWalletId', 'faasWalletId', 'apiCustomerId',
                'providerCustomerId', 'nativeCustomerId', 'publicFaasMatches'}
    require(type(provider) is dict and set(provider) == expected
        and provider['status'] == 'provider-crosswalk-readonly-verified', 'provider_crosswalk_report_refused')
    _fresh(provider['observedAt'], _instant(application['observedAt']))
    native = application['nativeApplication']
    require(type(native) is dict and set(native) == {'scope', 'collection', 'evidence',
        'conflicts', 'applicationCrosswalk'}, 'application_native_report_refused')
    mappings = native['applicationCrosswalk']
    require(type(mappings) is list and len(mappings) == 1 and type(mappings[0]) is dict,
            'application_crosswalk_cardinality_refused')
    crosswalk = dict(mappings[0])
    require(provider['publicWalletId'] == crosswalk.get('publicWalletId')
        and provider['providerCustomerId'] == crosswalk.get('providerCustomerId'),
        'provider_application_crosswalk_mismatch')
    for name in ('faasWalletId', 'apiCustomerId', 'nativeCustomerId', 'publicFaasMatches'):
        require(name not in crosswalk, 'application_crosswalk_overlap_refused')
        crosswalk[name] = provider[name]
    result = dict(schemaVersion=1, proofKind='native_transfer_precommit' if precommit else 'native_transfer', observedAt=application['observedAt'],
        appIdentity=application['appIdentity'], scope=native['scope'], collection=native['collection'],
        evidence=native['evidence'], conflicts=native['conflicts'], crosswalk=crosswalk, **original)
    if precommit:
        result['financialCommitted'] = False
    (validate_native_precommit if precommit else validate_native_evidence)(result)
    _fresh(provider['observedAt'])
    _fresh(result['provenance']['sourceProofObservedAt'])
    _fresh(result['receiptStorage']['observedAt'])
    return result


def assemble_native(application, original, provider):
    return _assemble_native(application, original, provider)


def _assemble_completed(application, original, provider, precommit=False):
    native = _assemble_native(application, original, provider, precommit)
    completed = application['completedApplication']
    require(type(completed) is dict and not {'schemaVersion', 'proofKind', 'observedAt',
        'appIdentity', 'nativeEvidence'} & set(completed), 'application_completed_report_refused')
    result = dict(schemaVersion=1, proofKind='financial_precommit' if precommit else 'financial_completion',
        observedAt=application['observedAt'], appIdentity=application['appIdentity'],
        nativeEvidence=native, **completed)
    if precommit:
        require('financialCommitted' not in completed, 'application_completed_report_refused')
        result['financialCommitted'] = False
    (validate_precommit if precommit else validate_completed)(result)
    return result


def assemble_completed(application, original, provider):
    return _assemble_completed(application, original, provider)


def assemble_precommit(application: dict, original: dict, provider: dict) -> dict:
    return _assemble_completed(application, original, provider, precommit=True)
