import assert from 'node:assert/strict';
import { Client } from 'pg';
import { createPrefundedCardReversalHandler } from '../../apps/web/src/lib/piggyvest/prefunded-card-reversal';

async function main() {
  const [socket, system] = process.argv.slice(2);
  assert.match(
    socket,
    /^\/private\/tmp\/baci-prefunded-reversal\.[^/]+\/socket$/
  );
  const client = new Client({
    host: socket,
    port: 55467,
    user: 'reversal_worker',
    database: 'postgres',
  });
  const admin = new Client({
    host: socket,
    port: 55467,
    user: 'harness_admin',
    database: 'postgres',
  });
  await client.connect();
  await admin.connect();
  try {
    const method = {
      savedMethodId: '60000000-0000-4000-8000-000000000001',
      merchantId: '11111111-1111-4111-8111-111111111111',
      customerId: '22222222-2222-4222-8222-222222222222',
      email: 'scratch@example.test',
      authorizationCode: 'AUTH_scratch',
      paystackCustomerCode: 'CUS_scratch',
      domain: 'test',
      active: false,
      reusable: false,
    };
    const calls: string[] = [];
    const handle = createPrefundedCardReversalHandler({
      execute: (statement, parameters) =>
        client.query(statement, [...parameters]),
      expectedSystemId: system,
      settings: {
        paystackSecret: 'sk_test_scratch',
        piggyvest: {
          apiSecret: 'pv_staging_scratch',
          expectedBusinessId: 'business',
          expectedCurrency: 'NGN',
        },
        scope: {
          integrationId: 'd91d9e87-8e0d-44de-9b84-1e1d709633d2',
          merchantId: method.merchantId,
          treasuryBindingId: '50000000-0000-4000-8000-000000000001',
          sourceWalletId: 'source-wallet',
        },
      },
      resolveSavedMethod: (identity) => {
        assert.equal(identity.savedMethodId, method.savedMethodId);
        assert.equal(identity.customerId, method.customerId);
        assert.equal(identity.merchantId, method.merchantId);
        return Promise.resolve(method);
      },
      fetchImplementation: (url, options) => {
        assert.equal(options?.method, 'GET');
        assert.equal(
          String(url),
          'https://api.paystack.co/transaction/verify/collection-6'
        );
        calls.push(String(url));
        return Promise.resolve(
          new Response(
            JSON.stringify({
              status: true,
              data: {
                id: 6,
                domain: 'test',
                status: 'reversed',
                reference: 'collection-6',
                amount: 10000,
                currency: 'NGN',
                customer: {
                  customer_code: 'CUS_scratch',
                  email: 'scratch@example.test',
                },
                authorization: { authorization_code: 'AUTH_scratch' },
              },
            }),
            { headers: { 'content-type': 'application/json' } }
          )
        );
      },
    });
    const operationId = '70000000-0000-4000-8000-000000000006';
    assert.equal(
      (await handle(operationId, 'runtime-delivery-6')).outcome,
      'recorded'
    );
    assert.equal(
      (await handle(operationId, 'runtime-delivery-6')).outcome,
      'duplicate'
    );
    assert.equal(calls.length, 2);
    const result = await client.query(
      'SELECT prefunded_card.claim_transfer($1::uuid,0) AS result',
      [operationId]
    );
    assert.deepEqual(result.rows, [
      { result: { outcome: 'stale_or_reconciliation_required' } },
    ]);
    assert.deepEqual(
      (
        await admin.query(
          'SELECT reserved_kobo::text,consumed_kobo::text FROM prefunded_card.treasury_bindings'
        )
      ).rows,
      [{ reserved_kobo: '60000', consumed_kobo: '20000' }]
    );
    assert.deepEqual(
      (
        await admin.query(
          'SELECT count(*)::int AS count FROM prefunded_card.collection_reversal_obligations'
        )
      ).rows,
      [{ count: 7 }]
    );
    console.log(
      'PASS real reversal handler, SQL store and mocked provider HTTP'
    );
  } finally {
    await client.end();
    await admin.end();
  }
}

void main().catch(() => {
  console.error('Reversal scratch runtime failed');
  process.exitCode = 1;
});
