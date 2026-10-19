import json
from pathlib import Path
import tempfile

from cutover_context import Context
from cutover_database import BODY, capture_snapshot
from cutover_probes import _credentials
from cutover_runtime import CONTAINER, NATIVE_ID, NATIVE_ROOT, NATIVE_SEAL, require


def preflight(context):
    context.verify_files()
    context.exclusive(NATIVE_ID)
    require(context.operator.find(CONTAINER) == NATIVE_ID, 'native_container_changed')
    native = context.operator.inspect(NATIVE_ID, NATIVE_ROOT, NATIVE_SEAL, name=CONTAINER)
    require(native['State']['Running'] is True, 'natural_native_retry_must_remain_running')
    require(context.competitor()['State']['Running'] is False, 'competing_claimant_running')
    tokens, proofs = context.credentials()
    _credentials(tokens, proofs)
    snapshot = capture_snapshot(context.database)
    require(snapshot['routine']['bodySha256'] == BODY, 'unexpected_fence_state')
    context.deadline()
    return dict(status='cutover-preflight-readonly-ready', receiptSystemId=snapshot['identity']['systemIdentifier'],
                oldNativeRunning=True, interestOnlyStopped=True, fixedDeadlineVerified=True,
                existingCredentialSignaturesVerified=True, fenceApplied=False,
                newRuntimeStarted=False, newPaymentStarted=False, snapshot=snapshot)


if __name__ == '__main__':
    try:
        context = Context()
        result = preflight(context)
        directory = Path(tempfile.mkdtemp(prefix='baci-cutover-preflight.', dir='/root'))
        context.journal(directory, 'preflight', result)
        print(json.dumps({name: value for name, value in result.items() if name != 'snapshot'}))
    except Exception as error:
        print(json.dumps(dict(status='cutover-preflight-refused', redacted=True,
                             errorType=type(error).__name__, fenceApplied=False,
                             newRuntimeStarted=False, newPaymentStarted=False)))
        raise SystemExit(1) from None
