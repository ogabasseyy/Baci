import copy
from datetime import datetime, timezone


def perform(adapter, *, capture, read_expected, validate, save, prove_unchanged,
            seal_manifest, clock=lambda: datetime.now(timezone.utc)):
    original = copy.deepcopy(adapter.payment_before)
    before = capture()
    prove_unchanged(original, before['protected'])
    save('original-protected-baseline', original)
    save('snapshot-before', before)
    started = clock().isoformat()
    adapter.run_once('snapshot')
    finished = clock().isoformat()
    after = capture()
    save('snapshot-after', after)
    outcome = adapter.passes['snapshot']['outcome']
    expected = read_expected()
    save('independent-snapshot-row', expected)
    receipt = validate(before, after, started_at=started, finished_at=finished,
        outcome=outcome, evidence_id=expected['evidence_id'], expected_snapshot=expected,
        seal_manifest=seal_manifest)
    save('snapshot-transition-proof', receipt)
    save('post-snapshot-protected-baseline', after['protected'])
    adapter.payment_before = copy.deepcopy(after['protected'])
    adapter.snapshot_transition_receipt = receipt
    return receipt
