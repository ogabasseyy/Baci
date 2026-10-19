import hashlib
import json
from pathlib import Path
import re

from cutover_runtime import require
from financial_quiescence import verify_financial_quiescence
from provider_preflight import (API_CUSTOMER, CONFIGURATION, CONFIGURATION_SHA, FILES as PROVIDER_FILES,
    checked_provider, fresh)
from receipt_provenance import (AUDIT, CUSTOMER, DESTINATION, DESTINATION_FAAS, ORIGINAL_PROOF,
    checked_native, collect_original_receipt)


FILES = PROVIDER_FILES | {'financial_quiescence.py', 'stopped_provider_preflight.py'}


def collect_stopped_provider(context, directory, pins):
    try:
        require(type(pins) is dict and set(pins) == FILES and all(type(pin) is str
            and re.fullmatch('[a-f0-9]{64}', pin) for pin in pins.values()), 'stopped_provider_refused')
        for name, pin in pins.items():
            raw = context.owner.read(Path(directory)/name, pin)
            require(type(raw) is bytes and hashlib.sha256(raw).hexdigest() == pin, 'stopped_provider_refused')
        before = verify_financial_quiescence(context)
        original = collect_original_receipt(context, Path(directory)/'receipt_report.sql', pins['receipt_report.sql'],
            Path(directory)/'receipt_crypto.cjs', pins['receipt_crypto.cjs'])
        require(original['receiptStorage']['status'] == 'processed', 'original_receipt_unprocessed')
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
            ['/usr/bin/node', str(Path(directory)/'provider_crosswalk.cjs')],
            input_text=json.dumps(request, separators=(',', ':')))))
        reports = {}
        for name in ('financial_report', 'background_preflight'):
            query = context.owner.read(Path(directory)/(name+'.sql'), pins[name+'.sql']).decode()
            report = json.loads(context.finance['database'](query))
            identity = report.get('appIdentity' if name == 'financial_report' else 'identity', {})
            require(identity.get('systemIdentifier') == '7685292944002592802'
                and identity.get('readOnly') is True, 'application_identity_refused')
            reports[name] = report
        after = verify_financial_quiescence(context)
        context.deadline()
        checked_provider(provider)
        fresh(original['receiptStorage']['observedAt'])
        fresh(original['provenance']['sourceProofObservedAt'])
        fresh(reports['financial_report']['observedAt'])
        fresh(reports['background_preflight']['capturedAt'])
        return dict(status='stopped-provider-and-application-readonly-verified', provider=provider,
            original=original, application=reports['financial_report'], background=reports['background_preflight'],
            quiescenceBefore=before, quiescenceAfter=after, financialActionAttempted=False, newPaymentStarted=False)
    except Exception:
        raise ValueError('stopped_provider_refused') from None
