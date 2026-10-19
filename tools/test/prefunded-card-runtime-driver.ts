import assert from 'node:assert/strict';
import { basename, isAbsolute } from 'node:path';
import { Client } from 'pg';
import { createPrefundedCardOperationStore } from '../../apps/web/src/lib/piggyvest/prefunded-card-operation-store';
import { createPrefundedCardProvider } from '../../apps/web/src/lib/piggyvest/prefunded-card-provider';
import { createPrefundedCardRuntime } from '../../apps/web/src/lib/piggyvest/prefunded-card-runtime';

async function main() {
  const [host, systemIdentifier] = process.argv.slice(2);
  assert(
    host && isAbsolute(host) && basename(host).startsWith('pvb-projection-')
  );
  assert(systemIdentifier && /^[0-9]{1,20}$/.test(systemIdentifier));
  const client = new Client({
    host,
    port: 55461,
    database: 'postgres',
    user: 'projection_worker',
  });
  await client.connect();
  try {
    const store = createPrefundedCardOperationStore(
      async (statement, parameters) => {
        await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
        try {
          const result = await client.query(statement, [...parameters]);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      }
    );
    const counts = {
      charge: 0,
      collectionVerify: 0,
      transfer: 0,
      transferVerify: 0,
    };
    const provider = createPrefundedCardProvider({
      settings: {
        paystackSecret: 'sk_test_fixture',
        piggyvest: {
          apiSecret: 'fixture-secret',
          expectedBusinessId: 'business',
          expectedCurrency: 'NGN',
          timeoutMs: 500,
          maxResponseBytes: 4096,
        },
        scope: {
          integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
          merchantId: '11111111-1111-4111-8111-111111111111',
          treasuryBindingId: '50000000-0000-4000-8000-000000000001',
          sourceWalletId: 'treasury-wallet',
        },
      },
      resolveSavedMethod: async (identity) => ({
        ...identity,
        email: 'fixture@example.test',
        authorizationCode: 'AUTH_fixture',
        paystackCustomerCode: 'CUS_fixture',
        domain: 'test',
        reusable: true,
        active: true,
      }),
      fetchImplementation: async (url, options) => {
        await Promise.resolve();
        const address = String(url);
        assert.equal(options?.redirect, 'error');
        if (
          address ===
            'https://api.paystack.co/transaction/charge_authorization' &&
          options?.method === 'POST'
        ) {
          counts.charge += 1;
          throw new Error('fixture: accepted collection response lost');
        }
        if (
          address ===
            'https://api.paystack.co/transaction/verify/collection-2' &&
          options?.method === 'GET'
        ) {
          counts.collectionVerify += 1;
          return Response.json({
            status: true,
            data: {
              id: 123,
              domain: 'test',
              status: 'success',
              reference: 'collection-2',
              amount: 10000,
              currency: 'NGN',
              customer: {
                customer_code: 'CUS_fixture',
                email: 'fixture@example.test',
              },
              authorization: { authorization_code: 'AUTH_fixture' },
            },
          });
        }
        if (
          address ===
            'https://staging.piggyvest.business/api/v1/transfer/wallet' &&
          options?.method === 'POST'
        ) {
          counts.transfer += 1;
          return Response.json(
            { status: true, message: 'Processing' },
            { status: 202 }
          );
        }
        if (
          address ===
            'https://staging.piggyvest.business/api/v1/transaction/verify?reference=transfer-2&wallet_id=treasury-wallet' &&
          options?.method === 'GET'
        ) {
          counts.transferVerify += 1;
          return Response.json({
            status: true,
            data: {
              id: '4680cf0b-cd3f-4a74-ad14-bd4cc9876dd4',
              status: 'success',
              reference: 'transfer-2',
              amount: 10000,
              currency: 'NGN',
              business_id: 'business',
              source_wallet: 'treasury-wallet',
              destination_wallet: 'scratch-private-wallet',
              destination_customer_id: 'scratch-event-customer',
            },
          });
        }
        throw new Error('fixture refused unexpected provider request');
      },
    });
    const runtime = createPrefundedCardRuntime({
      store,
      provider,
      expectedSystemId: systemIdentifier,
    });
    const operationId = '70000000-0000-4000-8000-000000000002';
    await runtime(operationId);
    assert.equal(
      (await store.readOperation(operationId, systemIdentifier))
        .collectionStatus,
      'unknown'
    );
    await runtime(operationId);
    assert.equal(
      (await store.readOperation(operationId, systemIdentifier))
        .collectionStatus,
      'verified_success'
    );
    await runtime(operationId);
    assert.equal(
      (await store.readOperation(operationId, systemIdentifier))
        .projectionStatus,
      'unapplied'
    );
    await runtime(operationId);
    assert.equal(
      (await store.readOperation(operationId, systemIdentifier)).transferStatus,
      'verified_success'
    );
    assert.deepEqual(await runtime(operationId), { outcome: 'applied' });
    assert.deepEqual(await runtime(operationId), { outcome: 'duplicate' });
    assert.deepEqual(counts, {
      charge: 1,
      collectionVerify: 1,
      transfer: 1,
      transferVerify: 1,
    });
    process.stdout.write('REAL_RUNTIME_DISPOSABLE_DB_PASS\n');
  } finally {
    await client.end();
  }
}

main().catch(() => {
  process.stderr.write(
    'Runtime fixture failed; no live provider requests were possible.\n'
  );
  process.exitCode = 1;
});
