import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import stat
import subprocess
import sys
import traceback
import uuid
from datetime import datetime, timezone

ROOT = Path('/root/baci-financial-owner.2ynkl9kc')
SOURCE = ROOT / 'reviewed-reconciliation-r3'
PARENT = ROOT / 'public-parent-3.py'
PARENT_PIN = '149db252bdaec8a3d512246e7d7ceb43f80b29a8b70cb4ccfd2d38b3b3a0dd41'
MANIFEST_PIN = 'ac1adb9ca19b88c8b5e123be64ab6d8b849151e32d8157b5d04e8cc1eeac0d6d'
PROOF_PIN = 'd00b64897460daae4b61ce4527c16a5d7e8413a8f72bebebe7110ecdde5beed4'
INTENT = 'ff561046-58e7-428d-9163-f6e60b0dab65'
DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']
TIMERS = ('baci-prefunded-background.timer', 'baci-prefunded-snapshot.timer',
          'baci-savings-notifications.timer')
NODE = r"""
const fs=require('node:fs'),crypto=require('node:crypto'),vm=require('node:vm');
const input=JSON.parse(fs.readFileSync(0,'utf8'));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
if(hash(input.source)!=='e188ef318f7bb7864f806907698fd28cf82b655f473a5096b6271028e1f05015')throw Error('Collector pin');
const raw=fs.readFileSync('/run/pvb-public/checkout.json');
if(hash(raw)!=='5953209ee31ebfe4290f227d7c0f5254ba251e2c4f9fc9d763af2a6d9320e67f')throw Error('Configuration pin');
const configuration=JSON.parse(raw);if(!/^sk_test_[A-Za-z0-9]+$/.test(configuration.checkout.provider.paystackSecret))throw Error('Test key');
const ownerModule={exports:{}};
vm.runInThisContext('(function(require,module,exports){'+input.source+'\n})')(require,ownerModule,ownerModule.exports);
ownerModule.exports.captureFirstCardOwnerProof({settings:configuration.checkout.provider,intent:input.intent,
 expectedIntent:input.intent,fetchImplementation:fetch}).then(value=>process.stdout.write(JSON.stringify(value))).catch(()=>{process.exitCode=1;});
"""


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        allow_nan=False, separators=(',', ':')).encode()).hexdigest()


def read(path, pin):
    metadata = path.lstat()
    assert stat.S_ISREG(metadata.st_mode) and metadata.st_uid == 0 and metadata.st_nlink == 1
    assert stat.S_IMODE(metadata.st_mode) == 0o600
    raw = path.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == pin
    return raw


def execute(arguments, text=None, timeout=60):
    result = subprocess.run(arguments, input=text, capture_output=True, text=True, timeout=timeout,
        env=dict(HOME='/root', PATH='/usr/sbin:/usr/bin:/sbin:/bin', LANG='C', LC_ALL='C'))
    if result.returncode or len(result.stdout) > 1000000:
        descriptor = os.open(SOURCE / ('failure-' + uuid.uuid4().hex + '.stderr'),
            os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'w') as output:
            output.write(result.stderr)
        code = re.search(r'^ERROR:\s*([A-Z0-9]{5})\s*$', result.stderr, re.MULTILINE)
        raise ValueError('owner_command_refused_' + (code[1] if code else 'redacted'))
    return result.stdout


def boot():
    assert os.geteuid() == 0 and not sys.flags.optimize
    manifest = json.loads(read(SOURCE / 'sealed-files.json', MANIFEST_PIN))
    for name, pin in manifest['files'].items():
        read(SOURCE / name, pin)
    read(SOURCE / 'proof_contract.py', PROOF_PIN)
    read(PARENT, PARENT_PIN)
    parent = runpy.run_path(str(PARENT), run_name='reviewed_card_owner')
    parent['closure']()
    for timer in TIMERS:
        assert execute(['/usr/bin/systemctl', 'show', timer, '--property=ActiveState', '--value']).strip() == 'inactive'
        service = timer.removesuffix('.timer') + '.service'
        assert execute(['/usr/bin/systemctl', 'show', service, '--property=ActiveState', '--value']).strip() == 'inactive'
    return parent


def sql(source):
    prefix = "SET log_statement='none'; SET log_min_error_statement='panic'; SET log_min_duration_statement=-1;"
    return execute([*DOCKER, 'exec', '-i', 'baci-isolated-savings-db-1', '/usr/bin/psql', '-XqAt',
        '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate', '-U', 'postgres', '-d', 'postgres'], prefix + source)


def snapshot():
    folder = SOURCE / 'reviewed-reconciliation'
    return json.loads(sql("BEGIN; SET LOCAL search_path=pg_catalog,pg_temp; SET LOCAL lock_timeout='5s';"
        "SET LOCAL statement_timeout='45s';" + (folder / 'identity.sql').read_text()
        + (folder / 'state.sql').read_text() + (folder / 'snapshot.sql').read_text() + 'ROLLBACK;'))


def render(bundle, receipt=None):
    folder = SOURCE / 'reviewed-reconciliation'
    snippet = "import sys,json;sys.path.insert(0," + repr(str(folder)) + ");from renderer import render_transaction;"
    snippet += "value=json.load(sys.stdin);print(render_transaction(**value),end='')"
    arguments = dict(bundle=bundle, reviewed_sha256=digest(bundle))
    if receipt is not None:
        arguments.update(mode='apply', receipt=receipt, reviewed_receipt_sha256=digest(receipt))
    return execute(['/usr/bin/python3', '-I', '-B', '-c', snippet], json.dumps(arguments))


def provider_attestation(proof, expected):
    snippet = "import sys,json;sys.path.insert(0," + repr(str(SOURCE)) + ");"
    snippet += "from proof_contract import reviewed_proof;value=json.load(sys.stdin);print(json.dumps(reviewed_proof(**value)))"
    return json.loads(execute(['/usr/bin/python3', '-I', '-B', '-c', snippet],
        json.dumps(dict(value=proof, expected=expected))))


def prepare(parent):
    previous = json.loads((ROOT / 'empty-card-scope-r1/sandbox-card-reviewed-source.json').read_bytes())
    assert previous['intent']['id'] == INTENT
    audit = SOURCE / ('attempt-' + uuid.uuid4().hex)
    audit.mkdir(mode=0o700)
    proof = json.loads(execute([*DOCKER, 'exec', '-i', 'baci-prefunded-public', 'node', '-e', NODE],
        json.dumps(dict(source=(SOURCE / 'collect.cjs').read_text(), intent=previous['typedIntent'])), timeout=15))
    attestation = provider_attestation(proof, previous['typedIntent'])
    preflight = snapshot()
    assert preflight['intentSha256'] == previous['intentSha256']
    assert preflight['operationSha256'] == '56f7090d7d264a1f66b995dad80ebf63e6981efcabaf1ca70368eb9a24e34e0d'
    scope = {key: previous['typedIntent'][key] for key in ('deployment', 'integrationId', 'merchantId',
        'treasuryBindingId', 'businessId', 'systemIdentifier', 'expiresAt')}
    selection = {key: previous['typedIntent'][key] for key in ('intentId', 'customerId', 'actorId', 'goalId')}
    bundle = dict(source=previous['routine']['source'], scope=scope, selection=selection,
        collection=proof['collection'], preflight=preflight, proof=attestation)
    parent['save'](audit / 'private-provider-proof.json', proof)
    parent['save'](audit / 'bundle.json', bundle)
    rollback = render(bundle)
    descriptor = os.open(audit / 'rollback.sql', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        output.write(rollback)
    result = json.loads(sql(rollback))
    assert result == dict(status='reviewed_postflight_passed', intentId=INTENT, manifestSha256=digest(bundle))
    assert snapshot() == preflight
    receipt = dict(manifestSha256=digest(bundle), rollbackSqlSha256=hashlib.sha256(rollback.encode()).hexdigest(),
        preflightSha256=digest(preflight), rolledBack=True, postflightPassed=True, independentlyReviewed=True,
        reviewedAt=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))
    parent['save'](audit / 'rollback-receipt.json', receipt)
    parent['closure']()
    return dict(status='owner_rehearsal_passed_review_required', audit=str(audit), bundleSha256=digest(bundle),
        receiptSha256=digest(receipt), sourceSha256=previous['routine']['sha256'],
        verifiedAt=proof['verifiedAt'], databaseApplied=False, oldPrincipalKobo=10000, newPrincipalKobo=0)


def apply(parent, path, bundle_pin, receipt_pin):
    audit = Path(path)
    assert audit.parent == SOURCE and audit.name.startswith('attempt-') and not audit.is_symlink()
    bundle = json.loads((audit / 'bundle.json').read_bytes())
    receipt = json.loads((audit / 'rollback-receipt.json').read_bytes())
    assert digest(bundle) == bundle_pin and digest(receipt) == receipt_pin
    assert snapshot() == bundle['preflight']
    value = sql(render(bundle, receipt))
    result = json.loads(value)
    assert result == dict(status='reviewed_postflight_passed', intentId=INTENT, manifestSha256=bundle_pin)
    after = snapshot()
    assert after['protectedRowsSha256'] == bundle['preflight']['protectedRowsSha256']
    assert after['permanentMetadataSha256'] == bundle['preflight']['permanentMetadataSha256']
    assert after['routine'] == bundle['preflight']['routine']
    parent['save'](audit / 'applied.json', dict(status='verified_collection_promoted',
        intentId=INTENT, manifestSha256=bundle_pin, postflight=after, financialTransferAttempted=False))
    parent['closure']()
    return dict(status='verified_collection_promoted', intentId=INTENT, databaseApplied=True,
        financialTransferAttempted=False, newPaymentStarted=False, originalPermanentFunctionUnchanged=True)


if __name__ == '__main__':
    try:
        parent = boot()
        if sys.argv == [sys.argv[0], '--prepare']:
            result = prepare(parent)
        elif len(sys.argv) == 5 and sys.argv[1] == '--apply':
            result = apply(parent, *sys.argv[2:])
        else:
            raise ValueError('owner_mode_refused')
        print(json.dumps(result))
    except Exception as error:
        allowed = re.fullmatch('owner_[a-z0-9_]+', str(error))
        frames = traceback.extract_tb(error.__traceback__)
        print(json.dumps(dict(status='refused', reasonCode=str(error) if allowed else 'redacted',
            errorType=type(error).__name__, sourceModule=Path(frames[-1].filename).name,
            sourceLine=frames[-1].lineno, newPaymentStarted=False, financialTransferAttempted=False)))
        raise SystemExit(1)
