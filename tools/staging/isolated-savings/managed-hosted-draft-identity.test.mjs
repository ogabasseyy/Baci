import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateRoutingIdentityShape } from './private-routing-inventory.mjs';

const identity = JSON.parse(
  await readFile(
    new URL('./managed-hosted-draft-identity.json', import.meta.url)
  )
);

test('hosts only the reviewed draft and catalogue routes without financial writes', () => {
  validateRoutingIdentityShape(identity);
  assert.deepEqual(identity.restRoutes, [
    { path: '/rest/v1/products', methods: ['GET', 'HEAD'] },
    { path: '/rest/v1/customers', methods: ['GET', 'HEAD'] },
    { path: '/rest/v1/merchants', methods: ['GET', 'HEAD'] },
    {
      path: '/rest/v1/rpc/customer_savings_draft_command',
      methods: ['POST'],
    },
    {
      path: '/rest/v1/rpc/get_storefront_product_variants',
      methods: ['POST'],
    },
  ]);
  assert.equal(JSON.stringify(identity).includes('piggyvest'), false);
  assert.equal(JSON.stringify(identity).includes('transfer'), false);
});
