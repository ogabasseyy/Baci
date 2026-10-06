import json
from pathlib import Path
import re
import sys
import tempfile

from cutover_context import Context
from cutover_preflight import preflight
from cutover_runtime import require
from receipt_provenance import collect_original_receipt


FILES = {'cutover_context.py', 'cutover_database.py', 'cutover_runtime.py',
         'cutover_probes.py', 'cutover_preflight.py', 'receipt_provenance.py',
         'receipt_report.sql', 'receipt_crypto.cjs', 'receipt_preflight.py'}


def receipt_preflight(context, directory, pins):
    require(type(pins) is dict and set(pins) == FILES, 'receipt_release_refused')
    for name, pin in pins.items():
        require(type(pin) is str and re.fullmatch(r'[a-f0-9]{64}', pin), 'receipt_release_refused')
        context.owner.read(Path(directory) / name, pin)
    runtime = preflight(context)
    receipt = collect_original_receipt(context, Path(directory) / 'receipt_report.sql',
        pins['receipt_report.sql'], Path(directory) / 'receipt_crypto.cjs', pins['receipt_crypto.cjs'])
    context.deadline()
    return dict(status='original-receipt-readonly-authenticated', runtime=runtime,
                receipt=receipt, financialActionAttempted=False, newPaymentStarted=False)


if __name__ == '__main__':
    try:
        require(len(sys.argv) == 2 and re.fullmatch(r'[a-f0-9]{64}', sys.argv[1]),
                'receipt_release_refused')
        context = Context()
        directory = Path(__file__).resolve().parent
        release = context.owner.decode(context.owner.read(directory / 'release.json', sys.argv[1]))
        require(set(release) == {'files', 'kind'} and release['kind'] == 'original-receipt-readonly',
                'receipt_release_refused')
        result = receipt_preflight(context, directory, release['files'])
        audit = Path(tempfile.mkdtemp(prefix='baci-original-receipt-proof.', dir='/root'))
        context.journal(audit, 'authenticated', result)
        print(json.dumps(dict(status=result['status'],
            receiptStatus=result['receipt']['receiptStorage']['status'],
            payloadSha256=result['receipt']['provenance']['payloadSha256'],
            hmacSha512Verified=result['receipt']['provenance']['hmacSha512Verified'],
            aeadVerified=result['receipt']['provenance']['aeadVerified'],
            fenceApplied=False, financialActionAttempted=False, newPaymentStarted=False,
            auditDirectory=str(audit))))
    except Exception as error:
        print(json.dumps(dict(status='original-receipt-readonly-refused', redacted=True,
            errorType=type(error).__name__, fenceApplied=False,
            financialActionAttempted=False, newPaymentStarted=False)))
        raise SystemExit(1) from None
