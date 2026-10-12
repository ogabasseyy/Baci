import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTRACT_E2E } from './constants.mjs';
import { createReceiptTransport } from './receipt-transport.mjs';
import { createSourceLoader } from './source-loader.mjs';

test('actual signed intake rejects bad signatures before any storage operation', async () => {
  let operations = 0;
  const transport = createReceiptTransport(
    {
      execute: () => {
        operations += 1;
        throw new Error('Must not store');
      },
    },
    createSourceLoader([CONTRACT_E2E.receiverRoot])
  );
  const response = await transport.submit(Buffer.from('{}'), '0'.repeat(128));
  assert.equal(response.status, 200);
  assert.equal(response.body.received, false);
  assert.equal(response.body.code, 'PIGGYVEST_INVALID_SIGNATURE');
  assert.equal(operations, 0);
  await assert.rejects(
    () => transport.store.call('arbitrary_function', {}),
    /Non-contract receipt RPC refused/
  );
  await assert.rejects(
    () =>
      transport.store.call('claim_piggyvest_staging_receipts', { p_limit: 1 }),
    /Non-contract receipt RPC refused/
  );
});
