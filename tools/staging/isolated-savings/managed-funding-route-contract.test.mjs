import assert from 'node:assert/strict';
import test from 'node:test';
import { fundingRouteContract } from './managed-funding-route-contract.mjs';

test('funding gateway adds only the four caller-authorized goal dependencies', () => {
  const routes = fundingRouteContract();
  assert.equal(routes.length, 9);
  assert.deepEqual(routes.slice(5), [
    { path: '/rest/v1/customer_savings_goals', methods: ['GET', 'HEAD'] },
    { path: '/rest/v1/rpc/get_merchant_paystack_subaccount_code', methods: ['POST'] },
    { path: '/rest/v1/rpc/get_customer_savings_feature_settings', methods: ['POST'] },
    { path: '/rest/v1/rpc/create_customer_savings_goal', methods: ['POST'] },
  ]);
  assert.equal(routes.some(({ path }) => /provisioning|transfer|cancel/.test(path)), false);
  assert.equal(routes.some(({ methods }) => methods.includes('DELETE')), false);
});

test('mutating a proposed contract never mutates subsequent contracts', () => {
  const first = fundingRouteContract();
  first[0].methods.push('POST');
  assert.deepEqual(fundingRouteContract()[0].methods, ['GET', 'HEAD']);
});
