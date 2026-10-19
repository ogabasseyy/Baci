import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile

import financial_readiness_owner as readiness


KIND = 'financial-project-existing-verified-transfer-only'
MODULES = ('financial_reconcile_pass', 'worker_adapter', 'projection_preflight', 'projection_pass', 'completion_snapshot')
EXTRA_FILES = frozenset(name+'.py' for name in MODULES) | {'financial_snapshot.sql', 'projection_owner.py'}
FILES = readiness.FILES | EXTRA_FILES


def _require(condition):
    if not condition:
        raise ValueError('projection_owner_refused')


def _closure(directory, seal):
    release = readiness._decode(readiness._protected_read(directory/'release.json', seal))
    _require(type(release) is dict and set(release) == {'kind', 'files'} and release['kind'] == KIND)
    pins = release['files']
    _require(type(pins) is dict and set(pins) == FILES and all(readiness._pin(pin) for pin in pins.values()))
    captured = readiness._verify_files(directory, {name: pins[name] for name in readiness.FILES},
        readiness._protected_read)
    for name in EXTRA_FILES:
        raw = readiness._protected_read(directory/name, pins[name])
        _require(type(raw) is bytes and hashlib.sha256(raw).hexdigest() == pins[name])
        captured[name] = raw
    return pins, captured


def main(arguments=None):
    context, audit, stage, recorded = None, None, 'sealed-inputs', False
    try:
        arguments = sys.argv[1:] if arguments is None else arguments
        _require(not sys.flags.optimize and os.geteuid() == 0 and len(arguments) == 1
            and readiness._pin(arguments[0]))
        directory = Path(__file__).resolve().parent
        pins, captured = _closure(directory, arguments[0])
        modules = readiness._load_modules(directory)
        readiness._canonical(captured, modules.get('natural_reclaim_authority'))
        executors = {name: importlib.import_module(name) for name in MODULES}
        for name, loaded in executors.items():
            _require(loaded.__file__ == str(directory/(name+'.py')))
        executor = executors['projection_pass']
        _require(executor.FILES == FILES-{'projection_owner.py'})
        _require(_closure(directory, arguments[0]) == (pins, captured))
        stage = 'verified-context'
        context = modules['cutover_context'].Context()
        audit = Path(tempfile.mkdtemp(prefix='baci-existing-payment-projection.', dir='/root'))
        os.chmod(audit, 0o700)
        stage = 'projection-only-pass'
        result = executor.run_projection_pass(context, directory,
            {name: pins[name] for name in FILES if name != 'projection_owner.py'})
        context.journal(audit, 'projection-pass', result)
        recorded = True
        _require(type(result) is dict and type(result.get('summary')) is dict)
        summary = result['summary']
        _require(summary.get('status') == 'existing-payment-financially-completed'
            and summary.get('financialCompleted') is True and summary.get('newPaymentStarted') is False)
        _require(_closure(directory, arguments[0]) == (pins, captured))
        print(json.dumps(summary, sort_keys=True))
        return 0
    except Exception as failure:
        evidence = getattr(failure, 'private_evidence', None)
        if not recorded and type(evidence) is dict and context is not None and audit is not None:
            try:
                context.journal(audit, 'refused-partial-projection', evidence)
                recorded = True
            except Exception:
                pass
        print(json.dumps(dict(status='existing-payment-projection-refused', stage=stage, redacted=True,
            financialActionAttempted=None if stage == 'projection-only-pass' else False,
            privateAuditRecorded=recorded, newPaymentStarted=False)))
        return 1
    finally:
        if context is not None:
            try:
                os.close(context.lock)
            except (OSError, TypeError):
                pass


if __name__ == '__main__':
    raise SystemExit(main())
