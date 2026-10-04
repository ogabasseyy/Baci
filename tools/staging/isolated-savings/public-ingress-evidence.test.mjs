import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { generatePrivateRouting } from './private-routing.mjs';
import { routingFixture } from './private-routing.test-support.mjs';
import { generatePublicIngress } from './public-ingress.mjs';

test('binds deterministic public and private hashes without extending the receipt lease', () => {
  const { receipt, inventory, now } = routingFixture();
  const output = generatePublicIngress(receipt, inventory, now, true);
  const privateOutput = generatePrivateRouting(
    receipt,
    inventory,
    now,
    'unprivileged-test'
  );
  assert.deepEqual(
    output,
    generatePublicIngress(receipt, inventory, now, true)
  );
  assert.equal(
    output.receipt.privateConfigSha256,
    privateOutput.receipt.configSha256
  );
  assert.equal(
    output.receipt.evidenceSha256,
    privateOutput.receipt.evidenceSha256
  );
  assert.equal(output.receipt.expiresAt, privateOutput.receipt.expiresAt);
  assert.equal(output.receipt.deploymentStatus, 'not-deployed');
  assert.equal(
    output.receipt.configSha256,
    createHash('sha256').update(output.config).digest('hex')
  );
  assert.notEqual(
    generatePublicIngress(receipt, inventory, now, false).receipt.configSha256,
    output.receipt.configSha256
  );
});

test('rejects expired, boundary-expired, unhealthy, changed and injected receipts with fixed errors', () => {
  for (const mutate of [
    (input) => {
      input.now += 300001;
    },
    (input) => {
      input.now += 300000;
    },
    (input) => {
      input.inventory.containers[0].State.Running = false;
    },
    (input) => {
      input.receipt.host = 'evil.test; SECRET';
    },
    (input) => {
      input.receipt.restRoutes[0].path = '/rest/v1/products; SECRET';
    },
    (input) => {
      input.receipt.restRoutes[0].methods = ['POST; SECRET'];
    },
    (input) => {
      input.receipt.containers.auth.id = 'a'.repeat(64);
    },
  ]) {
    const input = routingFixture();
    mutate(input);
    assert.throws(
      () =>
        generatePublicIngress(input.receipt, input.inventory, input.now, true),
      /^Error: Public ingress evidence rejected$/
    );
  }
});
