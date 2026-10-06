import { expect, it } from 'vitest';
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

it('accepts reordered keyed systemd output', () => {
  const state = parseState(
    'DropInPaths=\nMainPID=0\nActiveState=failed\nLoadState=loaded',
    ['LoadState', 'ActiveState', 'MainPID', 'DropInPaths'],
    ['DropInPaths']
  );
  expect(state.ActiveState).toBe('failed');
});

it('rejects missing or duplicate systemd properties', () => {
  expect(() =>
    parseState('LoadState=loaded\nActiveState=failed', [
      'LoadState',
      'ActiveState',
      'MainPID',
    ])
  ).toThrow();
  expect(() =>
    parseState(
      'LoadState=loaded\nLoadState=loaded\nActiveState=failed\nMainPID=0',
      ['LoadState', 'ActiveState', 'MainPID']
    )
  ).toThrow();
});

it('rejects an expired or widened binding', () => {
  const expired = binding();
  expired.leaseExpiresAt = new Date(deadline - 1).toISOString();
  expect(() => validateBinding(expired, deadline - 2)).toThrow();
  const widened = binding();
  widened.identity.restRoutes.push({
    path: '/rest/v1/rpc/funding',
    methods: ['POST'],
  });
  expect(() => validateBinding(widened, deadline - 1)).toThrow();
});

it('preserves the exact fixed five-route binding until expiry', () => {
  expect(validateBinding(binding(), deadline - 1).restRoutes.length).toBe(5);
});

it('accepts the eleven-route transitioned binding and still rejects widening', () => {
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
  expect(validateBinding(transitioned, deadline - 1).restRoutes.length).toBe(
    11
  );
  const widened = structuredClone(transitioned);
  widened.identity.restRoutes.push({
    path: '/rest/v1/rpc/funding',
    methods: ['POST'],
  });
  expect(() => validateBinding(widened, deadline - 1)).toThrow();
});

it('bugfix: accepts the approved millisecond lease within the fixed deadline second', () => {
  const actual = binding();
  actual.leaseExpiresAt = '2026-09-29T15:59:10.442Z';
  actual.leaseNotBefore = '2026-09-22T15:59:10.442Z';
  actual.reviewedAt = '2026-09-22T15:59:10.442Z';
  expect(validateBinding(actual, deadline - 1).restRoutes.length).toBe(5);
  const wrongSecond = binding();
  wrongSecond.leaseExpiresAt = '2026-09-29T15:59:11.000Z';
  expect(() => validateBinding(wrongSecond, deadline - 1)).toThrow();
});

it('uses the unit group rather than the account primary group', async () => {
  const account = await gatewayAccount(
    () => '[Service]\nUser=baci-savings-gateway\nGroup=baci-savings-ingress\n',
    (_command, argumentsList) =>
      Promise.resolve(
        argumentsList[0] === 'passwd'
          ? 'baci-savings-gateway:x:123:456::/:/usr/sbin/nologin'
          : 'baci-savings-ingress:x:789:'
      )
  );
  expect(account).toEqual({ uid: 123, gid: 789 });
});

it('recovers only the stopped gateway and waits for a delayed socket', async () => {
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
          expect(
            Date.parse(evidence.inventory.observedAt) >=
              Date.parse(evidence.receipt.verifiedAt),
            'inventory must be observed after firewall/reachability verification'
          ).toBe(true);
        },
      },
      { validateRoutingIdentity: () => undefined },
    ]
  );
  expect(result.status).toBe('recovered');
  expect(stages.slice(0, 5)).toEqual([
    'graph-verification',
    'module-loading',
    'binding-read',
    'binding-validation',
    'service-preflight',
  ]);
  expect(socketAttempts).toBe(2);
  expect(
    commands.some(
      ([command, argumentsList]) =>
        command === '/usr/bin/systemctl' &&
        argumentsList.join(' ') ===
          'start --no-block baci-savings-gateway.service'
    )
  ).toBe(true);
  expect(
    commands.some(
      ([command, argumentsList]) =>
        command === '/usr/bin/systemctl' && argumentsList.includes('stop')
    )
  ).toBe(false);
});
