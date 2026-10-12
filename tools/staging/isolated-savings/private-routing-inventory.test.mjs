import assert from 'node:assert/strict';
import test from 'node:test';
import { routingFixture } from './private-routing.test-support.mjs';
import { validatePrivateRouting } from './private-routing-inventory.mjs';

test('matches independent receipt to healthy owned endpoints on both internal bridges', () => {
  const { receipt, inventory, now } = routingFixture();
  assert.deepEqual(
    validatePrivateRouting(receipt, inventory, now).destinations,
    { auth: '172.23.0.4', rest: '172.23.0.3' }
  );
});

test('rejects stale, future, or pre-verification inventory', () => {
  for (const change of [
    (fixture) => {
      fixture.now += 300001;
    },
    (fixture) => {
      fixture.now -= 1;
    },
    (fixture) => {
      fixture.inventory.observedAt = '2026-09-14T08:59:59.000Z';
    },
    (fixture) => {
      fixture.receipt.verifiedAt = 'invalid';
    },
    (fixture) => {
      fixture.receipt.firewallVerified = false;
    },
    (fixture) => {
      fixture.receipt.hostReachabilityVerified = false;
    },
  ]) {
    const fixture = routingFixture();
    change(fixture);
    assert.throws(() =>
      validatePrivateRouting(fixture.receipt, fixture.inventory, fixture.now)
    );
  }
});

test('rejects recreated containers even if their names and IP addresses are reused', () => {
  const { receipt, inventory, now } = routingFixture();
  inventory.containers[0].Id = 'a'.repeat(64);
  assert.throws(() => validatePrivateRouting(receipt, inventory, now));
});

test('rejects recreated networks, moved endpoints, duplicate addresses and unrelated ownership', () => {
  for (const change of [
    (inventory) => {
      inventory.networks[0].Id = 'b'.repeat(64);
    },
    (inventory) => {
      inventory.containers[0].NetworkSettings.Networks[
        'baci-isolated-savings_database'
      ].EndpointID = 'c'.repeat(64);
    },
    (inventory) => {
      inventory.containers[0].NetworkSettings.Networks[
        'baci-isolated-savings_database'
      ].IPAddress = '172.23.0.9';
    },
    (inventory) => {
      inventory.networks[0].Containers.extra = { IPv4Address: '172.23.0.4/16' };
    },
    (inventory) => {
      inventory.containers[0].Config.Labels['com.docker.compose.project'] =
        'production';
    },
    (inventory) => {
      inventory.networks[0].Options['com.docker.network.bridge.name'] =
        'docker0';
    },
    (inventory) => {
      inventory.networks[0].Internal = false;
    },
    (inventory) => {
      inventory.networks[1].EnableIPv6 = true;
    },
    (inventory) => {
      inventory.containers[0].NetworkSettings.Networks.external = {};
    },
    (inventory) => {
      inventory.containers[0].HostConfig.RestartPolicy.Name = 'always';
    },
    (inventory) => {
      inventory.containers[0].State.Health.Status = 'unhealthy';
    },
    (inventory) => {
      inventory.containers[0].Config.Image = 'supabase/gotrue:latest';
    },
    (inventory) => {
      inventory.containers[0].Config.Env = ['SECRET=do-not-echo'];
    },
  ]) {
    const { receipt, inventory, now } = routingFixture();
    change(inventory);
    assert.throws(() => validatePrivateRouting(receipt, inventory, now));
  }
});

test('rejects public, gateway, malformed and out-of-subnet destinations', () => {
  for (const ip of [
    '8.8.8.8',
    '172.23.0.1',
    '172.23.0.0',
    '172.23.255.255',
    '172.24.0.4',
    '127.0.0.1',
    '172.23.0.4; include /tmp/evil;',
    '::1',
  ]) {
    const { receipt, inventory, now } = routingFixture();
    receipt.containers.auth.ip = ip;
    inventory.containers[0].NetworkSettings.Networks[
      'baci-isolated-savings_database'
    ].IPAddress = ip;
    inventory.networks[0].Containers[inventory.containers[0].Id].IPv4Address =
      `${ip}/16`;
    assert.throws(() => validatePrivateRouting(receipt, inventory, now));
  }
});

test('rejects alternate hosts, unsafe routes, duplicate routes and method injection', () => {
  for (const change of [
    (receipt) => {
      receipt.host = 'staging.ogabassey.com';
    },
    (receipt) => {
      receipt.restRoutes[0].path = '/rest/v1/';
    },
    (receipt) => {
      receipt.restRoutes[0].path = '/rest/v1/../admin';
    },
    (receipt) => {
      receipt.restRoutes[0].path = '/rest/v1/%61dmin';
    },
    (receipt) => {
      receipt.restRoutes[0].path = '/rest/v1/table;';
    },
    (receipt) => {
      receipt.restRoutes.push(receipt.restRoutes[0]);
    },
    (receipt) => {
      receipt.restRoutes[0].methods = ['GET|TRACE'];
    },
    (receipt) => {
      receipt.restRoutes[0].methods = ['OPTIONS'];
    },
  ]) {
    const { receipt, inventory, now } = routingFixture();
    change(receipt);
    assert.throws(() => validatePrivateRouting(receipt, inventory, now));
  }
});
