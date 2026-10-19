import assert from 'node:assert/strict';
import test from 'node:test';
import { routingFixture } from './private-routing.test-support.mjs';
import { validatePrivateRouting } from './private-routing-inventory.mjs';
import { collectSupervisorInventory } from './private-routing-supervisor-inventory.mjs';

test('collects only fixed read-only local Docker projections and preserves validator contract', async () => {
  const { receipt, inventory, now } = routingFixture();
  const records = [...inventory.containers, ...inventory.networks];
  const calls = [];
  const collected = await collectSupervisorInventory(
    receipt,
    (args) => {
      calls.push(args);
      return JSON.stringify(
        records.find((record) => record.Id === args.at(-1))
      );
    },
    () => now
  );
  assert.doesNotThrow(() => validatePrivateRouting(receipt, collected, now));
  assert.equal(calls.length, 4);
  for (const args of calls) {
    assert.deepEqual(args.slice(0, 2), [
      '--host',
      'unix:///var/run/docker.sock',
    ]);
    assert.equal(args[3], 'inspect');
    assert.doesNotMatch(
      args.join(' '),
      /\.Config\.Env|\.State\.Health\.Log| restart | start | exec | logs /
    );
  }
});

test('rejects malformed identities without invoking Docker and propagates inventory failures', async () => {
  const { receipt } = routingFixture();
  receipt.containers.auth.id = 'unsafe;command';
  let called = false;
  await assert.rejects(
    collectSupervisorInventory(
      receipt,
      () => {
        called = true;
      },
      Date.now
    )
  );
  assert.equal(called, false);
  const valid = routingFixture();
  await assert.rejects(
    collectSupervisorInventory(
      valid.receipt,
      () => {
        throw new Error('unavailable');
      },
      Date.now
    )
  );
});
