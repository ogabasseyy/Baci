import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFixture } from './fixtures.ts';
import { createScreenSource } from './screen-source.ts';

test('serializable source keeps consent and explicit fixture eligibility independent', () => {
  const policy = createFixture('green', false).draft;
  const input = {
    policy,
    session: true,
    eligibility: 'blocked' as const,
    funding: 'ready' as const,
    progress: 'ready' as const,
  };
  const required = createScreenSource(input);
  const accepted = createScreenSource({
    ...input,
    policy: { ...policy, consent: 'accepted' },
  });
  assert.equal(required.status, 'ready');
  assert.equal(accepted.status, 'ready');
  if (required.status !== 'ready' || accepted.status !== 'ready')
    throw new Error('Missing synthetic source');
  assert.equal(required.eligibility.status, 'blocked');
  assert.equal(accepted.eligibility.status, 'blocked');
  assert.deepEqual(JSON.parse(JSON.stringify(accepted)), accepted);
  const allowed = createScreenSource({
    ...input,
    policy: { ...policy, consent: 'accepted' },
    eligibility: 'allowed',
  });
  assert.equal(allowed.status, 'ready');
  if (allowed.status !== 'ready') throw new Error('Missing synthetic source');
  assert.equal(allowed.eligibility.status, 'allowed');
  assert.deepEqual(createScreenSource({ ...input, session: false }), {
    environment: 'staging',
    status: 'unauthenticated',
  });
});

test('required consent cannot receive allowed fixture eligibility', () => {
  const source = createScreenSource({
    policy: createFixture('blue', false).draft,
    session: true,
    eligibility: 'allowed',
    funding: 'ready',
    progress: 'ready',
  });
  if (source.status !== 'ready') throw new Error('Missing synthetic source');
  assert.equal(source.eligibility.status, 'blocked');
  assert.equal(source.policy.device.variant, '256 GB / Blue');
});
