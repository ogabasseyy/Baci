import assert from 'node:assert/strict';
import test from 'node:test';
import { managedRouteContract } from './managed-route-contract.mjs';

test('funding is explicit and never expands existing route modes', () => {
  assert.equal(managedRouteContract('product-only').length, 1);
  assert.equal(managedRouteContract('hosted-draft').length, 5);
  assert.equal(managedRouteContract('hosted-funding').length, 9);
  assert.throws(() => managedRouteContract('funding'));
  const routes = managedRouteContract('hosted-funding');
  routes[0].methods.push('POST');
  assert.deepEqual(managedRouteContract('product-only')[0].methods, [
    'GET',
    'HEAD',
  ]);
});
