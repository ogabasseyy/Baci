import assert from 'node:assert/strict';
import test from 'node:test';
import { managedInventory } from './managed-inventory-helper.mjs';
import { routingFixture } from './private-routing.test-support.mjs';

for (const [name, mutate] of [
  [
    'expired lease',
    (binding, now) => {
      binding.leaseExpiresAt = new Date(now).toISOString();
    },
  ],
  [
    'future lease',
    (binding, now) => {
      binding.leaseNotBefore = new Date(now + 1).toISOString();
    },
  ],
  [
    'oversized lease',
    (binding, now) => {
      binding.leaseExpiresAt = new Date(now + 86400001).toISOString();
    },
  ],
  [
    'wrong host',
    (binding) => {
      binding.identity.host = 'unexpected.example';
    },
  ],
  [
    'unknown binding field',
    (binding) => {
      binding.extra = true;
    },
  ],
  [
    'wrong container keys',
    (binding) => {
      binding.identity.containers = {
        first: binding.identity.containers.auth,
        second: binding.identity.containers.rest,
      };
    },
  ],
  [
    'unknown identity field',
    (binding) => {
      binding.identity.extra = true;
    },
  ],
  [
    'invalid endpoint',
    (binding) => {
      binding.identity.containers.auth.endpointId = 'invalid';
    },
  ],
  [
    'public address',
    (binding) => {
      binding.identity.containers.auth.ip = '8.8.8.8';
    },
  ],
  [
    'invalid subnet',
    (binding) => {
      binding.identity.networks.database.subnet = '172.23.0.0/99';
    },
  ],
  [
    'unapproved route method',
    (binding) => {
      binding.identity.restRoutes[0].methods = ['CONNECT'];
    },
  ],
  [
    'invalid route',
    (binding) => {
      binding.identity.restRoutes[0].path = '/admin';
    },
  ],
]) {
  test(`rejects ${name} before any privileged inspection`, async () => {
    const fixture = routingFixture();
    const { host, containers, networks, restRoutes } = fixture.receipt;
    const binding = {
      version: 1,
      identity: { host, containers, networks, restRoutes },
      reviewedAt: fixture.receipt.verifiedAt,
      leaseNotBefore: fixture.receipt.verifiedAt,
      leaseExpiresAt: new Date(fixture.now + 3600000).toISOString(),
    };
    mutate(binding, fixture.now);
    const calls = [];
    const run = (args) => {
      calls.push(args);
      return JSON.stringify(
        [...fixture.inventory.containers, ...fixture.inventory.networks].find(
          (entry) => entry.Id === args.at(-1)
        )
      );
    };

    await assert.rejects(managedInventory(binding, run, () => fixture.now));

    assert.equal(calls.length, 0);
  });
}

test('fixed inspector requests exact reviewed IDs only and strips unrelated labels', async () => {
  const fixture = routingFixture();
  const { host, containers, networks, restRoutes } = fixture.receipt;
  const binding = {
    version: 1,
    identity: { host, containers, networks, restRoutes },
    reviewedAt: fixture.receipt.verifiedAt,
    leaseNotBefore: fixture.receipt.verifiedAt,
    leaseExpiresAt: new Date(fixture.now + 3600000).toISOString(),
  };
  fixture.inventory.containers[0].Config.Labels.secret = 'never-return';
  const calls = [];
  const run = (args) => {
    calls.push(args);
    const source = [
      ...fixture.inventory.containers,
      ...fixture.inventory.networks,
    ].find((entry) => entry.Id === args.at(-1));
    return JSON.stringify(source);
  };
  const output = await managedInventory(binding, run, () => fixture.now);
  assert.equal(calls.length, 4);
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 2), [
      '--host',
      'unix:///var/run/docker.sock',
    ]);
    assert.equal(args[3], 'inspect');
    assert.match(args.at(-1), /^[a-f0-9]{64}$/);
  }
  assert.doesNotMatch(JSON.stringify(output), /never-return/);
  fixture.inventory.containers[0].State.Running = false;
  await assert.rejects(managedInventory(binding, run, () => fixture.now));
  await assert.rejects(
    managedInventory(
      binding,
      () => {
        throw new Error('timeout');
      },
      () => fixture.now
    )
  );
});

test('withholds inventory when the lease expires during inspection', async () => {
  const fixture = routingFixture();
  const { host, containers, networks, restRoutes } = fixture.receipt;
  const binding = {
    version: 1,
    identity: { host, containers, networks, restRoutes },
    reviewedAt: fixture.receipt.verifiedAt,
    leaseNotBefore: fixture.receipt.verifiedAt,
    leaseExpiresAt: new Date(fixture.now + 1000).toISOString(),
  };
  let current = fixture.now;
  let inspections = 0;
  const run = (args) => {
    inspections += 1;
    current = fixture.now + 1000;
    return JSON.stringify(
      [...fixture.inventory.containers, ...fixture.inventory.networks].find(
        (entry) => entry.Id === args.at(-1)
      )
    );
  };

  await assert.rejects(
    managedInventory(binding, run, () => current),
    /Managed lease rejected/
  );

  assert.equal(inspections, 4);
});
