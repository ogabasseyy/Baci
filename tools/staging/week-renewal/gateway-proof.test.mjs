import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { routingFixture } from '../isolated-savings/private-routing.test-support.mjs';

test('fresh gateway proof rejects stale evidence, changed identities and false firewall assertions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'baci-gateway-proof-'));
  try {
    let source = await readFile(
      new URL('./gateway-proof.mjs', import.meta.url),
      'utf8'
    );
    const module = new URL(
      '../isolated-savings/managed-gateway.mjs',
      import.meta.url
    ).href;
    source = source.replace(
      '/opt/baci-savings-gateway/managed-gateway.mjs',
      module
    );
    const now = Date.parse('2026-09-30T18:42:52.000Z');
    source = source.replace(
      /process\.platform !== 'linux' \|\|\s*process\.geteuid\(\) !== 0 \|\|\s*/,
      ''
    );
    source = source.replace('Date.now()', String(now));
    const filename = join(directory, 'proof.mjs');
    await writeFile(filename, source);
    const input = routingFixture();
    const { host, containers, networks, restRoutes } = input.receipt;
    input.receipt.verifiedAt = new Date(now - 1000).toISOString();
    input.inventory.observedAt = new Date(now).toISOString();
    const value = {
      binding: {
        version: 1,
        identity: { host, containers, networks, restRoutes },
        reviewedAt: input.receipt.verifiedAt,
        leaseNotBefore: input.receipt.verifiedAt,
        leaseExpiresAt: '2026-10-06T15:59:10.442Z',
      },
      input: { receipt: input.receipt, inventory: input.inventory },
    };
    const run = (payload) =>
      spawnSync(process.execPath, [filename], {
        input: JSON.stringify(payload),
        encoding: 'utf8',
      });
    const good = run(value);
    assert.equal(good.status, 0, good.stderr);
    assert.deepEqual(JSON.parse(good.stdout), {
      valid: true,
      expiresAt: '2026-10-06T15:59:10.442Z',
    });
    for (const change of [
      (payload) => {
        payload.input.receipt.firewallVerified = false;
      },
      (payload) => {
        payload.input.receipt.verifiedAt = new Date(now - 300001).toISOString();
      },
      (payload) => {
        payload.input.inventory.containers[0].Id = 'f'.repeat(64);
      },
      (payload) => {
        payload.binding.leaseExpiresAt = '2026-10-07T15:59:10.442Z';
      },
    ]) {
      const payload = structuredClone(value);
      change(payload);
      const bad = run(payload);
      assert.equal(bad.status, 1);
      assert.equal(bad.stdout, '');
      assert.equal(bad.stderr, 'Connectivity gateway evidence refused.\n');
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
