import hashlib
import importlib
import json
import os
from pathlib import Path
import sys
import tempfile

import financial_readiness_owner as readiness


KIND = 'financial-reconcile-existing-transfer-only'
CATALOG = 'a1443b22b5fb2573608c854baa4d02a8b2036a631c1b4163b940b1b1f7562b7d'
EXTRA_FILES = frozenset(('financial_reconcile_owner.py', 'financial_reconcile_pass.py',
    'worker_adapter.py', 'financial_snapshot.sql', 'completion_snapshot.py'))
FILES = readiness.FILES | EXTRA_FILES


def _require(condition):
    if not condition:
        raise ValueError('financial_reconcile_owner_refused')


def _origin(module, directory, name):
    _require(getattr(module, '__file__', None) == str(Path(directory)/(name+'.py')))


def _closure(directory, pin):
    release = readiness._decode(readiness._protected_read(directory/'release.json', pin))
    _require(type(release) is dict and set(release) == {'kind', 'files'} and release['kind'] == KIND)
    pins = release['files']
    _require(type(pins) is dict and set(pins) == FILES and all(readiness._pin(value) for value in pins.values()))
    captured = readiness._verify_files(directory, {name: pins[name] for name in readiness.FILES},
        readiness._protected_read)
    for name in EXTRA_FILES:
        raw = readiness._protected_read(directory/name, pins[name])
        _require(type(raw) is bytes and hashlib.sha256(raw).hexdigest() == pins[name])
        captured[name] = raw
    return pins, captured


def main(arguments=None):
    context, audit, stage, audit_recorded = None, None, 'sealed-inputs', False
    try:
        arguments = sys.argv[1:] if arguments is None else arguments
        _require(not sys.flags.optimize and os.geteuid() == 0 and len(arguments) == 1
            and readiness._pin(arguments[0]))
        directory = Path(__file__).resolve().parent
        pins, captured = _closure(directory, arguments[0])
        modules = readiness._load_modules(directory)
        readiness._canonical(captured, modules.get('natural_reclaim_authority'))
        executor = importlib.import_module('financial_reconcile_pass')
        adapter = importlib.import_module('worker_adapter')
        _origin(executor, directory, 'financial_reconcile_pass')
        _origin(adapter, directory, 'worker_adapter')
        _require(_closure(directory, arguments[0]) == (pins, captured))
        stage = 'verified-context'
        context = modules['cutover_context'].Context()
        audit = Path(tempfile.mkdtemp(prefix='baci-financial-reconciliation.', dir='/root'))
        os.chmod(audit, 0o700)
        _origin(executor, directory, 'financial_reconcile_pass')
        _origin(adapter, directory, 'worker_adapter')
        stage = 'finite-pass'
        result = executor.run_financial_reconcile_pass(context, directory,
            {name: pins[name] for name in FILES if name != 'financial_reconcile_owner.py'},
            reviewed_catalog_sha256=CATALOG)
        _require(type(result) is dict and type(result.get('summary')) is dict)
        summary = result['summary']
        _require(summary.get('status') in ('financial-reconcile-completed', 'financial-reconciliation-only')
            and type(summary.get('financialCompleted')) is bool and summary.get('newPaymentStarted') is False)
        context.journal(audit, 'finite-pass', result)
        audit_recorded = True
        _require(_closure(directory, arguments[0]) == (pins, captured))
        print(json.dumps(summary, sort_keys=True))
        return 0
    except Exception as failure:
        evidence = getattr(failure, 'private_evidence', None)
        if type(evidence) is dict and context is not None and audit is not None:
            try:
                context.journal(audit, 'refused-partial-pass', evidence)
                audit_recorded = True
            except Exception:
                pass
        print(json.dumps(dict(status='financial-reconcile-refused', stage=stage, redacted=True,
            financialActionAttempted=None if stage == 'finite-pass' else False,
            privateAuditRecorded=audit_recorded, newPaymentStarted=False)))
        return 1
    finally:
        if context is not None:
            try:
                os.close(context.lock)
            except (OSError, TypeError):
                pass


if __name__ == '__main__':
    raise SystemExit(main())
