"""Bounded source/profile checks and fixed truthful owned-transaction inspection."""

import hashlib
import json
import stat
import time

from continuation_release import require


def guard(context, diagnostic, modules, transaction=None, drain=None, started=None):
    started = time.monotonic() if started is None else started
    context.deadline()
    modules['financial_readiness_owner']._locked(context)
    require(context.exclusive() is True and context.verify_files() is True)
    quiet, authority = modules['financial_quiescence'], modules['worker_source_authority']
    image, worker = diagnostic.inspect(diagnostic.IMAGE), diagnostic.inspect(diagnostic.WORKER)
    authority._profile(worker, image)
    require(worker['State']['ExitCode'] == 1 and worker['State']['OOMKilled'] is False)
    native = context.operator.inspect(quiet.NATIVE_ID, quiet.NATIVE_ROOT, quiet.NATIVE_SEAL,
        name='pvb-staging-replay-prefunded')
    quiet._stopped(native, quiet.NATIVE_ID, 'pvb-staging-replay-prefunded')
    quiet._stopped(context.competitor(), quiet.COMPETITOR_ID, 'baci-interest-replay')
    for name, identifier in quiet.STOPPED.items():
        if identifier != diagnostic.WORKER:
            quiet._stopped(diagnostic.inspect(identifier), identifier, name)
    for name in quiet.UNITS:
        if name != 'baci-prefunded-background.service':
            quiet._unit(context, name)
    unit = diagnostic.worker_unit()
    raw = diagnostic.read_regular(diagnostic.CONFIGURATION, 65532, 131072)
    info = diagnostic.CONFIGURATION.lstat()
    require(hashlib.sha256(raw).hexdigest() == diagnostic.CONFIGURATION_SHA
        and info.st_gid == 65532 and stat.S_IMODE(info.st_mode) == 0o600)
    if transaction is None:
        observed = json.loads(context.finance['database'](quiet.DRAIN_SQL))
        require(type(observed) is dict and set(observed) == set(quiet.IDENTITY)
            and all(type(observed[key]) is type(value) and observed[key] == value
                for key, value in quiet.IDENTITY.items()))
    else:
        require(time.monotonic() - started < 8 and drain is not None)
        drain.verify()
        require(time.monotonic() - started < 10)
    context.deadline()
    modules['financial_readiness_owner']._locked(context)
    return dict(worker=worker, unit=unit)


def provenance(context, modules, directory, pins):
    receipt, provider = modules['receipt_provenance'], modules['provider_preflight']
    original = receipt.collect_original_receipt(context, directory/'receipt_report.sql',
        pins['receipt_report.sql'], directory/'receipt_crypto.cjs', pins['receipt_crypto.cjs'])
    require(original['receiptStorage']['status'] == 'processed')
    audit = context.owner.decode(context.owner.read(receipt.AUDIT, receipt.ORIGINAL_PROOF, limit=65536))
    event = context.owner.decode(audit['rawResponse'].encode())
    receipt.checked_native(event)
    configuration = context.owner.decode(context.owner.read(provider.CONFIGURATION,
        provider.CONFIGURATION_SHA, modes=(0o440,)))
    require(type(configuration) is dict and set(configuration) == {'database', 'evidence', 'scope'}
        and type(configuration['evidence']) is dict
        and type(configuration['evidence'].get('piggyvest')) is dict)
    request = dict(event=event, piggyvest=configuration['evidence']['piggyvest'],
        executionDeadline='2026-10-06T15:59:10Z')
    observed = provider.checked_provider(json.loads(context.finance['command'](
        ['/usr/bin/node', str(directory/'provider_crosswalk.cjs')],
        input_text=json.dumps(request, separators=(',', ':')))))
    provider.fresh(original['receiptStorage']['observedAt'])
    provider.fresh(original['provenance']['sourceProofObservedAt'])
    return original, observed
