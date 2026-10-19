"""Pinned retained evidence; no live collection or repair execution."""

import copy
from datetime import datetime, timezone
import hashlib
from pathlib import Path
from types import ModuleType

from continuation_release import decode, protected_bytes, require


REPAIR = Path('/root/baci-ledger-continuity.clooltoe')
AUDIT = Path('/root/baci-ledger-balance-repair.9xx36nvp')
PINS = {
    REPAIR/'owner.py': '2612faeebfaf73501ffcf6b20b6cf19578246d3653f5522e0b9e68690a8b66da',
    REPAIR/'reboot_continuity.py': 'fa884466e53a30f7154158914e284a29a78c602294fcea6a5ce40ed75ef9cdb2',
    REPAIR/'reminder_continuity.py': 'a915b8134b5626f6d664f3d3cf79245c59ee089373738ab37d6f24022283842f',
    AUDIT/'before-afa0c9cfb4f6443ba1c8be875c9e6da6.json': 'b708f82d1a77a4df19a3f7b4bfd217ffa37500f9fc9e120abfa97470fc651a3f',
    AUDIT/'after-f647e2f2add94c038ba1ec5ab9f0a171.json': 'd2f70b36ad83ea8e6385189a86cbf132671e136bd176cf045414c4d530046478',
    AUDIT/'result-a2c81a75c8d3466daca1694e6f4fd36d.json': '5efd783ce7a485828efe4d44209b59819c3fbf74f6f94b0a601df5d74dba59de',
    Path('/root/baci-project-rollback-bootstrap.afv7kuzy/owner.py'): '1893f5fa25ae2c1704e2d82f6c144dce750ed2c95731a875ba9ebea9069f9ccf',
    Path('/root/baci-project-rollback-tls.81u8stms/after-ecaad936c2a5455c8ec35a53ecf1f365.json'): '1696661109ae4bcaaa0b8c10f0573c4df558b89f79a32f3aade2907d4b5879b8',
    Path('/root/baci-financial-reconciliation.k785s099/refused-partial-pass-4bc6d1f553b640bc910d754c961574a3.json'): 'd1f3c7d7b1b7940731ddb196b5d7bf18e122354fc7541e70eda480e6472fc249',
    Path('/root/baci-reminder-continuity.sb522x47/proof.json'): '55c52b6b8797b8b17b144fbd66dd59817fcc1efe5177a617b8616d7979907169',
}


def capture():
    result = {path: protected_bytes(path, pin) for path, pin in PINS.items()}
    require(all(hashlib.sha256(raw).hexdigest() == PINS[path] for path, raw in result.items()))
    return result


def module(raw, path):
    result = ModuleType('continuation_authenticated_' + path.stem)
    result.__file__ = str(path)
    exec(compile(raw, str(path), 'exec'), result.__dict__)
    return result


def same(first, second):
    require({key: value for key, value in first.items() if key != 'capturedAt'}
        == {key: value for key, value in second.items() if key != 'capturedAt'})


def failed_queue_delta(previous, current):
    relation = 'prefunded_card.dispatch_queue'
    first, second = [value['allowedTargetWitnesses'][relation] for value in (previous, current)]
    require(first['targetCount'] == second['targetCount'] == 1
        and len(first['targetRows']) == len(second['targetRows']) == 1
        and len(first['targetRowColumnHashes']) == len(second['targetRowColumnHashes']) == 1)
    rows = first['targetRows'][0], second['targetRows'][0]
    require(type(rows[0]['attempts']) is type(rows[1]['attempts']) is int
        and rows[0]['attempts'] == 654 and rows[1]['attempts'] == 655
        and rows[0]['available_at'] == '2026-10-03T10:39:13.282099+00:00'
        and rows[1]['available_at'] == '2026-10-03T11:36:05.366749+00:00')
    mutable = {'attempts', 'available_at'}
    for old, new in (rows, (first['targetRowColumnHashes'][0], second['targetRowColumnHashes'][0])):
        require(set(old) == set(new) and {key for key in old if old[key] != new[key]} == mutable)
    require({key: value for key, value in first.items()
        if key not in ('targetHash', 'targetRows', 'targetRowColumnHashes')}
        == {key: value for key, value in second.items()
            if key not in ('targetHash', 'targetRows', 'targetRowColumnHashes')})
    require(first['targetHash'] == '80a4586ab38397510fd874f17b5eb55a9929a0fd94ff2785cece19f19e059123'
        and second['targetHash'] == '458e70de807d9a9243044f6eb40b02832860e234350d231808cd249763b53865')
    for snapshot, pin in ((previous, 'acc94cd5d2868c139e09e69cae9100584e4b3a7025e75fcdc1fdd27d56b0e2e4'),
        (current, 'cf0f52487660a1dae20c84e7fcbbecc4591480d5e74a35674799f9ec2ecd30d9')):
        require(snapshot['tableRows'][relation] == dict(count=2, oid=45648, sha256=pin))
    comparison = copy.deepcopy(current)
    comparison['tableRows'][relation] = copy.deepcopy(previous['tableRows'][relation])
    comparison['allowedTargetWitnesses'][relation] = copy.deepcopy(first)
    same(previous, comparison)


def verify(captured, legacy):
    require(set(captured) == set(PINS) and all(
        hashlib.sha256(raw).hexdigest() == PINS[path] for path, raw in captured.items()))
    owner = module(captured[REPAIR/'owner.py'], REPAIR/'owner.py')
    reminder = module(captured[REPAIR/'reminder_continuity.py'], REPAIR/'reminder_continuity.py')
    before = decode(captured[next(path for path in PINS if path.name.startswith('before-'))])
    after = decode(captured[next(path for path in PINS if path.name.startswith('after-'))])
    result = decode(captured[next(path for path in PINS if path.name.startswith('result-'))])
    baseline = decode(captured[owner.BASELINE])
    partial = decode(captured[legacy['projection_preflight'].AUDIT_PATH])
    proof = decode(captured[Path(reminder.PROOF_PATH)])
    require(result == dict(status='ledger-balance-repaired', metadataApplied=True,
        financialCommitted=False, newPaymentStarted=False, rowsUnchanged=True,
        onlyCheckerAuthorityChanged=True, failedWorkerStatePreserved=True, privateAudit=str(AUDIT)))
    require(partial.get('workerFailed') is True
        and partial['classificationBefore']['phase'] == 'verify_existing_transfer')
    legacy['projection_preflight']._retained(partial)
    require(set(baseline) == {'application', 'protectedSnapshot'})
    failed_queue_delta(partial['firstPost'], baseline['protectedSnapshot'])
    for evidence in (before, after):
        require(type(evidence) is dict and set(evidence) == {'normal', 'masked', 'checker'}
            and set(evidence['normal']) == {'application', 'protectedSnapshot'})
        for snapshot in (evidence['normal']['protectedSnapshot'], evidence['masked']):
            legacy['financial_delta']._snapshot(snapshot)
            require(snapshot['readOnly'] is True)
        require(evidence['normal']['protectedSnapshot']['tableRows'] == evidence['masked']['tableRows']
            and evidence['normal']['protectedSnapshot']['identity'] == evidence['masked']['identity'])
    normalized = reminder.normalize(baseline['protectedSnapshot'], before['normal']['protectedSnapshot'], proof)
    same(baseline['protectedSnapshot'], normalized)
    owner.prove(before, after, '--apply', same)
    stamps = [legacy['application_reports']._instant(snapshot['capturedAt']) for snapshot in (
        partial['firstPost'], baseline['protectedSnapshot'], before['normal']['protectedSnapshot'],
        after['normal']['protectedSnapshot'])]
    require(stamps == sorted(stamps) and stamps[-1] <= datetime.now(timezone.utc))
    return copy.deepcopy(after), owner
