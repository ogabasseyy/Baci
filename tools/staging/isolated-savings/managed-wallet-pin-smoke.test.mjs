import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runPrivateSmoke } from './managed-private-smoke-runner.mjs';
import { fixture } from './managed-private-smoke-test-fixture.mjs';
import { managedRouteContract } from './managed-route-contract.mjs';

const identity = JSON.parse(
  await readFile(
    new URL('./managed-private-smoke-identity.json', import.meta.url)
  )
);
const contract = 'hosted-wallet-pin';

function input(routes = managedRouteContract(contract)) {
  return { identity: { ...identity, restRoutes: routes }, uid: 100, gid: 101 };
}

function options(leaseExpiresAt) {
  return { retainOnReady: true, routeContract: contract, leaseExpiresAt };
}

test('PIN routing keeps the exact deadline and collects fresh evidence before retaining', async () => {
  const { actions, files, calls } = fixture('', 120000);
  const start = actions.now();
  const deadline = new Date(start + 120000).toISOString();
  await runPrivateSmoke(
    input(),
    actions,
    () => Promise.resolve(),
    options(deadline)
  );
  assert.equal(
    files.find(({ name }) => name === 'binding').value.leaseExpiresAt,
    deadline
  );
  const evidence = files.find(({ name }) => name === 'startup-evidence').value;
  assert.equal(evidence.receipt.verifiedAt, new Date(start).toISOString());
  assert.deepEqual(evidence.receipt.restRoutes, managedRouteContract(contract));
  assert.equal(
    calls.filter(([command]) => command === '/usr/sbin/iptables').length,
    2
  );
  assert.deepEqual(calls.filter(([command]) => command === 'GET').slice(0, 2), [
    ['GET', '/health'],
    ['GET', '/'],
  ]);
});

for (const expiry of [
  undefined,
  null,
  'invalid',
  new Date(1799999999999).toISOString(),
  new Date(1800000000000 + 8 * 86400000).toISOString(),
]) {
  test(
    'PIN routing rejects missing, invalid, expired or extended lease: ' +
      String(expiry),
    async () => {
      const { actions, calls, files } = fixture();
      await assert.rejects(
        runPrivateSmoke(
          input(),
          actions,
          () => Promise.resolve(),
          options(expiry)
        )
      );
      assert.equal(calls.length, 0);
      assert.equal(files.length, 0);
    }
  );
}

for (const mutate of [
  (routes) => {
    routes[0].methods.push('POST');
  },
  (routes) => {
    routes.pop();
  },
  (routes) => {
    routes.push({
      path: '/rest/v1/rpc/prepare_provisioning_intent',
      methods: ['POST'],
    });
  },
  (routes) => {
    routes.at(-1).methods.push('GET');
  },
]) {
  test('PIN route drift is rejected before host actions', async () => {
    const { actions, calls, files } = fixture();
    const routes = managedRouteContract(contract);
    mutate(routes);
    await assert.rejects(
      runPrivateSmoke(
        input(routes),
        actions,
        () => Promise.resolve(),
        options(new Date(actions.now() + 60000).toISOString())
      )
    );
    assert.equal(calls.length, 0);
    assert.equal(files.length, 0);
  });
}
