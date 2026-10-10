import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateManagedGateway,
  validateManagedBinding,
  validateManagedStartup,
} from '../../isolated-savings/managed-gateway.mjs';
import { routingFixture } from '../../isolated-savings/private-routing.test-support.mjs';
import { validateRoutingIdentity } from '../../isolated-savings/private-routing-inventory.mjs';
import { refreshEndpoints } from './endpoint_probe.mjs';

function fixture() {
  const value = routingFixture();
  const { host, containers, networks, restRoutes } = value.receipt;
  const now = Date.now();
  const binding = {
    version: 1,
    identity: { host, containers, networks, restRoutes },
    reviewedAt: new Date(now - 10000).toISOString(),
    leaseNotBefore: new Date(now - 5000).toISOString(),
    leaseExpiresAt: new Date(now + 60000).toISOString(),
  };
  for (const [index, endpointId] of [
    '180d11b7c11601217b5202d524be1762b04531d64c66ca589c04fc822c4ffe24',
    'f6a66017e2d3e8b4ea8f288b2bc91dfccfe9757d551bce80a0d692df2fe42fa7',
  ].entries()) {
    const container = value.inventory.containers[index];
    container.NetworkSettings.Networks[
      value.inventory.networks[0].Name
    ].EndpointID = endpointId;
    value.inventory.networks[0].Containers[container.Id].EndpointID =
      endpointId;
  }
  const calls = [];
  const ports = {
    validateRoutingIdentity,
    validateManagedBinding,
    validateManagedStartup,
    generateManagedGateway,
    collectSupervisorInventory: async () => ({
      ...structuredClone(value.inventory),
      observedAt: new Date().toISOString(),
    }),
    run: async (command, args) => {
      calls.push([command, args]);
      return await Promise.resolve({
        stdout: command.endsWith('curl') ? '200' : '',
      });
    },
  };
  return { binding, inventory: value.inventory, ports, calls };
}

test('actual validator accepts only corroborated endpoint rotation and preserves every other binding field', async () => {
  const value = fixture();
  const original = structuredClone(value.binding);
  const result = await refreshEndpoints(
    { binding: value.binding },
    value.ports
  );
  assert.deepEqual(value.binding, original);
  for (const name of ['auth', 'rest']) {
    assert.notEqual(
      result.binding.identity.containers[name].endpointId,
      original.identity.containers[name].endpointId
    );
    result.binding.identity.containers[name].endpointId =
      original.identity.containers[name].endpointId;
  }
  assert.deepEqual(result.binding, original);
  assert.equal(
    value.calls.filter(([command]) => command.endsWith('iptables')).length,
    2
  );
  assert.equal(
    value.calls.filter(([command]) => command.endsWith('curl')).length,
    2
  );
});

for (const [name, mutate] of [
  [
    'foreign CID',
    (value) => {
      value.inventory.containers[0].Id = 'a'.repeat(64);
    },
  ],
  [
    'foreign IP',
    (value) => {
      value.inventory.containers[0].NetworkSettings.Networks[
        value.inventory.networks[0].Name
      ].IPAddress = '172.23.0.99';
    },
  ],
  [
    'foreign network',
    (value) => {
      value.inventory.networks[0].Id = 'a'.repeat(64);
    },
  ],
  [
    'membership mismatch',
    (value) => {
      value.inventory.networks[0].Containers[
        value.inventory.containers[0].Id
      ].EndpointID = 'a'.repeat(64);
    },
  ],
  [
    'image drift',
    (value) => {
      value.inventory.containers[0].Config.Image = 'foreign';
    },
  ],
  [
    'profile drift',
    (value) => {
      value.inventory.containers[0].HostConfig.Privileged = true;
    },
  ],
  [
    'unhealthy',
    (value) => {
      value.inventory.containers[0].State.Health.Status = 'unhealthy';
    },
  ],
  [
    'endpoint not pinned',
    (value) => {
      value.inventory.containers[0].NetworkSettings.Networks[
        value.inventory.networks[0].Name
      ].EndpointID = 'a'.repeat(64);
    },
  ],
])
  test(`${name} refuses before health collection`, async () => {
    const value = fixture();
    mutate(value);
    await assert.rejects(
      refreshEndpoints({ binding: value.binding }, value.ports)
    );
    assert.equal(value.calls.length, 0);
  });

test('payload clock/extra keys and missing firewall refuse', async () => {
  const value = fixture();
  await assert.rejects(
    refreshEndpoints({ binding: value.binding, now: 0 }, value.ports)
  );
  value.ports.run = async (command) => {
    if (command.endsWith('iptables')) throw new Error('missing');
    return await Promise.resolve({ stdout: '200' });
  };
  await assert.rejects(
    refreshEndpoints({ binding: value.binding }, value.ports)
  );
});

test('second inventory drift refuses rather than using preliminary inventory', async () => {
  const value = fixture();
  let count = 0;
  const collect = value.ports.collectSupervisorInventory;
  value.ports.collectSupervisorInventory = async () => {
    const result = await collect();
    if (++count === 2) result.containers[0].HostConfig.Privileged = true;
    return result;
  };
  await assert.rejects(
    refreshEndpoints({ binding: value.binding }, value.ports)
  );
});
