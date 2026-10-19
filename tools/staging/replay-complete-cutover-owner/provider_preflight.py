from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
import tempfile

from cutover_context import Context
from cutover_runtime import require
from receipt_preflight import FILES as RECEIPT_FILES, receipt_preflight
from receipt_provenance import AUDIT, CUSTOMER, DESTINATION, DESTINATION_FAAS, ORIGINAL_PROOF, checked_native


API_CUSTOMER = '01M2T3PAHG3P5A32REX8MH3HD7'
CONFIGURATION = Path('/opt/baci-prefunded-replay-generations/native-m_xv_71j/config/prefunded.json')
CONFIGURATION_SHA = 'a2356c72a4dbf7e2651c518dc97652733a2699f9321e7a60b848c771cb92a6f0'
FILES = RECEIPT_FILES | {'provider_crosswalk.cjs', 'provider_json.cjs', 'provider_preflight.py',
                         'financial_report.sql', 'background_preflight.sql'}


def fresh(value):
    require(type(value) is str and re.fullmatch(
        r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', value), 'combined_report_stale')
    instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(0 <= (datetime.now(timezone.utc) - instant).total_seconds() <= 60, 'combined_report_stale')


def checked_provider(value):
    try:
        expected = dict(status='provider-crosswalk-readonly-verified', publicWalletId=DESTINATION,
            faasWalletId=DESTINATION_FAAS, apiCustomerId=API_CUSTOMER, providerCustomerId=CUSTOMER,
            nativeCustomerId=CUSTOMER, publicFaasMatches=True)
        require(type(value) is dict and set(value) == set(expected) | {'observedAt'}, 'provider_report_refused')
        require(all(type(value[name]) is type(item) and value[name] == item
                    for name, item in expected.items()), 'provider_report_refused')
        fresh(value['observedAt'])
        return value
    except Exception:
        raise ValueError('provider_report_refused') from None


def provider_preflight(context, directory, pins):
    require(type(pins) is dict and set(pins) == FILES and all(type(pin) is str
            and re.fullmatch(r'[a-f0-9]{64}', pin) for pin in pins.values()), 'provider_release_refused')
    for name, pin in pins.items():
        context.owner.read(Path(directory) / name, pin)
    context.deadline()
    original = receipt_preflight(context, directory, {name: pins[name] for name in RECEIPT_FILES})
    audit = context.owner.decode(context.owner.read(AUDIT, ORIGINAL_PROOF, limit=65536))
    event = context.owner.decode(audit['rawResponse'].encode())
    checked_native(event)
    configuration = context.owner.decode(context.owner.read(CONFIGURATION, CONFIGURATION_SHA, modes=(0o440,)))
    require(type(configuration) is dict and set(configuration) == {'database', 'evidence', 'scope'}
            and type(configuration['evidence']) is dict
            and type(configuration['evidence'].get('piggyvest')) is dict, 'provider_configuration_refused')
    request = dict(event=event, piggyvest=configuration['evidence']['piggyvest'],
                   executionDeadline='2026-10-06T15:59:10Z')
    provider = checked_provider(json.loads(context.finance['command'](
        ['/usr/bin/node', str(Path(directory) / 'provider_crosswalk.cjs')],
        input_text=json.dumps(request, separators=(',', ':')))))
    reports = {}
    for name in ('financial_report', 'background_preflight'):
        source = context.owner.read(Path(directory) / (name + '.sql'), pins[name + '.sql']).decode()
        report = json.loads(context.finance['database'](source))
        identity = report.get('appIdentity' if name == 'financial_report' else 'identity', {})
        require(identity.get('systemIdentifier') == '7685292944002592802'
                and identity.get('readOnly') is True, 'application_identity_refused')
        reports[name] = report
    context.deadline()
    checked_provider(provider)
    fresh(original['receipt']['receiptStorage']['observedAt'])
    fresh(original['receipt']['provenance']['sourceProofObservedAt'])
    fresh(reports['financial_report']['observedAt'])
    fresh(reports['background_preflight']['capturedAt'])
    return dict(status='provider-and-application-readonly-verified', provider=provider,
        original=original['receipt'], application=reports['financial_report'],
        background=reports['background_preflight'], financialActionAttempted=False, newPaymentStarted=False)


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2 and re.fullmatch(r'[a-f0-9]{64}', sys.argv[1]), 'provider_release_refused')
        context = Context()
        directory = Path(__file__).resolve().parent
        release = context.owner.decode(context.owner.read(directory / 'release.json', sys.argv[1]))
        require(set(release) == {'files', 'kind'} and release['kind'] == 'provider-readonly', 'provider_release_refused')
        result = provider_preflight(context, directory, release['files'])
        audit = Path(tempfile.mkdtemp(prefix='baci-provider-readonly-proof.', dir='/root'))
        context.journal(audit, 'provider-and-application', result)
        print(json.dumps(dict(status=result['status'], provider=result['provider'],
            receiptStatus=result['original']['receiptStorage']['status'],
            nativeEvidenceRows=len(result['application']['nativeApplication']['evidence']),
            backgroundPhase=result['background']['phase'], backgroundBlockers=result['background']['blockers'],
            financialActionAttempted=False, newPaymentStarted=False, auditDirectory=str(audit))))
    except Exception as error:
        print(json.dumps(dict(status='provider-readonly-refused', redacted=True,
            errorType=type(error).__name__, financialActionAttempted=False, newPaymentStarted=False)))
        raise SystemExit(1) from None
