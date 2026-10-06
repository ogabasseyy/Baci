import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
from datetime import datetime, timezone

from policy_contract import DEADLINE, FIELDS, SCOPE, SHA256, validate_evidence
from read_provider_identity import read_provider_identity


OLD_WALLET = '01M3CQX27G9687EFSF1TKYMPR9'
TRUE_WALLET = '01M3W0Y93XHJY9RPQ2G75X81WG'
HISTORY_SHA256 = '86d683c4aab907efa1040baa41cfcc5e9efe21d5e427c2bb3f8e4a250a68db9c'
MAX_BYTES = 1048576
READ_ONLY_SQL = """
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='10s';
SELECT json_build_object(
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'integrationId',mapping.integration_id,'merchantId',mapping.merchant_id,
 'appCustomerId',mapping.customer_id,'goalId',mapping.goal_id,
 'publicWalletId',mapping.provider_wallet_id,'webhookCustomerId',mapping.provider_customer_id,
 'principalKobo',(goal.current_amount*100)::bigint,'bindingEnabled',binding.enabled)
FROM piggyvest_staging.wallet_goal_mappings mapping
JOIN public.customer_savings_goals goal ON goal.id=mapping.goal_id
 AND goal.merchant_id=mapping.merchant_id AND goal.customer_id=mapping.customer_id
JOIN public.customers customer ON customer.id=goal.customer_id
 AND customer.merchant_id=goal.merchant_id AND customer.deleted_at IS NULL
JOIN piggyvest_savings_ledger.bindings binding ON binding.integration_id=mapping.integration_id
 AND binding.goal_id=mapping.goal_id AND binding.merchant_id=mapping.merchant_id
 AND binding.customer_id=mapping.customer_id
WHERE mapping.integration_id='d91d9e87-8e0d-44de-9b84-1e1d709633d2'
 AND mapping.goal_id='430314fd-cd8b-4579-98d4-e9f345713dd6'
 AND mapping.merchant_id='10000000-0000-4000-8000-000000000001'
 AND mapping.customer_id='10000000-0000-4000-8000-000000000002'
 AND mapping.provider_wallet_id='01M3CQX27G9687EFSF1TKYMPR9'
 AND goal.status IN ('active','paused','completed');
ROLLBACK;
"""


def _read(path, expected_sha=None):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        metadata = os.fstat(stream.fileno())
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1
                or metadata.st_size > MAX_BYTES or metadata.st_mode & 0o022):
            raise ValueError('input-metadata')
        raw = stream.read(MAX_BYTES + 1)
        if len(raw) > MAX_BYTES or (expected_sha and hashlib.sha256(raw).hexdigest() != expected_sha):
            raise ValueError('input-pin')
        return json.loads(raw)


def _wallet(wallet, expected_id):
    fields = ('id', 'api_customer_id', 'business_id', 'faas_wallet_identifier',
              'currency', 'status', 'interest_enabled')
    if not isinstance(wallet, dict):
        raise ValueError('wallet-shape')
    record = {key: wallet.get(key) for key in fields}
    if (record['id'] != expected_id or record['business_id'] != SCOPE['businessId']
            or record['currency'] != 'NGN' or record['status'] != 'active'
            or type(record['interest_enabled']) is not bool
            or any(not isinstance(record[key], str) or not record[key]
                   for key in ('api_customer_id', 'faas_wallet_identifier'))):
        raise ValueError('wallet-identity')
    return record


def collect_identity_evidence(history, wallets, binding, observed_at, fresh_reconciliation):
    if history.get('changesMade') is not False or history.get('principalKobo') != 10000:
        raise ValueError('historical-report')
    sealed = history.get('ownerSealed', {})
    scope = sealed.get('scope', {})
    expected = {key: SCOPE[key] for key in
                ('systemIdentifier', 'integrationId', 'businessId', 'merchantId', 'goalId')}
    expected.update(customerId=SCOPE['appCustomerId'], providerWalletId=OLD_WALLET,
                    providerCustomerId='c096507d-dc32-45d2-9c01-871a27abfd10', currency='NGN')
    if scope != expected or len(sealed.get('credits', [])) != 1:
        raise ValueError('historical-scope')
    credit = sealed['credits'][0]
    observation = credit.get('observation', {})
    reconciliation = credit.get('providerReconciliation', {})
    if (observation.get('status') != 'verified' or observation.get('kind') != 'bank_inflow'
            or observation.get('destinationWalletId') != OLD_WALLET
            or observation.get('destinationCustomerId') != expected['providerCustomerId']
            or observation.get('amountKobo') != 10000 or observation.get('currency') != 'NGN'
            or observation.get('providerTransactionId') != reconciliation.get('transactionId')
            or credit.get('originalPayloadIntegrity') != 'aead_authenticated'):
        raise ValueError('historical-reconciliation')
    if (fresh_reconciliation.get('transactionId') != reconciliation.get('transactionId')
            or fresh_reconciliation.get('status') not in (
                'exact_provider_transaction_match', 'exact_provider_transaction_identity_amount_match')
            or fresh_reconciliation.get('retrievedAt') != observed_at):
        raise ValueError('fresh-reconciliation')
    signature = {'provider_reconciliation': 'unavailable', 'signed_receipt': 'verified'}
    if (credit.get('provenance') not in signature
            or credit.get('signatureStatus') != signature[credit['provenance']]):
        raise ValueError('historical-signature')
    if set(binding) != FIELDS['goal_binding']:
        raise ValueError('app-binding-shape')
    if any(binding.get(key) != SCOPE[key] for key in
           ('systemIdentifier', 'integrationId', 'merchantId', 'appCustomerId', 'goalId')):
        raise ValueError('app-binding-scope')
    if (binding.get('publicWalletId') != OLD_WALLET
            or binding.get('webhookCustomerId') != expected['providerCustomerId']
            or binding.get('principalKobo') != 10000 or binding.get('bindingEnabled') is not True):
        raise ValueError('app-binding-history')
    old = _wallet(wallets.get(OLD_WALLET), OLD_WALLET)
    current = _wallet(wallets.get(TRUE_WALLET), TRUE_WALLET)
    if old['api_customer_id'] != current['api_customer_id']:
        raise ValueError('current-wallet-customer')
    common = {'environment': 'staging', 'businessId': SCOPE['businessId'],
              'observedAt': observed_at, 'validUntil': DEADLINE}
    records = [
        {**common, 'kind': 'historical_receipt', 'artifactId': 'collected-historical-receipt',
         'provenance': ('aead_original_and_provider_reconciliation' if credit['signatureStatus'] == 'unavailable'
                        else 'original_signature_and_provider_reconciliation'),
         **{key: SCOPE[key] for key in ('systemIdentifier', 'integrationId', 'merchantId', 'appCustomerId', 'goalId')},
         'historicalPublicWalletId': OLD_WALLET, 'webhookCustomerId': expected['providerCustomerId'],
         'amountKobo': 10000, 'currency': 'NGN', 'eventId': observation['eventId'],
         'providerTransactionId': reconciliation['transactionId'], 'payloadSha256': credit['payloadSha256'],
         'providerResponseSha256': fresh_reconciliation['responseSha256'],
         'signatureStatus': credit['signatureStatus'], 'originalPayloadIntegrity': 'aead_authenticated',
         'historicalObservedAt': sealed['verifiedAt'], 'providerRetrievedAt': fresh_reconciliation['retrievedAt'],
         'freshReconciliationStatus': fresh_reconciliation['status'],
         'reconciliationStatus': 'exact_provider_transaction_match'},
        {**common, 'kind': 'historical_wallet', 'artifactId': 'collected-historical-wallet',
         'provenance': 'provider_authenticated_readback', 'historicalPublicWalletId': OLD_WALLET,
         'apiCustomerId': old['api_customer_id'], 'currency': 'NGN', 'status': 'active'},
        {**common, 'kind': 'wallet', 'artifactId': 'collected-interest-wallet',
         'provenance': 'provider_authenticated_readback', 'publicWalletId': TRUE_WALLET,
         'faasWalletId': current['faas_wallet_identifier'], 'apiCustomerId': current['api_customer_id'],
         'interestEnabled': current['interest_enabled']},
        {**common, 'kind': 'goal_binding', 'artifactId': 'collected-goal-binding',
         'provenance': 'app_authenticated_snapshot', **binding},
    ]
    if not all(validate_evidence(record) for record in records):
        raise ValueError('collected-evidence-shape')
    return {'scope': dict(SCOPE), 'expiresAt': DEADLINE, 'evidence': records}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--history', type=Path, required=True)
    parser.add_argument('--history-sha256', default=HISTORY_SHA256)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    try:
        now = datetime.now(timezone.utc).isoformat(timespec='seconds').replace('+00:00', 'Z')
        if os.geteuid() != 0 or now >= DEADLINE:
            raise ValueError('root-or-deadline')
        if (SHA256.fullmatch(args.history_sha256) is None
                or str(args.history) not in {
                    '/home/bassey/baci-legacy-proof-final.4flGg4nk/legacy-proof.json',
                    '/root/baci-legacy-migration.wUqQX5Rh/runtime/legacy-proof.json'}):
            raise ValueError('historical-source-allowlist')
        history = _read(args.history, args.history_sha256)
        wallets, fresh = read_provider_identity()
        now = fresh['retrievedAt']
        process = subprocess.run(['docker', 'exec', '-i', 'baci-isolated-savings-db-1',
                                  '/nix/var/nix/profiles/default/bin/psql',
                                  '-U', 'postgres', '-d', 'postgres', '-X', '-Atq',
                                  '-v', 'ON_ERROR_STOP=1'], input=READ_ONLY_SQL, text=True,
                                 capture_output=True, timeout=20)
        if process.returncode or len(process.stdout) > MAX_BYTES:
            raise ValueError('app-read')
        binding = json.loads(process.stdout.strip())
        bundle = collect_identity_evidence(history, wallets, binding, now, fresh)
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(bundle, stream, sort_keys=True, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        print(json.dumps({'status': 'collected_unreviewed', 'changesMade': False,
                          'providerIdMappingApproved': False, 'readOnly': True}))
        return 0
    except Exception:
        print(json.dumps({'status': 'collection_refused', 'changesMade': False,
                          'providerIdMappingApproved': False, 'redacted': True}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
