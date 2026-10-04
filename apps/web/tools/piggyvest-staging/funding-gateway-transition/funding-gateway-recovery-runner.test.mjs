import assert from 'node:assert/strict';
import test from 'node:test';
import {
  gatewayAccount,
  parseState,
  recover,
  validateBinding,
} from './funding-gateway-recovery-runner.mjs';

const deadline = 1790697550000;
const binding = () => ({
  identity: {
    restRoutes: [
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
    ],
  },
  leaseExpiresAt: new Date(deadline).toISOString(),
  leaseNotBefore: new Date(deadline - 7 * 86400000).toISOString(),
  reviewedAt: new Date(deadline - 7 * 86400000).toISOString(),
  version: 1,
});

test('accepts reordered keyed systemd output', () => {
  const state = parseState(
    'DropInPaths=\nMainPID=0\nActiveState=failed\nLoadState=loaded',
    ['LoadState', 'ActiveState', 'MainPID', 'DropInPaths'],
    ['DropInPaths']
  );
  assert.equal(state.ActiveState, 'failed');
});

test('rejects missing or duplicate systemd properties', () => {
  assert.throws(() =>
    parseState('LoadState=loaded\nActiveState=failed', [
      'LoadState',
      'ActiveState',
      'MainPID',
    ])
  );
  assert.throws(() =>
    parseState(
      'LoadState=loaded\nLoadState=loaded\nActiveState=failed\nMainPID=0',
      ['LoadState', 'ActiveState', 'MainPID']
    )
  );
});

test('rejects an expired or widened binding', () => {
  const expired = binding();
  expired.leaseExpiresAt = new Date(deadline - 1).toISOString();
  assert.throws(() => validateBinding(expired, deadline - 2));
  const widened = binding();
  widened.identity.restRoutes.push({
    path: '/rest/v1/rpc/funding',
    methods: ['POST'],
  });
  assert.throws(() => validateBinding(widened, deadline - 1));
});

test('preserves the exact fixed five-route binding until expiry', () => {
  assert.equal(validateBinding(binding(), deadline - 1).restRoutes.length, 5);
});

test('accepts the eleven-route transitioned binding and still rejects widening', () => {
  const transitioned = binding();
  transitioned.identity.restRoutes = [
    ...transitioned.identity.restRoutes,
    { path: '/rest/v1/customer_savings_goals', methods: ['GET', 'HEAD'] },
    {
      path: '/rest/v1/rpc/get_merchant_paystack_subaccount_code',
      methods: ['POST'],
    },
    {
      path: '/rest/v1/rpc/get_customer_savings_feature_settings',
      methods: ['POST'],
    },
    { path: '/rest/v1/rpc/create_customer_savings_goal', methods: ['POST'] },
    { path: '/rest/v1/piggyvest_plan_wallets', methods: ['GET', 'HEAD'] },
    { path: '/rest/v1/piggyvest_interest_payouts', methods: ['GET', 'HEAD'] },
  ];
  assert.equal(
    validateBinding(transitioned, deadline - 1).restRoutes.length,
    11
  );
  const widened = structuredClone(transitioned);
  widened.identity.restRoutes.push({
    path: '/rest/v1/rpc/funding',
    methods: ['POST'],
  });
  assert.throws(() => validateBinding(widened, deadline - 1));
});

test('bugfix: accepts the approved millisecond lease within the fixed deadline second', () => {
  const actual = binding();
  actual.leaseExpiresAt = '2026-09-29T15:59:10.442Z';
  actual.leaseNotBefore = '2026-09-22T15:59:10.442Z';
  actual.reviewedAt = '2026-09-22T15:59:10.442Z';
  assert.equal(validateBinding(actual, deadline - 1).restRoutes.length, 5);
  const wrongSecond = binding();
  wrongSecond.leaseExpiresAt = '2026-09-29T15:59:11.000Z';
  assert.throws(() => validateBinding(wrongSecond, deadline - 1));
});

test('uses the unit group rather than the account primary group', async () => {
  const account = await gatewayAccount(
    () => '[Service]\nUser=baci-savings-gateway\nGroup=baci-savings-ingress\n',
    (_command, argumentsList) =>
      Promise.resolve(
        argumentsList[0] === 'passwd'
          ? 'baci-savings-gateway:x:123:456::/:/usr/sbin/nologin'
          : 'baci-savings-ingress:x:789:'
      )
  );
  assert.deepEqual(account, { uid: 123, gid: 789 });
});

test('recovers only the stopped gateway and waits for a delayed socket', async () => {
  const input = binding();
  input.identity.containers = {
    auth: { ip: '127.0.0.2' },
    rest: { ip: '127.0.0.3' },
  };
  input.identity.networks = {};
  let calls = 0;
  let socketAttempts = 0;
  const commands = [];
  const stages = [];
  const state = (name) => {
    if (name === 'baci-savings-drafts.service')
      return { ActiveState: 'active', MainPID: '71' };
    calls += 1;
    return calls < 3
      ? { ActiveState: 'failed', MainPID: '0', InvocationID: '' }
      : { ActiveState: 'active', MainPID: '72', InvocationID: 'a'.repeat(32) };
  };
  const result = await recover(
    {
      report: ({ stage }) => stages.push(stage),
      now: (() => {
        let value = deadline - 1000;
        return () => (value += 10);
      })(),
      monotonic: (() => {
        let value = 0;
        return () => (value += 100);
      })(),
      verifyGraph: () => undefined,
      readManagedFile: undefined,
      serviceState: state,
      run: (command, argumentsList) => {
        commands.push([command, argumentsList]);
        return '';
      },
      requestStatus: () => 200,
      replaceEvidence: () => undefined,
      gatewayAccount: () => ({ uid: 123, gid: 789 }),
      verifySocket: () => {
        socketAttempts += 1;
        if (socketAttempts === 1) throw new Error('not ready');
      },
    },
    [
      { readManagedFile: () => ({ value: input }) },
      {
        managedInventory: (_binding, _run, now) => ({
          observedAt: new Date(now()).toISOString(),
        }),
      },
      {
        validateManagedStartup: (_binding, evidence) => {
          assert.ok(
            Date.parse(evidence.inventory.observedAt) >=
              Date.parse(evidence.receipt.verifiedAt),
            'inventory must be observed after firewall/reachability verification'
          );
        },
      },
      { validateRoutingIdentity: () => undefined },
    ]
  );
  assert.equal(result.status, 'recovered');
  assert.deepEqual(stages.slice(0, 5), [
    'graph-verification',
    'module-loading',
    'binding-read',
    'binding-validation',
    'service-preflight',
  ]);
  assert.equal(socketAttempts, 2);
  assert.equal(
    commands.some(
      ([command, argumentsList]) =>
        command === '/usr/bin/systemctl' &&
        argumentsList.join(' ') ===
          'start --no-block baci-savings-gateway.service'
    ),
    true
  );
  assert.equal(
    commands.some(
      ([command, argumentsList]) =>
        command === '/usr/bin/systemctl' && argumentsList.includes('stop')
    ),
    false
  );
});
