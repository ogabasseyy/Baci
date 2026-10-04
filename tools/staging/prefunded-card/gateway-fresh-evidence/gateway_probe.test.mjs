import assert from 'node:assert/strict';
import test from 'node:test';
import {
  generateManagedGateway,
  validateManagedBinding,
  validateManagedStartup,
} from '../../isolated-savings/managed-gateway.mjs';
import { routingFixture } from '../../isolated-savings/private-routing.test-support.mjs';
import { probeGateway } from './gateway_probe.mjs';

function fixture(fail) {
  const calls = [];
  const binding = {
    identity: {
      host: 'staging-auth.ogabassey.com',
      containers: { auth: { ip: '172.23.0.3' }, rest: { ip: '172.23.0.4' } },
    },
  };
  const ports = {
    validateManagedBinding: () => calls.push('binding'),
    validateManagedStartup: () => {
      calls.push('proof');
      if (fail === 'proof') throw new Error('proof');
    },
    generateManagedGateway: () => calls.push('graph'),
    collectSupervisorInventory: async () => {
      calls.push('inventory');
      if (fail === 'inventory') throw new Error('inventory');
      return await Promise.resolve({
        observedAt: new Date().toISOString(),
        containers: [],
        networks: [],
      });
    },
    run: async (executable, args) => {
      calls.push([executable, args]);
      if (fail === 'firewall' && executable.endsWith('iptables'))
        throw new Error('firewall');
      if (executable.endsWith('curl'))
        return {
          stdout:
            fail === 'health'
              ? '500'
              : args.some(
                    (part) =>
                      part.includes('https://') ||
                      part.includes('--unix-socket')
                  )
                ? '401'
                : '200',
        };
      return await Promise.resolve({ stdout: '' });
    },
  };
  return { binding, ports, calls };
}

test('only successful actual health/firewall/inventory checks create a fresh receipt', async () => {
  const value = fixture();
  const result = await probeGateway(
    'collect',
    { binding: value.binding },
    value.ports
  );
  assert.equal(result.evidence.receipt.firewallVerified, true);
  assert.equal(result.evidence.receipt.hostReachabilityVerified, true);
  assert.deepEqual(
    result.evidence.receipt.containers,
    value.binding.identity.containers
  );
  assert.ok(value.calls.includes('inventory') && value.calls.includes('proof'));
  const commands = value.calls.filter(Array.isArray);
  assert.equal(
    commands.filter(([name]) => name.endsWith('iptables')).length,
    2
  );
  assert.ok(
    commands
      .filter(([name]) => name.endsWith('iptables'))
      .every(([, args]) => args.includes('-C'))
  );
});

test('unhealthy upstream, missing firewall, bad inventory or rejected proof cannot produce evidence', async () => {
  for (const failure of ['health', 'firewall', 'inventory', 'proof']) {
    const value = fixture(failure);
    await assert.rejects(
      probeGateway('collect', { binding: value.binding }, value.ports)
    );
  }
});

test('verification probes only fixed unauthenticated GETs and rejects non-401', async () => {
  const value = fixture();
  await probeGateway('verify', {}, value.ports);
  const calls = value.calls.filter(Array.isArray);
  assert.equal(calls.length, 6);
  for (const [executable, args] of calls) {
    assert.equal(executable, '/usr/bin/curl');
    assert.ok(
      !args.includes('-H') && !args.includes('--data') && !args.includes('-X')
    );
  }
  const failed = fixture('health');
  await assert.rejects(probeGateway('verify', {}, failed.ports), /401/);
});

test('unknown probe mode or extra input cannot select URLs, commands or clock overrides', async () => {
  const value = fixture();
  await assert.rejects(probeGateway('write', {}, value.ports));
  await assert.rejects(
    probeGateway('collect', { binding: value.binding, now: 0 }, value.ports)
  );
});

test('44390-second startup evidence fails the actual protocol; fresh observed checks pass without changing binding', async () => {
  const value = routingFixture();
  const { host, containers, networks, restRoutes } = value.receipt;
  const binding = {
    version: 1,
    identity: { host, containers, networks, restRoutes },
    reviewedAt: new Date(Date.now() - 60000).toISOString(),
    leaseNotBefore: new Date(Date.now() - 60000).toISOString(),
    leaseExpiresAt: '2026-10-06T15:59:10.442Z',
  };
  const original = structuredClone(binding);
  const old = structuredClone(value);
  old.receipt.verifiedAt = new Date(Date.now() - 44390000).toISOString();
  old.inventory.observedAt = old.receipt.verifiedAt;
  const ports = {
    ...fixture().ports,
    validateManagedBinding,
    validateManagedStartup,
    generateManagedGateway,
    collectSupervisorInventory: async () => ({
      ...structuredClone(value.inventory),
      observedAt: new Date().toISOString(),
    }),
  };
  await assert.rejects(
    probeGateway(
      'validate',
      {
        binding,
        evidence: {
          receipt: old.receipt,
          inventory: old.inventory,
        },
      },
      ports
    ),
    /evidence rejected/
  );
  const result = await probeGateway('collect', { binding }, ports);
  assert.deepEqual(
    await probeGateway(
      'validate',
      { binding, evidence: result.evidence },
      ports
    ),
    { status: 'fresh-evidence-valid' }
  );
  assert.deepEqual(binding, original);
  assert.equal(
    result.evidence.receipt.verifiedAt === old.receipt.verifiedAt,
    false
  );
});
