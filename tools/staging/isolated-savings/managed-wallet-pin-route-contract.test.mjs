import assert from 'node:assert/strict';
import test from 'node:test';
import { fundingRouteContract } from './managed-funding-route-contract.mjs';
import { walletPinRouteContract } from './managed-wallet-pin-route-contract.mjs';

const appendedRoutes = [
  ...[
    'piggyvest_plan_wallets',
    'piggyvest_interest_payouts',
    'customer_wallets',
    'customer_wallet_transactions',
    'customer_wallet_payment_accounts',
    'customer_wallet_accounts',
  ].map((name) => ({ path: `/rest/v1/${name}`, methods: ['GET', 'HEAD'] })),
  ...[
    'get_storefront_payment_settings',
    'get_customer_savings_earnings',
    'get_customer_savings_notifications',
    'update_customer_savings_notification_preferences',
    'mark_customer_savings_notification_read',
    'register_push_token',
  ].map((name) => ({ path: `/rest/v1/rpc/${name}`, methods: ['POST'] })),
  { path: '/rest/v1/push_tokens', methods: ['PATCH'] },
  ...[
    'allocate_customer_savings_contribution',
    'set_customer_wallet_phone',
    'set_customer_wallet_profile',
  ].map((name) => ({ path: `/rest/v1/rpc/${name}`, methods: ['POST'] })),
  ...[
    'get_wallet_pin_state',
    'set_wallet_pin',
    'change_wallet_pin',
    'reset_wallet_pin',
    'verify_wallet_pin',
  ].map((name) => ({ path: `/rest/v1/rpc/${name}`, methods: ['POST'] })),
];

test('contract retains funding routes and appends the exact approved route set', () => {
  const routes = walletPinRouteContract();
  assert.equal(routes.length, 30);
  assert.deepEqual(routes.slice(0, 9), fundingRouteContract());
  assert.deepEqual(routes.slice(9), appendedRoutes);
  assert.equal(new Set(routes.map(({ path }) => path)).size, 30);
});

test('only the five explicit PIN RPC routes are introduced and POST-only', () => {
  const routes = walletPinRouteContract();
  const pinRoutes = routes.filter(({ path }) => /wallet_pin/.test(path));
  assert.deepEqual(pinRoutes, [
    { path: '/rest/v1/rpc/get_wallet_pin_state', methods: ['POST'] },
    { path: '/rest/v1/rpc/set_wallet_pin', methods: ['POST'] },
    { path: '/rest/v1/rpc/change_wallet_pin', methods: ['POST'] },
    { path: '/rest/v1/rpc/reset_wallet_pin', methods: ['POST'] },
    { path: '/rest/v1/rpc/verify_wallet_pin', methods: ['POST'] },
  ]);
  assert.equal(
    routes.some(({ path }) => /\*/.test(path)),
    false
  );
  assert.equal(
    routes.some(({ path }) =>
      /pin.*(store|table)|(?:store|table).*pin/i.test(path)
    ),
    false
  );
  assert.equal(
    routes.some(({ path }) => /service[_-]?role/i.test(path)),
    false
  );
  assert.equal(
    routes.every(({ methods }) => !methods.includes('DELETE')),
    true
  );
});

test('contract arrays and nested method arrays are fresh on every call', () => {
  const first = walletPinRouteContract();
  first[0].methods.push('POST');
  first[9].methods[0] = 'DELETE';
  first.push({ path: '/unexpected', methods: ['GET'] });
  assert.deepEqual(walletPinRouteContract(), [
    ...fundingRouteContract(),
    ...appendedRoutes,
  ]);
});
